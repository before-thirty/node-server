import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY

interface PlaceDetails {
  id: string;
  name: string;
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  currentOpeningHours?: any; // Adjust type if needed
  regularOpeningHours?: any; // Adjust type if needed
}


export async function getPlaceId(query: string): Promise<string> {
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
      throw new Error(`No places found by Google Places API for query: ${query}`);
    }

    return places[0].id;
  } catch (error) {
    console.error("Error calling Places API:", error);
    throw new Error("Failed to get place ID from query.");
  }
}


export async function getFullPlaceDetails(query: string): Promise<PlaceDetails> {
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
          "places.id,places.displayName,places.rating,places.userRatingCount,places.websiteUri,places.currentOpeningHours,places.regularOpeningHours",
      },
    };

    const response = await axios.post(url, data, config);
    const places = response.data.places;

    if (!places || places.length === 0) {
      throw new Error(`No places found by Google Places API for query: ${query}`);
    }

    const place = places[0];

    // Construct the PlaceDetails object
    return {
      id: place.id,
      name: place.displayName?.text || "",
      rating: place.rating,
      userRatingCount: place.userRatingCount,
      websiteUri: place.websiteUri,
      currentOpeningHours: place.currentOpeningHours,
      regularOpeningHours: place.regularOpeningHours,
    };
  } catch (error) {
    console.error("Error calling Places API:", error);
    throw new Error("Failed to get place details from query.");
  }
}


export async function getCoordinatesFromPlaceId(
  placeId: string
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
    console.error("Error calling Geocoding API:", error);
    throw new Error("Failed to get coordinates from placeId.");
  }
}