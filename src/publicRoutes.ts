import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const router = express.Router();
const prisma = new PrismaClient();

// Marketing trip IDs - only content from these trips can be accessed via public API
export const MARKETING_TRIP_IDS = [
  "17827eb5-d9ce-45e4-bcce-ffdf3ade5fd9",
  // Add more trip IDs here as needed
];

// Public endpoint to get content and pins for web view (no auth required)
// Only returns content from marketing trips
router.get(
  "/api/public/content/:contentId",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { contentId } = req.params;

      // Fetch content with trip information and user info
      const content = await prisma.content.findUnique({
        where: { id: contentId },
        select: {
          id: true,
          url: true,
          title: true,
          thumbnail: true,
          createdAt: true,
          pins_count: true,
          tripId: true,
          userId: true,
          trip: {
            select: {
              id: true,
              name: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      if (!content) {
        res.status(404).json({ error: "Content not found" });
        return;
      }

      // Check if the content belongs to a marketing trip
      if (!MARKETING_TRIP_IDS.includes(content.tripId)) {
        res
          .status(403)
          .json({ error: "This content is not publicly available" });
        return;
      }

      // Fetch pins for this content
      const pins = await prisma.pin.findMany({
        where: { contentId: contentId },
        select: {
          id: true,
          name: true,
          category: true,
          description: true,
          contentId: true,
          placeCacheId: true,
          createdAt: true,
        },
      });

      // Get place cache IDs
      const placeCacheIds = pins
        .map((pin) => pin.placeCacheId)
        .filter((id): id is string => id !== null);

      // Fetch place cache entries
      const placeCaches = await prisma.placeCache.findMany({
        where: { id: { in: placeCacheIds } },
        select: {
          id: true,
          placeId: true,
          name: true,
          rating: true,
          userRatingCount: true,
          websiteUri: true,
          lat: true,
          lng: true,
          images: true,
          utcOffsetMinutes: true,
        },
      });

      // Map pins with their place cache data
      const pinsWithPlaces = pins.map((pin) => {
        const place = placeCaches.find((p) => p.id === pin.placeCacheId);
        return {
          ...pin,
          place: place || null,
        };
      });

      res.status(200).json({
        content: {
          id: content.id,
          url: content.url,
          title: content.title,
          thumbnail: content.thumbnail,
          createdAt: content.createdAt,
          pins_count: content.pins_count,
          trip: content.trip,
          userId: content.userId,
          userName: content.user.name,
          userEmail: content.user.email,
        },
        pins: pinsWithPlaces,
      });
    } catch (error) {
      console.error(`Error fetching public content:`, error);
      res.status(500).json({ error: "Internal server error." });
    }
  }
);

// Admin endpoint to get all marketing trip contents (for Sources Campaign tab)
router.get(
  "/api/admin/marketing-contents",
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Check admin secret
      const providedSecret =
        req.header("x-admin-secret") || (req.query.secret as string);
      if (providedSecret !== "asdfasdf") {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      // Fetch all content from marketing trips
      const contents = await prisma.content.findMany({
        where: {
          tripId: { in: MARKETING_TRIP_IDS },
        },
        select: {
          id: true,
          url: true,
          title: true,
          thumbnail: true,
          createdAt: true,
          pins_count: true,
          tripId: true,
          userId: true,
          trip: {
            select: {
              id: true,
              name: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      res.status(200).json({
        success: true,
        contents: contents,
      });
    } catch (error) {
      console.error(`Error fetching marketing contents:`, error);
      res.status(500).json({ error: "Internal server error." });
    }
  }
);

export default router;

