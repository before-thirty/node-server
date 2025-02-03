import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY


export async function getPlaceId(query: string): Promise<string> {
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
          "places.attributions,places.id,places.name,places.photos,nextPageToken",
      },
    };

    const response = await axios.post(url, data, config);
    const places = response.data.places;
    if (!places) {
      throw new Error(`No places found by google places api ${query}`);
    }
    return places[0].id;
  } catch (error) {
    console.error("Error calling Places API:", error);
    throw new Error("Failed to get placeid from query.");
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