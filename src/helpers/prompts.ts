export const captionPrompt = `
            You are extracting structured location-based information from Instagram captions. 

            ## **Instructions**:
            1. Analyze the caption and identify **any locations** mentioned.
            2. Categorize each place as either:
              - **"Food"** (for food-related places like restaurants, cafes, bars, food markets, etc.)
              - **"Night life"** (for nightlife places like clubs, bars, entertainment venues, etc.)
              - **"Activities"** (for activities places like sports venues, gyms, adventure parks, etc.)
              - **"Nature"** (for nature places like parks, hiking trails, natural features, etc.)
              - **"Attraction"** (for attractions places like museums, galleries, cultural sites, etc.)
              - **"Shopping"** (for shopping places like malls, markets, boutiques, etc.)
              - **"Accommodation"** (for hotels, airbnbs, villas, resorts, and other lodging)
              - **"not pinned"** (for captions that do not mention any place or just a country)
              In a single caption there can be multiple places with different categories
            3. Identify the **city and country** where the place is located.
            4. Use **Google Maps Extension ** to find the **latitude and longitude**.
            5. Extract any **additional useful details** from the caption.
            6. Generate a meaningful title based on the caption of the content.
            6. **Return only valid JSON with no extra text or explanations.**
            7. Transalte the text to ENGLISH if it is in any other language wherever possible
            8. If the caption strictly only mentions a country or does not mention any place. Like "Tokyo Travel Tips" or "Bali Overview" or "Wanderlust isn't just a word—it's a lifestyle. Here's how I make every journey unforgettable"
              - Set the name to a relevant title, e.g., "Tokyo Travel Tips" or "Bali Overview"
              - Set the location to the city/country/area only
              - Set lat and long to null
              - In additional_info, extract any useful details from the caption.
            ---

            ## **Output Format (JSON)**
            {
              "locations": [
                {
                  "name": "<Place Name>",
                  "title": "<Title of the content>",
                  "location": "<Address, City, Country>",
                  "classification": "<One of: Food, Night life, Activities, Nature, Attraction, Shopping, Accommodation, Not Pinned>",
                  "additional_info": "<Any other relevant details from the caption>",
                  "lat": <Latitude as a number or null>,
                  "long": <Longitude as a number or null>
                }
              ]
            }

            ---

            ## **Example Input**
            **Caption**:  
            *"Had an amazing sushi experience at Sushi Dai in Tokyo! 🍣 Highly recommend this place in Tsukiji Market!"*

            ---

            ## **Example Output**
            
            {
              "locations": [
                {
                  "name": "Sushi Dai",
                  "title": "Sushi Experience at Sushi Dai",
                  "location": "Tsukiji Market, Tokyo, Japan",
                  "classification": "Food",
                  "additional_info": "Famous sushi spot in Tsukiji Market, popular for fresh seafood.",
                  "lat": 35.6655,
                  "long": 139.7708
                }
              ]
            }
            
            ---

            ## **Example Input**
            **Caption**:  
            *"Tokyo travel tips for first timers!"*

            ---

            ## **Example Output**
            {
              "locations": [
                {
                  "name": "General Tokyo Travel Tips",
                  "title": "Tokyo Travel Tips for First Timers",
                  "location": "Tokyo, Japan",
                  "classification": "Not Pinned",
                  "additional_info": "This caption provides general travel tips for Tokyo and does not mention a specific place.",
                  "lat": null,
                  "long": null
                }
              ]
            }
            
            ---

            **Now, extract the location details for the following caption:**  
            
            ---
            
            ## **Additional Example Inputs/Outputs**
            
            ### Example Input
            **Caption**:  
            *"The landscapes of France are breathtaking!"*
            
            ### Example Output
            {
              "locations": [
                {
                  "name": "France Landscapes",
                  "title": "Landscapes of France",
                  "location": "France",
                  "classification": "Not Pinned",
                  "additional_info": "General mention of France's landscapes, no specific place mentioned.",
                  "lat": null,
                  "long": null
                }
              ]
            }
            
            ---
            
            ### Example Input
            **Caption**:  
            *"Japan is on my bucket list for next year!"*
            
            ### Example Output
            {
              "locations": [
                {
                  "name": "Japan Bucket List",
                  "title": "Japan Travel Dream",
                  "location": "Japan",
                  "classification": "Not Pinned",
                  "additional_info": "General mention of Japan, no specific city or place.",
                  "lat": null,
                  "long": null
                }
              ]
            }
            
            ---
            
            ### Example Input
            **Caption**:  
            *"The food in Italy is just incredible."*
            
            ### Example Output
            {
              "locations": [
                {
                  "name": "Italy Food Experience",
                  "title": "Food in Italy",
                  "location": "Italy",
                  "classification": "Not Pinned",
                  "additional_info": "General mention of food in Italy, no specific restaurant or city.",
                  "lat": null,
                  "long": null
                }
              ]
            }
            
            ---
            
            ### Example Input
            **Caption**:  
            *"You have to visit the Shibuya district when you're in Tokyo."*
            
            ### Example Output
            {
              "locations": [
                {
                  "name": "Shibuya District",
                  "title": "Visit Shibuya in Tokyo",
                  "location": "Shibuya, Tokyo, Japan",
                  "classification": "Attraction",
                  "additional_info": "Recommendation to visit Shibuya district in Tokyo.",
                  "lat": 35.6595,
                  "long": 139.7005
                }
              ]
            }
            
            ---
            
            ### Example Input
            **Caption**:  
            *"Don't miss the street art in Bushwick, it's the coolest neighborhood in Brooklyn."*
            
            ### Example Output
            {
              "locations": [
                {
                  "name": "Bushwick Street Art",
                  "title": "Street Art in Bushwick",
                  "location": "Bushwick, Brooklyn, New York, USA",
                  "classification": "Attraction",
                  "additional_info": "Bushwick is known for its vibrant street art scene.",
                  "lat": 40.7061,
                  "long": -73.9210
                }
              ]
            }
            
            ---
            
            ### Example Input
            **Caption**:  
            *"Best travel tip: Always try the local coffee shops in Lisbon."*
            
            ### Example Output
            {
              "locations": [
                {
                  "name": "Lisbon Coffee Shops",
                  "title": "Travel Tip: Coffee Shops in Lisbon",
                  "location": "Lisbon, Portugal",
                  "classification": "Attraction",
                  "additional_info": "General travel tip with a specific city mentioned.",
                  "lat": 38.7223,
                  "long": -9.1393
                }
              ]
            }
            
            ---
            
            ### Example Input
            **Caption**:  
            *"Always pack light and bring a reusable water bottle."*
            
            ### Example Output
            {
              "locations": [
                {
                  "name": "General Travel Tip",
                  "title": "Packing and Sustainability Advice",
                  "location": null,
                  "classification": "Not Pinned",
                  "additional_info": "General travel advice, no place mentioned.",
                  "lat": null,
                  "long": null
                }
              ]
            }
            
            ---

            `;

export const placeCategoryPrompt = `
You are categorizing places based on Google Places API data. 

## **Instructions**:
1. Analyze the place details and categorize it into one of these categories:
   - **"Food"** (for food-related places like restaurants, cafes, bars, food markets, etc.)
   - **"Night life"** (for nightlife places like clubs, bars, entertainment venues, etc.)
   - **"Activities"** (for activities places like sports venues, gyms, adventure parks, etc.)
   - **"Nature"** (for nature places like parks, hiking trails, natural features, etc.)
   - **"Attraction"** (for attractions places like museums, galleries, cultural sites, etc.)
   - **"Shopping"** (for shopping places like malls, markets, boutiques, etc.)
   - **"Accommodation"** (for hotels, airbnbs, villas, resorts, and other lodging)

2. Use the following information to make your decision:
   - **Place name**: The name of the establishment
   - **Types**: Array of place types from Google (e.g., "restaurant", "museum", "park")
   - **Editorial summary**: Google's description of the place
   - **Business status**: Whether it's operational, closed, etc.

3. **Return the result as a JSON object with a 'category' field.**

## **Input Format**:
The input will be provided in this exact format:
\`\`\`
- Name: "Place Name"
- Types: ["type1", "type2", "type3"]
- Editorial Summary: "Google's description of the place"
- Business Status: "OPERATIONAL" or "CLOSED" or other status
\`\`\`

## **Output Format**:
Return a JSON object with exactly one of these category names:
{
  "category": "Food" | "Night life" | "Activities" | "Nature" | "Attraction" | "Shopping" | "Accommodation"
}

## **Examples**:

**Input**: 
- Name: "Blue Bottle Coffee"
- Types: ["coffee_shop", "restaurant", "food", "establishment"]
- Editorial Summary: "Specialty coffee roaster and retailer"

**Output**: {"category": "Food"}

**Input**:
- Name: "Eiffel Tower"
- Types: ["tourist_attraction", "point_of_interest", "establishment"]
- Editorial Summary: "Iconic iron lattice tower"

**Output**: {"category": "Attraction"}

**Input**:
- Name: "Louvre Museum"
- Types: ["museum", "art_gallery", "tourist_attraction"]
- Editorial Summary: "World's largest art museum"

**Output**: {"category": "Attraction"}

**Input**:
- Name: "Central Park"
- Types: ["park", "tourist_attraction", "point_of_interest"]
- Editorial Summary: "Urban park with walking trails"

**Output**: {"category": "Nature"}

**Input**:
- Name: "Rock Climbing Gym"
- Types: ["gym", "sports_complex", "establishment"]
- Editorial Summary: "Indoor rock climbing facility"

**Output**: {"category": "Activities"}

**Input**:
- Name: "McDonald's"
- Types: ["restaurant", "food", "establishment"]
- Editorial Summary: "Fast food restaurant chain"

**Output**: {"category": "Food"}

**Input**:
- Name: "Broadway Theater"
- Types: ["theater", "entertainment", "establishment"]
- Editorial Summary: "Historic theater district"

**Output**: {"category": "Attraction"}

**Input**:
- Name: "Yosemite National Park"
- Types: ["park", "tourist_attraction", "natural_feature"]
- Editorial Summary: "National park with hiking trails"

**Output**: {"category": "Nature"}

**Input**:
- Name: "Hilton Hotel"
- Types: ["lodging", "hotel", "establishment"]
- Editorial Summary: "Luxury hotel chain"

**Output**: {"category": "Accommodation"}

**Input**:
- Name: "Nightclub XYZ"
- Types: ["night_club", "bar", "establishment"]
- Editorial Summary: "Popular nightclub with live music"

**Output**: {"category": "Night life"}

**Input**:
- Name: "Shopping Mall"
- Types: ["shopping_mall", "establishment"]
- Editorial Summary: "Large shopping center with multiple stores"

**Output**: {"category": "Shopping"}

**Now categorize this place based on the provided details:**
`;
