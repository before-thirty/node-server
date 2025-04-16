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
exports.extractLocationAndClassify = extractLocationAndClassify;
exports.extractLocationAndClassifyGemini = extractLocationAndClassifyGemini;
const openai_1 = require("openai");
const dotenv_1 = __importDefault(require("dotenv"));
const generative_ai_1 = require("@google/generative-ai");
dotenv_1.default.config(); // Load .env variables
const OPEN_AI_API_KEY = process.env.OPEN_AI_API_KEY;
const GOOGLE_GEMINI_KEY = process.env.GOOGLE_GEMINI_KEY;
const openaiClient = new openai_1.OpenAI({
    apiKey: OPEN_AI_API_KEY,
});
function extractLocationAndClassify(caption, req) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        try {
            const response = yield openaiClient.chat.completions.create({
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
            const content = (_b = (_a = response.choices[0]) === null || _a === void 0 ? void 0 : _a.message) === null || _b === void 0 ? void 0 : _b.content;
            if (!content)
                throw new Error("No response content from OpenAI");
            (_c = req.logger) === null || _c === void 0 ? void 0 : _c.debug(`Response from ChatGPT ${content}`);
            return JSON.parse(content);
        }
        catch (error) {
            (_d = req.logger) === null || _d === void 0 ? void 0 : _d.debug("Error calling OpenAI API:", error);
            throw new Error("Failed to analyze caption.");
        }
    });
}
function extractLocationAndClassifyGemini(caption) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            if (!process.env.GOOGLE_GEMINI_KEY) {
                throw new Error("GOOGLE_GEMINI_KEY is not set in environment variables");
            }
            const genAI = new generative_ai_1.GoogleGenerativeAI(process.env.GOOGLE_GEMINI_KEY);
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
            const result = yield model.generateContent({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: "application/json", // Ensures JSON output
                },
            });
            const content = result.response.text();
            if (!content)
                throw new Error("No response content from Gemini");
            console.log("Raw API response content:", content);
            return JSON.parse(content);
        }
        catch (error) {
            console.error("Error calling Gemini API:", error);
            throw new Error("Failed to analyze caption.");
        }
    });
}
