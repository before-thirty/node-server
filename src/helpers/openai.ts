import axios from "axios";
import { OpenAI } from "openai";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import express, { Request, Response } from 'express';



dotenv.config(); // Load .env variables

const OPEN_AI_API_KEY = process.env.OPEN_AI_API_KEY;
const GOOGLE_GEMINI_KEY = process.env.GOOGLE_GEMINI_KEY;

const openaiClient = new OpenAI({
  apiKey: OPEN_AI_API_KEY,
});

export interface CaptionAnalysisResponse {
  name: string | null;
  additional_info: string | null;
  location: string | null;
  classification:
    | "Attraction"
    | "Food Place"
    | "Culture Place"
    | "Adventure Place"
    | null;
}

export async function extractLocationAndClassify(
  caption: string,req: Request
): Promise<CaptionAnalysisResponse[]> {
  try {
    const response = await openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
            You are extracting structured location-based information from Instagram captions. 

            ## **Instructions**:
            1. Analyze the caption and identify **any locations** mentioned.
            2. Categorize each place as either:
              - **"restaurant"** (for food-related places) or
              - **"tourist spot"** (for sightseeing and attractions).
            3. Identify the **city and country** where the place is located.
            4. Use **Google Maps Extension ** to find the **latitude and longitude**.
            5. Extract any **additional useful details** from the caption.
            6. **Return only valid JSON with no extra text or explanations.**
            7. Transalte the text to ENGLISH if it is in any other language wherever possible

            ---

            ## **Output Format (JSON)**
            [
              {
                "name": "<Place Name>",
                "location": "<Address, City, Country>",
                "classification": "<One of: Food, Night life, Outdoor, Activities, Attraction>",
                "additional_info": "<Any other relevant details from the caption>",
                "lat": <Latitude as a number>,
                "long": <Longitude as a number>
              }
            ]

            ---

            ## **Example Input**
            **Caption**:  
            *"Had an amazing sushi experience at Sushi Dai in Tokyo! 🍣 Highly recommend this place in Tsukiji Market!"*

            ---

            ## **Example Output**
            
            [
              {
                "name": "Sushi Dai",
                "location": "Tsukiji Market, Tokyo, Japan",
                "classification": "Food",
                "additional_info": "Famous sushi spot in Tsukiji Market, popular for fresh seafood.",
                "lat": 35.6655,
                "long": 139.7708
              }
            ]
            

            ---

            **Now, extract the location details for the following caption:**  
            `

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
    req.logger?.debug(`Response from ChatGPT ${content}`)

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
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite-preview-02-05" });

    const prompt = `
            You are extracting structured location-based information from Instagram captions. 

            ## **Instructions**:
            1. Analyze the caption and identify **any locations** mentioned.
            2. Categorize each place as either:
              - **"restaurant"** (for food-related places) or
              - **"tourist spot"** (for sightseeing and attractions).
            3. Identify the **city and country** where the place is located.
            4. Use **Google Maps data** to find the **latitude and longitude**.
            5. Extract any **additional useful details** from the caption.
            6. **Return only valid JSON with no extra text or explanations.**

            ---

            ## **Output Format (JSON)**
            \`\`\`json
            [
              {
                "name": "<Place Name>",
                "location": "<Address, City, Country>",
                "classification": "<One of: Food, Night life, Outdoor, Activities, Attraction>",
                "additional_info": "<Any other relevant details from the caption>",
                "lat": "<Latitude as a string>",
                "long": "<Longitude as a string>",
                "gemini_details":"Anything else you know about this spot from your memory"
              }
            ]
            \`\`\`

            ---

            ## **Example Input**
            **Caption**:  
            *"Had an amazing sushi experience at Sushi Dai in Tokyo! 🍣 Highly recommend this place in Tsukiji Market!"*

            ---

            ## **Example Output**
            \`\`\`json
            [
              {
                "name": "Sushi Dai",
                "location": "Tsukiji Market, Tokyo, Japan",
                "classification": "Food",
                "additional_info": "Famous sushi spot in Tsukiji Market, popular for fresh seafood.",
                "lat": "35.6655",
                "long": "139.7708"
              }
            ]
            \`\`\`

            ---

            **Now, extract the location details for the following caption:**  
            **Caption:** "${caption}"
            `;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
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



