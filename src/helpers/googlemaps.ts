import axios from "axios";
import dotenv from "dotenv";
import express, { Request, Response } from "express";

dotenv.config();

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GOOGLE_MAPS_IMAGE_API = "https://places.googleapis.com/v1";
// https://places.googleapis.com/v1/NAME/media?key=API_KEY&PARAMETERS

// Updated PlaceDetails interface
interface PlaceDetails {
  id: string;
  name: string;
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  currentOpeningHours?: any;
  regularOpeningHours?: any;
  images: string[];
  utcOffsetMinutes?: number;
  formattedAddress?: string;
  editorialSummary?: {
    text: string;
    languageCode: string;
  };
  businessStatus?: string;
  priceLevel?: string;
  types?: string[];
  location?: {
    latitude: number;
    longitude: number;
  } | null;
}

// Updated createPlaceCache function parameters interface
interface CreatePlaceCacheParams {
  placeId: string;
  name: string;
  rating?: number | null;
  userRatingCount?: number | null;
  websiteUri?: string | null;
  currentOpeningHours?: any;
  regularOpeningHours?: any;
  lat: number;
  lng: number;
  images: string[];
  utcOffsetMinutes?: number | null;
}

// Session token interface for autocomplete
interface AutocompleteSession {
  sessionToken: string;
  createdAt: Date;
  expiresAt: Date;
}

// Store active sessions (in production, use Redis or database)
const activeSessions = new Map<string, AutocompleteSession>();

// Generate a new session token
function generateSessionToken(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Get or create a session token for a user
function getOrCreateSession(userId: string): string {
  const now = new Date();
  const session = activeSessions.get(userId);

  // If session exists and is still valid (5 minutes)
  if (session && now < session.expiresAt) {
    return session.sessionToken;
  }

  // Create new session
  const newSession: AutocompleteSession = {
    sessionToken: generateSessionToken(),
    createdAt: now,
    expiresAt: new Date(now.getTime() + 5 * 60 * 1000), // 5 minutes
  };

  activeSessions.set(userId, newSession);
  return newSession.sessionToken;
}

// Clean up expired sessions
function cleanupExpiredSessions(): void {
  const now = new Date();
  for (const [userId, session] of activeSessions.entries()) {
    if (now >= session.expiresAt) {
      activeSessions.delete(userId);
    }
  }
}

// Utility functions for session monitoring
export function getSessionStats() {
  cleanupExpiredSessions();
  return {
    activeSessions: activeSessions.size,
    sessions: Array.from(activeSessions.entries()).map(([userId, session]) => ({
      userId,
      sessionToken: session.sessionToken,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      isExpired: new Date() >= session.expiresAt,
    })),
  };
}

export function clearAllSessions() {
  activeSessions.clear();
  return { message: "All sessions cleared" };
}

export function getSessionForUser(userId: string) {
  const session = activeSessions.get(userId);
  if (!session) {
    return null;
  }

  return {
    userId,
    sessionToken: session.sessionToken,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    isExpired: new Date() >= session.expiresAt,
  };
}

export async function getPlaceId(query: string, req: Request): Promise<string> {
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

    const response = await axios.post(url, data, config);
    const places = response.data.places;

    if (!places || places.length === 0) {
      throw new Error(
        `No places found by Google Places API for query: ${query}`
      );
    }

    req.logger?.debug(`For location - ${query} place_id - ${places[0].id}`);

    return places[0].id;
  } catch (error) {
    req.logger?.error("Error calling Places API:", error);
    throw new Error("Failed to get place ID from query.");
  }
}

export async function getFullPlaceDetails(
  query: string,
  req: Request
): Promise<PlaceDetails> {
  try {
    const url = "https://places.googleapis.com/v1/places:searchText";
    const data = {
      textQuery: query,
    };
    const config = {
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask":
          "places.addressComponents,places.formattedAddress,places.id,places.displayName,places.rating,places.userRatingCount,places.websiteUri,places.currentOpeningHours,places.regularOpeningHours,places.photos,places.utcOffsetMinutes,places.location,places.editorialSummary,places.businessStatus,places.priceLevel,places.types",
      },
    };
    const response = await axios.post(url, data, config);
    const places = response.data.places;
    if (!places || places.length === 0) {
      throw new Error(
        `No places found by Google Places API for query: ${query}`
      );
    }
    const place = places[0];
    // Extract photos field
    const photos = place.photos || [];
    let photoUrls: string[] = [];
    for (const photo of photos) {
      if (photo.name) {
        const imageUrl = `${GOOGLE_MAPS_IMAGE_API}/${photo.name}/media?maxWidthPx=800&skipHttpRedirect=true&key=${GOOGLE_MAPS_API_KEY}`;
        const response = await axios.get(imageUrl);
        photoUrls.push(response.data.photoUri);
        if (response.status === 200) break;
      }
    }
    // Construct the PlaceDetails object
    return {
      id: place.id,
      name: place.displayName?.text || "",
      rating: place.rating,
      userRatingCount: place.userRatingCount,
      websiteUri: place.websiteUri,
      currentOpeningHours: place.currentOpeningHours,
      regularOpeningHours: place.regularOpeningHours,
      images: photoUrls ?? [],
      utcOffsetMinutes: place.utcOffsetMinutes,
      formattedAddress: place.formattedAddress,
      editorialSummary: place.editorialSummary,
      businessStatus: place.businessStatus,
      priceLevel: place.priceLevel,
      types: place.types,
      location: place.location
        ? {
            latitude: place.location.latitude,
            longitude: place.location.longitude,
          }
        : null, // Add location coordinates
    };
  } catch (error) {
    req.logger?.error("Error calling Places API:", error);
    throw new Error("Failed to get place details from query.");
  }
}

export async function getPlaceDetailsFromId(
  placeId: string,
  req: Request,
  userId?: string
): Promise<PlaceDetails> {
  try {
    // Clean up expired sessions periodically
    cleanupExpiredSessions();

    // Get or create session token for the user
    const sessionToken = userId ? getOrCreateSession(userId) : undefined;

    const url = `https://places.googleapis.com/v1/places/${placeId}`;

    const config: any = {
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask":
          "addressComponents,formattedAddress,id,displayName,rating,userRatingCount,websiteUri,currentOpeningHours,regularOpeningHours,photos,utcOffsetMinutes,location,editorialSummary,businessStatus,priceLevel,types",
      },
    };

    // Add session token if available (enables session-based pricing)
    if (sessionToken) {
      config.headers["X-Goog-SessionToken"] = sessionToken;
      console.log(`Using session token: ${sessionToken} for user: ${userId}`);
    }

    console.log("Making request to Google Places API v1 for place details:", {
      url,
      placeId,
      sessionToken: sessionToken ? "present" : "none",
    });

    const response = await axios.get(url, config);
    const place = response.data;

    if (!place) {
      throw new Error(
        `No place found by Google Places API for placeId: ${placeId}`
      );
    }

    // Extract photos field
    const photos = place.photos || [];
    let photoUrls: string[] = [];
    for (const photo of photos) {
      if (photo.name) {
        const imageUrl = `${GOOGLE_MAPS_IMAGE_API}/${photo.name}/media?maxWidthPx=800&skipHttpRedirect=true&key=${GOOGLE_MAPS_API_KEY}`;
        const response = await axios.get(imageUrl);
        photoUrls.push(response.data.photoUri);
        if (response.status === 200) break;
      }
    }

    // Construct the PlaceDetails object
    return {
      id: place.id,
      name: place.displayName?.text || "",
      rating: place.rating,
      userRatingCount: place.userRatingCount,
      websiteUri: place.websiteUri,
      currentOpeningHours: place.currentOpeningHours,
      regularOpeningHours: place.regularOpeningHours,
      images: photoUrls ?? [],
      utcOffsetMinutes: place.utcOffsetMinutes,
      formattedAddress: place.formattedAddress,
      editorialSummary: place.editorialSummary,
      businessStatus: place.businessStatus,
      priceLevel: place.priceLevel,
      types: place.types,
      location: place.location
        ? {
            latitude: place.location.latitude,
            longitude: place.location.longitude,
          }
        : null,
    };
  } catch (error) {
    req.logger?.error("Error calling Places API for place details:", error);
    throw new Error("Failed to get place details from placeId.");
  }
}

export async function getCoordinatesFromPlaceId(
  placeId: string,
  req: Request
): Promise<{ lat: number; lng: number }> {
  try {
    const url = "https://maps.googleapis.com/maps/api/geocode/json";

    const params = {
      place_id: placeId,
      key: GOOGLE_MAPS_API_KEY,
    };

    const response = await axios.get(url, { params });

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
  } catch (error) {
    req.logger?.error("Error calling Geocoding API:", error);
    throw new Error("Failed to get coordinates from placeId.");
  }
}

// Interface for search results
interface SearchPlaceResult {
  id: string;
  name: string;
  address: string;
  rating?: number;
  userRatingCount?: number;
  photos?: string[];
  location?: {
    lat: number;
    lng: number;
  };
  types?: string[];
}

export async function searchPlaces(
  query: string,
  location?: { lat: number; lng: number },
  radius: number = 5000,
  type?: string,
  req?: Request,
  userId?: string
): Promise<SearchPlaceResult[]> {
  try {
    // Clean up expired sessions periodically
    cleanupExpiredSessions();

    // Get or create session token for the user
    const sessionToken = userId ? getOrCreateSession(userId) : undefined;

    // Use the new Places API v1 for session-based pricing
    const url = "https://places.googleapis.com/v1/places:searchText";

    const data: any = {
      textQuery: query,
      maxResultCount: 10, // Limit results for better performance
    };

    // Add location bias if provided and radius is not unlimited
    if (location && radius > 0) {
      data.locationBias = {
        circle: {
          center: {
            latitude: location.lat,
            longitude: location.lng,
          },
          radius: radius,
        },
      };
    }

    // Add type filter if provided
    if (type) {
      data.includedTypes = [type];
    }

    const config: any = {
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.types",
      },
    };

    // Add session token if available (enables session-based pricing)
    if (sessionToken) {
      config.headers["X-Goog-SessionToken"] = sessionToken;
      console.log(`Using session token: ${sessionToken} for user: ${userId}`);
    }

    console.log("Making request to Google Places API v1:", {
      url,
      data,
      sessionToken: sessionToken ? "present" : "none",
    });

    const response = await axios.post(url, data, config);
    console.log("Google Places API v1 response:", response.data);

    const places = response.data.places;

    if (!places || places.length === 0) {
      return [];
    }

    // Process and format the results
    const results: SearchPlaceResult[] = places.map((place: any) => {
      return {
        id: place.id,
        name: place.displayName?.text || "",
        address: place.formattedAddress || "",
        location: place.location
          ? {
              lat: place.location.latitude,
              lng: place.location.longitude,
            }
          : undefined,
        types: place.types || [],
      };
    });

    req?.logger?.debug(
      `Found ${results.length} suggestions for query: ${query} using session: ${
        sessionToken ? "yes" : "no"
      }`
    );
    return results;
  } catch (error: any) {
    console.error("Detailed error in searchPlaces:", error);
    if (axios.isAxiosError(error)) {
      console.error("Axios error details:", {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        url: error.config?.url,
        method: error.config?.method,
        headers: error.config?.headers,
      });

      // Log the full error response for debugging
      if (error.response?.data?.error?.details) {
        console.error(
          "Error details array:",
          JSON.stringify(error.response.data.error.details, null, 2)
        );
      }
    }
    req?.logger?.error("Error calling Places API v1:", error);
    throw new Error(
      `Failed to get place suggestions: ${error.message || "Unknown error"}`
    );
  }
}
