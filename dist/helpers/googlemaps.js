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
exports.getPlaceId = getPlaceId;
exports.getFullPlaceDetails = getFullPlaceDetails;
exports.getCoordinatesFromPlaceId = getCoordinatesFromPlaceId;
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GOOGLE_MAPS_IMAGE_API = "https://places.googleapis.com/v1";
function getPlaceId(query, req) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            const url = "https://places.googleapis.com/v1/places:searchText";
            const data = { textQuery: query };
            const config = {
                headers: {
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
                    "X-Goog-FieldMask": "places.id",
                },
            };
            const response = yield axios_1.default.post(url, data, config);
            const places = response.data.places;
            if (!places || places.length === 0) {
                throw new Error(`No places found by Google Places API for query: ${query}`);
            }
            (_a = req.logger) === null || _a === void 0 ? void 0 : _a.debug(`For location - ${query} place_id - ${places[0].id}`);
            return places[0].id;
        }
        catch (error) {
            (_b = req.logger) === null || _b === void 0 ? void 0 : _b.error("Error calling Places API:", error);
            throw new Error("Failed to get place ID from query.");
        }
    });
}
function getFullPlaceDetails(query, req) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            const url = "https://places.googleapis.com/v1/places:searchText";
            const data = {
                textQuery: query,
            };
            const config = {
                headers: {
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
                    "X-Goog-FieldMask": "places.addressComponents,places.formattedAddress,places.id,places.displayName,places.rating,places.userRatingCount,places.websiteUri,places.currentOpeningHours,places.regularOpeningHours,places.photos",
                },
            };
            const response = yield axios_1.default.post(url, data, config);
            const places = response.data.places;
            if (!places || places.length === 0) {
                throw new Error(`No places found by Google Places API for query: ${query}`);
            }
            const place = places[0];
            // Extract photos field
            const photos = place.photos || [];
            let photoUrls = [];
            for (const photo of photos) {
                if (photo.name) {
                    const imageUrl = `${GOOGLE_MAPS_IMAGE_API}/${photo.name}/media?maxWidthPx=800&skipHttpRedirect=true&key=${GOOGLE_MAPS_API_KEY}`;
                    const response = yield axios_1.default.get(imageUrl);
                    photoUrls.push(response.data.photoUri);
                    if (response.status === 200)
                        break;
                }
            }
            // Construct the PlaceDetails object
            return {
                id: place.id,
                name: ((_a = place.displayName) === null || _a === void 0 ? void 0 : _a.text) || "",
                rating: place.rating,
                userRatingCount: place.userRatingCount,
                websiteUri: place.websiteUri,
                currentOpeningHours: place.currentOpeningHours,
                regularOpeningHours: place.regularOpeningHours,
                images: photoUrls !== null && photoUrls !== void 0 ? photoUrls : []
            };
        }
        catch (error) {
            (_b = req.logger) === null || _b === void 0 ? void 0 : _b.error("Error calling Places API:", error);
            throw new Error("Failed to get place details from query.");
        }
    });
}
function getCoordinatesFromPlaceId(placeId, req) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const url = "https://maps.googleapis.com/maps/api/geocode/json";
            const params = {
                place_id: placeId,
                key: GOOGLE_MAPS_API_KEY,
            };
            const response = yield axios_1.default.get(url, { params });
            const results = response.data.results;
            if (!results || results.length === 0) {
                throw new Error("No results found by Google Geocoding API");
            }
            const location = results[0].geometry.location;
            if (!location) {
                throw new Error("No location data found for the provided placeId");
            }
            return {
                lat: location.lat,
                lng: location.lng,
            };
        }
        catch (error) {
            (_a = req.logger) === null || _a === void 0 ? void 0 : _a.error("Error calling Geocoding API:", error);
            throw new Error("Failed to get coordinates from placeId.");
        }
    });
}
