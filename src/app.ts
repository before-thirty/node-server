// Importing required modules
import express, { Request, Response, NextFunction } from "express";
import morgan from "morgan";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import cors from "cors";
import { requestLogger } from "./middleware/logger";
import {
  extractLocationAndClassify,
  classifyPlaceCategory,
} from "./helpers/openai";
import parser from "html-metadata-parser";
import {
  getPlaceId,
  getFullPlaceDetails,
  searchPlaces,
  getSessionStats,
  clearAllSessions,
  getSessionForUser,
  getPlaceDetailsFromId,
} from "./helpers/googlemaps";
import { z } from "zod";
import {
  createPlaceCache,
  getContentPinsPlaceNested,
  getTripContentData,
  getTripsByUserId,
  createContent,
  createUserTrip,
  updateContent,
  getPlaceCacheById,
  createPin,
  getTripById,
  createUser,
  getUserByFirebaseId,
  createTripAndTripUser,
  addUserToTrip,
  getUsersByIds,
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
  isUserInTrip,
  verifyPlaceExists,
  verifyTripExists,
  verifyContentAccess,
  verifyPinAccess,
  getPublicTrips,
  getUserRoleInTrip,
} from "./helpers/dbHelpers"; // Import helper functions
import { PrismaClient } from "@prisma/client";
import { authenticate } from "./middleware/currentUser";
import { getDummyStartAndEndDate } from "./utils/jsUtils";
import pocRoutes from "./poc-routes";
import { generateContentEmbeddings } from "./poc-embeddings";
import cronRoutes from "./cronRoutes";
import moderationRoutes from "./moderationRoutes";

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
const getMetadata = async (url: string) => {
  try {
    const result = await parser(url);
    return result;
  } catch (err) {
    console.error("Error parsing metadata:", err);
    return null;
  }
};

const UserSchema = z.object({
  id: z.string().uuid().optional(), // UUID
  name: z.string().min(1, "User name is required"),
  email: z.string(),
  phoneNumber: z.string(),
  firebaseId: z.string(),
});

const ContentSchema = z.object({
  url: z.string(),
  content: z.string().optional(),
  trip_id: z.string(),
  user_notes: z.string().optional(),
});

const UserTripSchema = z.object({
  role: z.string(),
  user_id: z.string().uuid(),
  trip_id: z.string(),
});

app.get("/api/status", async (req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    userId: "67580046-2ff8-4e92-9eec-8263cf908616",
  });
});

// Async background processing function
const processContentAnalysisAsync = async (
  contentId: string,
  description: string,
  req: Request
): Promise<void> => {
  try {
    console.log(`Starting async processing for content ${contentId}`);
    
    // Extract structured data using AI
    const analysis = await extractLocationAndClassify(description, req);

    // Get title from the first analysis object, if present
    const title =
      analysis && analysis.length > 0 && analysis[0].title
        ? analysis[0].title
        : "";

    // Update the Content entry with structured data and title
    const pinsCount = analysis.filter(
      (a) => a.classification !== "Not Pinned"
    ).length;
    await updateContent(contentId, analysis, title, pinsCount);
    
    req.logger?.debug(`Updated content entry with structured data ${contentId}`);

    // Generate embeddings for the new content in the background
    try {
      console.log(`🔄 Starting embedding generation for new content ${contentId}...`);
      generateContentEmbeddings(contentId)
        .then(() => {
          console.log(`✅ Embeddings generated successfully for content ${contentId}`);
        })
        .catch((embeddingError) => {
          console.error(`❌ Failed to generate embeddings for content ${contentId}:`, embeddingError);
        });
    } catch (embeddingError) {
      console.error(`❌ Error starting embedding generation for content ${contentId}:`, embeddingError);
    }

    // Process each analysis object for pin creation
    await Promise.all(
      analysis.map(async (analysis) => {
        if (analysis.classification === "Not Pinned") {
          return;
        }
        
        const full_loc = (analysis.name ?? "") + " " + (analysis.location ?? "");

        // Step 1: Get Place ID
        const placeId = await getPlaceId(full_loc, req);
        let coordinates;
        let placeCacheId;

        // Step 2: Check if the place exists in the cache
        let placeCache = await getPlaceCacheById(placeId);

        if (!placeCache) {
          req.logger?.debug("Could not find place in place Cache.. getting full place details");
          
          // Step 3: If not in cache, fetch full place details (includes coordinates)
          const placeDetails = await getFullPlaceDetails(full_loc, req);

          req.logger?.debug(`Place details for placeID - ${placeId} is - ${placeDetails}`);

          // Use coordinates from place details instead of separate API call
          coordinates = placeDetails.location
            ? {
                lat: placeDetails.location.latitude,
                lng: placeDetails.location.longitude,
              }
            : null;

          if (!coordinates) {
            req.logger?.error(`No coordinates found for place: ${full_loc}`);
            throw new Error(`Could not get coordinates for place: ${full_loc}`);
          }

          req.logger?.debug(`Coordinates for placeID - ${placeId} is - ${coordinates}`);

          // Step 4: Store in cache
          placeCache = await createPlaceCache({
            placeId: placeDetails.id,
            name: placeDetails.name,
            rating: placeDetails.rating ?? null,
            userRatingCount: placeDetails.userRatingCount ?? null,
            websiteUri: placeDetails.websiteUri ?? null,
            currentOpeningHours: placeDetails.currentOpeningHours,
            regularOpeningHours: placeDetails.regularOpeningHours,
            lat: coordinates.lat,
            lng: coordinates.lng,
            images: placeDetails.images ?? [],
            utcOffsetMinutes: placeDetails.utcOffsetMinutes ?? null,
          });

          req.logger?.debug(`Created new entry in place cache ${placeCache.id} for placeID ${placeId}`);
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

        req.logger?.info(`Created Pin - ${pin.id} with content_id - ${contentId} and place_id - ${placeCacheId}`);
      })
    );

    console.log(`✅ Async processing completed for content ${contentId}`);
  } catch (error) {
    console.error(`❌ Error in async processing for content ${contentId}:`, error);
    req.logger?.error(`Async processing failed for content ${contentId}:`, error);
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

      // If content is empty, fetch metadata from the URL
      if (!content || content.trim() === "") {
        req.logger?.debug(
          `The request doesnt contains content fetching metadata from URL`
        );
        const metadata = await getMetadata(url);
        description = [metadata?.meta.title, metadata?.meta.description]
          .filter(Boolean)
          .join(" ");
        contentThumbnail = metadata?.og.image ?? "";
      }

      console.log("Desc is ", description);

      if (!description) {
        req.logger?.error(`Failed to fetch metadata for URL - ${url}`);
        res
          .status(404)
          .json({ error: "Could not fetch metadata for the given URL" });
        return;
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

      console.log(`✅ Content created with ID: ${newContent.id}. Starting async processing...`);
      req.logger?.info(`Content created: ${newContent.id}. Processing will continue asynchronously.`);

      // Start async processing in the background (don't await)
      processContentAnalysisAsync(newContent.id, description, req);

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
          message: "AI analysis and pin creation are being processed in the background"
        }
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

app.get(
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

// API to delete a trip and all related data (except place cache)
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
          error: "You don't have access to this trip" 
        });
        return;
      }

      // Only owners can delete trips
      if (userRole !== "owner") {
        res.status(403).json({ 
          error: "Only trip owners can delete trips" 
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
        where: { id: tripId }
      });

      req.logger?.info(
        `Trip ${tripId} successfully deleted by user ${currentUser.id}`
      );

      res.status(200).json({
        success: true,
        message: "Trip and all related data deleted successfully",
        deletedTripId: tripId
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: "Invalid input data",
          details: error.errors
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
    if (!user) {
      user = await prisma.user.create({
        data: {
          firebaseId,
          name,
          email,
          phoneNumber: phoneNumber || "", // Apple doesn't always provide phone number
        },
      });
    }

    const trips = await getTripsByUserId(user.id);
    const currentTripId = trips[0]?.id;
    res.status(200).json({ ...user, currentTripId });
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

    if (!user) {
      user = await prisma.user.create({
        data: {
          firebaseId,
          name,
          email,
          phoneNumber,
        },
      });
    }

    const trips = await getTripsByUserId(user.id);
    const currentTripId = trips[0]?.id;

    res.status(200).json({ ...user, currentTripId });
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

      const lastLoginDate = userLastLogin
        ? new Date(userLastLogin * 1000)
        : null;

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

      // Get user IDs from content, filtering out blocked users
      const userIds = [
        ...new Set(
          contentList.map((content) => content.userId).filter(Boolean)
        ),
      ];

      const users = userIds.length > 0 ? await getUsersByIds(userIds, currentUser.id) : [];

      res.status(200).json({
        contents: contentList,
        pins: pinsList,
        placeCaches: placeCacheList,
        nestedData: nested,
        trip,
        users: users.map(user => ({
          id: user.id,
          name: user.name,
          // Don't expose sensitive info like email and phone number
        })),
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
              `✅ Embeddings regenerated successfully for content ${contentId}`
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
        const userRole = await getUserRoleInTrip(currentUser.id, content.tripId);
        if (userRole === "owner") {
          canDelete = true;
        }
      }

      if (!canDelete) {
        res.status(403).json({ 
          error: "You don't have permission to delete this content" 
        });
        return;
      }

      // Delete the content and its pins (Prisma cascade will handle pins)
      // This will delete:
      // - The Content record
      // - All associated Pin records (via onDelete: Cascade)
      // PlaceCache remains untouched as intended
      await prisma.content.delete({
        where: { id: contentId }
      });

      req.logger?.info(
        `Content ${contentId} and its pins successfully deleted by user ${currentUser.id}`
      );

      res.status(200).json({
        success: true,
        message: "Content and associated pins deleted successfully",
        deletedContentId: contentId
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: "Invalid input data",
          details: error.errors
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
  content: z.string().min(1, "Content/transcript is required")
});

// Add this endpoint to your main Express app file
app.post(
  "/api/update-content",
  async (req: Request, res: Response): Promise<void> => {
    try {
      
      const validatedData = UpdateContentSchema.parse(req.body);
      const { content_id, content } = validatedData;

      console.log(`Received request to update content: content_id=${content_id}`);
      req.logger?.info(
        `Update content request received: content_id=${content_id}`
      );

      // Verify the content exists and user has access
      const existingContent = await prisma.content.findUnique({
        where: { id: content_id }
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

      // Update content with new transcript data and analysis
      await updateContent(content_id, analysis, title, pinsCount);
      
      // Also update the rawData field with the transcript
      await prisma.content.update({
        where: { id: content_id },
        data: {
          rawData: description,
        }
      });

      req.logger?.debug(
        `Updated content entry with transcript data ${content_id}`
      );

      // Generate embeddings for the updated content in the background
      try {
        console.log(`🔄 Starting embedding generation for updated content ${content_id}...`);
        generateContentEmbeddings(content_id)
          .then(() => {
            console.log(`✅ Embeddings generated successfully for content ${content_id}`);
          })
          .catch((embeddingError) => {
            console.error(`❌ Failed to generate embeddings for content ${content_id}:`, embeddingError);
            // Don't throw here - embedding generation failure shouldn't affect the main flow
          });
      } catch (embeddingError) {
        console.error(`❌ Error starting embedding generation for content ${content_id}:`, embeddingError);
        // Continue with the main flow even if embedding generation fails
      }

      // Delete existing pins for this content before creating new ones
      await prisma.pin.deleteMany({
        where: { contentId: content_id }
      });

      // Process each analysis object in the list (same logic as extract-lat-long)
      const responses = await Promise.all(
        analysis.map(async (analysis) => {
          if (analysis.classification === "Not Pinned") {
            return analysis;
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
            coordinates = placeDetails.location ? {
              lat: placeDetails.location.latitude,
              lng: placeDetails.location.longitude
            } : null;

            if (!coordinates) {
              req.logger?.error(`No coordinates found for place: ${full_loc}`);
              throw new Error(`Could not get coordinates for place: ${full_loc}`);
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
        })
      );

      // Respond with the processed data
      res.status(200).json({
        message: "Content updated successfully with transcript analysis",
        contentId: content_id,
        analysis: responses
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

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
