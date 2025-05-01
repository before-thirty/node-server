import axios from "axios";
import dotenv from "dotenv";
import express, { Request, Response } from 'express';


dotenv.config();

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY
const GOOGLE_MAPS_IMAGE_API = "https://places.googleapis.com/v1";
// https://places.googleapis.com/v1/NAME/media?key=API_KEY&PARAMETERS

interface PlaceDetails {
  id: string;
  name: string;
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  images?: string[];
  currentOpeningHours?: any; // Adjust type if needed
  regularOpeningHours?: any; // Adjust type if needed
}


export async function getPlaceId(query: string,req:Request): Promise<string> {
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

    req.logger?.debug(`For location - ${query} place_id - ${places[0].id}`)

    return places[0].id;
  } catch (error) {
    req.logger?.error("Error calling Places API:", error);
    throw new Error("Failed to get place ID from query.");
  }
}


export async function getFullPlaceDetails(query: string,req:Request): Promise<PlaceDetails> {
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
          "places.addressComponents,places.formattedAddress,places.id,places.displayName,places.rating,places.userRatingCount,places.websiteUri,places.currentOpeningHours,places.regularOpeningHours,places.photos",
      },
    };

    const response = await axios.post(url, data, config);
    const places = response.data.places;

    if (!places || places.length === 0) {
      throw new Error(`No places found by Google Places API for query: ${query}`);
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
      images:photoUrls ?? []
    };
  } catch (error) {
    req.logger?.error("Error calling Places API:", error);
    throw new Error("Failed to get place details from query.");
  }
}


export async function getCoordinatesFromPlaceId(
  placeId: string,req:Request
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