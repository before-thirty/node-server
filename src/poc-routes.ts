// poc-routes.ts - Simplified POC endpoints
import express, { Request, Response } from "express";
import { z } from "zod";
import {
  processAllContent,
  generateContentEmbeddings,
  pocSemanticSearch,
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
    processAllContent(20, 500)
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

// 3. Semantic search within a trip
router.post("/poc/search", async (req: Request, res: Response) => {
  try {
    const { query, tripId, limit } = SearchSchema.parse(req.body);
    
    console.log(`🔍 Searching in trip ${tripId}: "${query}"`);
    const startTime = Date.now();
    
    const results = await pocSemanticSearch(query, undefined, tripId, limit);
    const searchTime = Date.now() - startTime;

    // Format results as contents array
    const contents = results.map((result: any) => {
      const maxScore = Math.max(
        result.title_similarity || 0,
        result.raw_data_similarity || 0,
        result.user_notes_similarity || 0,
        result.structured_data_similarity || 0
      );

      return {
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
        matchedFields: {
          title: result.title_similarity > 0.1 ? parseFloat(result.title_similarity.toFixed(3)) : null,
          rawData: result.raw_data_similarity > 0.1 ? parseFloat(result.raw_data_similarity.toFixed(3)) : null,
          userNotes: result.user_notes_similarity > 0.1 ? parseFloat(result.user_notes_similarity.toFixed(3)) : null,
          structuredData: result.structured_data_similarity > 0.1 ? parseFloat(result.structured_data_similarity.toFixed(3)) : null,
        }
      };
    });

    res.status(200).json({
      success: true,
      query,
      tripId,
      searchTimeMs: searchTime,
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

export default router;