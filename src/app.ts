// Importing required modules
import express, { Request, Response } from 'express';
import morgan from 'morgan';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import cors from 'cors';
import { requestLogger } from "./middleware/logger"
import {extractLocationAndClassify,extractLocationAndClassifyGemini} from "./helpers/openai"
import parser from "html-metadata-parser";
import { getPlaceId,getFullPlaceDetails,getCoordinatesFromPlaceId } from './helpers/googlemaps';
import { z } from 'zod';
import { createPlaceCache,getContentPinsPlaceNested,getTripContentData,getTripsByUserId,createContent, createTrip, createUserTrip, updateContent, getPlaceCacheById, createPin, addUserToTrip, getTripById, getUsersFromTrip, addMessage, getMessageById, getMessagesByTime, getUsername} from './helpers/dbHelpers'; // Import helper functions

// Load environment variables from .env file
dotenv.config();

// Initialize the Express app
const app = express();
app.use(requestLogger);
// Middleware setup
app.use(cors()); // Enable Cross-Origin Resource Sharing
app.use(bodyParser.json()); // Parse JSON bodies
app.use(morgan("dev")); // HTTP request logger for development

// Define directory structure for routes
// const routes = require('./routes');
// app.use('/api', routes);

// Connect to MongoDB Atlas


const getMetadata = async (url: string) => {
  try {
    const result = await parser(url);
    return result;
  } catch (err) {
    console.error("Error parsing metadata:", err);
    return null;
  }
};

const TripSchema = z
  .object({
    id: z.string().uuid().optional(), // UUID
    name: z.string().min(1, "Trip name is required"),
    startDate: z.coerce.date().refine((data) => data >= new Date(), {
      message: "Start date must be in the future",
    }),
    endDate: z.coerce.date().refine((data) => data >= new Date(), {
      message: "End date must be in the future",
    }),
    description: z.string().optional(),
  })
  .refine((data) => data.endDate > data.startDate, {
    message: "End date cannot be earlier than start date.",
    path: ["endDate"],
  });

// Define the Zod schema for validation
const ContentSchema = z.object({
  url: z.string().url(), // URL must be a valid URL
  content: z.string(), // Content should be a string
  user_id: z.string().uuid(), // user_id should be a UUID string
  trip_id: z.string().uuid(), // trip_id should be a UUID string
});

const UserTripSchema = z.object({
  role: z.string(),
  user_id: z.string().uuid(),
  trip_id: z.string().uuid(),
});
// Define primary route
app.post(
  "/api/extract-lat-long",
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate the request body using Zod
      const validatedData = ContentSchema.parse(req.body);
      const { url, content, user_id, trip_id } = validatedData;

      req.logger?.info(
        `Request received: URL=${url}, user_id=${user_id}, trip_id=${trip_id}`
      );

      let description = content ?? "";

        // If content is empty, fetch metadata from the URL
        if (!content || content.trim() === "") {
            req.logger?.debug(`The request doesnt contains content fetching metadata from URL`)
            const metadata = await getMetadata(url);
            description = metadata?.meta.description ?? "";
        }

        if (!description) {
            req.logger?.error(`Failed to fetch metadata for URL - ${url}`)
            res.status(404).json({ error: "Could not fetch metadata for the given URL" });
            return;
        }

        // Create a DB entry for content
        const newContent = await createContent(url, description, user_id, trip_id);
        req.logger?.debug(`Create new content entry ${newContent.id}`)

        // Extract structured data using AI
        const analysis = await extractLocationAndClassify(description ?? "",req);

        // Update the Content entry with structured data
        await updateContent(newContent.id, analysis);
        req.logger?.debug(`Updated content entry with structured data ${newContent.id}`)

        // Process each analysis object in the list
        const responses = await Promise.all(
            analysis.map(async (analysis) => {
                const full_loc = (analysis.name ?? "") + " " + (analysis.location ?? "");
                
                // Step 1: Get Place ID
                const placeId = await getPlaceId(full_loc,req);

          let coordinates;
          let placeCacheId;

          // Step 2: Check if the place exists in the cache
          let placeCache = await getPlaceCacheById(placeId);

                if (!placeCache) {
                    req.logger?.debug("Could not find place in place Cache.. getting full place details")
                    // Step 3: If not in cache, fetch full place details
                    const placeDetails = await getFullPlaceDetails(full_loc,req);

                    req.logger?.debug(`Place details for placeID - ${placeId} is - ${placeDetails}`)                    

                    coordinates = await getCoordinatesFromPlaceId(placeId,req);

                    req.logger?.debug(`Coordinates for placeID - ${placeId} is - ${coordinates}`)  

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
                        images: placeDetails.images ?? []
                    });

                    req.logger?.debug(`Created new entry in place cache ${placeCache.id} for placeID ${placeId}`)
                } else {
                    req.logger?.debug(`Found place id - ${placeId} in place cache`)
                    coordinates = { lat: placeCache.lat, lng: placeCache.lng };
                }

          placeCacheId = placeCache.id;

                // Step 5: Create Pin linked to PlaceCache
                const pin = await createPin({
                    name: analysis.name ?? "",
                    category: analysis.classification ?? "",
                    contentId: newContent.id,
                    placeCacheId: placeCacheId,
                    coordinates: coordinates
                });
                req.logger?.info(`Created Pin - ${pin.id} with content_id - ${newContent.id} and place_id - ${placeCacheId}`)

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
                        images:placeCache.images
                    }
                };
            })
        );

      // Respond with the processed data
      res.status(200).json(responses);
    } catch (error) {
      // Handle Zod validation error
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Invalid input data", details: error.errors });
      } else {
        console.error(`Error processing request:`, error);
        res.status(500).json({ error: "Internal server error." });
      }
    }
});




// Define Zod schema for the request validation
const userTripsSchema = z.object({
  user_id: z.string().min(1, "user_id is required"), // user_id must be a non-empty string
});
app.get(
  "/api/user-trips",
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate the incoming query using Zod schema
      const { user_id } = userTripsSchema.parse(req.query);

      // Call the helper function to get the trips by user ID
      const trips = await getTripsByUserId(user_id);

      if (trips.length === 0) {
        res.status(404).json({ error: "No trips found for the given user." });
        return;
      }

      // Send the trips as a list of dictionaries
      res.status(200).json(trips);
    } catch (error) {
      if (error instanceof z.ZodError) {
        // Handle Zod validation errors
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

app.post(
  "/api/create-trip",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, startDate, endDate, description } = TripSchema.parse(
        req.body
      );
      const newTrip = await createTrip(
        name,
        startDate,
        endDate,
        description ?? ""
      );
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

app.get(
  "/api/trip/:tripId/content",
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request parameters
      const { tripId } = tripIdSchema.parse(req.params);

      // Fetch content, pins, and place cache separately
      const { contentList, pinsList, placeCacheList } =
        await getTripContentData(tripId);
      const trip = await getTripById(tripId);

      const nested = await getContentPinsPlaceNested(tripId);

      // Return as three separate arrays
      res.status(200).json({
        contents: contentList,
        pins: pinsList,
        placeCaches: placeCacheList,
        nestedData: nested,
        trip,
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
      res.status(500).json({ error: "Internal server error." });  }
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
)
    
// api for sending message
app.post(
  "/api/addMessage",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { tripId, userId, message, timestamp, type } = req.body;
      console.log(req.body)
      await addMessage(
        tripId,
        userId,
        message,
        timestamp,
        type);
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
      res.status(400).json({ error: 'tripId is required' });
      return
    }
    const queryLimit = parseInt(limit as string, 10);
    let beforeDate: Date | undefined = undefined;
    if (before) {
      const beforeMessage = await getMessageById(tripId as string, before as string);
      if (!beforeMessage) {
        res.status(400).json({ error: 'Invalid "before" message ID' });
        return
      }
      beforeDate = beforeMessage?.createdAt;
    }
    const messages = await getMessagesByTime(tripId as string, beforeDate as any, queryLimit as number)
    res.json(messages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});


app.get("/api/getUsername", async (req: Request, res: Response) => {
  const { userId } = req.query;
  console.log(userId)
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }
  try {
    const user = await getUsername(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    console.log(user)
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


// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
