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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMessagesByTime = exports.getMessageById = exports.addMessage = exports.getUsersFromTrip = exports.addUserToTrip = exports.getContentPinsPlaceNested = exports.getTripContentData = exports.getTripById = exports.createUserTrip = exports.createTrip = exports.getTripsByUserId = exports.createPin = exports.createPlaceCache = exports.getPlaceCacheById = exports.updateContent = exports.createContent = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
// Create a new Content entry
const createContent = (url, description, userId, tripId) => __awaiter(void 0, void 0, void 0, function* () {
    return yield prisma.content.create({
        data: {
            url: url,
            rawData: description, // Store raw description data
            structuredData: "", // Initially empty, will update later
            userId: userId,
            tripId: tripId,
        },
    });
});
exports.createContent = createContent;
// Update an existing Content entry with structured data
const updateContent = (contentId, structuredData) => __awaiter(void 0, void 0, void 0, function* () {
    return yield prisma.content.update({
        where: { id: contentId },
        data: {
            structuredData: typeof structuredData === "string"
                ? structuredData
                : JSON.stringify(structuredData),
        },
    });
});
exports.updateContent = updateContent;
// Function to get the PlaceCache by placeId
const getPlaceCacheById = (placeId) => __awaiter(void 0, void 0, void 0, function* () {
    return yield prisma.placeCache.findUnique({
        where: { placeId: placeId },
    });
});
exports.getPlaceCacheById = getPlaceCacheById;
// Function to create a new PlaceCache entry with full details
const createPlaceCache = (placeDetails) => __awaiter(void 0, void 0, void 0, function* () {
    return yield prisma.placeCache.create({
        data: {
            placeId: placeDetails.placeId,
            name: placeDetails.name,
            rating: placeDetails.rating,
            userRatingCount: placeDetails.userRatingCount,
            websiteUri: placeDetails.websiteUri,
            currentOpeningHours: placeDetails.currentOpeningHours,
            regularOpeningHours: placeDetails.regularOpeningHours,
            lat: placeDetails.lat,
            lng: placeDetails.lng,
            lastCached: new Date(),
            images: placeDetails.images
        },
    });
});
exports.createPlaceCache = createPlaceCache;
// Create a new Pin linked to the Content and PlaceCache
const createPin = (pinDetails) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    return yield prisma.pin.create({
        data: {
            name: (_a = pinDetails.name) !== null && _a !== void 0 ? _a : "Unnamed Pin",
            category: (_b = pinDetails.category) !== null && _b !== void 0 ? _b : "Uncategorized",
            contentId: pinDetails.contentId,
            placeCacheId: pinDetails.placeCacheId,
        },
    });
});
exports.createPin = createPin;
// dbHelpers.ts
// dbHelpers.ts
const getTripsByUserId = (userId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Fetch all the trips associated with the user through the TripUser model
        const tripUsers = yield prisma.tripUser.findMany({
            where: { userId: userId }, // Filter by userId
            select: {
                trip: {
                    select: {
                        id: true,
                        name: true,
                        startDate: true,
                        endDate: true,
                        description: true,
                    },
                },
            },
        });
        // Extract the trip details from the tripUser relation
        const trips = tripUsers.map((tripUser) => tripUser.trip);
        return trips;
    }
    catch (error) {
        console.error(`Error fetching trips for user ${userId}:`, error);
        throw new Error("Error fetching trips");
    }
});
exports.getTripsByUserId = getTripsByUserId;
const createTrip = (name, startDate, endDate, description) => __awaiter(void 0, void 0, void 0, function* () {
    return yield prisma.trip.create({
        data: {
            name: name !== null && name !== void 0 ? name : "Untitled",
            startDate: startDate !== null && startDate !== void 0 ? startDate : "NA",
            endDate: endDate !== null && endDate !== void 0 ? endDate : "NA",
            description: description,
        },
    });
});
exports.createTrip = createTrip;
const createUserTrip = (role, userId, tripId) => __awaiter(void 0, void 0, void 0, function* () {
    return yield prisma.tripUser.create({
        data: {
            role: role !== null && role !== void 0 ? role : "Member",
            userId: userId,
            tripId: tripId,
        },
    });
});
exports.createUserTrip = createUserTrip;
const getTripById = (tripId) => __awaiter(void 0, void 0, void 0, function* () {
    return yield prisma.trip.findUnique({
        where: { id: tripId },
        // Optionally, select or include additional fields/relations
    });
});
exports.getTripById = getTripById;
const getTripContentData = (tripId) => __awaiter(void 0, void 0, void 0, function* () {
    // Fetch all content linked to the trip
    const contentList = yield prisma.content.findMany({
        where: { tripId },
        select: {
            id: true,
            url: true,
            structuredData: true,
            userId: true,
            tripId: true,
        },
    });
    // Fetch all pins related to those content entries
    const pinsList = yield prisma.pin.findMany({
        where: {
            contentId: { in: contentList.map((content) => content.id) },
        },
        select: {
            id: true,
            name: true,
            category: true,
            description: true,
            contentId: true, // Foreign key linking to content
            placeCacheId: true, // Foreign key linking to place cache
        },
    });
    // Fetch all place cache entries related to those pins
    const placeCacheList = yield prisma.placeCache.findMany({
        where: {
            id: {
                in: pinsList
                    .map((pin) => pin.placeCacheId)
                    .filter((id) => id !== null),
            },
        },
    });
    return { contentList, pinsList, placeCacheList };
});
exports.getTripContentData = getTripContentData;
const getContentPinsPlaceNested = (tripId) => __awaiter(void 0, void 0, void 0, function* () {
    // === Fetch Nested Data Separately ===
    const nestedTrip = yield prisma.trip.findUnique({
        where: { id: tripId },
        include: {
            contents: {
                include: {
                    pins: {
                        include: {
                            placeCache: true,
                        },
                    },
                },
            },
        },
    });
    return nestedTrip;
});
exports.getContentPinsPlaceNested = getContentPinsPlaceNested;
const addUserToTrip = (tripId, userId) => __awaiter(void 0, void 0, void 0, function* () {
    const tripUser = yield prisma.tripUser.create({
        data: {
            userId: userId,
            tripId: tripId,
            role: "Admin",
        },
    });
    // need to add socket.io code here
    return tripUser;
});
exports.addUserToTrip = addUserToTrip;
const getUsersFromTrip = (tripId) => __awaiter(void 0, void 0, void 0, function* () {
    const users = yield prisma.trip.findUnique({
        where: { id: tripId },
        include: { tripUsers: true },
    });
    // users is json object with tripUsers array
    if (users) {
        return users.tripUsers.map((tripUser) => tripUser.userId);
    }
    else {
        return [];
    }
    ;
});
exports.getUsersFromTrip = getUsersFromTrip;
const addMessage = (tripId, userId, message, timestamp) => __awaiter(void 0, void 0, void 0, function* () {
    const newMessage = yield prisma.chatMessage.create({
        data: {
            id: crypto.randomUUID(),
            tripId: tripId,
            userId: userId,
            text: message,
            createdAt: timestamp
        },
    });
    return newMessage;
});
exports.addMessage = addMessage;
const getMessageById = (tripId, messageId) => __awaiter(void 0, void 0, void 0, function* () {
    const response = yield prisma.chatMessage.findUnique({
        where: { id: messageId },
        select: { createdAt: true },
    });
    return response;
});
exports.getMessageById = getMessageById;
const getMessagesByTime = (tripId, beforeDate, queryLimit) => __awaiter(void 0, void 0, void 0, function* () {
    const messages = yield prisma.chatMessage.findMany({
        where: Object.assign({ tripId: tripId }, (beforeDate && { createdAt: { lt: beforeDate } })),
        orderBy: { createdAt: 'desc' },
        take: queryLimit,
        include: {
            user: {
                select: {
                    id: true,
                    name: true,
                },
            },
        },
    });
    return messages;
});
exports.getMessagesByTime = getMessagesByTime;
