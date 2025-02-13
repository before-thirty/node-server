// Importing required modules
import express, { Request, Response, NextFunction } from 'express';
import morgan from 'morgan';
import { v4 as uuidv4 } from 'uuid';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import cors from 'cors';
import { logger, requestLogger } from "./middleware/logger"
import {extractLocationAndClassify,extractLocationAndClassifyGemini} from "./helpers/openai"
import parser from "html-metadata-parser";
import { getPlaceId,getFullPlaceDetails,getCoordinatesFromPlaceId } from './helpers/googlemaps';
import { z } from 'zod';
import { createPlaceCache,getContentPinsPlaceNested,getTripContentData,getTripsByUserId,createContent, createTrip, createUserTrip, updateContent, getPlaceCacheById, createPin } from './helpers/dbHelpers'; // Import helper functions



// Load environment variables from .env file
dotenv.config();

// Initialize the Express app
const app = express();
app.use(requestLogger)
// Middleware setup
app.use(cors()); // Enable Cross-Origin Resource Sharing
app.use(bodyParser.json()); // Parse JSON bodies
app.use(morgan('dev')); // HTTP request logger for development


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

const TripSchema = z.object({
    id: z.string().uuid().optional(), // UUID
    name: z.string().min(1, "Trip name is required"),
    startDate:  z.coerce.date().refine((data) => data >= new Date(), {message: 'Start date must be in the future'}),
    endDate: z.coerce.date().refine((data) => data >= new Date(), {message: 'End date must be in the future'}),
    description: z.string().optional()
  }).refine((data) => data.endDate > data.startDate, {
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
    trip_id: z.string().uuid()
    }); 
// Define primary route
app.post('/api/extract-lat-long', async (req: Request, res: Response): Promise<void> => {
    try {
        // Validate the request body using Zod
        const validatedData = ContentSchema.parse(req.body);
        const { url, content, user_id, trip_id } = validatedData;

        req.logger?.info(`Request received: URL=${url}, user_id=${user_id}, trip_id=${trip_id}`);

        let description = content ?? "";

        // If content is empty, fetch metadata from the URL
        if (!content || content.trim() === "") {
            const metadata = await getMetadata(url);
            description = metadata?.meta.description ?? "";
        }

        if (!description) {
            res.status(404).json({ error: "Could not fetch metadata for the given URL" });
            return;
        }

        // Create a DB entry for content
        const newContent = await createContent(url, description, user_id, trip_id);

        // Extract structured data using AI
        const analysis = await extractLocationAndClassify(description ?? "");

        // Update the Content entry with structured data
        await updateContent(newContent.id, analysis);

        // Process each analysis object in the list
        const responses = await Promise.all(
            analysis.map(async (analysis) => {
                const full_loc = (analysis.name ?? "") + " " + (analysis.location ?? "");
                
                // Step 1: Get Place ID
                const placeId = await getPlaceId(full_loc);

                let coordinates;
                let placeCacheId;

                // Step 2: Check if the place exists in the cache
                let placeCache = await getPlaceCacheById(placeId);

                if (!placeCache) {
                    // Step 3: If not in cache, fetch full place details
                    const placeDetails = await getFullPlaceDetails(full_loc);

                    coordinates = await getCoordinatesFromPlaceId(placeId);

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
                        lng: coordinates.lng
                    });
                } else {
                    coordinates = { lat: placeCache.lat, lng: placeCache.lng };
                }

                placeCacheId = placeCache.id;

                // Step 5: Create Pin linked to PlaceCache
                await createPin({
                    name: analysis.name ?? "",
                    category: analysis.classification ?? "",
                    contentId: newContent.id,
                    placeCacheId: placeCacheId,
                    coordinates: coordinates
                });

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
                    }
                };
            })
        );

        // Respond with the processed data
        res.status(200).json(responses);

    } catch (error) {
        // Handle Zod validation error
        if (error instanceof z.ZodError) {
            res.status(400).json({ error: 'Invalid input data', details: error.errors });
        } else {
            console.error(`Error processing request:`, error);
            res.status(500).json({ error: 'Internal server error.' });
        }
    }
});



// Define internal route stubs
// Route to extract place details from ChatGPT API
const fetchPlaceDetails = async (caption: string): Promise<{ placeName: string; city: string; country: string }> => {
    console.log(`Extracting place details from caption: "${caption}"`);
    // Placeholder: Call ChatGPT API and return JSON
    return { placeName: 'Example Place', city: 'Example City', country: 'Example Country' };
};

// Route to fetch lat-long using Google Maps API
const fetchLatLong = async (placeData: { placeName: string; city: string; country: string }): Promise<{ lat: number; long: number }> => {
    console.log(`Fetching lat-long for: ${JSON.stringify(placeData)}`);
    // Placeholder: Call Google Maps Geocoding API
    return { lat: 12.9716, long: 77.5946 }; // Example lat-long for Bangalore, India
};




// Define Zod schema for the request validation
const userTripsSchema = z.object({
    user_id: z.string().min(1, 'user_id is required'), // user_id must be a non-empty string
});
app.get('/api/user-trips', async (req: Request, res: Response): Promise<void> => {
    try {
        // Validate the incoming query using Zod schema
        const { user_id } = userTripsSchema.parse(req.query);

        // Call the helper function to get the trips by user ID
        const trips = await getTripsByUserId(user_id);

        if (trips.length === 0) {
            res.status(404).json({ error: 'No trips found for the given user.' });
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
            res.status(500).json({ error: 'Internal server error.' });
        }
    }
});

app.get("/api/health", async (req: Request, res: Response) => {
    res.status(200).json({
        status: "ok",
        timestamp: new Date().toISOString(),
    });
});




app.post('/api/create-trip', async (req: Request, res: Response): Promise<void> => {
    try {
        const {name, startDate, endDate, description} = TripSchema.parse(req.body);
        const newTrip = await createTrip(name, startDate, endDate, description ?? "");
        res.status(201).json(newTrip);
    } catch (error) {
        if (error instanceof z.ZodError) {
            res.status(400).json({ error: error.errors });
        } else {
            console.error(`Error creating trip:`, error);
            res.status(500).json({ error: 'Internal server error.' });
        }
    }
})

app.post('/api/create-user-trip', async (req: Request, res: Response): Promise<void> => {
    try {
        const {role, user_id, trip_id} = UserTripSchema.parse(req.body);
        await createUserTrip(role, user_id, trip_id);
        res.status(201).json({ message: 'User-trip association created successfully.' });
    } catch (error) {
        if (error instanceof z.ZodError) {
            res.status(400).json({ error: error.errors });
        } else {
            console.error(`Error creating user-trip association:`, error);
            res.status(500).json({ error: 'Internal server error.' });
        }
    }
})



// Zod schema for validating tripId
const tripIdSchema = z.object({
    tripId: z.string().uuid(),
});

app.get('/api/trip/:tripId/content', async (req: Request, res: Response): Promise<void> => {
    try {
        // Validate request parameters
        const { tripId } = tripIdSchema.parse(req.params);

        // Fetch content, pins, and place cache separately
        const { contentList, pinsList, placeCacheList } = await getTripContentData(tripId);


        const nested = await getContentPinsPlaceNested(tripId)

        

        // Return as three separate arrays
        res.status(200).json({
            contents: contentList,
            pins: pinsList,
            placeCaches: placeCacheList,
            nestedData: nested
        });
    } catch (error) {
        console.error("Error fetching trip data:", error);
        res.status(500).json({ error: 'Internal server error.' });
    }
});



// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Directory structure:
// project-root/
// ├── routes/
// │   ├── index.ts (future expansion for modular routes)
// ├── server.ts (main entry point)
// ├── .env (environment variables)
// ├── package.json
// ├── node_modules/

/* Best practices:
1. Use environment variables for sensitive data (e.g., API keys).
2. Add input validation for all endpoints.
3. Modularize route files for better maintainability.
4. Implement error handling for async calls.
5. Use logging libraries like Winston for better logging capabilities in production.
*/
