import axios from "axios";
import { OpenAI } from "openai";


const OPEN_AI_API_KEY = "";

const openaiClient = new OpenAI({
  apiKey: OPEN_AI_API_KEY,
});

export interface CaptionAnalysisResponse {
  name: string | null;
  addtional_info: string | null;
  location: string | null;
  classification:
    | "Attraction"
    | "Food Place"
    | "Culture Place"
    | "Adventure Place"
    | null;
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
          content: `I am going to feed a series of captions from reels on Instagram. They might be about restaurants or sightseeing places, etc.
                    I want to extract information in the following structure:
                    - Categorize the place into either "restaurant" or "tourist spot"
                    - Find out which city the place is located in
                    - Provide the name of the place
                    - The next message will contain the first caption

                    Please return the information **only in pure JSON format** with no additional text or explanations:

                    {
                    "name": "<Name of the place being talked about in the reel>",
                    "location": "<Any information about the address, city, and country>",
                    "classification": "<One of: Food, Night life, Outdoor, Activities, Attraction. Based on the type of place the caption is describing>",
                    "additional_info": "<Any other info in the caption relevant to the user>"
                    }`
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
    console.log("Raw API response content:", content);

    return JSON.parse(content) as CaptionAnalysisResponse;
  } catch (error) {
    console.error("Error calling OpenAI API:", error);
    throw new Error("Failed to analyze caption.");
  }
}

