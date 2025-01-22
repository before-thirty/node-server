// Importing required modules
import express, { Request, Response, NextFunction } from 'express';
import morgan from 'morgan';
import { v4 as uuidv4 } from 'uuid';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import cors from 'cors';
import { logger, requestLogger } from "./middleware/logger"
import {extractLocationAndClassify} from "./helpers/openai"
import parser from "html-metadata-parser";
import { getPlaceId,getCoordinatesFromPlaceId } from './helpers/googlemaps';

// Load environment variables from .env file
dotenv.config();

// MongoDB Atlas connection
const connectDB = async (): Promise<void> => {
    try {
        await mongoose.connect("mongodb+srv://beforethirty911:xAyoioz0DboGbfAo@beforethirty.5kpzb.mongodb.net/?retryWrites=true&w=majority&appName=BeforeThirty");
        console.log('MongoDB connected');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
};

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
connectDB();

const getMetadata = async (url: string) => {
    try {
      const result = await parser(url);
      return result;
    } catch (err) {
      console.error("Error parsing metadata:", err);
      return null;
    }
  };

// Define primary route
app.post('/api/extract-lat-long', async (req: Request, res: Response): Promise<void> => {
    // req.logger?(req.requestId)
    // req.log
    req.logger?.info(req.requestId)
    try {
        const url = req.query.url as string;
        if (!url) {
        res.status(400).json({ error: "URL is required" });
        }
        const metadata = await getMetadata(url);

        const description = metadata?.meta.description;

        if (!description) {
        res
            .status(404)
            .json({ error: "Could not fetch metadata for the given URL" });
        }
        
        const analysis = await extractLocationAndClassify(description ?? "");

        const full_loc = analysis.name ?? "" + analysis.location
        const placeId = await getPlaceId(full_loc);

        const coordinates = await getCoordinatesFromPlaceId(placeId);

        const response = { ...analysis, coordinates };

        res.status(200).json({ response });
    } catch (error) {
        console.error(`Error processing request:`, error);
        res.status(500).json({ error: 'Internal server error.' });
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
