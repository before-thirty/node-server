"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Importing required modules
const express_1 = __importDefault(require("express"));
const morgan_1 = __importDefault(require("morgan"));
const body_parser_1 = __importDefault(require("body-parser"));
const dotenv_1 = __importDefault(require("dotenv"));
const cors_1 = __importDefault(require("cors"));
const logger_1 = require("./middleware/logger");
const openai_1 = require("./helpers/openai");
const html_metadata_parser_1 = __importDefault(require("html-metadata-parser"));
const googlemaps_1 = require("./helpers/googlemaps");
const zod_1 = require("zod");
const dbHelpers_1 = require("./helpers/dbHelpers"); // Import helper functions
// Load environment variables from .env file
dotenv_1.default.config();
// Initialize the Express app
const app = (0, express_1.default)();
app.use(logger_1.requestLogger);
// Middleware setup
app.use((0, cors_1.default)()); // Enable Cross-Origin Resource Sharing
app.use(body_parser_1.default.json()); // Parse JSON bodies
app.use((0, morgan_1.default)("dev")); // HTTP request logger for development
// Define directory structure for routes
// const routes = require('./routes');
// app.use('/api', routes);
// Connect to MongoDB Atlas
const getMetadata = (url) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield (0, html_metadata_parser_1.default)(url);
        return result;
    }
    catch (err) {
        console.error("Error parsing metadata:", err);
        return null;
    }
});
const TripSchema = zod_1.z
    .object({
    id: zod_1.z.string().uuid().optional(), // UUID
    name: zod_1.z.string().min(1, "Trip name is required"),
    startDate: zod_1.z.coerce.date().refine((data) => data >= new Date(), {
        message: "Start date must be in the future",
    }),
    endDate: zod_1.z.coerce.date().refine((data) => data >= new Date(), {
        message: "End date must be in the future",
    }),
    description: zod_1.z.string().optional(),
})
    .refine((data) => data.endDate > data.startDate, {
    message: "End date cannot be earlier than start date.",
    path: ["endDate"],
});
// Define the Zod schema for validation
const ContentSchema = zod_1.z.object({
    url: zod_1.z.string().url(), // URL must be a valid URL
    content: zod_1.z.string(), // Content should be a string
    user_id: zod_1.z.string().uuid(), // user_id should be a UUID string
    trip_id: zod_1.z.string().uuid(), // trip_id should be a UUID string
});
const UserTripSchema = zod_1.z.object({
    role: zod_1.z.string(),
    user_id: zod_1.z.string().uuid(),
    trip_id: zod_1.z.string().uuid(),
});
// Define primary route
app.post("/api/extract-lat-long", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    try {
        // Validate the request body using Zod
        const validatedData = ContentSchema.parse(req.body);
        const { url, content, user_id, trip_id } = validatedData;
        (_a = req.logger) === null || _a === void 0 ? void 0 : _a.info(`Request received: URL=${url}, user_id=${user_id}, trip_id=${trip_id}`);
        let description = content !== null && content !== void 0 ? content : "";
        // If content is empty, fetch metadata from the URL
        if (!content || content.trim() === "") {
            (_b = req.logger) === null || _b === void 0 ? void 0 : _b.debug(`The request doesnt contains content fetching metadata from URL`);
            const metadata = yield getMetadata(url);
            description = (_c = metadata === null || metadata === void 0 ? void 0 : metadata.meta.description) !== null && _c !== void 0 ? _c : "";
        }
        if (!description) {
            (_d = req.logger) === null || _d === void 0 ? void 0 : _d.error(`Failed to fetch metadata for URL - ${url}`);
            res.status(404).json({ error: "Could not fetch metadata for the given URL" });
            return;
        }
        // Create a DB entry for content
        const newContent = yield (0, dbHelpers_1.createContent)(url, description, user_id, trip_id);
        (_e = req.logger) === null || _e === void 0 ? void 0 : _e.debug(`Create new content entry ${newContent.id}`);
        // Extract structured data using AI
        const analysis = yield (0, openai_1.extractLocationAndClassify)(description !== null && description !== void 0 ? description : "", req);
        // Update the Content entry with structured data
        yield (0, dbHelpers_1.updateContent)(newContent.id, analysis);
        (_f = req.logger) === null || _f === void 0 ? void 0 : _f.debug(`Updated content entry with structured data ${newContent.id}`);
        // Process each analysis object in the list
        const responses = yield Promise.all(analysis.map((analysis) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
            const full_loc = ((_a = analysis.name) !== null && _a !== void 0 ? _a : "") + " " + ((_b = analysis.location) !== null && _b !== void 0 ? _b : "");
            // Step 1: Get Place ID
            const placeId = yield (0, googlemaps_1.getPlaceId)(full_loc, req);
            let coordinates;
            let placeCacheId;
            // Step 2: Check if the place exists in the cache
            let placeCache = yield (0, dbHelpers_1.getPlaceCacheById)(placeId);
            if (!placeCache) {
                (_c = req.logger) === null || _c === void 0 ? void 0 : _c.debug("Could not find place in place Cache.. getting full place details");
                // Step 3: If not in cache, fetch full place details
                const placeDetails = yield (0, googlemaps_1.getFullPlaceDetails)(full_loc, req);
                (_d = req.logger) === null || _d === void 0 ? void 0 : _d.debug(`Place details for placeID - ${placeId} is - ${placeDetails}`);
                coordinates = yield (0, googlemaps_1.getCoordinatesFromPlaceId)(placeId, req);
                (_e = req.logger) === null || _e === void 0 ? void 0 : _e.debug(`Coordinates for placeID - ${placeId} is - ${coordinates}`);
                // Step 4: Store in cache
                placeCache = yield (0, dbHelpers_1.createPlaceCache)({
                    placeId: placeDetails.id,
                    name: placeDetails.name,
                    rating: (_f = placeDetails.rating) !== null && _f !== void 0 ? _f : null,
                    userRatingCount: (_g = placeDetails.userRatingCount) !== null && _g !== void 0 ? _g : null,
                    websiteUri: (_h = placeDetails.websiteUri) !== null && _h !== void 0 ? _h : null,
                    currentOpeningHours: placeDetails.currentOpeningHours,
                    regularOpeningHours: placeDetails.regularOpeningHours,
                    lat: coordinates.lat,
                    lng: coordinates.lng,
                    images: (_j = placeDetails.images) !== null && _j !== void 0 ? _j : []
                });
                (_k = req.logger) === null || _k === void 0 ? void 0 : _k.debug(`Created new entry in place cache ${placeCache.id} for placeID ${placeId}`);
            }
            else {
                (_l = req.logger) === null || _l === void 0 ? void 0 : _l.debug(`Found place id - ${placeId} in place cache`);
                coordinates = { lat: placeCache.lat, lng: placeCache.lng };
            }
            placeCacheId = placeCache.id;
            // Step 5: Create Pin linked to PlaceCache
            const pin = yield (0, dbHelpers_1.createPin)({
                name: (_m = analysis.name) !== null && _m !== void 0 ? _m : "",
                category: (_o = analysis.classification) !== null && _o !== void 0 ? _o : "",
                contentId: newContent.id,
                placeCacheId: placeCacheId,
                coordinates: coordinates
            });
            (_p = req.logger) === null || _p === void 0 ? void 0 : _p.info(`Created Pin - ${pin.id} with content_id - ${newContent.id} and place_id - ${placeCacheId}`);
            return Object.assign(Object.assign({}, analysis), { placeCacheId,
                coordinates, placeDetails: {
                    name: placeCache.name,
                    rating: placeCache.rating,
                    userRatingCount: placeCache.userRatingCount,
                    websiteUri: placeCache.websiteUri,
                    currentOpeningHours: placeCache.currentOpeningHours,
                    regularOpeningHours: placeCache.regularOpeningHours,
                    images: placeCache.images
                } });
        })));
        // Respond with the processed data
        res.status(200).json(responses);
    }
    catch (error) {
        // Handle Zod validation error
        if (error instanceof zod_1.z.ZodError) {
            res
                .status(400)
                .json({ error: "Invalid input data", details: error.errors });
        }
        else {
            console.error(`Error processing request:`, error);
            res.status(500).json({ error: "Internal server error." });
        }
    }
}));
// Define Zod schema for the request validation
const userTripsSchema = zod_1.z.object({
    user_id: zod_1.z.string().min(1, "user_id is required"), // user_id must be a non-empty string
});
app.get("/api/user-trips", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Validate the incoming query using Zod schema
        const { user_id } = userTripsSchema.parse(req.query);
        // Call the helper function to get the trips by user ID
        const trips = yield (0, dbHelpers_1.getTripsByUserId)(user_id);
        if (trips.length === 0) {
            res.status(404).json({ error: "No trips found for the given user." });
            return;
        }
        // Send the trips as a list of dictionaries
        res.status(200).json(trips);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            // Handle Zod validation errors
            res.status(400).json({ error: error.errors });
        }
        else {
            console.error(`Error fetching trips:`, error);
            res.status(500).json({ error: "Internal server error." });
        }
    }
}));
app.get("/api/health", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    res.status(200).json({
        status: "ok",
        timestamp: new Date().toISOString(),
    });
}));
app.post("/api/create-trip", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, startDate, endDate, description } = TripSchema.parse(req.body);
        const newTrip = yield (0, dbHelpers_1.createTrip)(name, startDate, endDate, description !== null && description !== void 0 ? description : "");
        res.status(201).json(newTrip);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            res.status(400).json({ error: error.errors });
        }
        else {
            console.error(`Error creating trip:`, error);
            res.status(500).json({ error: "Internal server error." });
        }
    }
}));
app.post("/api/create-user-trip", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { role, user_id, trip_id } = UserTripSchema.parse(req.body);
        yield (0, dbHelpers_1.createUserTrip)(role, user_id, trip_id);
        res
            .status(201)
            .json({ message: "User-trip association created successfully." });
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            res.status(400).json({ error: error.errors });
        }
        else {
            console.error(`Error creating user-trip association:`, error);
            res.status(500).json({ error: "Internal server error." });
        }
    }
}));
// Zod schema for validating tripId
const tripIdSchema = zod_1.z.object({
    tripId: zod_1.z.string().uuid(),
});
app.get("/api/trip/:tripId/content", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Validate request parameters
        const { tripId } = tripIdSchema.parse(req.params);
        // Fetch content, pins, and place cache separately
        const { contentList, pinsList, placeCacheList } = yield (0, dbHelpers_1.getTripContentData)(tripId);
        const trip = yield (0, dbHelpers_1.getTripById)(tripId);
        const nested = yield (0, dbHelpers_1.getContentPinsPlaceNested)(tripId);
        // Return as three separate arrays
        res.status(200).json({
            contents: contentList,
            pins: pinsList,
            placeCaches: placeCacheList,
            nestedData: nested,
            trip,
        });
    }
    catch (error) {
        console.error("Error fetching trip data:", error);
        res.status(500).json({ error: "Internal server error." });
    }
}));
app.post("/api/add-user-to-trip", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { user_id, trip_id } = req.body;
        console.log(user_id, trip_id);
        yield (0, dbHelpers_1.addUserToTrip)(trip_id, user_id);
        res.status(201).json({ message: "User added to trip successfully." });
    }
    catch (error) {
        console.error("Error adding user to trip:", error);
        res.status(500).json({ error: "Internal server error." });
    }
}));
app.get("/api/getUsersFromTrip", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { tripId } = req.query;
        const users = yield (0, dbHelpers_1.getUsersFromTrip)(tripId);
        res.status(200).json(users);
    }
    catch (error) {
        console.error("Error fetching users from trip:", error);
        res.status(500).json({ error: "Internal server error." });
    }
}));
// api for sending message
app.post("/api/addMessage", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { tripId, userId, message, timestamp } = req.body;
        yield (0, dbHelpers_1.addMessage)(tripId, userId, message, timestamp);
        res.status(200).json({ message: "Message received successfully." });
    }
    catch (error) {
        console.error("Error sending message:", error);
        res.status(500).json({ error: "Internal server error." });
    }
}));
app.get("/api/getMessagesByTrip", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { tripId, before, limit = 20 } = req.query;
        if (!tripId) {
            res.status(400).json({ error: 'tripId is required' });
            return;
        }
        const queryLimit = parseInt(limit, 10);
        let beforeDate = undefined;
        if (before) {
            const beforeMessage = yield (0, dbHelpers_1.getMessageById)(tripId, before);
            if (!beforeMessage) {
                res.status(400).json({ error: 'Invalid "before" message ID' });
            }
            beforeDate = beforeMessage === null || beforeMessage === void 0 ? void 0 : beforeMessage.createdAt;
        }
        const messages = yield (0, dbHelpers_1.getMessagesByTime)(tripId, beforeDate, queryLimit);
        res.json(messages);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
}));
// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
