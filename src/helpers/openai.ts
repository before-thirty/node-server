import axios from "axios";
import { OpenAI } from "openai";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import express, { Request, Response } from "express";
import { captionPrompt, placeCategoryPrompt } from "./prompts";

dotenv.config(); // Load .env variables

const OPEN_AI_API_KEY = process.env.OPEN_AI_API_KEY;
const GOOGLE_GEMINI_KEY = process.env.GOOGLE_GEMINI_KEY;

const openaiClient = new OpenAI({
  apiKey: OPEN_AI_API_KEY,
});

export interface CaptionAnalysisResponse {
  name: string | null;
  title: string | null;
  additional_info: string | null;
  location: string | null;
  classification:
    | "Food"
    | "Night life"
    | "Activities"
    | "Nature"
    | "Attraction"
    | "Shopping"
    | "Accommodation"
    | "Not Pinned"
    | null;
  lat: number | null;
  long: number | null;
}

// JSON Schema for location extraction structured output
const locationExtractionSchema = {
  type: "json_schema" as const,
  json_schema: {
    name: "location_extraction",
    description: "Extract location information from captions",
    strict: true,
    schema: {
      type: "object",
      properties: {
        locations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: ["string", "null"] },
              title: { type: ["string", "null"] },
              additional_info: { type: ["string", "null"] },
              location: { type: ["string", "null"] },
              classification: {
                type: ["string", "null"],
                enum: ["Food", "Night life", "Activities", "Nature", "Attraction", "Shopping", "Accommodation", "Not Pinned", null]
              },
              lat: { type: ["number", "null"] },
              long: { type: ["number", "null"] }
            },
            required: ["name", "title", "additional_info", "location", "classification", "lat", "long"],
            additionalProperties: false
          }
        }
      },
      required: ["locations"],
      additionalProperties: false
    }
  }
};

// JSON Schema for place category classification
const placeCategorySchema = {
  type: "json_schema" as const,
  json_schema: {
    name: "place_category",
    description: "Classify a place into a category",
    strict: true,
    schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["Food", "Night life", "Activities", "Nature", "Attraction", "Shopping", "Accommodation"]
        }
      },
      required: ["category"],
      additionalProperties: false
    }
  }
};

export async function extractLocationAndClassify(
  caption: string,
  req: Request
): Promise<CaptionAnalysisResponse[]> {
  try {
    const response = await openaiClient.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: captionPrompt,
        },
        {
          role: "user",
          content: `Given the caption: "${caption}", extract the location, classification, and description.`,
        },
      ],
      response_format: locationExtractionSchema,
    });

    // Parse and return the structured response
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("No response content from OpenAI");
    
    req.logger?.debug(`Response from ChatGPT ${content}`);

    // Handle refusal case
    if (response.choices[0]?.message?.refusal) {
      req.logger?.error(`OpenAI refused the request: ${response.choices[0].message.refusal}`);
      throw new Error("OpenAI refused to process the request");
    }

    const parsedResponse = JSON.parse(content);
    return parsedResponse.locations as CaptionAnalysisResponse[];
  } catch (error) {
    req.logger?.error("Error calling OpenAI API:", error);
    throw new Error("Failed to analyze caption.");
  }
}

export async function extractLocationAndClassifyGemini(
  caption: string
): Promise<CaptionAnalysisResponse[]> {
  try {
    if (!process.env.GOOGLE_GEMINI_KEY) {
      throw new Error("GOOGLE_GEMINI_KEY is not set in environment variables");
    }

    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash-lite-preview-02-05",
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: captionPrompt }] }],
      generationConfig: {
        responseMimeType: "application/json", // Ensures JSON output
      },
    });

    const content = result.response.text();
    if (!content) throw new Error("No response content from Gemini");

    console.log("Raw API response content:", content);

    return JSON.parse(content) as CaptionAnalysisResponse[];
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    throw new Error("Failed to analyze caption.");
  }
}

export async function classifyPlaceCategory(placeDetails: {
  name: string;
  types?: string[];
  editorialSummary?: { text: string; languageCode: string };
  businessStatus?: string;
}): Promise<string> {
  try {
    const placeInfo = `
- Name: "${placeDetails.name}"
- Types: ${JSON.stringify(placeDetails.types || [])}
- Editorial Summary: "${placeDetails.editorialSummary?.text || ""}"
- Business Status: "${placeDetails.businessStatus || ""}"
`;

    const response = await openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: placeCategoryPrompt,
        },
        {
          role: "user",
          content: placeInfo,
        },
      ],
      response_format: placeCategorySchema,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("No response content from OpenAI");

    // Handle refusal case
    if (response.choices[0]?.message?.refusal) {
      console.error(`OpenAI refused the request: ${response.choices[0].message.refusal}`);
      return "Attraction"; // Default fallback
    }

    const parsedResponse = JSON.parse(content);
    return parsedResponse.category;
  } catch (error) {
    console.error("Error classifying place category:", error);
    return "Attraction"; // Default fallback
  }
}
export async function analyzeYouTubeContent(
  title: string,
  description: string,
  req: Request
): Promise<boolean> {
  try {
    const prompt = `Analyze the provided YouTube video title and description. Determine if the content is travel-related. It can contain places, attractions, restaurants, nature, or tourist spots. It can focus on travel itineraries, destination guides, or place-based travel content. Return only 'True' if the content is clearly about travel, destinations, or attractions, otherwise return 'False'.`;

    const response = await openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: prompt,
        },
        {
          role: "user",
          content: `Title: "${title}"\nDescription: "${description}"`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content?.trim();
    req.logger?.debug(`YouTube analysis response from ChatGPT: ${content}`);

    if (response.choices[0]?.message?.refusal) {
      req.logger?.error(
        `OpenAI refused the request: ${response.choices[0].message.refusal}`
      );
      return false;
    }

    return content === "True";
  } catch (error) {
    req.logger?.error("Error calling OpenAI API for YouTube content analysis:", error);
    return false;
  }
}
