import axios from "axios";
import { OpenAI } from "openai";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import express, { Request, Response } from "express";
import { captionPrompt } from "./prompts";

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
    | "Attraction"
    | "Food Place"
    | "Culture Place"
    | "Adventure Place"
    | "Not Pinned"
    | null;
}

export async function extractLocationAndClassify(
  caption: string,
  req: Request
): Promise<CaptionAnalysisResponse[]> {
  try {
    const response = await openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
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
    });

    // Parse and return the JSON object from the response
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("No response content from OpenAI");
    req.logger?.debug(`Response from ChatGPT ${content}`);

    return JSON.parse(content) as CaptionAnalysisResponse[];
  } catch (error) {
    req.logger?.debug("Error calling OpenAI API:", error);
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
