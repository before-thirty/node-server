import axios from "axios";
import { OpenAI } from "openai";

const OPENAI_API_KEY = process.env.OPEN_AI_API_KEY;

const openaiClient = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

export interface CaptionAnalysisResponse {
  location: string | null;
  classification:
    | "Attraction"
    | "Food Place"
    | "Culture Place"
    | "Adventure Place"
    | null;
  generalTopic: string | null;
}

export async function extractLocationAndClassify(
  caption: string
): Promise<CaptionAnalysisResponse> {
  try {
    const response = await openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
              {
                "location": "<Extracted location as specifically as possible, e.g., 'Eiffel Tower, Paris' or 'Toit, Mahadevapura' or 'Atom Shinjuku pub' .>",
                "classification": "<One of: Food, Night life, Outdoor, Activities, Attraction. Based on the type of place the caption is describing.>",
                "description": "Summarize the reel in about 20-30 words"
              }

              The location must be specific and detailed, including the name of the place followed by the city (if mentioned or can be inferred). Ensure all extracted information is directly relevant to the caption content.
            `,
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

    return JSON.parse(content) as CaptionAnalysisResponse;
  } catch (error) {
    console.error("Error calling OpenAI API:", error);
    throw new Error("Failed to analyze caption.");
  }
}
