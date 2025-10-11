// poc-routes.ts - Simplified POC endpoints
import express, { Request, Response } from "express";
import { z } from "zod";
import {
  processAllContent,
  generateContentEmbeddings,
  pocSemanticSearch,
  processAllContentAggressive,
  searchPinNames,
  getPinsFromSemanticResults,
} from "./poc-embeddings";

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const router = express.Router();

// Validation schemas
const SearchSchema = z.object({
  query: z.string().min(1, "Search query is required"),
  tripId: z.string().uuid("Valid trip ID is required"),
  limit: z.number().min(1).max(50).optional().default(10),
});

const SingleEmbeddingSchema = z.object({
  contentId: z.string().uuid(),
});

// 1. Generate embeddings for all content (one-time setup)
router.post("/poc/generate-all-embeddings", async (req: Request, res: Response) => {
  try {
    console.log("🚀 Starting embedding generation for all content...");
    
    res.status(202).json({
      message: "Embedding generation started in background",
      note: "Check server logs for progress. This will take a few minutes."
    });

    // Start processing in background
    processAllContentAggressive(20, 100)
      .then(() => {
        console.log("🎉 All embeddings generated successfully!");
      })
      .catch((error) => {
        console.error("❌ Embedding generation failed:", error);
      });
  } catch (error) {
    console.error("Error starting embedding generation:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to start embedding generation"
    });
  }
});

// 2. Generate embedding for single content (for testing)
router.post("/poc/generate-single-embedding", async (req: Request, res: Response) => {
  try {
    const { contentId } = SingleEmbeddingSchema.parse(req.body);
    await generateContentEmbeddings(contentId);
    
    res.status(200).json({
      success: true,
      message: `Embeddings generated for content ${contentId}`,
      contentId
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid input", details: error.errors });
    } else {
      console.error("Error generating single embedding:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to generate embedding"
      });
    }
  }
});

// Helper function to combine and rank hybrid search results
function combineHybridResults(
  semanticResults: any[],
  pinResults: any[],
  _query: string,
  limit: number
): any[] {
  const combined = new Map();
  
  // Add semantic search results
  semanticResults.forEach((result: any) => {
    const maxScore = Math.max(
      result.title_similarity || 0,
      result.raw_data_similarity || 0,
      result.user_notes_similarity || 0,
      result.structured_data_similarity || 0
    );
    
    combined.set(result.id, {
      id: result.id,
      title: result.title || 'Untitled',
      rawData: result.rawData,
      userNotes: result.userNotes,
      structuredData: result.structuredData,
      userId: result.userId,
      tripId: result.tripId,
      createdAt: result.createdAt,
      thumbnail: result.thumbnail,
      pins_count: result.pins_count,
      relevanceScore: parseFloat(maxScore.toFixed(3)),
      searchType: 'semantic',
      matchedFields: {
        title: result.title_similarity > 0.1 ? parseFloat(result.title_similarity.toFixed(3)) : null,
        rawData: result.raw_data_similarity > 0.1 ? parseFloat(result.raw_data_similarity.toFixed(3)) : null,
        userNotes: result.user_notes_similarity > 0.1 ? parseFloat(result.user_notes_similarity.toFixed(3)) : null,
        structuredData: result.structured_data_similarity > 0.1 ? parseFloat(result.structured_data_similarity.toFixed(3)) : null,
      },
      matchedPins: []
    });
  });
  
  // Add or enhance with pin name matches
  pinResults.forEach((pinResult: any) => {
    const contentId = pinResult.contentId;
    
    if (combined.has(contentId)) {
      // Content already exists from semantic search, enhance it
      const existing = combined.get(contentId);
      
      // Boost score for pin name matches (they're typically more precise)
      const boostedScore = Math.max(existing.relevanceScore, pinResult.similarity_score + 0.1);
      existing.relevanceScore = parseFloat(boostedScore.toFixed(3));
      existing.searchType = 'hybrid';
      existing.matchedPins.push({
        pinId: pinResult.pin_id,
        pinName: pinResult.pin_name,
        similarity: parseFloat(pinResult.similarity_score.toFixed(3))
      });
    } else {
      // New content from pin search, add it
      combined.set(contentId, {
        id: contentId,
        title: pinResult.title || 'Untitled',
        rawData: pinResult.rawData,
        userNotes: null,
        structuredData: null,
        userId: pinResult.userId,
        tripId: pinResult.tripId,
        createdAt: pinResult.createdAt,
        thumbnail: pinResult.thumbnail,
        pins_count: 1, // At least one pin matched
        relevanceScore: parseFloat(pinResult.similarity_score.toFixed(3)),
        searchType: 'pin_name',
        matchedFields: {},
        matchedPins: [{
          pinId: pinResult.pin_id,
          pinName: pinResult.pin_name,
          similarity: parseFloat(pinResult.similarity_score.toFixed(3))
        }]
      });
    }
  });
  
  // Convert to array and sort by relevance score
  return Array.from(combined.values())
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
}

// 3. Hybrid search within a trip (semantic + pin name matching) - ORIGINAL VERSION
router.post("/poc/search", async (req: Request, res: Response) => {
  try {
    const { query, tripId, limit } = SearchSchema.parse(req.body);
    
    console.log(`🔍 Hybrid search in trip ${tripId}: "${query}"`);
    const startTime = Date.now();
    
    // Run both searches in parallel
    const [semanticResults, pinNameResults] = await Promise.all([
      pocSemanticSearch(query, undefined, tripId, limit),
      searchPinNames(query, undefined, tripId, Math.ceil(limit / 2)) // Get fewer pin results to balance
    ]);
    
    const searchTime = Date.now() - startTime;
    
    // Combine and rank results
    const contents = combineHybridResults(semanticResults, pinNameResults, query, limit);
    
    console.log(`📊 Hybrid search completed in ${searchTime}ms:`, {
      semanticMatches: semanticResults.length,
      pinNameMatches: pinNameResults.length,
      combinedResults: contents.length
    });

    res.status(200).json({
      success: true,
      query,
      tripId,
      searchTimeMs: searchTime,
      searchStats: {
        semanticMatches: semanticResults.length,
        pinNameMatches: pinNameResults.length,
        totalCombined: contents.length
      },
      contents
    });
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid input data", details: error.errors });
    } else {
      console.error("Error performing search:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Search failed"
      });
    }
  }
});

// 4. NEW: Pin-based hybrid search within a trip
router.post("/poc/search/pins", async (req: Request, res: Response) => {
  try {
    const { query, tripId, limit } = SearchSchema.parse(req.body);
    
    console.log(`🔍 Pin-based search in trip ${tripId}: "${query}"`);
    const startTime = Date.now();
    
    // Run both searches in parallel
    const [semanticResults, textPinResults] = await Promise.all([
      pocSemanticSearch(query, undefined, tripId, limit * 2), // Get more semantic results for pins
      searchPinNames(query, undefined, tripId, Math.ceil(limit / 2)) // Text similarity pins
    ]);
    
    // Get all pins from semantic search results
    const semanticPins = await getPinsFromSemanticResults(semanticResults, query);
    
    const searchTime = Date.now() - startTime;
    
    // Combine pins with ranking: text similarity first, then semantic
    const allPins = new Map();
    
    // 1. Add text similarity pins first (these get top priority)
    textPinResults.forEach((pin: any) => {
      if (pin.similarity_score >= 0.5) { // Only include high similarity matches
        allPins.set(pin.pin_id, {
          pinId: pin.pin_id,
          pinName: pin.pin_name,
          contentId: pin.contentId,
          rawData: pin.rawData,
          similarity: parseFloat(pin.similarity_score.toFixed(3)),
          matchType: 'text_similarity'
        });
      }
    });
    
    // 2. Add semantic pins (lower priority, avoid duplicates)
    semanticPins.forEach((pin: any) => {
      if (!allPins.has(pin.pin_id)) { // Avoid duplicates - pin appears only once
        allPins.set(pin.pin_id, {
          pinId: pin.pin_id,
          pinName: pin.pin_name,
          contentId: pin.contentId,
          rawData: pin.rawData,
          similarity: parseFloat(pin.similarity_score.toFixed(3)),
          matchType: 'semantic'
        });
      }
    });
    
    // Convert to array and sort: text similarity first, then by score
    const sortedPins = Array.from(allPins.values())
      .sort((a, b) => {
        // Text similarity pins always come first
        if (a.matchType === 'text_similarity' && b.matchType !== 'text_similarity') return -1;
        if (b.matchType === 'text_similarity' && a.matchType !== 'text_similarity') return 1;
        
        // Within same type, sort by similarity score
        return b.similarity - a.similarity;
      })
      .slice(0, limit);
    
    // Format final response with all required fields
    const finalPins = sortedPins.map(pin => ({
      pinId: pin.pinId,
      pinName: pin.pinName,
      contentId: pin.contentId,
      rawData: pin.rawData,
      matchType: pin.matchType,
      similarity: pin.similarity
    }));
    
    console.log(`📊 Pin-based search completed in ${searchTime}ms:`, {
      textSimilarityPins: textPinResults.length,
      semanticContentMatches: semanticResults.length,
      semanticPins: semanticPins.length,
      totalPins: finalPins.length
    });

    res.status(200).json({
      success: true,
      query,
      tripId,
      searchTimeMs: searchTime,
      searchStats: {
        textSimilarityPins: textPinResults.filter(p => p.similarity_score >= 0.5).length,
        semanticContentMatches: semanticResults.length,
        semanticPins: semanticPins.length,
        totalPins: finalPins.length
      },
      pins: finalPins
    });
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid input data", details: error.errors });
    } else {
      console.error("Error performing pin-based search:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Pin-based search failed"
      });
    }
  }
});

export default router;