// Importing required modules
import express, { Request, Response, NextFunction } from "express";
import morgan from "morgan";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import cors from "cors";
import { requestLogger } from "./middleware/logger";
import { extractLocationAndClassify } from "./helpers/openai";
import parser from "html-metadata-parser";
import {
  getPlaceId,
  getFullPlaceDetails,
  getCoordinatesFromPlaceId,
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
  getUsersFromTrip, addMessage, getMessageById, getMessagesByTime, getUsername,getShareTokenDetails,createShareToken,isUserInTrip,generateUniqueToken,getTripMemberCount
} from "./helpers/dbHelpers"; // Import helper functions
import { PrismaClient } from "@prisma/client";
import { authenticate, dummyAuthenticate } from "./middleware/currentUser";
import { getDummyStartAndEndDate } from "./utils/jsUtils";
import crypto from "crypto";


dotenv.config();

const app = express();

app.use(requestLogger);
app.use(cors());
app.use(bodyParser.json());
app.use(morgan("dev"));

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
  url: z.string().url(),
  content: z.string().optional(),
  user_id: z.string().uuid(),
  trip_id: z.string().uuid(),
  user_notes: z.string().optional(),
});

const UserTripSchema = z.object({
  role: z.string(),
  user_id: z.string().uuid(),
  trip_id: z.string().uuid(),
});

app.get("/api/status", async (req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    userId: "67580046-2ff8-4e92-9eec-8263cf908616",
  });
});

app.post(
  "/api/extract-lat-long",
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate the request body using Zod
      const validatedData = ContentSchema.parse(req.body);
      const { url, content, user_id, trip_id, user_notes } = validatedData;

      req.logger?.info(
        `Request received: URL=${url}, user_id=${user_id}, trip_id=${trip_id}`
      );

      let description = content ?? "";

      // If content is empty, fetch metadata from the URL
      if (!content || content.trim() === "") {
        req.logger?.debug(
          `The request doesnt contains content fetching metadata from URL`
        );
        const metadata = await getMetadata(url);
        description = metadata?.meta.description ?? "";
      }

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
        user_notes
      );

        // Extract structured data using AI
        console.log("Calling with desc ",description)
        const analysis = await extractLocationAndClassify(description ?? "",req);

      // Update the Content entry with structured data
      await updateContent(newContent.id, analysis);
      req.logger?.debug(
        `Updated content entry with structured data ${newContent.id}`
      );

      // Process each analysis object in the list
      const responses = await Promise.all(
        analysis.map(async (analysis) => {
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
            // Step 3: If not in cache, fetch full place details
            const placeDetails = await getFullPlaceDetails(full_loc, req);

            req.logger?.debug(
              `Place details for placeID - ${placeId} is - ${placeDetails}`
            );

            coordinates = await getCoordinatesFromPlaceId(placeId, req);

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
            contentId: newContent.id,
            placeCacheId: placeCacheId,
            coordinates: coordinates,
            description: analysis.additional_info ?? "",
          });
          req.logger?.info(
            `Created Pin - ${pin.id} with content_id - ${newContent.id} and place_id - ${placeCacheId}`
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
            },
          };
        })
      );

      // Respond with the processed data
      res.status(200).json(responses);
    } catch (error) {
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
  dummyAuthenticate,
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

app.post(
  "/api/create-trip",
  dummyAuthenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, description } = req.body;
      const user = req.currentUser;
      if (user == null) {
        throw new Error("User not authenticated");
      }
      const { startDate, endDate } = getDummyStartAndEndDate();
      const newTrip = await createTripAndTripUser(
        user.id,
        name,
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
  tripId: z.string().uuid(),
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
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request parameters
      const { tripId } = tripIdSchema.parse(req.params);

      // Validate query parameters
      const { userLastLogin } = tripContentQuerySchema.parse(req.query);

      const lastLoginDate = userLastLogin
        ? new Date(userLastLogin * 1000)
        : null;

      // Fetch content, pins, and place cache separately
      const { contentList, pinsList, placeCacheList } =
        await getTripContentData(tripId, lastLoginDate);
      const trip = await getTripById(tripId);
      const nested = await getContentPinsPlaceNested(tripId);

      const userIds = [
        ...new Set(
          contentList.map((content) => content.userId).filter(Boolean)
        ),
      ];

      const users = userIds.length > 0 ? await getUsersByIds(userIds) : [];

      res.status(200).json({
        contents: contentList,
        pins: pinsList,
        placeCaches: placeCacheList,
        nestedData: nested,
        trip,
        users, // TODO: DONT EXPOSE USERS NUMBER AND EMAIL HERE - NEEDS FRONTEND CHANGE TO SO DO LATER
      });
    } catch (error) {
      console.error("Error fetching trip data:", error);
      res.status(500).json({ error: "Internal server error." });
    }
  }
);

app.post(
  "/api/add-user-to-trip",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user_id, trip_id } = req.body;
      console.log(user_id, trip_id);
      await addUserToTrip(trip_id, user_id);
      res.status(201).json({ message: "User added to trip successfully." });
    } catch (error) {
      console.error("Error adding user to trip:", error);
      res.status(500).json({ error: "Internal server error." });
    }
  }
);

app.get(
  "/api/getUsersFromTrip",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { tripId } = req.query;
      const users = await getUsersFromTrip(tripId as string);
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
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { tripId, userId, message, timestamp, type } = req.body;
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
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { tripId, before, limit = 20 } = req.query;
      if (!tripId) {
        res.status(400).json({ error: "tripId is required" });
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
        queryLimit as number
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
          error: "Only trip members can generate share links" 
        });
        return;
      }

      // Generate unique token
      const uniqueToken = generateUniqueToken();
      
      // Store token in database
      await createShareToken(uniqueToken, tripId, currentUser.id);
      
      // Create the deep link URL
      // This URL format should match your mobile app's deep link configuration
      const deepLink = `before-thirty://join-trip/${uniqueToken}`;
      
      res.status(200).json({ 
        success: true,
        shareLink: deepLink
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
          endDate: trip.endDate
        }
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
          error: "User not authenticated" 
        });
        return;
      }
      
      // Get trip information from token
      const shareToken = await getShareTokenDetails(token);
      
      if (!shareToken) {
        res.status(404).json({ 
          success: false,
          error: "Invalid share link" 
        });
        return;
      }
      
      // Check if token has expired
      if (shareToken.expiresAt < new Date()) {
        res.status(410).json({ 
          success: false,
          error: "Share link has expired" 
        });
        return;
      }
      
      // Get trip details
      const trip = await getTripById(shareToken.tripId);
      
      if (!trip) {
        res.status(404).json({ 
          success: false,
          error: "Trip not found" 
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
          trip: trip
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
        trip: trip
      });
      
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ 
          success: false,
          error: "Invalid input data", 
          details: error.errors 
        });
      } else {
        console.error("Error joining trip:", error);
        res.status(500).json({ 
          success: false,
          error: "Internal server error." 
        });
      }
    }
  }
);
// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
