// Importing required modules
import express, { Request, Response, NextFunction } from "express";
import { createServer } from "http";
import morgan from "morgan";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import cors from "cors";
import { initializeWebSocket } from "./services/websocketService";
import { requestLogger } from "./middleware/logger";
import {
  extractLocationAndClassify,
  classifyPlaceCategory,
  analyzeYouTubeContent,
} from "./helpers/openai";
import axios from "axios";
import { parse } from "node-html-parser";
import parser from "html-metadata-parser";
import {
  getPlaceId,
  getFullPlaceDetails,
  searchPlaces,
  getSessionStats,
  clearAllSessions,
  getSessionForUser,
  getPlaceDetailsFromId,
  getGoogleMapsUriOnly,
  fetchGoogleMapsImage,
} from "./helpers/googlemaps";
import { z } from "zod";
import fs from "fs";
import path from "path";

// Type definitions for demo data structure
interface DemoDataPin {
  title: string;
  classification: string;
  description?: string;
  place: {
    id: string;
    lat: number;
    lng: number;
  };
}

interface DemoData {
  structuredData: string;
  title: string;
  pins_count: number;
  pins: DemoDataPin[];
}
import {
  createPlaceCache,
  getContentPinsPlaceNested,
  getTripContentData,
  getTripsByUserId,
  createContent,
  createUserTrip,
  updateContent,
  updateContentStatus,
  appendToContent,
  getPlaceCacheById,
  createPin,
  getTripById,
  createUser,
  getUserByFirebaseId,
  createTripAndTripUser,
  addUserToTrip,
  getUsersFromTrip,
  addMessage,
  getMessageById,
  getMessagesByTime,
  getUsername,
  getShareTokenDetails,
  createShareToken,
  generateUniqueToken,
  getTripMemberCount,
  markPlaceAsMustDo,
  unmarkPlaceAsMustDo,
  updateUserNotes,
  deletePin,
  findExistingContentByUrl,
  isUserInTrip,
  verifyPlaceExists,
  verifyTripExists,
  verifyContentAccess,
  verifyPinAccess,
  getPublicTrips,
  getUserRoleInTrip,
  getUsersWithContentInTrip,
  getAllTripUsers,
  appendPinCount,
  getContentSummarySinceLastLogin,
} from "./helpers/dbHelpers"; // Import helper functions
import { PrismaClient } from "@prisma/client";
import { authenticate } from "./middleware/currentUser";
import { getDummyStartAndEndDate } from "./utils/jsUtils";
import { mergeMetadata } from "./utils/metadataUtils";
import pocRoutes from "./poc-routes";
import { generateContentEmbeddings } from "./poc-embeddings";
import cronRoutes from "./cronRoutes";
import moderationRoutes from "./moderationRoutes";
import {
  registerFcmToken,
  unregisterFcmToken,
  sendNotificationToUsers,
  sendBroadcastNotification,
  getUserNotificationStats,
  sendPinAddedNotifications,
} from "./services/notificationService";
import { emitContentProcessingStatus } from "./services/websocketService";
import { getYoutubeMetadata, getYouTubeVideoId } from "./helpers/googleApis";

const prisma = new PrismaClient();

dotenv.config();

const app = express();

app.use(requestLogger);
app.use(cors());
app.use(bodyParser.json());
app.use(morgan("dev"));

app.use("/api", pocRoutes); // POC semantic search routes
app.use("/cron", cronRoutes);
app.use("/api/moderation", moderationRoutes);

// app.use(
//   "/.well-known",
//   express.static(path.join(process.cwd(), ".well-known"))
// );
const PORT = process.env.PORT || 5000;
const baseUrl = process.env.BASE_URL || "http://localhost" + `:${PORT}`;
const ADMIN_SECRET = process.env.ADMIN_SECRET || "asdfasdf";

interface WebMetadata {
  og?: {
    title?: string;
    description?: string;
    image?: string;
    url?: string;
    site_name?: string;
    type?: string;
    caption?: string; // Instagram-specific: clean caption text
  };
  twitter?: {
    card?: string;
    title?: string;
    description?: string;
    image?: string;
    site?: string;
  };
  meta?: {
    title?: string;
    description?: string;
  };
}

/**
 * Extracts metadata from web pages using axios with Instagram CSRF token
 * @param url - The URL to fetch metadata from
 * @returns Promise<WebMetadata | null> - The extracted metadata
 */
const fetchWebMetadata = async (url: string): Promise<WebMetadata | null> => {
  const maxRetries = 5;
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt++;

    try {
      console.log(
        `🔍 Fetching Instagram metadata (attempt ${attempt}/${maxRetries}) from:`,
        url
      );

      // Instagram CSRF tokens - randomly pick one
      const instagramCsrfTokens = [
        "Xlr1xoC5aViXOOyu8gNCdazYXta7jrPT",
        "s3ZvilLdQFSmR06cSKtAmZ7gzx49FejO",
      ];
      const instagramCsrfToken =
        instagramCsrfTokens[
          Math.floor(Math.random() * instagramCsrfTokens.length)
        ];
      console.log(
        `🎲 Using CSRF token: ${instagramCsrfToken.substring(0, 8)}...`
      );

      const response = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          Cookie: `csrftoken=${instagramCsrfToken}; Domain=instagram.com; Secure`,
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1",
        },
        timeout: 10000,
        maxRedirects: 5,
      });

      const html = response.data;

      // Check if we got redirected to login page
      if (
        html.includes("Login • Instagram") ||
        html.includes("Welcome back to Instagram")
      ) {
        console.warn(
          `⚠️ Instagram returned login page on attempt ${attempt}. Retrying...`
        );

        if (attempt < maxRetries) {
          // Wait before retrying (exponential backoff)
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          console.log(`⏳ Waiting ${delay}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue; // Retry
        } else {
          console.error(
            "❌ All retry attempts failed - Instagram still returning login page"
          );
          return null;
        }
      }

      console.log(
        `✅ Successfully received Instagram content on attempt ${attempt}`
      );

      // Parse HTML and extract metadata from meta tags
      const root = parse(html);

      const metadata: WebMetadata = {
        og: {},
        twitter: {},
        meta: {},
      };

      // Extract Open Graph meta tags
      const ogTitle = root.querySelector('meta[property="og:title"]');
      if (ogTitle) {
        metadata.og!.title = ogTitle.getAttribute("content") || undefined;
      }

      const ogDescription = root.querySelector(
        'meta[property="og:description"]'
      );
      if (ogDescription) {
        metadata.og!.description =
          ogDescription.getAttribute("content") || undefined;
      }

      const ogImage = root.querySelector('meta[property="og:image"]');
      if (ogImage) {
        metadata.og!.image = ogImage.getAttribute("content") || undefined;
      }

      const ogUrl = root.querySelector('meta[property="og:url"]');
      if (ogUrl) {
        metadata.og!.url = ogUrl.getAttribute("content") || undefined;
      }

      const ogSiteName = root.querySelector('meta[property="og:site_name"]');
      if (ogSiteName) {
        metadata.og!.site_name =
          ogSiteName.getAttribute("content") || undefined;
      }

      const ogType = root.querySelector('meta[property="og:type"]');
      if (ogType) {
        metadata.og!.type = ogType.getAttribute("content") || undefined;
      }

      // Extract basic meta tags
      const titleTag = root.querySelector("title");
      if (titleTag) {
        metadata.meta!.title = titleTag.innerHTML;
      }

      const descriptionTag = root.querySelector('meta[name="description"]');
      if (descriptionTag) {
        metadata.meta!.description =
          descriptionTag.getAttribute("content") || undefined;
      }

      // Instagram-specific: Extract clean caption from og:title
      if (metadata.og?.title) {
        // Instagram format: "Username on Instagram: "actual caption content""
        const instagramCaptionMatch = metadata.og.title.match(
          /on Instagram: "(.+)"$/
        );
        if (instagramCaptionMatch) {
          metadata.og.caption = instagramCaptionMatch[1];
        }
      }

      console.log("✅ Successfully extracted web metadata with axios");
      console.log("📋 Full extracted metadata:", {
        ogTitle: metadata.og?.title,
        ogDescription: metadata.og?.description,
        ogImage: metadata.og?.image,
        ogUrl: metadata.og?.url,
        ogSiteName: metadata.og?.site_name,
        ogType: metadata.og?.type,
        caption: metadata.og?.caption,
        metaTitle: metadata.meta?.title,
        metaDescription: metadata.meta?.description,
      });

      return metadata;
    } catch (error) {
      console.error(`❌ Error on attempt ${attempt}:`, error);

      if (attempt < maxRetries) {
        console.log(`⏳ Retrying in a moment... (${attempt}/${maxRetries})`);
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue; // Retry
      } else {
        console.error("❌ All retry attempts failed due to errors");
        if (axios.isAxiosError(error)) {
          console.error("Status:", error.response?.status);
          console.error("Headers:", error.response?.headers);
        }
        return null;
      }
    }
  }

  // This should never be reached, but just in case
  return null;
};

const getFinalUrl = async (url: string) => {
  const res = await fetch(url, { redirect: "follow" }); // follows redirects automatically
  return res.url; // gives final resolved URL after following redirects
};

const getMetadata = async (url: string) => {
  try {
    console.log("🔍 Getting metadata for:", url);

    // Use custom Instagram extraction for Instagram URLs
    if (url.includes("instagram.com")) {
      console.log(
        "📸 Instagram URL detected, using custom extraction with CSRF token"
      );

      const metadata = await fetchWebMetadata(url);

      if (!metadata) {
        return null;
      }

      console.log(
        "✅ Successfully extracted Instagram metadata with custom parser"
      );

      // Return in the format expected by the rest of the application
      return {
        og: {
          title: metadata.og?.title,
          description: metadata.og?.description,
          image: metadata.og?.image,
          url: metadata.og?.url || url,
          site_name: metadata.og?.site_name,
          type: metadata.og?.type,
          caption: metadata.og?.caption, // Instagram-specific: clean caption
        },
        meta: {
          title: metadata.meta?.title || metadata.og?.title,
          description: metadata.meta?.description || metadata.og?.description,
        },
        images: metadata.og?.image ? [metadata.og.image] : [],
      };
    }

    // For all other URLs, use html-metadata-parser
    else {
      console.log("🌐 Non-Instagram URL, using html-metadata-parser");

      const finalUrl = await getFinalUrl(url);
      console.log("Resolved URL:", finalUrl);

      const result = await parser(finalUrl);
      console.log(
        "✅ Successfully extracted metadata with html-metadata-parser"
      );

      return result;
    }
  } catch (err) {
    console.error("Error getting metadata:", err);
    return null;
  }
};

const getTikTokMetadata = async (videoUrl: string) => {
  try {
    console.log(`Fetching metadata for: ${videoUrl}`);

    const response = await fetch("http://18.195.148.72:80/share-meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: videoUrl }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch metadata: ${response.statusText}`);
    }

    const data = await response.json();
    console.log("Received TikTok metadata:", data);
    const combined = [data.title, data.desc].filter(Boolean).join(" ");
    return { description: combined };
  } catch (error) {
    console.error("Error fetching TikTok metadata:", error);
    return null;
  }
};

const UserSchema = z.object({
  id: z.string().uuid().optional(), // UUID
  name: z.string().min(1, "User name is required"),
  email: z.string(),
  phoneNumber: z.string(),
  firebaseId: z.string(),
  metadata: z
    .object({
      new_tour_flow_user: z.boolean().optional(),
      has_local_trip: z.boolean().optional(),
      has_completed_first_tour: z.boolean().optional(),
      has_completed_second_tour: z.boolean().optional(),
      has_completed_third_tour: z.boolean().optional(),
    })
    .optional(),
});

const ContentSchema = z.object({
  url: z.string(),
  content: z.string().optional(),
  trip_id: z.string(),
  user_notes: z.string().optional(),
});

const RefreshContentSchema = z.object({
  content_id: z.string(),
});

const UserTripSchema = z.object({
  role: z.string(),
  user_id: z.string().uuid(),
  trip_id: z.string(),
});

app.get("/api/status", authenticate, async (req: Request, res: Response) => {
  try {
    const currentUser = req.currentUser;
    if (currentUser == null) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    // Get the full user data including metadata
    const user = await prisma.user.findUnique({
      where: { id: currentUser.id },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      user: {
        ...user,
        metadata: (user as any).metadata,
      },
    });
  } catch (error) {
    console.error("Error in status endpoint:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Async background processing function
const processContentAnalysisAsync = async (
  contentId: string,
  description: string,
  req: Request,
  url: string,
  userId: string,
  tripId: string
): Promise<void> => {
  try {
    console.log(`Starting async processing for content ${contentId}`);

    // Check if this is a demo trip and first content
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: { metadata: true },
    });

    // Check for demo trip and extract country ID
    const isDemoTrip =
      trip?.metadata &&
      typeof trip.metadata === "object" &&
      "type" in trip.metadata &&
      trip.metadata.type === "demo";

    const countryId =
      trip?.metadata &&
      typeof trip.metadata === "object" &&
      "countryId" in trip.metadata
        ? (trip.metadata as any).countryId
        : null;

    const countryUuid =
      trip?.metadata &&
      typeof trip.metadata === "object" &&
      "countryUuid" in trip.metadata
        ? (trip.metadata as any).countryUuid
        : null;

    // Check if this is the first content in the trip
    const existingContentCount = await prisma.content.count({
      where: { tripId: tripId },
    });
    const isFirstContent = existingContentCount === 1; // 1 because we already created this content

    // Use demo data for demo trip's first content
    let analysis: any[];
    let title: string;
    let pinsCount: number;
    let shouldSkipProcessing = false;

    if (isDemoTrip && isFirstContent && (countryUuid || countryId)) {
      try {
        // Fetch demo data from database based on country UUID or fallback to ID
        let countryDemoData;
        if (countryUuid) {
          countryDemoData = await prisma.countryDemoData.findUnique({
            where: { id: countryUuid },
          });
        } else {
          countryDemoData = await prisma.countryDemoData.findFirst({
            where: { countryId: countryId },
          });
        }

        if (countryDemoData && countryDemoData.demoData) {
          const demoData = countryDemoData.demoData as unknown as DemoData;

          // Parse the structured data to get analysis format
          analysis = JSON.parse(demoData.structuredData);
          title = demoData.title;
          pinsCount = demoData.pins_count;
          shouldSkipProcessing = true;

          console.log(
            `Successfully loaded demo data for country ${
              countryUuid || countryId
            }`
          );
        } else {
          console.log(
            `No demo data found for country ${
              countryUuid || countryId
            }, falling back to AI`
          );
          analysis = await extractLocationAndClassify(description, req);
          title =
            analysis && analysis.length > 0 && analysis[0].title
              ? analysis[0].title
              : "";
          pinsCount = analysis.filter(
            (a) => a.classification !== "Not Pinned"
          ).length;
        }
      } catch (error) {
        console.error(
          `Error fetching demo data for country ${countryId}, falling back to AI:`,
          error
        );
        analysis = await extractLocationAndClassify(description, req);
        title =
          analysis && analysis.length > 0 && analysis[0].title
            ? analysis[0].title
            : "";
        pinsCount = analysis.filter(
          (a) => a.classification !== "Not Pinned"
        ).length;
      }
    } else {
      // Extract structured data using AI
      analysis = await extractLocationAndClassify(description, req);
      title =
        analysis && analysis.length > 0 && analysis[0].title
          ? analysis[0].title
          : "";
      pinsCount = analysis.filter(
        (a) => a.classification !== "Not Pinned"
      ).length;
    }

    // Update the Content entry with structured data and title

    // Check if URL already exists in content table (excluding current content)
    console.log("URL is ", url);

    // Determine if external API calls are needed (skip for demo trips)
    const needsExternalAPI =
      !shouldSkipProcessing &&
      (url.includes("instagram.com") ||
        url.includes("tiktok.com") ||
        url.includes("youtube") ||
        url.includes("youtu.be"));

    // Fire external API calls without waiting for response if needed
    if (
      (!shouldSkipProcessing && url.includes("instagram.com")) ||
      url.includes("youtube") ||
      url.includes("youtu.be")
    ) {
      console.log("Instagram URL detected, calling analysis API");
      fetch("https://kadshnkjadnk.pinspire.co.in/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentId: contentId, url: url }),
      }).catch((error) => {
        console.error(
          `Failed to call Instagram / Tiktok analysis API for content ${contentId}:`,
          error
        );
      });
    } else if (!shouldSkipProcessing && url.includes("tiktok.com")) {
      console.log("TikTok URL detected, calling analysis API");
      fetch("https://kadshnkjadnk.pinspire.co.in/api/tiktok-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentId: contentId, url: url }),
      }).catch((error) => {
        console.error(
          `Failed to call TikTok analysis API for content ${contentId}:`,
          error
        );
      });
    }

    await updateContent(contentId, analysis, title, pinsCount);

    // If no external API calls are needed, set status to COMPLETED and send notifications

    req.logger?.debug(
      `Updated content entry with structured data ${contentId}`
    );

    let pinsCreated = 0;

    // Process each analysis object for pin creation
    // Process pin creation - use same logic for both demo and normal content
    await Promise.all(
      analysis.map(async (analysis) => {
        try {
          if (analysis.classification === "Not Pinned") {
            return;
          }

          const full_loc =
            (analysis.name ?? "") + " " + (analysis.location ?? "");

          console.log(
            `Processing pin for: ${full_loc} (${analysis.classification})`
          );

          // Step 1: Get Place ID
          const placeId = await getPlaceId(full_loc, req);
          let coordinates;
          let placeCacheId;

          // Step 2: Check if the place exists in the cache
          let placeCache = await getPlaceCacheById(placeId);

          if (!placeCache) {
            req.logger?.debug(
              "Could not find place in place Cache.. getting full place details"
            );

            // Step 3: If not in cache, fetch full place details (includes coordinates)
            const placeDetails = await getFullPlaceDetails(full_loc, req);

            req.logger?.debug(
              `Place details for placeID - ${placeId} is - ${placeDetails}`
            );

            // Use coordinates from place details instead of separate API call
            coordinates = placeDetails.location
              ? {
                  lat: placeDetails.location.latitude,
                  lng: placeDetails.location.longitude,
                }
              : null;

            if (!coordinates) {
              req.logger?.error(`No coordinates found for place: ${full_loc}`);
              throw new Error(
                `Could not get coordinates for place: ${full_loc}`
              );
            }

            req.logger?.debug(
              `Coordinates for placeID - ${placeId} is - ${coordinates}`
            );

            // Step 4: Store in cache
            placeCache = await createPlaceCache({
              placeId: placeDetails.id,
              name: placeDetails.name,
              rating: placeDetails.rating ?? null,
              userRatingCount: placeDetails.userRatingCount ?? null,
              websiteUri: placeDetails.websiteUri ?? null,
              googleMapsLink: placeDetails.googleMapsUri ?? null,
              currentOpeningHours: placeDetails.currentOpeningHours,
              regularOpeningHours: placeDetails.regularOpeningHours,
              lat: coordinates.lat,
              lng: coordinates.lng,
              images: placeDetails.images ?? [],
              utcOffsetMinutes: placeDetails.utcOffsetMinutes ?? null,
            });

            req.logger?.debug(
              `Created new entry in place cache ${placeCache.id} for placeID ${placeId}`
            );
          } else {
            req.logger?.debug(`Found place id - ${placeId} in place cache`);
            coordinates = { lat: placeCache.lat, lng: placeCache.lng };
          }

          placeCacheId = placeCache.id;

          // Step 5: Create Pin linked to PlaceCache
          const pin = await createPin({
            name: analysis.name ?? "",
            category: analysis.classification ?? "",
            contentId: contentId,
            placeCacheId: placeCacheId,
            coordinates: coordinates,
            description: analysis.additional_info ?? "",
          });

          if (pin) {
            pinsCreated++;
          }

          req.logger?.info(
            `Created Pin - ${pin.id} with content_id - ${contentId} and place_id - ${placeCacheId}`
          );
        } catch (error) {
          console.error(
            `Error creating pin for ${analysis.name || "unknown place"}:`,
            error
          );
          req.logger?.error(
            `Failed to create pin for ${analysis.name}:`,
            error
          );
          // Continue processing other pins even if one fails
        }
      })
    );

    // If this is a demo trip and at least one pin was created, update user metadata
    if (isDemoTrip && pinsCreated > 0) {
      try {
        // Get current user metadata
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { metadata: true },
        });

        // Update user metadata to mark first tour as completed
        const updatedMetadata = mergeMetadata(user?.metadata, {
          has_completed_first_tour: true,
        });

        await prisma.user.update({
          where: { id: userId },
          data: {
            metadata: updatedMetadata,
          } as any,
        });

        req.logger?.info(
          `Updated user ${userId} metadata: has_completed_first_tour = true (demo trip pins created)`
        );
      } catch (error) {
        req.logger?.error(
          `Failed to update user metadata for demo trip:`,
          error
        );
      }
    }

    if (!needsExternalAPI) {
      await updateContentStatus(contentId, "COMPLETED");

      // Get content details for notification
      const contentWithDetails = await prisma.content.findUnique({
        where: { id: contentId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
            },
          },
          trip: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // Send notifications to trip members about pins added (if any pins were added)
      if (pinsCount > 0 && contentWithDetails) {
        try {
          await sendPinAddedNotifications(
            contentWithDetails.trip.id,
            contentWithDetails.user.id,
            pinsCount,
            contentWithDetails.trip.name,
            contentWithDetails.user.name,
            title || contentWithDetails.title || undefined,
            contentWithDetails.id
          );
        } catch (notificationError) {
          console.error(
            "Error sending pin added notifications:",
            notificationError
          );
          // Don't fail the request if notifications fail
        }
      }

      // Emit completion status via WebSocket for content that doesn't need external API
      emitContentProcessingStatus(tripId, contentId, "completed", {
        pinsCount: pinsCount,
        title: title,
      });
    }

    try {
      console.log(
        `🔄 Starting embedding generation for new content ${contentId}...`
      );
      generateContentEmbeddings(contentId)
        .then(() => {
          console.log(
            ` Embeddings generated successfully for content ${contentId}`
          );
        })
        .catch((embeddingError) => {
          console.error(
            `❌ Failed to generate embeddings for content ${contentId}:`,
            embeddingError
          );
        });
    } catch (embeddingError) {
      console.error(
        `❌ Error starting embedding generation for content ${contentId}:`,
        embeddingError
      );
    }

    console.log(` Async processing completed for content ${contentId}`);
  } catch (error) {
    console.error(
      `❌ Error in async processing for content ${contentId}:`,
      error
    );
    req.logger?.error(
      `Async processing failed for content ${contentId}:`,
      error
    );
  }
};

// New function to process content updates (similar to processContentAnalysisAsync but for updates)
const processContentUpdateAsync = async (
  contentId: string,
  description: string,
  req: Request,
  url: string,
  userId: string,
  tripId: string
): Promise<void> => {
  try {
    console.log(`Starting async update processing for content ${contentId}`);

    // Get existing content to preserve trip context
    const existingContent = await prisma.content.findUnique({
      where: { id: contentId },
      select: {
        id: true,
        tripId: true,
        userId: true,
        url: true,
      },
    });

    if (!existingContent) {
      throw new Error(`Content ${contentId} not found`);
    }

    // Extract structured data using AI (same as extract-lat-long)
    const analysis = await extractLocationAndClassify(description, req);

    // Get title from the first analysis object, if present
    const title =
      analysis && analysis.length > 0 && analysis[0].title
        ? analysis[0].title
        : "";

    // Calculate pins count
    const pinsCount = analysis.filter(
      (a) => a.classification !== "Not Pinned"
    ).length;

    // Delete existing pins for this content before creating new ones
    console.log(`Deleting existing pins for content ${contentId}`);
    await prisma.pin.deleteMany({
      where: { contentId: contentId },
    });
    console.log(`Existing pins deleted for content ${contentId}`);

    // Fire external API calls without waiting for response if needed
    if (
      url.includes("instagram.com") ||
      url.includes("youtube") ||
      url.includes("youtu.be")
    ) {
      console.log("Instagram/YouTube URL detected, calling analysis API");
      fetch("https://kadshnkjadnk.pinspire.co.in/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentId: contentId, url: url }),
      }).catch((error) => {
        console.error(
          `Failed to call Instagram/YouTube analysis API for content ${contentId}:`,
          error
        );
      });
    } else if (url.includes("tiktok.com")) {
      console.log("TikTok URL detected, calling analysis API");
      fetch("https://kadshnkjadnk.pinspire.co.in/api/tiktok-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentId: contentId, url: url }),
      }).catch((error) => {
        console.error(
          `Failed to call TikTok analysis API for content ${contentId}:`,
          error
        );
      });
    }

    // Update the Content entry with new structured data, title, and pins count
    await updateContent(contentId, analysis, title, pinsCount);

    req.logger?.debug(
      `Updated content entry with new structured data ${contentId}`
    );

    let pinsCreated = 0;

    // Process each analysis object for pin creation (same logic as extract-lat-long)
    await Promise.all(
      analysis.map(async (analysis) => {
        try {
          if (analysis.classification === "Not Pinned") {
            return;
          }

          const full_loc =
            (analysis.name ?? "") + " " + (analysis.location ?? "");

          console.log(
            `Processing pin for: ${full_loc} (${analysis.classification})`
          );

          // Step 1: Get Place ID
          const placeId = await getPlaceId(full_loc, req);
          let coordinates;
          let placeCacheId;

          // Step 2: Check if the place exists in the cache
          let placeCache = await getPlaceCacheById(placeId);

          if (!placeCache) {
            req.logger?.debug(
              "Could not find place in place Cache.. getting full place details"
            );

            // Step 3: If not in cache, fetch full place details (includes coordinates)
            const placeDetails = await getFullPlaceDetails(full_loc, req);

            req.logger?.debug(
              `Place details for placeID - ${placeId} is - ${placeDetails}`
            );

            // Use coordinates from place details instead of separate API call
            coordinates = placeDetails.location
              ? {
                  lat: placeDetails.location.latitude,
                  lng: placeDetails.location.longitude,
                }
              : null;

            if (!coordinates) {
              req.logger?.error(`No coordinates found for place: ${full_loc}`);
              throw new Error(
                `Could not get coordinates for place: ${full_loc}`
              );
            }

            req.logger?.debug(
              `Coordinates for placeID - ${placeId} is - ${coordinates}`
            );

            // Step 4: Store in cache
            placeCache = await createPlaceCache({
              placeId: placeDetails.id,
              name: placeDetails.name,
              rating: placeDetails.rating ?? null,
              userRatingCount: placeDetails.userRatingCount ?? null,
              websiteUri: placeDetails.websiteUri ?? null,
              googleMapsLink: placeDetails.googleMapsUri ?? null,
              currentOpeningHours: placeDetails.currentOpeningHours,
              regularOpeningHours: placeDetails.regularOpeningHours,
              lat: coordinates.lat,
              lng: coordinates.lng,
              images: placeDetails.images ?? [],
              utcOffsetMinutes: placeDetails.utcOffsetMinutes ?? null,
            });

            req.logger?.debug(
              `Created new entry in place cache ${placeCache.id} for placeID ${placeId}`
            );
          } else {
            req.logger?.debug(`Found place id - ${placeId} in place cache`);
            coordinates = { lat: placeCache.lat, lng: placeCache.lng };
          }

          placeCacheId = placeCache.id;

          // Step 5: Create Pin linked to PlaceCache
          const pin = await createPin({
            name: analysis.name ?? "",
            category: analysis.classification ?? "",
            contentId: contentId,
            placeCacheId: placeCacheId,
            coordinates: coordinates,
            description: analysis.additional_info ?? "",
          });

          if (pin) {
            pinsCreated++;
          }

          req.logger?.info(
            `Created Pin - ${pin.id} with content_id - ${contentId} and place_id - ${placeCacheId}`
          );
        } catch (error) {
          console.error(
            `Error creating pin for ${analysis.name || "unknown place"}:`,
            error
          );
          req.logger?.error(
            `Failed to create pin for ${analysis.name}:`,
            error
          );
          // Continue processing other pins even if one fails
        }
      })
    );

    // Determine if external API calls are needed
    const needsExternalAPI =
      url.includes("instagram.com") ||
      url.includes("tiktok.com") ||
      url.includes("youtube") ||
      url.includes("youtu.be");

    // If no external API calls are needed, set status to COMPLETED and send notifications
    if (!needsExternalAPI) {
      await updateContentStatus(contentId, "COMPLETED");

      // Get content details for notification
      const contentWithDetails = await prisma.content.findUnique({
        where: { id: contentId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
            },
          },
          trip: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // Send notifications to trip members about pins updated (if any pins were added)
      if (pinsCount > 0 && contentWithDetails) {
        try {
          await sendPinAddedNotifications(
            contentWithDetails.trip.id,
            contentWithDetails.user.id,
            pinsCount,
            contentWithDetails.trip.name,
            contentWithDetails.user.name,
            title || contentWithDetails.title || undefined,
            contentWithDetails.id
          );
        } catch (notificationError) {
          console.error(
            "Error sending pin updated notifications:",
            notificationError
          );
          // Don't fail the request if notifications fail
        }
      }

      // Emit completion status via WebSocket
      emitContentProcessingStatus(tripId, contentId, "completed", {
        pinsCount: pinsCount,
        title: title,
      });
    }

    // Generate embeddings for updated content
    try {
      console.log(
        `🔄 Starting embedding generation for updated content ${contentId}...`
      );
      generateContentEmbeddings(contentId)
        .then(() => {
          console.log(
            ` Embeddings generated successfully for content ${contentId}`
          );
        })
        .catch((embeddingError) => {
          console.error(
            `❌ Failed to generate embeddings for content ${contentId}:`,
            embeddingError
          );
        });
    } catch (embeddingError) {
      console.error(
        `❌ Error starting embedding generation for content ${contentId}:`,
        embeddingError
      );
    }

    console.log(` Async update processing completed for content ${contentId}`);
  } catch (error) {
    console.error(
      `❌ Error in async update processing for content ${contentId}:`,
      error
    );
    req.logger?.error(
      `Async update processing failed for content ${contentId}:`,
      error
    );
  }
};

app.post(
  "/api/extract-lat-long",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        throw new Error("User not authenticated");
      }
      const user_id = currentUser.id;
      const validatedData = ContentSchema.parse(req.body);

      console.log(req.body);
      const { url, content, trip_id, user_notes } = validatedData;

      console.log(
        `Received request to extract lat-long: URL=${url}, user_id=${user_id}, trip_id=${trip_id}`
      );
      req.logger?.info(
        `Request received: URL=${url}, user_id=${user_id}, trip_id=${trip_id}`
      );

      let description = content ?? "";
      let contentThumbnail = "";

      // If content is empty, fetch content from the URL
      if (!content || content.trim() === "") {
        req.logger?.debug(
          `The request doesnt contains content, fetching content from URL`
        );

        // For Instagram, Facebook, or TikTok - use metadata extraction
        if (
          url.includes("instagram.com") ||
          url.includes("facebook.com") ||
          url.includes("tiktok.com") ||
          url.includes("youtube.com") ||
          url.includes("youtu.be")
        ) {
          req.logger?.debug(
            `Social media URL detected, using metadata extraction`
          );

          const metadata = await getMetadata(url);

          if (url.includes("facebook.com")) {
            req.logger?.debug(
              `Facebook URL detected, using custom metadata extraction`
            );
            description = metadata?.og.title ?? "";
          } else if (url.includes("youtube.com") || url.includes("youtu.be")) {
            const videoId = getYouTubeVideoId(url);
            req.logger?.debug(
              `YouTube URL detected, analyzing content for ${videoId}`
            );

            const { title, description: desc } = videoId
              ? await getYoutubeMetadata(videoId)
              : { title: null, description: "" };

            if (title || desc) {
              const isTravelContent = await analyzeYouTubeContent(
                title,
                desc,
                req
              );
              if (!isTravelContent) {
                req.logger?.info(
                  `YouTube content is not travel-related. Skipping processing for URL: ${url}`
                );
                // Immediately return a response indicating that the content is not relevant
                res.status(200).json({
                  success: false,
                  message:
                    "YouTube content is not travel-related and will not be processed.",
                });
                return;
              }
              req.logger?.info(
                "YouTube content is travel-related. Proceeding with processing."
              );
              description = [title, desc].filter(Boolean).join(" ");
            } else {
              req.logger?.warn(
                `Missing title or description for YouTube URL: ${url}. Skipping analysis.`
              );

              res.status(200).json({
                success: false,
                message: `Missing title or description for YouTube URL: ${url}`,
              });
              return;
            }
          } else {
            description = [metadata?.meta.title, metadata?.meta.description]
              .filter(Boolean)
              .join(" ");
          }
          contentThumbnail = metadata?.og.image ?? "";
        }
        // For all other URLs - use Jina API directly
        else {
          try {
            req.logger?.debug(
              `Non-social media URL detected, fetching full webpage content via Jina API: ${url}`
            );

            const jinaResponse = await fetch(`https://r.jina.ai/${url}`, {
              method: "GET",
              headers: {
                Authorization: `Bearer ${process.env.JINA_API_TOKEN}`,
              },
            });

            if (jinaResponse.ok) {
              const webpageContent = await jinaResponse.text();
              if (webpageContent && webpageContent.trim().length > 0) {
                // Use the full webpage content
                description = webpageContent;
                req.logger?.debug(
                  `Successfully extracted webpage content (${webpageContent.length} characters)`
                );
              } else {
                req.logger?.warn(`Jina API returned empty content`);
                description = "No content available from URL";
              }
            } else {
              req.logger?.warn(
                `Jina API request failed with status: ${jinaResponse.status}`
              );
              description = "Failed to fetch content from URL";
            }
          } catch (jinaError) {
            req.logger?.warn(
              `Failed to fetch webpage content via Jina API:`,
              jinaError
            );
            description = "Error fetching content from URL";
          }
        }
      }

      console.log("Description is ", description);

      if (!description) {
        req.logger?.error(`Failed to fetch metadata for URL - ${url}`);
      }

      // Create a DB entry for content
      const newContent = await createContent(
        url,
        description,
        user_id,
        trip_id,
        user_notes,
        contentThumbnail
      );

      console.log(
        `Content created with ID: ${newContent.id}. Starting async processing...`
      );
      req.logger?.info(
        `Content created: ${newContent.id}. Processing will continue asynchronously.`
      );

      // Emit processing status via WebSocket
      emitContentProcessingStatus(trip_id, newContent.id, "processing");

      // Start async processing in the background (don't await)
      processContentAnalysisAsync(
        newContent.id,
        description,
        req,
        url,
        user_id,
        trip_id
      );

      // Return immediate response with content info
      res.status(202).json({
        success: true,
        message: "Content received and is being processed",
        content: {
          id: newContent.id,
          url: newContent.url,
          rawData: newContent.rawData,
          userId: newContent.userId,
          tripId: newContent.tripId,
          userNotes: newContent.userNotes,
          thumbnail: newContent.thumbnail,
          createdAt: newContent.createdAt,
        },
        processing: {
          status: "in_progress",
          message:
            "AI analysis and pin creation are being processed in the background",
        },
      });
    } catch (error) {
      console.log("Look at exact error", error);
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Invalid input data", details: error.errors });
      } else {
        console.error(`Error processing request:`, error);
        res.status(500).json({ error: "Internal server error." });
      }
    }
  }
);

// New endpoint to refresh existing content (similar to extract-lat-long but refreshes/updates existing content instead of creating)
app.post(
  "/api/refresh-content",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const validatedData = RefreshContentSchema.parse(req.body);

      console.log(req.body);
      const { content_id } = validatedData;

      console.log(
        `Received request to refresh content: content_id=${content_id}`
      );
      req.logger?.info(
        `Request received to refresh content: content_id=${content_id}`
      );

      // Get the existing content entry
      const existingContent = await prisma.content.findUnique({
        where: { id: content_id },
        include: {
          trip: true,
        },
      });

      if (!existingContent) {
        res.status(404).json({ error: "Content not found" });
        return;
      }

      const trip_id = existingContent.tripId;
      const user_id = existingContent.userId; // Use existing content's userId
      const contentUrl = existingContent.url; // Always use existing URL

      let description = "";
      let contentThumbnail = existingContent.thumbnail;

      // Always fetch content from the URL
      req.logger?.debug(`Fetching content from URL: ${contentUrl}`);

      // For Instagram, Facebook, or TikTok - use metadata extraction
      if (
        contentUrl.includes("instagram.com") ||
        contentUrl.includes("facebook.com") ||
        contentUrl.includes("tiktok.com") ||
        contentUrl.includes("youtube.com") ||
        contentUrl.includes("youtu.be")
      ) {
        req.logger?.debug(
          `Social media URL detected, using metadata extraction`
        );

        const metadata = await getMetadata(contentUrl);

        if (contentUrl.includes("facebook.com")) {
          req.logger?.debug(
            `Facebook URL detected, using custom metadata extraction`
          );
          description = metadata?.og.title ?? "";
        } else if (
          contentUrl.includes("youtube.com") ||
          contentUrl.includes("youtu.be")
        ) {
          const videoId = getYouTubeVideoId(contentUrl);
          req.logger?.debug(
            `YouTube URL detected, analyzing content for ${videoId}`
          );

          const { title, description: desc } = videoId
            ? await getYoutubeMetadata(videoId)
            : { title: null, description: "" };

          if (title || desc) {
            const isTravelContent = await analyzeYouTubeContent(
              title,
              desc,
              req
            );
            if (!isTravelContent) {
              req.logger?.info(
                `YouTube content is not travel-related. Skipping processing for URL: ${contentUrl}`
              );
              // Immediately return a response indicating that the content is not relevant
              res.status(200).json({
                success: false,
                message:
                  "YouTube content is not travel-related and will not be processed.",
              });
              return;
            }
            req.logger?.info(
              "YouTube content is travel-related. Proceeding with processing."
            );
            description = [title, desc].filter(Boolean).join(" ");
          } else {
            req.logger?.warn(
              `Missing title or description for YouTube URL: ${contentUrl}. Skipping analysis.`
            );

            res.status(200).json({
              success: false,
              message: `Missing title or description for YouTube URL: ${contentUrl}`,
            });
            return;
          }
        } else {
          description = [metadata?.meta.title, metadata?.meta.description]
            .filter(Boolean)
            .join(" ");
        }
        contentThumbnail = metadata?.og.image ?? contentThumbnail;
      }
      // For all other URLs - use Jina API directly
      else {
        try {
          req.logger?.debug(
            `Non-social media URL detected, fetching full webpage content via Jina API: ${contentUrl}`
          );

          const jinaResponse = await fetch(`https://r.jina.ai/${contentUrl}`, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${process.env.JINA_API_TOKEN}`,
            },
          });

          if (jinaResponse.ok) {
            const webpageContent = await jinaResponse.text();
            if (webpageContent && webpageContent.trim().length > 0) {
              // Use the full webpage content
              description = webpageContent;
              req.logger?.debug(
                `Successfully extracted webpage content (${webpageContent.length} characters)`
              );
            } else {
              req.logger?.warn(`Jina API returned empty content`);
              description = "No content available from URL";
            }
          } else {
            req.logger?.warn(
              `Jina API request failed with status: ${jinaResponse.status}`
            );
            description = "Failed to fetch content from URL";
          }
        } catch (jinaError) {
          req.logger?.warn(
            `Failed to fetch webpage content via Jina API:`,
            jinaError
          );
          description = "Error fetching content from URL";
        }
      }

      console.log("Description is ", description);

      if (!description) {
        req.logger?.error(`Failed to fetch metadata for URL - ${contentUrl}`);
      }

      // Update the content's rawData (URL and user_notes remain unchanged)
      await prisma.content.update({
        where: { id: content_id },
        data: {
          rawData: description,
          ...(contentThumbnail && { thumbnail: contentThumbnail }),
          status: "PROCESSING",
        },
      });

      console.log(
        `Content updated with ID: ${content_id}. Starting async processing...`
      );
      req.logger?.info(
        `Content updated: ${content_id}. Processing will continue asynchronously.`
      );

      // Emit processing status via WebSocket
      emitContentProcessingStatus(trip_id, content_id, "processing");

      // Start async processing in the background (don't await)
      processContentUpdateAsync(
        content_id,
        description,
        req,
        contentUrl,
        user_id,
        trip_id
      );

      // Return immediate response with content info
      res.status(202).json({
        success: true,
        message: "Content is being refreshed and processed",
        content: {
          id: content_id,
          url: contentUrl,
          rawData: description,
          userId: user_id,
          tripId: trip_id,
          thumbnail: contentThumbnail,
          updatedAt: new Date(),
        },
        processing: {
          status: "in_progress",
          message:
            "AI analysis and pin updates are being processed in the background",
        },
      });
    } catch (error) {
      console.log("Look at exact error", error);
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Invalid input data", details: error.errors });
      } else {
        console.error(`Error processing refresh request:`, error);
        res.status(500).json({ error: "Internal server error." });
      }
    }
  }
);

app.get(
  "/api/user-trips",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        console.log("Is current user null", currentUser);
        throw new Error("User not authenticated");
      }
      const { id } = currentUser;
      const trips = await getTripsByUserId(id);
      res.status(200).json(trips);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        console.error(`Error fetching trips:`, error);
        res.status(500).json({ error: "Internal server error." });
      }
    }
  }
);

app.post(
  "/api/user-trips",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        throw new Error("User not authenticated");
      }
      const { id } = currentUser;
      const trips = await getTripsByUserId(id);
      if (trips.length === 0) {
        res.status(404).json({ error: "No trips found for the given user." });
        return;
      }
      res.status(200).json(trips);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        console.error(`Error fetching trips:`, error);
        res.status(500).json({ error: "Internal server error." });
      }
    }
  }
);

// API to leave a trip (removes user from trip, keeps content visible)
app.delete(
  "/api/leave-trip",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const { tripId } = LeaveTripSchema.parse(req.body);

      req.logger?.info(
        `Leave trip request: tripId=${tripId}, user=${currentUser.id}`
      );

      // Verify the trip exists
      const trip = await getTripById(tripId);
      if (!trip) {
        res.status(404).json({ error: "Trip not found" });
        return;
      }

      // Verify user is a member of this trip
      const userRole = await getUserRoleInTrip(currentUser.id, tripId);
      if (!userRole) {
        res.status(403).json({
          error: "You are not a member of this trip",
        });
        return;
      }

      // Check if user is the only owner and needs to transfer ownership
      const ownerCount = await prisma.tripUser.count({
        where: { tripId, role: "owner" },
      });

      let newOwnerName = null;
      if (userRole === "owner" && ownerCount === 1) {
        // Find other members to transfer ownership to (oldest member first)
        const otherMembers = await prisma.tripUser.findMany({
          where: {
            tripId,
            userId: { not: currentUser.id },
            role: "member",
          },
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: "asc" }, // Oldest member first
        });

        if (otherMembers.length > 0) {
          // Transfer ownership to the longest-standing member
          const newOwner = otherMembers[0];
          await prisma.tripUser.update({
            where: {
              tripId_userId: {
                tripId,
                userId: newOwner.userId,
              },
            },
            data: { role: "owner" },
          });

          newOwnerName = newOwner.user.name;
          req.logger?.info(
            `Ownership of trip ${tripId} transferred from ${currentUser.id} to ${newOwner.userId} (${newOwnerName})`
          );
        }
        // If no other members exist, user still leaves and trip becomes ownerless
      }

      // Remove user from trip (their content remains visible to other members)
      await prisma.tripUser.delete({
        where: {
          tripId_userId: {
            tripId,
            userId: currentUser.id,
          },
        },
      });

      // Remove user's UserPlaceMustDo entries for this trip
      await prisma.userPlaceMustDo.deleteMany({
        where: {
          tripId,
          userId: currentUser.id,
        },
      });

      req.logger?.info(
        `User ${currentUser.id} successfully left trip ${tripId}. Their content remains visible to other members.`
      );

      const responseMessage = newOwnerName
        ? `Successfully left trip. Ownership transferred to ${newOwnerName}. Your shared content remains visible to other members.`
        : "Successfully left trip. Your shared content remains visible to other members.";

      res.status(200).json({
        success: true,
        message: responseMessage,
        action: "left_trip",
        ownershipTransferred: !!newOwnerName,
        newOwner: newOwnerName,
        contentNote:
          "Your pins and content shared in this trip will remain visible to other members",
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: "Invalid input data",
          details: error.errors,
        });
      } else {
        console.error("Error leaving trip:", error);
        req.logger?.error(`Failed to leave trip: ${error}`);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
);

// API to delete a trip (owners only - deletes entire trip and all data)
app.delete(
  "/api/delete-trip",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const { tripId } = DeleteTripSchema.parse(req.body);

      req.logger?.info(
        `Delete trip request: tripId=${tripId}, user=${currentUser.id}`
      );

      // Verify the trip exists
      const trip = await getTripById(tripId);
      if (!trip) {
        res.status(404).json({ error: "Trip not found" });
        return;
      }

      // Verify user has access to this trip and is an owner
      const userRole = await getUserRoleInTrip(currentUser.id, tripId);
      if (!userRole) {
        res.status(403).json({
          error: "You don't have access to this trip",
        });
        return;
      }

      // Only owners can delete trips
      if (userRole !== "owner") {
        res.status(403).json({
          error: "Only trip owners can delete trips",
        });
        return;
      }

      // Delete the trip - Prisma cascade deletes will handle related records
      // This will delete:
      // - TripUser entries (trip members)
      // - Content entries (and their pins via cascade)
      // - ShareToken entries
      // - UserPlaceMustDo entries
      // - Message entries
      // PlaceCache remains untouched as intended
      await prisma.trip.delete({
        where: { id: tripId },
      });

      req.logger?.info(
        `Trip ${tripId} successfully deleted by user ${currentUser.id}`
      );

      res.status(200).json({
        success: true,
        message: "Trip and all related data deleted successfully",
        deletedTripId: tripId,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: "Invalid input data",
          details: error.errors,
        });
      } else {
        console.error("Error deleting trip:", error);
        req.logger?.error(`Failed to delete trip: ${error}`);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
);

app.get(
  "/api/public-trips",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        throw new Error("User not authenticated");
      }

      const trips = await getPublicTrips();
      if (trips.length === 0) {
        res.status(404).json({ error: "No Public trips found." });
        return;
      }
      res.status(200).json(trips);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        console.error(`Error fetching trips:`, error);
        res.status(500).json({ error: "Internal server error." });
      }
    }
  }
);

app.get("/api/health", async (req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.get(
  "/api/admin/latest-content",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const providedSecret =
        req.header("x-admin-secret") || (req.query.secret as string);
      const pinFilter = (req.query.pins as string) || "all";

      if (!providedSecret || providedSecret !== ADMIN_SECRET) {
        res.status(401).json({
          success: false,
          error: "Unauthorized",
        });
        return;
      }

      const whereClause =
        pinFilter === "none"
          ? {
              pins_count: 0,
            }
          : undefined;

      const contents = await prisma.content.findMany({
        where: whereClause,
        orderBy: {
          createdAt: "desc",
        },
        take: 50,
        select: {
          id: true,
          title: true,
          url: true,
          createdAt: true,
          updatedAt: true,
          pins_count: true,
          thumbnail: true,
          userNotes: true,
          status: true,
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
          pins: {
            orderBy: {
              createdAt: "desc",
            },
            select: {
              id: true,
              name: true,
              category: true,
              description: true,
              createdAt: true,
              placeCache: {
                select: {
                  id: true,
                  name: true,
                  lat: true,
                  lng: true,
                  rating: true,
                  userRatingCount: true,
                  googleMapsLink: true,
                },
              },
            },
          },
        },
      });

      res.status(200).json({
        success: true,
        count: contents.length,
        contents,
      });
    } catch (error) {
      console.error("Error fetching admin latest content:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }
);

app.post("/api/users", async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, phoneNumber, firebaseId } = UserSchema.parse(req.body);
    const newUser = await createUser(name, email, phoneNumber, firebaseId);
    res.status(201).json(newUser);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      console.error(`Error creating trip:`, error);
      res.status(500).json({ error: "Internal server error." });
    }
  }
});

app.post("/api/signin-with-apple", async (req, res) => {
  const { firebaseId, name, email, phoneNumber } = UserSchema.parse(req.body);
  const prisma = new PrismaClient();

  try {
    let user = await getUserByFirebaseId(firebaseId);
    let isNewUser = false;

    if (!user) {
      user = await prisma.user.create({
        data: {
          firebaseId,
          name,
          email,
          phoneNumber: phoneNumber || "", // Apple doesn't always provide phone number
          metadata: {
            new_tour_flow_user: true,
            has_local_trip: false,
            has_demo_country_trip: false,
            has_completed_first_tour: false,
            has_completed_second_tour: false,
            has_completed_third_tour: false,
          },
        } as any,
      });
      isNewUser = true;
    }

    const trips = await getTripsByUserId(user.id);
    let currentTripId = trips[0]?.id;

    res.status(200).json({
      ...user,
      metadata: (user as any).metadata,
      currentTripId: currentTripId,
      trips: trips,
    });
  } catch (error) {
    console.error("Error in apple sign-in:", error);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.post("/api/signin-with-google", async (req, res) => {
  const { firebaseId, name, email, phoneNumber } = UserSchema.parse(req.body);
  const prisma = new PrismaClient();

  try {
    let user = await getUserByFirebaseId(firebaseId);
    let isNewUser = false;
    if (!user) {
      user = await prisma.user.create({
        data: {
          firebaseId,
          name,
          email,
          phoneNumber,
          metadata: {
            new_tour_flow_user: true,
            has_local_trip: false,
            has_completed_first_tour: false,
            has_completed_second_tour: false,
            has_completed_third_tour: false,
          },
        } as any,
      });
      isNewUser = true;
    }

    const trips = await getTripsByUserId(user.id);
    let currentTripId = trips[0]?.id;

    res.status(200).json({
      ...user,
      metadata: (user as any).metadata,
      currentTripId: currentTripId,
      trips: trips,
    });
  } catch (error) {
    console.error("Error in get-or-create-user:", error);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.delete("/api/delete-user", authenticate, async (req, res) => {
  const currentUser = req.currentUser;
  if (currentUser == null) {
    res.status(401).json({ error: "User not authenticated" });
    throw new Error("User not authenticated");
  }

  const prisma = new PrismaClient();
  try {
    // delete user

    await prisma.user.delete({
      where: { id: currentUser.id },
    });
    res.status(200).json({ msg: "User deleted" });
  } catch (error) {
    console.error("Error in deleting user:", error);
    res.status(500).json({ error });
  }
});

app.post(
  "/api/create-local-trip",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { cityName, userName } = req.body;
      const user = req.currentUser;

      if (user == null) {
        throw new Error("User not authenticated");
      }

      // Validate that cityName is not empty
      if (!cityName || cityName.trim() === "") {
        res
          .status(400)
          .json({ error: "City name is required and cannot be empty" });
        return;
      }

      const { startDate, endDate } = getDummyStartAndEndDate();
      const firstName = userName ? userName.split(" ")[0] : "My";

      const newTrip = await createTripAndTripUser(
        user.id,
        `${firstName}'s favourite spots in ${cityName}`,
        startDate,
        endDate,
        `My collection of all the cool stuff to do in ${cityName}.`,
        { type: "default_local", isDemo: false }
      );

      // Update user metadata to mark local trip as created
      // Fetch the complete user data to preserve existing metadata
      const currentUserData = await prisma.user.findUnique({
        where: { id: user.id },
        select: { metadata: true },
      });

      const updatedMetadata = mergeMetadata(currentUserData?.metadata, {
        has_local_trip: true,
      });

      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: {
          metadata: updatedMetadata,
        } as any,
      });

      console.log("Created local trip:", newTrip);
      console.log("Updated user metadata:", (updatedUser as any).metadata);
      res.status(201).json(newTrip);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        console.error(`Error creating local trip:`, error);
        res.status(500).json({ error: "Internal server error." });
      }
    }
  }
);

// Update user tutorial completion status
app.put(
  "/api/update-user-tutorial-status",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { firstTourCompleted, secondTourCompleted, thirdTourCompleted } =
        req.body;
      const user = req.currentUser;

      if (user == null) {
        throw new Error("User not authenticated");
      }

      // First, fetch the complete user data to get existing metadata
      const currentUserData = await prisma.user.findUnique({
        where: { id: user.id },
        select: { metadata: true },
      });

      const updateData: any = {};
      if (firstTourCompleted !== undefined) {
        updateData.has_completed_first_tour = firstTourCompleted;
      }
      if (secondTourCompleted !== undefined) {
        updateData.has_completed_second_tour = secondTourCompleted;
      }
      if (thirdTourCompleted !== undefined) {
        updateData.has_completed_third_tour = thirdTourCompleted;
      }

      // Preserve existing metadata and merge with new data
      const updatedMetadata = mergeMetadata(
        currentUserData?.metadata,
        updateData
      );

      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: {
          metadata: updatedMetadata,
        } as any,
      });

      console.log(
        "Updated user tutorial status:",
        (updatedUser as any).metadata
      );
      res.status(200).json(updatedUser);
    } catch (error) {
      console.error(`Error updating user tutorial status:`, error);
      res.status(500).json({ error: "Internal server error." });
    }
  }
);

app.post(
  "/api/create-trip",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, description } = req.body;
      const user = req.currentUser;

      if (user == null) {
        throw new Error("User not authenticated");
      }

      // Validate that name is not empty
      if (!name || name.trim() === "") {
        res
          .status(400)
          .json({ error: "Trip name is required and cannot be empty" });
        return;
      }

      const { startDate, endDate } = getDummyStartAndEndDate();
      const newTrip = await createTripAndTripUser(
        user.id,
        name.trim(), // Also trim whitespace from the name
        startDate,
        endDate,
        description ?? ""
      );

      console.log("Look at new trip", newTrip);
      res.status(201).json(newTrip);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        console.error(`Error creating trip:`, error);
        res.status(500).json({ error: "Internal server error." });
      }
    }
  }
);

// Edit trip API
app.put(
  "/api/edit-trip",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { tripId, name, description } = req.body;
      const user = req.currentUser;

      if (user == null) {
        throw new Error("User not authenticated");
      }

      // Validate that name is not empty
      if (!name || name.trim() === "") {
        res
          .status(400)
          .json({ error: "Trip name is required and cannot be empty" });
        return;
      }

      // Verify user has access to this trip
      const userInTrip = await isUserInTrip(user.id, tripId);
      if (!userInTrip) {
        res.status(403).json({ error: "You don't have access to this trip" });
        return;
      }

      // Update the trip
      const updatedTrip = await prisma.trip.update({
        where: { id: tripId },
        data: {
          name: name.trim(),
          description: description ?? "",
        },
      });

      console.log("Updated trip:", updatedTrip);
      res.status(200).json(updatedTrip);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        console.error(`Error updating trip:`, error);
        res.status(500).json({ error: "Internal server error." });
      }
    }
  }
);

// Update trip metadata API
app.put(
  "/api/update-trip-metadata",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { tripId, metadata } = req.body;
      const user = req.currentUser;

      if (user == null) {
        throw new Error("User not authenticated");
      }

      // Verify user has access to this trip
      const userInTrip = await isUserInTrip(user.id, tripId);
      if (!userInTrip) {
        res.status(403).json({ error: "You don't have access to this trip" });
        return;
      }

      // Update the trip metadata
      const updatedTrip = await prisma.trip.update({
        where: { id: tripId },
        data: {
          metadata: metadata,
        },
      });

      console.log("Updated trip metadata:", updatedTrip);
      res.status(200).json(updatedTrip);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        console.error(`Error updating trip metadata:`, error);
        res.status(500).json({ error: "Internal server error." });
      }
    }
  }
);

app.post(
  "/api/create-user-trip",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { role, user_id, trip_id } = UserTripSchema.parse(req.body);
      await createUserTrip(role, user_id, trip_id);
      res
        .status(201)
        .json({ message: "User-trip association created successfully." });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        console.error(`Error creating user-trip association:`, error);
        res.status(500).json({ error: "Internal server error." });
      }
    }
  }
);

// Zod schema for validating tripId
const tripIdSchema = z.object({
  tripId: z.string(),
});
// Query parameters schema
const tripContentQuerySchema = z.object({
  userLastLogin: z
    .string()
    .regex(/^\d+$/, "Must be a valid Unix timestamp")
    .transform((val) => parseInt(val, 10))
    .optional(), // Unix timestamp (seconds since epoch)
});

app.get(
  "/api/trip/:tripId/content",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      // Validate request parameters
      const { tripId } = tripIdSchema.parse(req.params);

      // Validate query parameters
      const { userLastLogin } = tripContentQuerySchema.parse(req.query);

      // Determine the last login time to use for filtering new content
      let lastLoginDate: Date | null = null;
      if (userLastLogin) {
        // Use the provided userLastLogin parameter
        lastLoginDate = new Date(userLastLogin * 1000);
      } else if (currentUser.lastOpened) {
        // Use the user's last opened time from the database
        lastLoginDate = new Date(currentUser.lastOpened);
      }

      // Verify user has access to this trip
      const userInTrip = await isUserInTrip(currentUser.id, tripId);
      if (!userInTrip) {
        res.status(403).json({ error: "You don't have access to this trip" });
        return;
      }

      // Fetch content, pins, and place cache with blocking logic
      const { contentList, pinsList, placeCacheList } =
        await getTripContentData(tripId, lastLoginDate, currentUser.id);

      const trip = await getTripById(tripId);
      const nested = await getContentPinsPlaceNested(tripId, currentUser.id);

      // Get all users who are members of this trip
      const tripUsers = await getAllTripUsers(tripId, currentUser.id);

      res.status(200).json({
        contents: contentList,
        pins: pinsList,
        placeCaches: placeCacheList,
        nestedData: nested,
        trip,
        users: tripUsers,
      });
    } catch (error) {
      console.error("Error fetching trip data:", error);
      res.status(500).json({ error: "Internal server error." });
    }
  }
);

app.post(
  "/api/add-user-to-trip",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        throw new Error("User not authenticated");
      }
      const user_id = currentUser.id;
      const { trip_id } = req.body;
      console.log(user_id, trip_id);
      await addUserToTrip(trip_id, user_id, "member");
      res.status(201).json({ message: "User added to trip successfully." });
    } catch (error) {
      console.error("Error adding user to trip:", error);
      res.status(500).json({ error: "Internal server error." });
    }
  }
);

app.get(
  "/api/getUsersFromTrip",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const { tripId } = req.query;

      if (!tripId) {
        res.status(400).json({ error: "tripId is required" });
        return;
      }

      // Verify user has access to this trip
      const userInTrip = await isUserInTrip(currentUser.id, tripId as string);
      if (!userInTrip) {
        res.status(403).json({ error: "You don't have access to this trip" });
        return;
      }

      const users = await getUsersFromTrip(tripId as string, currentUser.id);
      res.status(200).json(users);
    } catch (error) {
      console.error("Error fetching users from trip:", error);
      res.status(500).json({ error: "Internal server error." });
    }
  }
);

// api for sending message
app.post(
  "/api/addMessage",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        throw new Error("User not authenticated");
      }
      const userId = currentUser.id;

      const { tripId, message, timestamp, type } = req.body;
      console.log(req.body);
      await addMessage(tripId, userId, message, timestamp, type);
      res.status(200).json({ message: "Message received successfully." });
    } catch (error) {
      console.error("Error sending message:", error);
      res.status(500).json({ error: "Internal server error." });
    }
  }
);

app.get(
  "/api/getMessagesByTrip",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const { tripId, before, limit = 20 } = req.query;

      if (!tripId) {
        res.status(400).json({ error: "tripId is required" });
        return;
      }

      // Verify user has access to this trip
      const userInTrip = await isUserInTrip(currentUser.id, tripId as string);
      if (!userInTrip) {
        res.status(403).json({ error: "You don't have access to this trip" });
        return;
      }

      const queryLimit = parseInt(limit as string, 10);
      let beforeDate: Date | undefined = undefined;

      if (before) {
        const beforeMessage = await getMessageById(
          tripId as string,
          before as string
        );
        if (!beforeMessage) {
          res.status(400).json({ error: 'Invalid "before" message ID' });
          return;
        }
        beforeDate = beforeMessage?.createdAt;
      }

      const messages = await getMessagesByTime(
        tripId as string,
        beforeDate as any,
        queryLimit as number,
        currentUser.id
      );

      res.json(messages);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

app.get("/api/getUsername", async (req: Request, res: Response) => {
  const { userId } = req.query;
  console.log(userId);
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }
  try {
    const user = await getUsername(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    console.log(user);
    return res.status(200).json({ name: user.name });
  } catch (error) {
    console.error("Error fetching username:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get(
  "/api/trip/:tripId",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request parameters
      const { tripId } = tripIdSchema.parse(req.params);
      const trip = await getTripById(tripId);
      res.status(200).json({
        trip,
      });
    } catch (error) {
      console.error("Error fetching trip:", error);
      res.status(500).json({ error: "Internal server error." });
    }
  }
);

// Add this to your existing schemas
const ShareTripSchema = z.object({
  tripId: z.string().uuid(),
});

const JoinTripSchema = z.object({
  token: z.string(),
});

// Route to generate a share link for a trip
app.post(
  "/api/generate-share-link",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { tripId } = ShareTripSchema.parse(req.body);
      const currentUser = req.currentUser;

      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      req.logger?.info(
        `Share link request received: tripId=${tripId}, userId=${currentUser.id}`
      );

      // Verify the trip exists
      const trip = await getTripById(tripId);
      if (!trip) {
        res.status(404).json({ error: "Trip not found" });
        return;
      }

      // Verify the user is part of this trip
      const userInTrip = await isUserInTrip(currentUser.id, tripId);
      if (!userInTrip) {
        res.status(403).json({
          error: "Only trip members can generate share links",
        });
        return;
      }

      // Generate unique token
      const uniqueToken = generateUniqueToken();

      // Store token in database
      await createShareToken(uniqueToken, tripId, currentUser.id);

      // Create the web URL (instead of custom scheme)
      // This will work in WhatsApp and other messaging apps
      const shareLink = `https://pinspire.co.in/join-trip/${uniqueToken}`;

      // Also include the custom scheme as fallback for direct app integration
      const deepLink = `before-thirty://join-trip/${uniqueToken}`;

      res.status(200).json({
        success: true,
        shareLink: shareLink, // Primary link for sharing
        deepLink: deepLink, // Fallback for direct app usage
        token: uniqueToken, // Token for reference
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Invalid input data", details: error.errors });
      } else {
        console.error(`Error generating share link:`, error);
        res.status(500).json({ error: "Internal server error." });
      }
    }
  }
);

// Route to get trip details from a token
app.get(
  "/api/join-trip/:token",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { token } = req.params;

      if (!token) {
        res.status(400).json({ error: "Token is required" });
        return;
      }

      // Get trip information from token
      const shareToken = await getShareTokenDetails(token);

      if (!shareToken) {
        res.status(404).json({ error: "Invalid share link" });
        return;
      }

      // Check if token has expired
      if (shareToken.expiresAt < new Date()) {
        res.status(410).json({ error: "Share link has expired" });
        return;
      }

      // Get trip details
      const trip = await getTripById(shareToken.tripId);

      if (!trip) {
        res.status(404).json({ error: "Trip not found" });
        return;
      }

      // Get member count
      const memberCount = await getTripMemberCount(shareToken.tripId);

      res.status(200).json({
        success: true,
        tripDetails: {
          id: trip.id,
          name: trip.name,
          description: trip.description,
          memberCount,
          startDate: trip.startDate,
          endDate: trip.endDate,
        },
      });
    } catch (error) {
      console.error("Error fetching trip details from token:", error);
      res.status(500).json({ error: "Internal server error." });
    }
  }
);

// Route to join a trip using a token
app.post(
  "/api/join-trip",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { token } = JoinTripSchema.parse(req.body);

      const currentUser = req.currentUser;
      if (!currentUser) {
        res.status(401).json({
          success: false,
          error: "User not authenticated",
        });
        return;
      }

      // Get trip information from token
      const shareToken = await getShareTokenDetails(token);

      if (!shareToken) {
        res.status(404).json({
          success: false,
          error: "Invalid share link",
        });
        return;
      }

      // Check if token has expired
      if (shareToken.expiresAt < new Date()) {
        res.status(410).json({
          success: false,
          error: "Share link has expired",
        });
        return;
      }

      // Get trip details
      const trip = await getTripById(shareToken.tripId);

      if (!trip) {
        res.status(404).json({
          success: false,
          error: "Trip not found",
        });
        return;
      }

      // Check if user is already in the trip
      const userInTrip = await isUserInTrip(currentUser.id, shareToken.tripId);

      if (userInTrip) {
        // User is already in the trip
        res.status(200).json({
          success: true,
          message: "You are already a member of this trip",
          alreadyMember: true,
          trip: trip,
        });
        return;
      }

      // Add user to the trip
      await addUserToTrip(shareToken.tripId, currentUser.id, "member");

      // Return success response with trip details
      res.status(200).json({
        success: true,
        message: "Successfully joined trip",
        alreadyMember: false,
        trip: trip,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: "Invalid input data",
          details: error.errors,
        });
      } else {
        console.error("Error joining trip:", error);
        res.status(500).json({
          success: false,
          error: "Internal server error.",
        });
      }
    }
  }
);

// Zod schemas for validation
const MustDoPlaceSchema = z.object({
  placeCacheId: z.string().uuid(),
  tripId: z.string().uuid(),
});

const EditUserNotesSchema = z.object({
  contentId: z.string().uuid(),
  userNotes: z.string(),
});

const DeletePinSchema = z.object({
  pinId: z.string().uuid(),
});

const DeleteTripSchema = z.object({
  tripId: z.string().uuid(),
});

const LeaveTripSchema = z.object({
  tripId: z.string().uuid(),
});

const DeleteContentSchema = z.object({
  contentId: z.string().uuid(),
});

const SearchPlacesSchema = z.object({
  query: z.string().min(1, "Search query is required"),
  location: z
    .object({
      lat: z.number(),
      lng: z.number(),
    })
    .optional(),
  radius: z.number().min(1).max(50000).optional().default(5000), // Default 5km radius
  type: z.string().optional(), // Optional place type filter
});

const ManualPinSchema = z.object({
  placeId: z.string().min(1, "Place ID is required"),
  tripId: z.string().uuid(),
});

// Notification schemas
const RegisterFcmTokenSchema = z.object({
  fcmToken: z.string().min(1, "FCM token is required"),
  deviceInfo: z
    .object({
      platform: z.string().optional(),
      version: z.string().optional(),
      deviceId: z.string().optional(),
    })
    .optional(),
});

const UnregisterFcmTokenSchema = z.object({
  fcmToken: z.string().min(1, "FCM token is required"),
});

const SendNotificationSchema = z.object({
  userIds: z
    .array(z.string().uuid())
    .min(1, "At least one user ID is required"),
  title: z.string().min(1, "Title is required"),
  body: z.string().min(1, "Body is required"),
  data: z.record(z.string()).optional(),
  imageUrl: z.string().url().optional(),
});

const BroadcastNotificationSchema = z.object({
  title: z.string().min(1, "Title is required"),
  body: z.string().min(1, "Body is required"),
  data: z.record(z.string()).optional(),
  imageUrl: z.string().url().optional(),
});

const UpdateBucketListSchema = z.object({
  countries: z
    .array(z.string())
    .min(1, "At least one country must be selected"),
});

const EditTripNameSchema = z.object({
  tripId: z.string().uuid(),
  newName: z
    .string()
    .min(1, "Trip name is required")
    .max(100, "Trip name too long"),
});

// API to mark a place as must-do for a trip
app.post(
  "/api/mark-place-must-do",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const { placeCacheId, tripId } = MustDoPlaceSchema.parse(req.body);

      // Verify user has access to this trip
      const userInTrip = await isUserInTrip(currentUser.id, tripId);
      if (!userInTrip) {
        res.status(403).json({ error: "You don't have access to this trip" });
        return;
      }

      // Verify the place exists
      const placeExists = await verifyPlaceExists(placeCacheId);
      if (!placeExists) {
        res.status(404).json({ error: "Place not found" });
        return;
      }

      // Verify the trip exists
      const tripExists = await verifyTripExists(tripId);
      if (!tripExists) {
        res.status(404).json({ error: "Trip not found" });
        return;
      }

      // Mark place as must-do
      const result = await markPlaceAsMustDo(
        currentUser.id,
        placeCacheId,
        tripId
      );

      req.logger?.info(
        `Place ${placeCacheId} marked as must-do by user ${currentUser.id} for trip ${tripId}`
      );

      if (result.alreadyMarked) {
        res.status(200).json({
          success: true,
          message: "Place is already marked as must-do",
          alreadyMarked: true,
          mustDoEntry: result.entry,
        });
      } else {
        res.status(201).json({
          success: true,
          message: "Place marked as must-do successfully",
          mustDoEntry: result.entry,
        });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Invalid input data", details: error.errors });
      } else {
        console.error("Error marking place as must-do:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
);

// API to unmark a place as must-do for a trip
app.delete(
  "/api/unmark-place-must-do",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const { placeCacheId, tripId } = MustDoPlaceSchema.parse(req.body);

      // Verify user has access to this trip
      const userInTrip = await isUserInTrip(currentUser.id, tripId);
      if (!userInTrip) {
        res.status(403).json({ error: "You don't have access to this trip" });
        return;
      }

      // Unmark place as must-do
      const success = await unmarkPlaceAsMustDo(
        currentUser.id,
        placeCacheId,
        tripId
      );

      if (!success) {
        res.status(404).json({
          success: false,
          message: "Place is not marked as must-do",
        });
        return;
      }

      req.logger?.info(
        `Place ${placeCacheId} unmarked as must-do by user ${currentUser.id} for trip ${tripId}`
      );
      res.status(200).json({
        success: true,
        message: "Place unmarked as must-do successfully",
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Invalid input data", details: error.errors });
      } else {
        console.error("Error unmarking place as must-do:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
);

// API to edit user notes
app.put(
  "/api/edit-user-notes",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const { contentId, userNotes } = EditUserNotesSchema.parse(req.body);

      const hasAccess = await verifyContentAccess(contentId, currentUser.id);
      if (!hasAccess) {
        res
          .status(403)
          .json({ error: "You don't have access to this content" });
        return;
      }

      const updatedContent = await updateUserNotes(contentId, userNotes);

      // Regenerate embeddings for the updated content in the background
      try {
        console.log(
          `Regenerating embeddings for updated content ${contentId}...`
        );
        generateContentEmbeddings(contentId)
          .then(() => {
            console.log(
              ` Embeddings regenerated successfully for content ${contentId}`
            );
          })
          .catch((embeddingError) => {
            console.error(
              `Failed to regenerate embeddings for content ${contentId}:`,
              embeddingError
            );
          });
      } catch (embeddingError) {
        console.error(
          `Error starting embedding regeneration for content ${contentId}:`,
          embeddingError
        );
      }

      req.logger?.info(
        `User notes updated for content ${contentId} by user ${currentUser.id}`
      );
      res.status(200).json({
        success: true,
        message: "User notes updated successfully",
        content: updatedContent,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Invalid input data", details: error.errors });
      } else {
        console.error("Error updating user notes:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
);

// API to delete a pin
app.delete(
  "/api/delete-pin",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const { pinId } = DeletePinSchema.parse(req.body);

      // Verify user has access to this pin
      const hasAccess = await verifyPinAccess(pinId, currentUser.id);
      if (!hasAccess) {
        res.status(403).json({ error: "You don't have access to this pin" });
        return;
      }

      // Delete the pin
      await deletePin(pinId);

      req.logger?.info(`Pin ${pinId} deleted by user ${currentUser.id}`);
      res.status(200).json({
        success: true,
        message: "Pin deleted successfully",
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Invalid input data", details: error.errors });
      } else {
        console.error("Error deleting pin:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
);

// API to delete content and its associated pins (preserves place cache)
app.delete(
  "/api/delete-content",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const { contentId } = DeleteContentSchema.parse(req.body);

      req.logger?.info(
        `Delete content request: contentId=${contentId}, user=${currentUser.id}`
      );

      // Get the content to verify it exists and check ownership
      const content = await prisma.content.findUnique({
        where: { id: contentId },
        select: {
          id: true,
          userId: true,
          tripId: true,
          url: true,
          title: true,
        },
      });

      if (!content) {
        res.status(404).json({ error: "Content not found" });
        return;
      }

      // Check if user owns the content OR is a trip owner
      let canDelete = false;

      if (content.userId === currentUser.id) {
        // User owns the content
        canDelete = true;
      } else {
        // Check if user is a trip owner
        const userRole = await getUserRoleInTrip(
          currentUser.id,
          content.tripId
        );
        if (userRole === "owner") {
          canDelete = true;
        }
      }

      if (!canDelete) {
        res.status(403).json({
          error: "You don't have permission to delete this content",
        });
        return;
      }

      // Delete the content and its pins (Prisma cascade will handle pins)
      // This will delete:
      // - The Content record
      // - All associated Pin records (via onDelete: Cascade)
      // PlaceCache remains untouched as intended
      await prisma.content.delete({
        where: { id: contentId },
      });

      req.logger?.info(
        `Content ${contentId} and its pins successfully deleted by user ${currentUser.id}`
      );

      res.status(200).json({
        success: true,
        message: "Content and associated pins deleted successfully",
        deletedContentId: contentId,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: "Invalid input data",
          details: error.errors,
        });
      } else {
        console.error("Error deleting content:", error);
        req.logger?.error(`Failed to delete content: ${error}`);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
);

app.post(
  "/api/google-places-autocomplete",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const { query, location, radius, type } = SearchPlacesSchema.parse(
        req.body
      );

      req.logger?.info(
        `Search places request: query="${query}", user="${currentUser.id}"`
      );

      const places = await searchPlaces(
        query,
        location,
        radius,
        type,
        req,
        currentUser.id
      );

      res.status(200).json({
        success: true,
        places: places,
        count: places.length,
        query: query,
      });
    } catch (error) {
      console.log("What is the exact error though", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: "Invalid input data",
          details: error.errors,
        });
      } else {
        console.error("Error searching places:", error);
        res.status(500).json({
          success: false,
          error: "Internal server error.",
        });
      }
    }
  }
);

// Paginated pins API
app.get(
  "/api/trip/:tripId/pins",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      // Validate request parameters
      const { tripId } = tripIdSchema.parse(req.params);

      // Parse pagination parameters
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = (page - 1) * limit;

      // Verify user has access to this trip
      const userInTrip = await isUserInTrip(currentUser.id, tripId);
      if (!userInTrip) {
        res.status(403).json({ error: "You don't have access to this trip" });
        return;
      }

      // Get paginated pins from database
      const prisma = new PrismaClient();
      const pins = await prisma.pin.findMany({
        where: {
          content: {
            tripId: tripId,
          },
        },
        include: {
          placeCache: {
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
              // Excluding currentOpeningHours and regularOpeningHours to reduce response size
            },
          },
          content: {
            select: {
              id: true,
              title: true,
              rawData: true,
              userNotes: true,
              thumbnail: true,
              userId: true,
              createdAt: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip: offset,
        take: limit,
      });

      // Get total count for pagination info
      const totalPins = await prisma.pin.count({
        where: {
          content: {
            tripId: tripId,
          },
        },
      });

      const totalPages = Math.ceil(totalPins / limit);
      const hasNextPage = page < totalPages;
      const hasPrevPage = page > 1;

      res.status(200).json({
        pins: pins,
        pagination: {
          currentPage: page,
          totalPages: totalPages,
          totalPins: totalPins,
          limit: limit,
          hasNextPage: hasNextPage,
          hasPrevPage: hasPrevPage,
        },
      });
    } catch (error) {
      console.error("Error fetching paginated pins:", error);
      res.status(500).json({ error: "Internal server error." });
    }
  }
);

// API to manually create content and pin from placeId (no AI analysis)
app.post(
  "/api/manual-pin",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const { placeId, tripId } = ManualPinSchema.parse(req.body);

      req.logger?.info(
        `Manual pin request: placeId="${placeId}", user="${currentUser.id}", tripId="${tripId}"`
      );

      // Step 1: Get full place details from Google Places API
      const placeDetails = await getPlaceDetailsFromId(placeId, req);

      req.logger?.debug(
        `Place details for placeID - ${placeId}: ${placeDetails.name}`
      );

      // Step 2: Check if the place exists in the cache
      let placeCache = await getPlaceCacheById(placeId);

      if (!placeCache) {
        req.logger?.debug(
          "Could not find place in place Cache.. creating new entry"
        );

        // Use coordinates from place details
        const coordinates = placeDetails.location
          ? {
              lat: placeDetails.location.latitude,
              lng: placeDetails.location.longitude,
            }
          : null;

        if (!coordinates) {
          req.logger?.error(
            `No coordinates found for place: ${placeDetails.name}`
          );
          throw new Error(
            `Could not get coordinates for place: ${placeDetails.name}`
          );
        }

        req.logger?.debug(
          `Coordinates for placeID - ${placeId}: ${coordinates}`
        );

        // Step 3: Store in cache
        placeCache = await createPlaceCache({
          placeId: placeDetails.id,
          name: placeDetails.name,
          rating: placeDetails.rating ?? null,
          userRatingCount: placeDetails.userRatingCount ?? null,
          websiteUri: placeDetails.websiteUri ?? null,
          googleMapsLink: placeDetails.googleMapsUri ?? null,
          currentOpeningHours: placeDetails.currentOpeningHours,
          regularOpeningHours: placeDetails.regularOpeningHours,
          lat: coordinates.lat,
          lng: coordinates.lng,
          images: placeDetails.images ?? [],
          utcOffsetMinutes: placeDetails.utcOffsetMinutes ?? null,
        });

        req.logger?.debug(
          `Created new entry in place cache ${placeCache.id} for placeID ${placeId}`
        );
      } else {
        req.logger?.debug(`Found place id - ${placeId} in place cache`);
      }

      // Step 4: Classify the place category using AI
      const category = await classifyPlaceCategory({
        name: placeDetails.name,
        types: placeDetails.types,
        editorialSummary: placeDetails.editorialSummary,
        businessStatus: placeDetails.businessStatus,
      });

      // Step 5: Create content with manual pin title
      const manualContentTitle = `Manually Pinned: ${placeDetails.name}`;

      // Create raw data description
      const rawData = `Pinned through Google Places API - ${placeDetails.name}`;

      // Create user notes
      const userNotes = `Manually added ${placeDetails.name}`;

      // Create pin description using editorial summary
      const pinDescription =
        placeDetails.editorialSummary?.text ||
        `Manually added ${placeDetails.name}`;

      const newContent = await createContent(
        "", // No URL for manual pins
        rawData,
        currentUser.id,
        tripId,
        userNotes,
        placeDetails.images && placeDetails.images.length > 0
          ? placeDetails.images[0]
          : ""
      );

      // Step 6: Update content with title and pin count
      await updateContent(newContent.id, [], manualContentTitle, 1);

      // Step 7: Create Pin linked to PlaceCache
      const coordinates = { lat: placeCache.lat, lng: placeCache.lng };

      const pin = await createPin({
        name: placeDetails.name,
        category: category,
        contentId: newContent.id,
        placeCacheId: placeCache.id,
        coordinates: coordinates,
        description: pinDescription,
      });

      req.logger?.info(
        `Created manual pin - ${pin.id} with content_id - ${newContent.id} and place_id - ${placeCache.id}`
      );

      const updatedContent = await updateContentStatus(
        newContent.id,
        "COMPLETED"
      );

      // Step 7: Respond with the created data
      res.status(200).json({
        success: true,
        content: {
          id: newContent.id,
          title: manualContentTitle,
          description: rawData,
          userNotes: userNotes,
          thumbnail:
            placeDetails.images && placeDetails.images.length > 0
              ? placeDetails.images[0]
              : "",
        },
        pin: {
          id: pin.id,
          name: placeDetails.name,
          category: category,
          coordinates: coordinates,
          description: pinDescription,
        },
        placeDetails: {
          id: placeCache.id,
          name: placeCache.name,
          rating: placeCache.rating,
          userRatingCount: placeCache.userRatingCount,
          websiteUri: placeCache.websiteUri,
          currentOpeningHours: placeCache.currentOpeningHours,
          regularOpeningHours: placeCache.regularOpeningHours,
          images: placeCache.images,
          utcOffsetMinutes: placeCache.utcOffsetMinutes,
          address: placeDetails.formattedAddress,
        },
      });
    } catch (error) {
      console.error("Error creating manual pin:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: "Invalid input data",
          details: error.errors,
        });
      } else {
        res.status(500).json({
          success: false,
          error: "Internal server error.",
        });
      }
    }
  }
);

// API endpoint to monitor session usage (for debugging/admin purposes)
app.get(
  "/api/places-sessions",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const stats = getSessionStats();
      const userSession = getSessionForUser(currentUser.id);

      res.status(200).json({
        success: true,
        globalStats: stats,
        userSession: userSession,
      });
    } catch (error) {
      console.error("Error getting session stats:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error.",
      });
    }
  }
);

// API endpoint to clear all sessions (admin only)
app.delete(
  "/api/places-sessions",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      // TODO: Add admin check here if needed
      const result = clearAllSessions();

      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      console.error("Error clearing sessions:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error.",
      });
    }
  }
);

const UpdateContentSchema = z.object({
  content_id: z.string().uuid(),
  content: z.string().min(1, "Content/transcript is required"),
});

const UpdateContentStatusSchema = z.object({
  contentId: z.string().uuid("Invalid content ID format"),
  status: z.enum(["PROCESSING", "COMPLETED", "FAILED"], {
    errorMap: () => ({
      message: "Status must be one of: PROCESSING, COMPLETED, FAILED",
    }),
  }),
});

// Add this endpoint to your main Express app file
app.post(
  "/api/update-content",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const validatedData = UpdateContentSchema.parse(req.body);
      const { content_id, content } = validatedData;

      console.log(
        `Received request to update content: content_id=${content_id}`
      );
      req.logger?.info(
        `Update content request received: content_id=${content_id}`
      );

      // Verify the content exists and user has access
      const existingContent = await prisma.content.findUnique({
        where: { id: content_id },
        include: {
          user: {
            select: {
              id: true,
              name: true,
            },
          },
          trip: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (!existingContent) {
        res.status(404).json({ error: "Content not found" });
        return;
      }

      const trip_id = existingContent.tripId;
      const description = content;

      console.log("Processing transcript content:", description);

      // Extract structured data using AI (same as extract-lat-long)
      const analysis = await extractLocationAndClassify(description, req);

      // Get title from the first analysis object, if present
      const title =
        analysis && analysis.length > 0 && analysis[0].title
          ? analysis[0].title
          : existingContent.title || "";

      // Update the Content entry with transcript and structured data
      const pinsCount = analysis.filter(
        (a) => a.classification !== "Not Pinned"
      ).length;

      // Only create pins for new analysis data (don't delete existing pins)
      // Process each analysis object in the list (same logic as extract-lat-long)
      const responses = await Promise.allSettled(
        analysis.map(async (analysis) => {
          try {
            if (analysis.classification === "Not Pinned") {
              return null;
            }
            const full_loc =
              (analysis.name ?? "") + " " + (analysis.location ?? "");

            // Step 1: Get Place ID
            const placeId = await getPlaceId(full_loc, req);
            let coordinates;
            let placeCacheId;

            // Step 2: Check if the place exists in the cache
            let placeCache = await getPlaceCacheById(placeId);

            if (!placeCache) {
              req.logger?.debug(
                "Could not find place in place Cache.. getting full place details"
              );
              // Step 3: If not in cache, fetch full place details (includes coordinates)
              const placeDetails = await getFullPlaceDetails(full_loc, req);

              req.logger?.debug(
                `Place details for placeID - ${placeId} is - ${placeDetails}`
              );

              // Use coordinates from place details instead of separate API call
              coordinates = placeDetails.location
                ? {
                    lat: placeDetails.location.latitude,
                    lng: placeDetails.location.longitude,
                  }
                : null;

              if (!coordinates) {
                req.logger?.error(
                  `No coordinates found for place: ${full_loc}`
                );
                return null;
              }

              req.logger?.debug(
                `Coordinates for placeID - ${placeId} is - ${coordinates}`
              );

              // Step 4: Store in cache
              placeCache = await createPlaceCache({
                placeId: placeDetails.id,
                name: placeDetails.name,
                rating: placeDetails.rating ?? null,
                userRatingCount: placeDetails.userRatingCount ?? null,
                websiteUri: placeDetails.websiteUri ?? null,
                googleMapsLink: placeDetails.googleMapsUri ?? null,
                currentOpeningHours: placeDetails.currentOpeningHours,
                regularOpeningHours: placeDetails.regularOpeningHours,
                lat: coordinates.lat,
                lng: coordinates.lng,
                images: placeDetails.images ?? [],
                utcOffsetMinutes: placeDetails.utcOffsetMinutes ?? null,
              });

              req.logger?.debug(
                `Created new entry in place cache ${placeCache.id} for placeID ${placeId}`
              );
            } else {
              req.logger?.debug(`Found place id - ${placeId} in place cache`);
              coordinates = {
                lat: placeCache.lat,
                lng: placeCache.lng,
              };
            }

            placeCacheId = placeCache.id;
            // Check if a pin with this placeCacheId already exists for this content
            const existingPin = await prisma.pin.findFirst({
              where: {
                contentId: content_id,
                placeCacheId: placeCacheId,
              },
            });

            if (existingPin) {
              req.logger?.info(
                `Pin already exists for placeCacheId ${placeCacheId} and contentId ${content_id}. Skipping creation.`
              );
              return null;
            }

            // Step 5: Create Pin linked to PlaceCache
            const pin = await createPin({
              name: analysis.name ?? "",
              category: analysis.classification ?? "",
              contentId: content_id,
              placeCacheId: placeCacheId,
              coordinates: coordinates,
              description: analysis.additional_info ?? "",
            });
            req.logger?.info(
              `Created Pin - ${pin.id} with content_id - ${content_id} and place_id - ${placeCacheId}`
            );

            return {
              ...analysis,
              placeCacheId,
              coordinates,
              placeDetails: {
                name: placeCache.name,
                rating: placeCache.rating,
                userRatingCount: placeCache.userRatingCount,
                websiteUri: placeCache.websiteUri,
                currentOpeningHours: placeCache.currentOpeningHours,
                regularOpeningHours: placeCache.regularOpeningHours,
                images: placeCache.images,
                utcOffsetMinutes: placeCache.utcOffsetMinutes,
              },
            };
          } catch (error) {
            req.logger?.error(
              `Failed to process analysis item "${analysis.name}" at location "${analysis.location}":`,
              error
            );
            console.error(
              `❌ Google Places API failed for "${analysis.name}" at "${analysis.location}":`,
              error
            );
            // Return null so this item is skipped but processing continues for other items
            return null;
          }
        })
      );

      // const content_status = await prisma.content.findUnique({
      //   where: { id: content_id },
      //   select: { tripId: true, title: true, pins_count: true }
      // });

      // if (content_status) {
      //   emitContentProcessingStatus(content_status.tripId, content_id, 'completed', {
      //     pinsCount: content_status.pins_count,
      //     title: content_status.title
      //   });
      // }

      // Extract successful results from Promise.allSettled
      const successfulResponses = responses
        .filter(
          (result) => result.status === "fulfilled" && result.value !== null
        )
        .map((result) => (result as PromiseFulfilledResult<any>).value);

      const actualPinsCount = successfulResponses.length;
      console.log("Pin Count : ", actualPinsCount);

      // Log any failed operations for debugging
      const failedResponses = responses.filter(
        (result) => result.status === "rejected"
      );
      if (failedResponses.length > 0) {
        req.logger?.warn(
          `${failedResponses.length} pin creation operations failed, but continuing with successful ones`
        );
      }

      // Append new content data instead of replacing
      await appendToContent(
        content_id,
        description,
        analysis,
        actualPinsCount,
        title
      );

      req.logger?.debug(
        `Updated content entry with transcript data ${content_id}`
      );

      // Get total pins count from database for notification
      const totalPinsCount = await prisma.pin.count({
        where: { contentId: content_id },
      });

      // Send notifications to trip members about pins added (using total count from database)
      if (totalPinsCount > 0) {
        try {
          await sendPinAddedNotifications(
            trip_id,
            existingContent.user.id,
            totalPinsCount,
            existingContent.trip.name,
            existingContent.user.name,
            title || existingContent.title || undefined,
            existingContent.id
          );
        } catch (notificationError) {
          console.error(
            "Error sending pin added notifications:",
            notificationError
          );
          // Don't fail the request if notifications fail
        }
      }

      // Generate embeddings for the updated content in the background
      try {
        console.log(
          `🔄 Starting embedding generation for updated content ${content_id}...`
        );
        generateContentEmbeddings(content_id)
          .then(() => {
            console.log(
              ` Embeddings generated successfully for content ${content_id}`
            );
          })
          .catch((embeddingError) => {
            console.error(
              `❌ Failed to generate embeddings for content ${content_id}:`,
              embeddingError
            );
            // Don't throw here - embedding generation failure shouldn't affect the main flow
          });
      } catch (embeddingError) {
        console.error(
          `❌ Error starting embedding generation for content ${content_id}:`,
          embeddingError
        );
        // Continue with the main flow even if embedding generation fails
      }

      // Emit completion status via WebSocket
      emitContentProcessingStatus(trip_id, content_id, "completed", {
        pinsCount: actualPinsCount,
        title: title,
      });

      // Respond with the processed data
      res.status(200).json({
        message: "Content updated successfully with transcript analysis",
        contentId: content_id,
        analysis: successfulResponses,
        successfulPins: actualPinsCount,
        failedPins: failedResponses.length,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Invalid input data", details: error.errors });
      } else {
        console.error(`Error processing update content request:`, error);
        res.status(500).json({ error: "Internal server error." });
      }
    }
  }
);

// API to update content status
app.patch(
  "/api/update-content-status",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const validatedData = UpdateContentStatusSchema.parse(req.body);
      const { contentId, status } = validatedData;

      console.log(
        `Received request to update content status: contentId=${contentId}, status=${status}`
      );
      req.logger?.info(
        `Update content status request: contentId=${contentId}, status=${status}`
      );

      const existingContent = await prisma.content.findUnique({
        where: { id: contentId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
            },
          },
          trip: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (!existingContent) {
        res.status(404).json({ error: "Content not found" });
        return;
      }

      // Update the content status
      const updatedContent = await updateContentStatus(contentId, status);

      console.log(
        ` Content status updated successfully: ${contentId} -> ${status}`
      );
      req.logger?.info(`Content status updated: ${contentId} -> ${status}`);

      // Optionally emit WebSocket event for status change
      if (status === "COMPLETED") {
        emitContentProcessingStatus(
          existingContent.tripId,
          contentId,
          "completed",
          {
            pinsCount: existingContent.pins_count,
            title: existingContent.title,
          }
        );
      } else if (status === "FAILED") {
        emitContentProcessingStatus(
          existingContent.tripId,
          contentId,
          "failed",
          {
            pinsCount: 0,
            title: existingContent.title,
          }
        );
      }

      res.status(200).json({
        success: true,
        message: "Content status updated successfully",
        contentId: contentId,
        newStatus: status,
        updatedAt: updatedContent.updatedAt,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Invalid input data", details: error.errors });
      } else {
        console.error(`Error updating content status:`, error);
        req.logger?.error(`Error updating content status:`, error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
);

// Register FCM token for push notifications
app.post(
  "/api/notifications/register-token",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const { fcmToken, deviceInfo } = RegisterFcmTokenSchema.parse(req.body);

      await registerFcmToken(currentUser.id, fcmToken, deviceInfo);

      req.logger?.info(`FCM token registered for user ${currentUser.id}`);

      res.status(200).json({
        success: true,
        message: "FCM token registered successfully",
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: "Invalid input data",
          details: error.errors,
        });
      } else {
        console.error("Error registering FCM token:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
);

// Unregister FCM token
app.delete(
  "/api/notifications/unregister-token",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const { fcmToken } = UnregisterFcmTokenSchema.parse(req.body);

      await unregisterFcmToken(fcmToken);

      req.logger?.info(`FCM token unregistered for user ${currentUser.id}`);

      res.status(200).json({
        success: true,
        message: "FCM token unregistered successfully",
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: "Invalid input data",
          details: error.errors,
        });
      } else {
        console.error("Error unregistering FCM token:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
);

// Send notification to specific users
app.post(
  "/api/notifications/send",
  // authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      // const currentUser = req.currentUser;
      // if (currentUser == null) {
      //   res.status(401).json({ error: "User not authenticated" });
      //   return;
      // }

      const { userIds, title, body, data, imageUrl } =
        SendNotificationSchema.parse(req.body);

      const result = await sendNotificationToUsers(userIds, {
        title,
        body,
        data,
        imageUrl,
      });

      // req.logger?.info(
      //   `Notification sent by user ${currentUser.id} to ${userIds.length} users - Success: ${result.successCount}, Failed: ${result.failureCount}`
      // );

      res.status(200).json({
        success: true,
        message: "Notification sent successfully",
        result: {
          successCount: result.successCount,
          failureCount: result.failureCount,
          totalTargeted: userIds.length,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: "Invalid input data",
          details: error.errors,
        });
      } else {
        console.error("Error sending notification:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
);

// Send broadcast notification to all users (admin only - you may want to add admin check)
app.post(
  "/api/notifications/broadcast",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      // TODO: Add admin role check here if needed
      // const userRole = await getUserRole(currentUser.id);
      // if (userRole !== "admin") {
      //   res.status(403).json({ error: "Admin access required" });
      //   return;
      // }

      const { title, body, data, imageUrl } = BroadcastNotificationSchema.parse(
        req.body
      );

      const result = await sendBroadcastNotification({
        title,
        body,
        data,
        imageUrl,
      });

      req.logger?.info(
        `Broadcast notification sent by user ${currentUser.id} - Success: ${result.successCount}, Failed: ${result.failureCount}`
      );

      res.status(200).json({
        success: true,
        message: "Broadcast notification sent successfully",
        result: {
          successCount: result.successCount,
          failureCount: result.failureCount,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: "Invalid input data",
          details: error.errors,
        });
      } else {
        console.error("Error sending broadcast notification:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
);

// Get user's notification statistics
app.get(
  "/api/notifications/stats",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const stats = await getUserNotificationStats(currentUser.id);

      res.status(200).json({
        success: true,
        stats,
      });
    } catch (error) {
      console.error("Error fetching notification stats:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// API to get processing content status for user's trips
app.get(
  "/api/processing-content",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      // Get all trips the user is part of
      const userTrips = await prisma.tripUser.findMany({
        where: { userId: currentUser.id },
        select: { tripId: true },
      });

      const tripIds = userTrips.map((trip) => trip.tripId);

      if (tripIds.length === 0) {
        res.status(200).json({ processingContentIds: [] });
        return;
      }

      // Get all content in PROCESSING status for user's trips
      const processingContent = await prisma.content.findMany({
        where: {
          tripId: { in: tripIds },
          status: "PROCESSING",
        },
        select: { id: true },
      });

      const processingContentIds = processingContent.map(
        (content) => content.id
      );

      req.logger?.info(
        `Retrieved ${processingContentIds.length} processing content items for user ${currentUser.id}`
      );

      res.status(200).json({
        success: true,
        processingContentIds,
        count: processingContentIds.length,
      });
    } catch (error) {
      console.error("Error fetching processing content:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// API to get the last processing content with full details for notification
app.get(
  "/api/last-processing-content",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      // Get all trips the user is part of
      const userTrips = await prisma.tripUser.findMany({
        where: { userId: currentUser.id },
        select: { tripId: true },
      });

      const tripIds = userTrips.map((trip) => trip.tripId);

      if (tripIds.length === 0) {
        res.status(200).json({
          success: true,
          lastProcessingContent: null,
        });
        return;
      }

      // Calculate the time 10 minutes ago
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

      // Get the most recent content in PROCESSING status for user's trips
      // that was created within the last 10 minutes
      const lastProcessingContent = await prisma.content.findFirst({
        where: {
          tripId: { in: tripIds },
          status: "PROCESSING",
          createdAt: {
            gte: tenMinutesAgo,
          },
        },
        include: {
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
            },
          },
        },
        orderBy: {
          createdAt: "desc", // Get the most recent one
        },
      });

      if (!lastProcessingContent) {
        res.status(200).json({
          success: true,
          lastProcessingContent: null,
        });
        return;
      }

      req.logger?.info(
        `Retrieved last processing content ${lastProcessingContent.id} for user ${currentUser.id}`
      );

      res.status(200).json({
        success: true,
        lastProcessingContent: {
          id: lastProcessingContent.id,
          title: lastProcessingContent.title,
          tripId: lastProcessingContent.tripId,
          tripName: lastProcessingContent.trip.name,
          userId: lastProcessingContent.userId,
          userName: lastProcessingContent.user.name,
          createdAt: lastProcessingContent.createdAt,
          url: lastProcessingContent.url,
        },
      });
    } catch (error) {
      console.error("Error fetching last processing content:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// API to update user's bucket list countries
app.put(
  "/api/update-bucket-list",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const { countries } = UpdateBucketListSchema.parse(req.body);

      // Update user's bucket list countries
      const updatedUser = await prisma.user.update({
        where: { id: currentUser.id },
        data: { bucketListCountries: countries },
        select: {
          id: true,
          name: true,
          email: true,
          bucketListCountries: true,
          updatedAt: true,
        },
      });

      req.logger?.info(
        `Bucket list countries updated for user ${
          currentUser.id
        }: ${countries.join(", ")}`
      );

      res.status(200).json({
        success: true,
        message: "Bucket list countries updated successfully",
        user: updatedUser,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: "Invalid input data",
          details: error.errors,
        });
      } else {
        console.error("Error updating bucket list countries:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
);

// API to edit trip name
app.put(
  "/api/edit-trip-name",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const { tripId, newName } = EditTripNameSchema.parse(req.body);

      req.logger?.info(
        `Edit trip name request: tripId=${tripId}, newName=${newName}, user=${currentUser.id}`
      );

      // Verify the trip exists
      const trip = await getTripById(tripId);
      if (!trip) {
        res.status(404).json({ error: "Trip not found" });
        return;
      }

      // Verify user has access to this trip and is a member
      const userRole = await getUserRoleInTrip(currentUser.id, tripId);
      if (!userRole) {
        res.status(403).json({
          error: "You don't have access to this trip",
        });
        return;
      }

      // Update the trip name
      const updatedTrip = await prisma.trip.update({
        where: { id: tripId },
        data: { name: newName.trim() },
        select: {
          id: true,
          name: true,
          description: true,
          updatedAt: true,
        },
      });

      req.logger?.info(
        `Trip name updated successfully: tripId=${tripId}, newName=${newName}, user=${currentUser.id}`
      );

      res.status(200).json({
        success: true,
        message: "Trip name updated successfully",
        trip: updatedTrip,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: "Invalid input data",
          details: error.errors,
        });
      } else {
        console.error("Error updating trip name:", error);
        req.logger?.error(`Failed to update trip name: ${error}`);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
);

// API to update user's last opened time
app.post(
  "/api/update-last-opened",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      // Update the user's last opened time
      const updatedUser = await prisma.user.update({
        where: { id: currentUser.id },
        data: { lastOpened: new Date() },
        select: {
          id: true,
          name: true,
          email: true,
          lastOpened: true,
          updatedAt: true,
        },
      });

      req.logger?.info(`Last opened time updated for user ${currentUser.id}`);

      res.status(200).json({
        success: true,
        message: "Last opened time updated successfully",
        user: updatedUser,
      });
    } catch (error) {
      console.error("Error updating last opened time:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// API to get content summary since user's last login
app.get(
  "/api/content-summary-since-last-login",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (currentUser == null) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      // Use the user's last opened time from the database
      const lastLoginDate = currentUser.lastOpened || null;

      req.logger?.info(
        `Content summary request for user ${currentUser.id}, lastOpened: ${lastLoginDate}`
      );

      // Get content summary since last login
      const contentSummaryResult = await getContentSummarySinceLastLogin(
        currentUser.id,
        lastLoginDate
      );

      const { completedSummary, processingItems } = contentSummaryResult;

      req.logger?.info(
        `Content summary result: ${completedSummary.length} completed trip summaries, ${processingItems.length} processing items found`
      );

      res.status(200).json({
        success: true,
        lastLoginDate: lastLoginDate,
        summary: completedSummary,
        processingItems: processingItems,
        hasNewContent:
          completedSummary.length > 0 || processingItems.length > 0,
      });
    } catch (error) {
      console.error("Error fetching content summary:", error);
      req.logger?.error(`Failed to fetch content summary: ${error}`);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Debug endpoint to check FCM tokens for a user
app.get(
  "/api/debug/fcm-tokens/:userId",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { userId } = req.params;

      console.log(`🔍 Debug: Checking FCM tokens for user ${userId}`);

      const tokens = await prisma.fcmToken.findMany({
        where: { userId },
        select: {
          id: true,
          fcmToken: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          deviceInfo: true,
        },
      });

      console.log(`📱 Found ${tokens.length} FCM tokens for user ${userId}:`);
      tokens.forEach((token, idx) => {
        console.log(
          `  ${idx + 1}. Active: ${
            token.isActive
          }, Created: ${token.createdAt.toISOString()}`
        );
        console.log(
          `     Token: ${token.fcmToken.substring(
            0,
            20
          )}...${token.fcmToken.substring(token.fcmToken.length - 10)}`
        );
        console.log(`     Device: ${JSON.stringify(token.deviceInfo)}`);
      });

      res.status(200).json({
        success: true,
        userId,
        totalTokens: tokens.length,
        activeTokens: tokens.filter((t) => t.isActive).length,
        tokens: tokens.map((token) => ({
          id: token.id,
          isActive: token.isActive,
          createdAt: token.createdAt,
          updatedAt: token.updatedAt,
          deviceInfo: token.deviceInfo,
          tokenPreview: `${token.fcmToken.substring(
            0,
            20
          )}...${token.fcmToken.substring(token.fcmToken.length - 10)}`,
        })),
      });
    } catch (error) {
      console.error("Error fetching debug FCM tokens:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// DEBUG: API to create and store country demo data from Instagram URL
app.post(
  "/api/debug/content-analysis",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { contentId, country } = req.body;

      // Validate required fields
      if (!contentId || !country) {
        res.status(400).json({
          error: "Missing required fields: contentId, country",
        });
        return;
      }

      // Get existing content with all related data
      const content = await prisma.content.findUnique({
        where: { id: contentId },
        include: {
          pins: {
            include: {
              placeCache: true,
            },
          },
          trip: true,
          user: true,
        },
      });

      if (!content) {
        res
          .status(404)
          .json({ error: "Content not found with provided contentId" });
        return;
      }

      // Validate that content URL is Instagram URL
      if (!content.url.includes("instagram.com")) {
        res.status(400).json({
          error: "Content URL must be an Instagram URL",
        });
        return;
      }

      // Check for duplicate URLs in existing demo data for different countries
      const existingDemoData = await prisma.countryDemoData.findFirst({
        where: {
          url: content.url,
          countryName: { not: country },
        },
      });

      if (existingDemoData) {
        res.status(409).json({
          error: `URL already exists for country: ${existingDemoData.countryName}. Cannot create demo data for ${country} with the same URL.`,
          existingCountry: existingDemoData.countryName,
          existingCountryId: existingDemoData.countryId,
        });
        return;
      }

      // Format the demo data with all needed information
      const demoData = {
        contentId: content.id,
        url: content.url,
        title: content.title,
        rawData: content.rawData,
        structuredData: content.structuredData,
        pins_count: content.pins_count,
        pins: content.pins.map((pin: any) => ({
          id: pin.id,
          title: pin.title,
          description: pin.description,
          classification: pin.classification,
          place: pin.placeCache
            ? {
                id: pin.placeCache.id,
                name: pin.placeCache.name,
                address: pin.placeCache.address,
                lat: pin.placeCache.lat,
                lng: pin.placeCache.lng,
                place_id: pin.placeCache.placeId,
                rating: pin.placeCache.rating,
                user_ratings_total: pin.placeCache.userRatingCount,
                price_level: pin.placeCache.priceLevel,
                photos: pin.placeCache.images,
                types: pin.placeCache.types,
                opening_hours: pin.placeCache.regularOpeningHours,
                website: pin.placeCache.websiteUri,
                phone_number: pin.placeCache.phoneNumber,
                business_status: pin.placeCache.businessStatus,
              }
            : null,
        })),
        trip: {
          id: content.trip.id,
          name: content.trip.name,
          metadata: content.trip.metadata,
        },
        user: {
          id: content.user.id,
          name: content.user.name,
        },
      };

      // Load countries data from JSON file
      const countriesPath = path.join(
        __dirname,
        "..",
        "data",
        "countries.json"
      );
      const countriesData = JSON.parse(fs.readFileSync(countriesPath, "utf8"));

      // Find the requested country in the JSON data
      const countryInfo = countriesData.countries.find(
        (c: any) => c.name === country
      );

      if (!countryInfo) {
        const availableCountries = countriesData.countries
          .map((c: any) => c.name)
          .slice(0, 10);
        res.status(400).json({
          error: `Unsupported country: ${country}. Country not found in countries.json.`,
          availableCountries: availableCountries,
          totalCountries: countriesData.countries.length,
          message: `Please use one of the ${countriesData.countries.length} supported countries.`,
        });
        return;
      }

      // Store or update country demo data
      const countryDemoData = await prisma.countryDemoData.upsert({
        where: { countryName: country },
        update: {
          countryId: countryInfo.code,
          url: content.url,
          demoData: {
            ...demoData,
            countryInfo: {
              name: countryInfo.name,
              code: countryInfo.code,
              capital: countryInfo.capital,
              language: countryInfo.language,
              hello: countryInfo.hello,
              flag: countryInfo.flag,
              continent: countryInfo.continent,
              lat: countryInfo.lat || 0,
              lng: countryInfo.lng || 0,
            },
          },
          lat: countryInfo.lat || 0,
          lng: countryInfo.lng || 0,
          flag: countryInfo.flag,
        },
        create: {
          countryName: country,
          countryId: countryInfo.code,
          url: content.url,
          demoData: {
            ...demoData,
            countryInfo: {
              name: countryInfo.name,
              code: countryInfo.code,
              capital: countryInfo.capital,
              language: countryInfo.language,
              hello: countryInfo.hello,
              flag: countryInfo.flag,
              continent: countryInfo.continent,
              lat: countryInfo.lat || 0,
              lng: countryInfo.lng || 0,
            },
          },
          lat: countryInfo.lat || 0,
          lng: countryInfo.lng || 0,
          flag: countryInfo.flag,
        },
      });

      res.status(200).json({
        success: true,
        message: "Country demo data stored successfully",
        data: {
          countryUuid: countryDemoData.id,
          id: countryDemoData.id,
          countryName: countryDemoData.countryName,
          countryId: countryDemoData.countryId,
          countryCode: countryInfo.code,
          flag: countryInfo.flag,
          hello: countryInfo.hello,
          capital: countryInfo.capital,
          language: countryInfo.language,
          url: countryDemoData.url,
        },
      });
    } catch (error) {
      console.error("Error storing country demo data:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// API to get all available countries with demo data
app.get(
  "/api/countries/demo",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const countries = await prisma.countryDemoData.findMany({
        select: {
          id: true, // Include the UUID
          countryName: true,
          countryId: true,
          url: true,
          createdAt: true,
          demoData: true,
          lat: true,
          lng: true,
          flag: true,
        },
        orderBy: {
          countryName: "asc",
        },
      });

      // Format for country selection page
      const formattedCountries = countries.map((country: any) => {
        // Extract countryInfo from demoData if available
        const countryInfo = country.demoData?.countryInfo || {};

        return {
          name: country.countryName,
          id: country.id, // Use the UUID as id
          countryId: country.countryId, // Also include countryId separately
          url: country.url,
          hasDemo: true,
          demoData: country.demoData,
          lat: country.lat,
          lng: country.lng,
          flag: country.flag,
          // Add greeting/hello from countryInfo
          greeting: countryInfo.hello || "Hello",
          language: countryInfo.language || "English",
          capital: countryInfo.capital || "",
          continent: countryInfo.continent || "",
        };
      });

      res.status(200).json({
        success: true,
        countries: formattedCountries,
      });
    } catch (error) {
      console.error("Error fetching countries with demo data:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// API to create demo trip for a country
app.post(
  "/api/demo-trip/create",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = req.currentUser;
      if (!currentUser) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const { countryId, countryName, countryUuid } = req.body;

      if (!countryUuid && (!countryId || !countryName)) {
        res.status(400).json({
          error:
            "Missing required fields: either countryUuid OR (countryId and countryName)",
        });
        return;
      }

      // Check if demo data exists for this country
      let countryDemoData;
      if (countryUuid) {
        // Use UUID to find the country data
        countryDemoData = await prisma.countryDemoData.findUnique({
          where: { id: countryUuid },
        });
      } else {
        // Fallback to countryId lookup
        countryDemoData = await prisma.countryDemoData.findFirst({
          where: { countryId: countryId },
        });
      }

      if (!countryDemoData) {
        res.status(404).json({
          error: `No demo data available for country: ${
            countryUuid ? "with UUID " + countryUuid : countryName
          }`,
        });
        return;
      }

      const { startDate, endDate } = getDummyStartAndEndDate();
      const currentYear = new Date().getFullYear();
      const firstName = currentUser.name
        ? currentUser.name.split(" ")[0]
        : "My";

      // Use data from the found country record
      const finalCountryName = countryDemoData.countryName;
      const finalCountryId = countryDemoData.countryId;

      // Create demo trip with country-specific metadata including UUID
      const demoTrip = await createTripAndTripUser(
        currentUser.id,
        `${firstName}'s trip to ${finalCountryName} ${currentYear}`,
        startDate,
        endDate,
        `My dream trip to ${finalCountryName}`,
        {
          type: "demo",
          countryUuid: countryDemoData.id,
          countryId: finalCountryId,
          countryName: finalCountryName,
          isDemo: true,
          tutorial_completed: false,
        }
      );

      // Update user metadata to mark demo country trip as created
      // Fetch the complete user data to preserve existing metadata
      const currentUserData = await prisma.user.findUnique({
        where: { id: currentUser.id },
        select: { metadata: true },
      });

      const updatedMetadata = mergeMetadata(currentUserData?.metadata, {
        has_demo_country_trip: true,
      });

      await prisma.user.update({
        where: { id: currentUser.id },
        data: {
          metadata: updatedMetadata,
        } as any,
      });

      res.status(201).json({
        success: true,
        message: "Demo trip created successfully",
        trip_id: demoTrip.id,
        demoTripURL: countryDemoData.url,
        countryUuid: countryDemoData.id,
        trip: {
          id: demoTrip.id,
          name: demoTrip.name,
          description: demoTrip.description,
          startDate: demoTrip.startDate,
          endDate: demoTrip.endDate,
          countryUuid: countryDemoData.id,
          countryId: finalCountryId,
          countryName: finalCountryName,
        },
      });
    } catch (error) {
      console.error("Error creating demo trip:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// API to backfill Google Maps links for existing places
app.post(
  "/api/backfill-google-maps-links",
  async (req: Request, res: Response): Promise<void> => {
    try {
      // First, get the total count of places without Google Maps links
      const totalPlacesToUpdate = await prisma.placeCache.count({
        where: {
          googleMapsLink: null,
        },
      });

      console.log(
        `🔗 Starting Google Maps links backfill for ALL ${totalPlacesToUpdate} places without links...`
      );

      if (totalPlacesToUpdate === 0) {
        res.status(200).json({
          success: true,
          message: "No places found that need Google Maps links",
          updated: 0,
          total: 0,
        });
        return;
      }

      // Process in chunks to avoid memory issues with large datasets
      const chunkSize = 100; // Get 100 places at a time from DB
      const batchSize = 50; // Process 50 places in parallel (optimized for 500 req/min)
      const delay = 6000; // 6 seconds delay between batches (500 req/min = 50 req per 6 seconds)

      let totalSuccessCount = 0;
      let totalErrorCount = 0;
      const allErrors: string[] = [];

      // Process all places in chunks
      for (let offset = 0; offset < totalPlacesToUpdate; offset += chunkSize) {
        console.log(
          `📊 Fetching chunk ${Math.floor(offset / chunkSize) + 1}/${Math.ceil(
            totalPlacesToUpdate / chunkSize
          )} (${Math.min(chunkSize, totalPlacesToUpdate - offset)} places)`
        );

        // Get current chunk of places that don't have Google Maps links
        const placesToUpdate = await prisma.placeCache.findMany({
          where: {
            googleMapsLink: null, // Only get places without Google Maps links
          },
          orderBy: {
            createdAt: "desc", // Latest first
          },
          take: chunkSize,
          skip: offset,
          select: {
            id: true,
            placeId: true,
            name: true,
            createdAt: true,
          },
        });

        if (placesToUpdate.length === 0) {
          console.log(`📊 No more places to process in this chunk.`);
          break; // No more places to process
        }

        console.log(
          `📊 Processing ${placesToUpdate.length} places from chunk ${
            Math.floor(offset / chunkSize) + 1
          }`
        );

        let chunkSuccessCount = 0;
        let chunkErrorCount = 0;
        const chunkErrors: string[] = [];

        // Process places in batches to avoid rate limiting
        for (let i = 0; i < placesToUpdate.length; i += batchSize) {
          const batch = placesToUpdate.slice(i, i + batchSize);

          console.log(
            `🔄 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
              placesToUpdate.length / batchSize
            )} from chunk ${Math.floor(offset / chunkSize) + 1} (${
              batch.length
            } places)`
          );

          // Process batch in parallel
          await Promise.allSettled(
            batch.map(async (place) => {
              try {
                // Get only Google Maps URI to minimize API costs
                const googleMapsUri = await getGoogleMapsUriOnly(
                  place.placeId,
                  req
                );

                if (googleMapsUri) {
                  // Fetch Google Maps image from the URI
                  console.log(
                    `🖼️ Fetching Google Maps image for ${place.name}`
                  );
                  const googleMapsImage = await fetchGoogleMapsImage(
                    googleMapsUri
                  );

                  // Prepare update data
                  const updateData: any = {
                    googleMapsLink: googleMapsUri,
                    lastCached: new Date(), // Update the cache timestamp
                  };

                  // Always update images array - either with Google Maps image or empty (no backup mode)
                  if (googleMapsImage) {
                    console.log(
                      ` Found Google Maps image for ${place.name}: ${googleMapsImage}`
                    );
                    updateData.images = [googleMapsImage]; // Replace existing images with the Google Maps image
                  } else {
                    console.log(
                      `⚠️ No image found for ${place.name} Google Maps link - clearing images array`
                    );
                    updateData.images = []; // Clear existing images since we only want Google Maps metadata images
                  }

                  // Update the place cache with the Google Maps link and image
                  await prisma.placeCache.update({
                    where: { id: place.id },
                    data: updateData,
                  });

                  console.log(
                    ` Updated ${place.name}: ${googleMapsUri}${
                      googleMapsImage ? " with image" : ""
                    }`
                  );
                  chunkSuccessCount++;
                } else {
                  console.log(`⚠️ No Google Maps URI found for ${place.name}`);
                  chunkErrorCount++;
                  chunkErrors.push(
                    `No Google Maps URI found for ${place.name} (ID: ${place.id})`
                  );
                }
              } catch (error) {
                console.error(`❌ Failed to update ${place.name}:`, error);
                chunkErrorCount++;
                const errorMessage =
                  error instanceof Error ? error.message : String(error);
                chunkErrors.push(
                  `Failed to update ${place.name}: ${errorMessage}`
                );
              }
            })
          );

          // Add delay between batches to respect rate limits
          if (i + batchSize < placesToUpdate.length) {
            console.log(`⏱️ Waiting ${delay}ms before next batch...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }

        // Update totals for this chunk
        totalSuccessCount += chunkSuccessCount;
        totalErrorCount += chunkErrorCount;
        allErrors.push(...chunkErrors);

        console.log(
          `📊 Chunk ${
            Math.floor(offset / chunkSize) + 1
          } completed: ${chunkSuccessCount} successful, ${chunkErrorCount} errors. Total so far: ${totalSuccessCount}/${totalPlacesToUpdate}`
        );

        // Add delay between chunks to be extra safe with rate limits
        if (offset + chunkSize < totalPlacesToUpdate) {
          console.log(`⏱️ Waiting ${delay}ms before next chunk...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      console.log(
        `🎉 Full backfill completed: ${totalSuccessCount} successful, ${totalErrorCount} errors out of ${totalPlacesToUpdate} total places`
      );

      res.status(200).json({
        success: true,
        message: "Google Maps links backfill completed for all places",
        total: totalPlacesToUpdate,
        updated: totalSuccessCount,
        errors: totalErrorCount,
        errorDetails: allErrors.slice(0, 20), // Return first 20 errors for debugging
      });
    } catch (error) {
      console.error("Error during Google Maps links backfill:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      res.status(500).json({
        error: "Internal server error during backfill",
        message: errorMessage,
      });
    }
  }
);

// Start the server
const httpServer = createServer(app);

// Initialize WebSocket
const io = initializeWebSocket(httpServer);

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔌 WebSocket server initialized`);
});
