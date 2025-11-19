// routes/analytics_routes.ts
// Note: All dates are displayed in IST (UTC+5:30)
// PostgreSQL stores timestamps in UTC, so we convert IST ranges to UTC for queries

import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const router = express.Router();
const prisma = new PrismaClient();

const ADMIN_SECRET = process.env.ADMIN_SECRET || "asdfasdf";

// IST offset: UTC+5:30 = 5.5 hours = 330 minutes
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Helper functions to convert between UTC and IST
const getISTDate = (date: Date = new Date()): Date => {
  return new Date(date.getTime() + IST_OFFSET_MS);
};

const getUTCFromIST = (istDate: Date): Date => {
  return new Date(istDate.getTime() - IST_OFFSET_MS);
};

const formatISTDate = (istDate: Date): string => {
  // Format date as YYYY-MM-DD
  // istDate is already in IST representation (offset added), so we use UTC methods
  // to get the IST date components
  const year = istDate.getUTCFullYear();
  const month = String(istDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(istDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

type Period = "day" | "week" | "month";

type Bucket = {
  label: string;
  startIST: Date;
  endIST: Date;
  startUTC: Date;
  endUTC: Date;
};

// Build time buckets in IST, with corresponding UTC ranges for DB queries
const buildISTBuckets = (
  period: Period,
  limit: number,
  nowIST: Date,
  nowUTC: Date
): Bucket[] => {
  const buckets: Bucket[] = [];

  for (let i = limit - 1; i >= 0; i--) {
    let periodStartIST: Date;
    let periodEndIST: Date;
    let periodLabel: string;
    const isCurrent = i === 0;

    if (period === "day") {
      periodStartIST = new Date(nowIST);
      periodStartIST.setUTCDate(periodStartIST.getUTCDate() - i);
      periodStartIST.setUTCHours(0, 0, 0, 0);

      if (isCurrent) {
        periodEndIST = new Date(nowIST);
      } else {
        periodEndIST = new Date(periodStartIST);
        periodEndIST.setUTCHours(23, 59, 59, 999);
      }

      periodLabel = formatISTDate(periodStartIST);
    } else if (period === "week") {
      periodStartIST = new Date(nowIST);
      periodStartIST.setUTCDate(periodStartIST.getUTCDate() - i * 7);

      // Get start of week (Monday) in IST, using UTC day methods on the shifted IST date
      const day = periodStartIST.getUTCDay(); // 0 (Sun) - 6 (Sat)
      const currentDate = periodStartIST.getUTCDate();
      const diff = currentDate - day + (day === 0 ? -6 : 1); // shift to Monday
      periodStartIST.setUTCDate(diff);
      periodStartIST.setUTCHours(0, 0, 0, 0);

      if (isCurrent) {
        periodEndIST = new Date(nowIST);
      } else {
        periodEndIST = new Date(periodStartIST);
        periodEndIST.setUTCDate(periodEndIST.getUTCDate() + 6);
        periodEndIST.setUTCHours(23, 59, 59, 999);
      }

      periodLabel = `Week of ${formatISTDate(periodStartIST)}`;
    } else {
      // month
      periodStartIST = new Date(
        Date.UTC(nowIST.getUTCFullYear(), nowIST.getUTCMonth() - i, 1)
      );
      periodStartIST.setUTCHours(0, 0, 0, 0);

      if (isCurrent) {
        periodEndIST = new Date(nowIST);
      } else {
        periodEndIST = new Date(
          Date.UTC(nowIST.getUTCFullYear(), nowIST.getUTCMonth() - i + 1, 0)
        );
        periodEndIST.setUTCHours(23, 59, 59, 999);
      }

      // YYYY-MM
      periodLabel = periodStartIST.toISOString().slice(0, 7);
    }

    const startUTC = getUTCFromIST(periodStartIST);
    const endUTC = isCurrent ? nowUTC : getUTCFromIST(periodEndIST);

    buckets.push({
      label: periodLabel,
      startIST: periodStartIST,
      endIST: periodEndIST,
      startUTC,
      endUTC,
    });
  }

  return buckets;
};

// Middleware to check admin secret
const requireAdminSecret = (req: Request, res: Response, next: any) => {
  const providedSecret =
    req.header("x-admin-secret") || (req.query.secret as string);

  if (!providedSecret || providedSecret !== ADMIN_SECRET) {
    res.status(401).json({
      success: false,
      error: "Unauthorized",
    });
    return;
  }
  next();
};

// Get all totals (users, contents, places, pins, trips)
router.get(
  "/totals",
  requireAdminSecret,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const [totalUsers, totalContents, totalPlaces, totalPins, totalTrips] =
        await Promise.all([
          prisma.user.count(),
          prisma.content.count(),
          prisma.placeCache.count(),
          prisma.pin.count(),
          prisma.trip.count(),
        ]);

      res.status(200).json({
        success: true,
        totals: {
          users: totalUsers,
          contents: totalContents,
          places: totalPlaces,
          pins: totalPins,
          trips: totalTrips,
        },
      });
    } catch (error) {
      console.error("Error fetching totals:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }
);

// Get new users by time period (day/week/month)
router.get(
  "/new-users",
  requireAdminSecret,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const periodParam = (req.query.period as string) || "day"; // day, week, month
      const period = periodParam as Period;
      const limit = parseInt((req.query.limit as string) || "30"); // number of periods to return

      const nowIST = getISTDate(); // Current time in IST
      const nowUTC = new Date(); // Current time in UTC (for database queries)

      const buckets = buildISTBuckets(period, limit, nowIST, nowUTC);
      if (buckets.length === 0) {
        res.status(200).json({ success: true, period, data: [] });
        return;
      }

      const globalStartUTC = buckets[0].startUTC;
      const globalEndUTC = buckets[buckets.length - 1].endUTC;

      // Single query to fetch all users in the overall range
      const users = await prisma.user.findMany({
        where: {
          createdAt: {
            gte: globalStartUTC,
            lte: globalEndUTC,
          },
        },
        select: {
          createdAt: true,
        },
      });

      const data = buckets.map((b) => ({
        period: b.label,
        count: 0,
      }));

      for (const user of users) {
        const createdIST = getISTDate(user.createdAt);
        const idx = buckets.findIndex(
          (b) => createdIST >= b.startIST && createdIST <= b.endIST
        );
        if (idx !== -1) {
          data[idx].count++;
        }
      }

      res.status(200).json({
        success: true,
        period,
        data,
      });
    } catch (error) {
      console.error("Error fetching new users:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }
);

// Get new contents by time period (day/week/month)
router.get(
  "/new-contents",
  requireAdminSecret,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const periodParam = (req.query.period as string) || "day"; // day, week, month
      const period = periodParam as Period;
      const limit = parseInt((req.query.limit as string) || "30"); // number of periods to return

      const nowIST = getISTDate();
      const nowUTC = new Date();

      const buckets = buildISTBuckets(period, limit, nowIST, nowUTC);
      if (buckets.length === 0) {
        res.status(200).json({ success: true, period, data: [] });
        return;
      }

      const globalStartUTC = buckets[0].startUTC;
      const globalEndUTC = buckets[buckets.length - 1].endUTC;

      // Single query for all contents in this overall range
      const contents = await prisma.content.findMany({
        where: {
          createdAt: {
            gte: globalStartUTC,
            lte: globalEndUTC,
          },
        },
        select: {
          createdAt: true,
        },
      });

      const data = buckets.map((b) => ({
        period: b.label,
        count: 0,
      }));

      for (const c of contents) {
        const createdIST = getISTDate(c.createdAt);
        const idx = buckets.findIndex(
          (b) => createdIST >= b.startIST && createdIST <= b.endIST
        );
        if (idx !== -1) {
          data[idx].count++;
        }
      }

      res.status(200).json({
        success: true,
        period,
        data,
      });
    } catch (error) {
      console.error("Error fetching new contents:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }
);

// Get new contents by unique users by time period
router.get(
  "/new-contents-by-unique-users",
  requireAdminSecret,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const periodParam = (req.query.period as string) || "day"; // day, week, month
      const period = periodParam as Period;
      const limit = parseInt((req.query.limit as string) || "30"); // number of periods to return

      const nowIST = getISTDate(); // Current time in IST
      const nowUTC = new Date(); // Current time in UTC (for database queries)

      const buckets = buildISTBuckets(period, limit, nowIST, nowUTC);
      if (buckets.length === 0) {
        res.status(200).json({ success: true, period, data: [] });
        return;
      }

      const globalStartUTC = buckets[0].startUTC;
      const globalEndUTC = buckets[buckets.length - 1].endUTC;

      // Fetch all contents in this overall range once
      const contents = await prisma.content.findMany({
        where: {
          createdAt: {
            gte: globalStartUTC,
            lte: globalEndUTC,
          },
        },
        select: {
          createdAt: true,
          userId: true,
          userNotes: true,
        },
      });

      const bucketData = buckets.map((b) => ({
        label: b.label,
        allUsers: new Set<unknown>(),
        nonTutorialUsers: new Set<unknown>(),
      }));

      for (const c of contents) {
        const createdIST = getISTDate(c.createdAt);
        const idx = buckets.findIndex(
          (b) => createdIST >= b.startIST && createdIST <= b.endIST
        );
        if (idx === -1) continue;

        const bucket = bucketData[idx];

        bucket.allUsers.add(c.userId);
        if (c.userNotes !== "My first Japan tutorial reel") {
          bucket.nonTutorialUsers.add(c.userId);
        }
      }

      const data = bucketData.map((b) => ({
        period: b.label,
        count: b.allUsers.size,
        contentsWithoutTutorialNote: b.nonTutorialUsers.size,
      }));

      res.status(200).json({
        success: true,
        period,
        data,
      });
    } catch (error) {
      console.error("Error fetching new contents by unique users:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }
);

// Get user count timeline (all time) - cumulative users per day in IST
router.get(
  "/user-count-timeline",
  requireAdminSecret,
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Get all users with their creation dates (one query)
      const users = await prisma.user.findMany({
        select: {
          createdAt: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      });

      if (!users.length) {
        res.status(200).json({
          success: true,
          data: [],
        });
        return;
      }

      // Map: YYYY-MM-DD (IST) -> new users that day
      const newUsersByDate = new Map<string, number>();

      for (const user of users) {
        const createdIST = getISTDate(user.createdAt);
        const key = formatISTDate(createdIST); // YYYY-MM-DD in IST
        newUsersByDate.set(key, (newUsersByDate.get(key) ?? 0) + 1);
      }

      const nowIST = getISTDate();

      // Start from the first user's IST date, truncated to start of day
      const firstCreatedIST = getISTDate(users[0].createdAt);
      const currentIST = new Date(firstCreatedIST);
      currentIST.setUTCHours(0, 0, 0, 0);

      let runningTotal = 0;
      const data: { date: string; count: number }[] = [];

      while (currentIST <= nowIST) {
        const dateKey = formatISTDate(currentIST);
        const newToday = newUsersByDate.get(dateKey) ?? 0;
        runningTotal += newToday;

        data.push({
          date: dateKey,
          count: runningTotal,
        });

        // Move to next calendar day (IST-based, but using UTC methods
        // because our currentIST already has the IST offset baked in)
        currentIST.setUTCDate(currentIST.getUTCDate() + 1);
      }

      res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      console.error("Error fetching user count timeline:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }
);

// Get power users (top users by content shared)
router.get(
  "/power-users",
  requireAdminSecret,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const period = (req.query.period as string) || "all"; // today, week, month, all
      const limit = parseInt((req.query.limit as string) || "20");

      const nowIST = getISTDate();
      const nowUTC = new Date();

      let periodStartUTC: Date | undefined;
      const periodEndUTC: Date = nowUTC;

      if (period === "today") {
        const todayStartIST = new Date(nowIST);
        todayStartIST.setUTCHours(0, 0, 0, 0);
        periodStartUTC = getUTCFromIST(todayStartIST);
      } else if (period === "week") {
        const weekStartIST = new Date(nowIST);
        const day = weekStartIST.getUTCDay();
        const currentDate = weekStartIST.getUTCDate();
        const diff = currentDate - day + (day === 0 ? -6 : 1);
        weekStartIST.setUTCDate(diff);
        weekStartIST.setUTCHours(0, 0, 0, 0);
        periodStartUTC = getUTCFromIST(weekStartIST);
      } else if (period === "month") {
        const monthStartIST = new Date(
          nowIST.getUTCFullYear(),
          nowIST.getUTCMonth(),
          1
        );
        monthStartIST.setUTCHours(0, 0, 0, 0);
        periodStartUTC = getUTCFromIST(monthStartIST);
      }
      // else "all" - periodStartUTC remains undefined

      const contentWhere =
        periodStartUTC != null
          ? {
              createdAt: {
                gte: periodStartUTC,
                lte: periodEndUTC,
              },
            }
          : {};

      // 1) groupBy to get content counts per user in this period
      const grouped = await prisma.content.groupBy({
        by: ["userId"],
        where: Object.keys(contentWhere).length ? contentWhere : undefined,
        _count: { _all: true },
      });

      if (!grouped.length) {
        res.status(200).json({
          success: true,
          period,
          users: [],
        });
        return;
      }

      // Sort by count in JS and keep top N
      grouped.sort((a, b) => {
        const countA = (a as any)._count._all as number;
        const countB = (b as any)._count._all as number;
        return countB - countA;
      });
      const topGrouped = grouped.slice(0, limit);

      const userIds = topGrouped.map((g) => g.userId);
      const userIdToContentCount = new Map<(typeof userIds)[number], number>();
      for (const g of topGrouped) {
        const count = (g as any)._count._all as number;
        userIdToContentCount.set(g.userId, count);
      }

      // 2) fetch user details for only those userIds
      const users = await prisma.user.findMany({
        where: {
          id: {
            in: userIds,
          },
        },
        include: {
          tripUsers: {
            select: {
              tripId: true,
            },
          },
          userPlaceMustDos: {
            select: {
              id: true,
            },
          },
        },
      });

      const usersWithStats = users.map((user) => {
        const contentCount =
          userIdToContentCount.get(user.id as (typeof userIds)[number]) ?? 0;

        const uniqueTripIds = new Set(user.tripUsers.map((tu) => tu.tripId));

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          contentCount, // period-filtered
          tripCount: uniqueTripIds.size, // all-time
          mustDoCount: user.userPlaceMustDos.length, // all-time
        };
      });

      // Ensure sorted by contentCount descending, just in case
      const topUsers = usersWithStats.sort(
        (a, b) => b.contentCount - a.contentCount
      );

      res.status(200).json({
        success: true,
        period,
        users: topUsers,
      });
    } catch (error) {
      console.error("Error fetching power users:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }
);

export default router;
