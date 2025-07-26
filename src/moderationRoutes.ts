// routes/moderation_routes.ts
import express, { Request, Response } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { authenticate } from "./middleware/currentUser";
import {
  isUserInTrip,
  verifyPlaceExists,
  verifyTripExists,
  verifyContentAccess,
  verifyPinAccess,
  getBlockedUserIds,
  isUserBlocked,
  getModerationStats,
  hideContent,
  blockUserGlobally,
  unblockUserGlobally,
  unhideContent,
  getContentReports,
  getUserReports
} from "./helpers/dbHelpers";

const router = express.Router();
const prisma = new PrismaClient();

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const ReportContentSchema = z.object({
  contentId: z.string().uuid(),
  reason: z.enum([
    'SPAM',
    'INAPPROPRIATE_CONTENT', 
    'HARASSMENT',
    'MISINFORMATION',
    'COPYRIGHT_VIOLATION',
    'VIOLENCE',
    'HATE_SPEECH',
    'ADULT_CONTENT',
    'OTHER'
  ]),
  description: z.string().optional()
});

const ReportUserSchema = z.object({
  reportedUserId: z.string().uuid(),
  reason: z.enum([
    'HARASSMENT',
    'SPAM',
    'INAPPROPRIATE_BEHAVIOR',
    'IMPERSONATION',
    'HATE_SPEECH',
    'THREATS',
    'SCAM',
    'OTHER'
  ]),
  description: z.string().optional()
});

const BlockUserSchema = z.object({
  blockedUserId: z.string().uuid(),
  reason: z.string().optional()
});

const AdminActionSchema = z.object({
  action: z.enum(['HIDE', 'BLOCK', 'DISMISS']),
  reason: z.string().optional()
});

// =============================================================================
// MIDDLEWARE
// =============================================================================

// Middleware to check if user is globally blocked
const checkUserNotBlocked = async (req: Request, res: Response, next: any) => {
  try {
    if (req.currentUser) {
      const user = await prisma.user.findUnique({
        where: { id: req.currentUser.id },
        select: { isBlocked: true, blockReason: true }
      });

      if (user?.isBlocked) {
        res.status(403).json({ 
          error: "Your account has been blocked due to violations of our community guidelines",
          reason: user.blockReason,
          blocked: true
        });
        return;
      }
    }
    next();
  } catch (error) {
    console.error("Error checking user block status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Admin authentication middleware (you'll need to implement this based on your system)
const requireAdmin = async (req: Request, res: Response, next: any) => {
  try {
    const currentUser = req.currentUser;
    if (!currentUser) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // TODO: Implement your admin check logic here
    // Example: Check if user has admin role in database
    // const user = await prisma.user.findUnique({
    //   where: { id: currentUser.id },
    //   select: { role: true }
    // });
    // 
    // if (user?.role !== 'ADMIN') {
    //   res.status(403).json({ error: "Admin access required" });
    //   return;
    // }

    // For now, you can use a simple check or environment variable
    // Remove this and implement proper admin checking
    console.log("TODO: Implement proper admin authentication");
    
    next();
  } catch (error) {
    console.error("Error checking admin status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// =============================================================================
// USER-FACING MODERATION ROUTES
// =============================================================================

// Report objectionable content
router.post("/report-content", authenticate, checkUserNotBlocked, async (req: Request, res: Response): Promise<void> => {
  try {
    const currentUser = req.currentUser;
    if (currentUser == null) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    const { contentId, reason, description } = ReportContentSchema.parse(req.body);

    // Verify the content exists
    const content = await prisma.content.findUnique({
      where: { id: contentId },
      include: {
        trip: {
          include: {
            tripUsers: {
              where: { userId: currentUser.id }
            }
          }
        }
      }
    });

    if (!content) {
      res.status(404).json({ error: "Content not found" });
      return;
    }

    // Verify user has access to this content (is part of the trip)
    if (content.trip.tripUsers.length === 0) {
      res.status(403).json({ error: "You don't have access to this content" });
      return;
    }

    // Prevent users from reporting their own content
    if (content.userId === currentUser.id) {
      res.status(400).json({ error: "You cannot report your own content" });
      return;
    }

    // Check if user has already reported this content
    const existingReport = await prisma.contentReport.findUnique({
      where: {
        contentId_reportedBy: {
          contentId,
          reportedBy: currentUser.id
        }
      }
    });

    if (existingReport) {
      res.status(409).json({ error: "You have already reported this content" });
      return;
    }

    // Create the content report
    const report = await prisma.contentReport.create({
      data: {
        contentId,
        reportedBy: currentUser.id,
        reason,
        description: description || null
      },
      include: {
        content: {
          select: {
            id: true,
            title: true,
            userId: true
          }
        }
      }
    });

    req.logger?.info(`Content ${contentId} reported by user ${currentUser.id} for ${reason}`);
    
    res.status(201).json({
      success: true,
      message: "Content reported successfully. Our team will review it within 24 hours.",
      reportId: report.id
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid input data", details: error.errors });
    } else {
      console.error("Error reporting content:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// Report abusive users
router.post("/report-user", authenticate, checkUserNotBlocked, async (req: Request, res: Response): Promise<void> => {
  try {
    const currentUser = req.currentUser;
    if (currentUser == null) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    const { reportedUserId, reason, description } = ReportUserSchema.parse(req.body);

    // Prevent users from reporting themselves
    if (reportedUserId === currentUser.id) {
      res.status(400).json({ error: "You cannot report yourself" });
      return;
    }

    // Verify the reported user exists
    const reportedUser = await prisma.user.findUnique({
      where: { id: reportedUserId }
    });

    if (!reportedUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Check if user has already reported this user
    const existingReport = await prisma.userReport.findUnique({
      where: {
        reportedUserId_reportedBy: {
          reportedUserId,
          reportedBy: currentUser.id
        }
      }
    });

    if (existingReport) {
      res.status(409).json({ error: "You have already reported this user" });
      return;
    }

    // Create the user report
    const report = await prisma.userReport.create({
      data: {
        reportedUserId,
        reportedBy: currentUser.id,
        reason,
        description: description || null
      },
      include: {
        reportedUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    req.logger?.info(`User ${reportedUserId} reported by user ${currentUser.id} for ${reason}`);
    
    res.status(201).json({
      success: true,
      message: "User reported successfully. Our team will review it within 24 hours.",
      reportId: report.id
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid input data", details: error.errors });
    } else {
      console.error("Error reporting user:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// =============================================================================
// USER BLOCKING ROUTES
// =============================================================================

// Block a user
router.post("/block-user", authenticate, checkUserNotBlocked, async (req: Request, res: Response): Promise<void> => {
  try {
    const currentUser = req.currentUser;
    if (currentUser == null) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    const { blockedUserId, reason } = BlockUserSchema.parse(req.body);

    // Prevent users from blocking themselves
    if (blockedUserId === currentUser.id) {
      res.status(400).json({ error: "You cannot block yourself" });
      return;
    }

    // Verify the user to be blocked exists
    const userToBlock = await prisma.user.findUnique({
      where: { id: blockedUserId }
    });

    if (!userToBlock) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Check if user is already blocked
    const existingBlock = await prisma.userBlock.findUnique({
      where: {
        blockingUserId_blockedUserId: {
          blockingUserId: currentUser.id,
          blockedUserId
        }
      }
    });

    if (existingBlock) {
      res.status(409).json({ 
        success: true,
        message: "User is already blocked",
        alreadyBlocked: true
      });
      return;
    }

    // Create the user block
    const userBlock = await prisma.userBlock.create({
      data: {
        blockingUserId: currentUser.id,
        blockedUserId,
        reason: reason || null
      },
      include: {
        blockedUser: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    req.logger?.info(`User ${blockedUserId} blocked by user ${currentUser.id}`);
    
    res.status(201).json({
      success: true,
      message: "User blocked successfully",
      userBlock: {
        id: userBlock.id,
        blockedUser: userBlock.blockedUser,
        createdAt: userBlock.createdAt
      }
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid input data", details: error.errors });
    } else {
      console.error("Error blocking user:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// Unblock a user
router.delete("/unblock-user", authenticate, checkUserNotBlocked, async (req: Request, res: Response): Promise<void> => {
  try {
    const currentUser = req.currentUser;
    if (currentUser == null) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    const { blockedUserId } = BlockUserSchema.parse(req.body);

    // Delete the user block
    const deletedBlock = await prisma.userBlock.delete({
      where: {
        blockingUserId_blockedUserId: {
          blockingUserId: currentUser.id,
          blockedUserId
        }
      }
    }).catch(() => null);

    if (!deletedBlock) {
      res.status(404).json({ 
        success: false,
        message: "User was not blocked" 
      });
      return;
    }

    req.logger?.info(`User ${blockedUserId} unblocked by user ${currentUser.id}`);
    
    res.status(200).json({
      success: true,
      message: "User unblocked successfully"
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid input data", details: error.errors });
    } else {
      console.error("Error unblocking user:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// Get blocked users list
router.get("/blocked-users", authenticate, checkUserNotBlocked, async (req: Request, res: Response): Promise<void> => {
  try {
    const currentUser = req.currentUser;
    if (currentUser == null) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    const blockedUsers = await prisma.userBlock.findMany({
      where: {
        blockingUserId: currentUser.id
      },
      include: {
        blockedUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.status(200).json({
      success: true,
      blockedUsers: blockedUsers.map(block => ({
        id: block.id,
        blockedUser: block.blockedUser,
        reason: block.reason,
        blockedAt: block.createdAt
      }))
    });

  } catch (error) {
    console.error("Error fetching blocked users:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Check if a user is blocked
router.get("/is-user-blocked/:userId", authenticate, checkUserNotBlocked, async (req: Request, res: Response): Promise<void> => {
  try {
    const currentUser = req.currentUser;
    if (currentUser == null) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    const { userId } = req.params;
    
    if (!userId) {
      res.status(400).json({ error: "userId is required" });
      return;
    }

    const blocked = await isUserBlocked(currentUser.id, userId);
    
    res.status(200).json({
      success: true,
      isBlocked: blocked
    });

  } catch (error) {
    console.error("Error checking if user is blocked:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// =============================================================================
// ADMIN MODERATION ROUTES
// =============================================================================

// Get pending content reports (for admins)
router.get("/admin/content-reports", authenticate, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { status = 'PENDING', limit = '50', offset = '0' } = req.query;
    
    const { reports, totalCount } = await getContentReports(
      status as any,
      parseInt(limit as string),
      parseInt(offset as string)
    );

    res.status(200).json({
      success: true,
      reports,
      total: totalCount,
      pagination: {
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        hasMore: totalCount > parseInt(offset as string) + reports.length
      }
    });

  } catch (error) {
    console.error("Error fetching content reports:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Take action on content reports (hide content)
router.post("/admin/action-content-report/:reportId", authenticate, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { reportId } = req.params;
    const { action, reason } = AdminActionSchema.parse(req.body);
    
    const report = await prisma.contentReport.findUnique({
      where: { id: reportId },
      include: { content: true }
    });

    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }

    if (action === 'HIDE') {
      // Hide the content and update report status
      await prisma.$transaction([
        prisma.content.update({
          where: { id: report.contentId },
          data: {
            isHidden: true,
            hiddenAt: new Date(),
            hideReason: reason || `Content violated community guidelines: ${report.reason}`
          }
        }),
        prisma.contentReport.update({
          where: { id: reportId },
          data: {
            status: 'ACTIONED',
            reviewedAt: new Date(),
            reviewedBy: req.currentUser?.id
          }
        })
      ]);

      res.status(200).json({
        success: true,
        message: "Content has been hidden and report marked as actioned"
      });
    } else if (action === 'DISMISS') {
      // Dismiss the report without taking action
      await prisma.contentReport.update({
        where: { id: reportId },
        data: {
          status: 'DISMISSED',
          reviewedAt: new Date(),
          reviewedBy: req.currentUser?.id
        }
      });

      res.status(200).json({
        success: true,
        message: "Report has been dismissed"
      });
    } else {
      res.status(400).json({ error: "Invalid action. Use 'HIDE' or 'DISMISS'" });
    }

  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid input data", details: error.errors });
    } else {
      console.error("Error processing content report action:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// Get pending user reports (for admins)
router.get("/admin/user-reports", authenticate, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { status = 'PENDING', limit = '50', offset = '0' } = req.query;
    
    const { reports, totalCount } = await getUserReports(
      status as any,
      parseInt(limit as string),
      parseInt(offset as string)
    );

    res.status(200).json({
      success: true,
      reports,
      total: totalCount,
      pagination: {
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        hasMore: totalCount > parseInt(offset as string) + reports.length
      }
    });

  } catch (error) {
    console.error("Error fetching user reports:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Take action on user reports (block user)
router.post("/admin/action-user-report/:reportId", authenticate, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { reportId } = req.params;
    const { action, reason } = AdminActionSchema.parse(req.body);
    
    const report = await prisma.userReport.findUnique({
      where: { id: reportId },
      include: { reportedUser: true }
    });

    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }

    if (action === 'BLOCK') {
      // Block the user and update report status
      await prisma.$transaction([
        prisma.user.update({
          where: { id: report.reportedUserId },
          data: {
            isBlocked: true,
            blockedAt: new Date(),
            blockReason: reason || `User violated community guidelines: ${report.reason}`
          }
        }),
        prisma.userReport.update({
          where: { id: reportId },
          data: {
            status: 'ACTIONED',
            reviewedAt: new Date(),
            reviewedBy: req.currentUser?.id
          }
        })
      ]);

      res.status(200).json({
        success: true,
        message: "User has been blocked and report marked as actioned"
      });
    } else if (action === 'DISMISS') {
      // Dismiss the report without taking action
      await prisma.userReport.update({
        where: { id: reportId },
        data: {
          status: 'DISMISSED',
          reviewedAt: new Date(),
          reviewedBy: req.currentUser?.id
        }
      });

      res.status(200).json({
        success: true,
        message: "Report has been dismissed"
      });
    } else {
      res.status(400).json({ error: "Invalid action. Use 'BLOCK' or 'DISMISS'" });
    }

  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid input data", details: error.errors });
    } else {
      console.error("Error processing user report action:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// Get moderation statistics (for admin dashboard)
router.get("/admin/moderation-stats", authenticate, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const stats = await getModerationStats();
    
    res.status(200).json({
      success: true,
      stats
    });

  } catch (error) {
    console.error("Error fetching moderation stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Unblock user globally (admin action)
router.post("/admin/unblock-user/:userId", authenticate, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (!user.isBlocked) {
      res.status(400).json({ error: "User is not blocked" });
      return;
    }

    const unblockedUser = await unblockUserGlobally(userId);
    
    res.status(200).json({
      success: true,
      message: "User has been unblocked globally",
      user: {
        id: unblockedUser.id,
        name: unblockedUser.name,
        isBlocked: unblockedUser.isBlocked
      }
    });

  } catch (error) {
    console.error("Error unblocking user globally:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Unhide content (admin action)
router.post("/admin/unhide-content/:contentId", authenticate, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { contentId } = req.params;
    
    const content = await prisma.content.findUnique({
      where: { id: contentId }
    });

    if (!content) {
      res.status(404).json({ error: "Content not found" });
      return;
    }

    if (!content.isHidden) {
      res.status(400).json({ error: "Content is not hidden" });
      return;
    }

    const unhiddenContent = await unhideContent(contentId);
    
    res.status(200).json({
      success: true,
      message: "Content has been unhidden",
      content: {
        id: unhiddenContent.id,
        title: unhiddenContent.title,
        isHidden: unhiddenContent.isHidden
      }
    });

  } catch (error) {
    console.error("Error unhiding content:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;