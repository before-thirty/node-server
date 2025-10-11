// poc-embeddings.ts - Simplified embedding service for POC

import { OpenAI } from "openai";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";


dotenv.config();

const openaiClient = new OpenAI({
  apiKey: process.env.OPEN_AI_API_KEY,
});

// Use POC Prisma client pointing to poc schema
const prismaPoc = new PrismaClient();
/**
 * Generate embedding for text using OpenAI
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    if (!text || text.trim() === '') {
      throw new Error('Text cannot be empty');
    }

    const response = await openaiClient.embeddings.create({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000), // Limit to stay within token limits
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw new Error('Failed to generate embedding');
  }
}

/**
 * Extract meaningful text from structured data
 */
function extractTextFromStructuredData(data: any): string {
  if (Array.isArray(data)) {
    return data.map(item => extractTextFromStructuredData(item)).join(' ');
  }
  
  if (typeof data === 'object' && data !== null) {
    const textFields = [];
    
    // Extract specific fields that are useful for search
    if (data.name) textFields.push(data.name);
    if (data.title) textFields.push(data.title);
    if (data.location) textFields.push(data.location);
    if (data.classification) textFields.push(data.classification);
    if (data.additional_info) textFields.push(data.additional_info);
    if (data.description) textFields.push(data.description);
    if (data.category) textFields.push(data.category);
    
    return textFields.join(' ');
  }
  
  return String(data);
}

/**
 * Generate embeddings for a single content item
 */
export async function generateContentEmbeddings(contentId: string): Promise<void> {
  try {
    console.log(`🔄 Processing content ${contentId}...`);
    
    // Fetch the content
    const content = await prismaPoc.content.findUnique({
      where: { id: contentId },
    });

    if (!content) {
      throw new Error(`Content with ID ${contentId} not found`);
    }

    const updates: any = {
      last_embedding_update: new Date(),
    };

    let embeddingCount = 0;

    // Generate embeddings for each field that has content
    if (content.title && content.title.trim() !== '') {
      console.log(`  📝 Generating title embedding...`);
      const titleEmbedding = await generateEmbedding(content.title);
      updates.title_embedding = `[${titleEmbedding.join(',')}]`;
      embeddingCount++;
    }

    if (content.rawData && content.rawData.trim() !== '') {
      console.log(`  📄 Generating raw data embedding...`);
      const rawDataEmbedding = await generateEmbedding(content.rawData);
      updates.raw_data_embedding = `[${rawDataEmbedding.join(',')}]`;
      embeddingCount++;
    }

    if (content.userNotes && content.userNotes.trim() !== '') {
      console.log(`  📝 Generating user notes embedding...`);
      const userNotesEmbedding = await generateEmbedding(content.userNotes);
      updates.user_notes_embedding = `[${userNotesEmbedding.join(',')}]`;
      embeddingCount++;
    }

    if (content.structuredData && content.structuredData.trim() !== '') {
      console.log(`  🏗️ Generating structured data embedding...`);
      let structuredText = content.structuredData;
      try {
        const parsed = JSON.parse(content.structuredData);
        structuredText = extractTextFromStructuredData(parsed);
      } catch {
        // If it's not JSON, use as is
      }
      
      if (structuredText && structuredText.trim() !== '') {
        const structuredEmbedding = await generateEmbedding(structuredText);
        updates.structured_data_embedding = `[${structuredEmbedding.join(',')}]`;
        embeddingCount++;
      }
    }

    if (embeddingCount === 0) {
      console.log(`  ⚠️ No content to embed for ${contentId}`);
      return;
    }

    // Update the database using separate queries for each field type
    // This avoids the casting issue with mixed data types
    
    if (updates.title_embedding) {
      await prismaPoc.$executeRawUnsafe(`
        UPDATE app_data."Content" 
        SET title_embedding = $1::vector
        WHERE id = $2
      `, updates.title_embedding, contentId);
    }
    
    if (updates.raw_data_embedding) {
      await prismaPoc.$executeRawUnsafe(`
        UPDATE app_data."Content" 
        SET raw_data_embedding = $1::vector
        WHERE id = $2
      `, updates.raw_data_embedding, contentId);
    }
    
    if (updates.user_notes_embedding) {
      await prismaPoc.$executeRawUnsafe(`
        UPDATE app_data."Content" 
        SET user_notes_embedding = $1::vector
        WHERE id = $2
      `, updates.user_notes_embedding, contentId);
    }
    
    if (updates.structured_data_embedding) {
      await prismaPoc.$executeRawUnsafe(`
        UPDATE app_data."Content" 
        SET structured_data_embedding = $1::vector
        WHERE id = $2
      `, updates.structured_data_embedding, contentId);
    }
    
    // Update the timestamp separately
    await prismaPoc.$executeRawUnsafe(`
      UPDATE app_data."Content" 
      SET last_embedding_update = $1
      WHERE id = $2
    `, updates.last_embedding_update, contentId);

    console.log(`  ✅ Generated ${embeddingCount} embeddings for content ${contentId}`);

  } catch (error) {
    console.error(`❌ Error processing content ${contentId}:`, error);
    throw error;
  }
}

export async function processAllContentAggressive(
  batchSize: number = 20,
  delayMs: number = 200, // Shorter delay
  maxConcurrentBatches: number = 5, // More concurrent batches
  maxConcurrentItems: number = 3 // Process items within batch in parallel too
): Promise<void> {
  console.log('🚀 Starting aggressive parallel batch processing...');
  
  const allContentResult = await prismaPoc.$queryRaw`
    SELECT id, title
    FROM app_data."Content"
    WHERE title_embedding IS NULL
    AND raw_data_embedding IS NULL
    AND user_notes_embedding IS NULL
    AND structured_data_embedding IS NULL
    ORDER BY "createdAt" DESC
  `;
  
  const allContent = allContentResult as Array<{id: string, title: string}>;
  console.log(`📊 Found ${allContent.length} content items to process`);
  
  if (allContent.length === 0) {
    console.log('✅ All content already has embeddings!');
    return;
  }

  const batches: Array<{id: string, title: string}>[] = [];
  for (let i = 0; i < allContent.length; i += batchSize) {
    batches.push(allContent.slice(i, i + batchSize));
  }

  let processedCount = 0;
  let successCount = 0;

  // Process batches in parallel chunks
  for (let i = 0; i < batches.length; i += maxConcurrentBatches) {
    const concurrentBatches = batches.slice(i, i + maxConcurrentBatches);
    
    console.log(`\n🔄 Processing batches ${i + 1}-${Math.min(i + maxConcurrentBatches, batches.length)} of ${batches.length}...`);

    const batchPromises = concurrentBatches.map(async (batch, localIndex) => {
      const globalBatchIndex = i + localIndex;
      let batchSuccessCount = 0;
      let batchFailedCount = 0;

      // Process items within batch in parallel too (more aggressive)
      for (let j = 0; j < batch.length; j += maxConcurrentItems) {
        const itemChunk = batch.slice(j, j + maxConcurrentItems);
        
        await Promise.all(
          itemChunk.map(async (content) => {
            try {
              await generateContentEmbeddings(content.id);
              batchSuccessCount++;
            } catch (error) {
              console.error(`❌ Batch ${globalBatchIndex + 1} - Failed to process content ${content.id}:`, error);
              batchFailedCount++;
            }
          })
        );
        
        // Small delay between item chunks within the same batch
        if (j + maxConcurrentItems < batch.length) {
          await new Promise(resolve => setTimeout(resolve, delayMs / 4));
        }
      }

      console.log(`✅ Batch ${globalBatchIndex + 1} completed: ${batchSuccessCount} successful, ${batchFailedCount} failed`);
      
      return {
        success: batchSuccessCount,
        failed: batchFailedCount
      };
    });

    const batchResults = await Promise.all(batchPromises);
    
    for (const result of batchResults) {
      successCount += result.success;
      processedCount += result.success + result.failed;
    }

    console.log(`📈 Progress: ${processedCount}/${allContent.length} (${successCount} successful)`);

    if (i + maxConcurrentBatches < batches.length) {
      console.log(`⏸️ Waiting ${delayMs}ms before next parallel batch chunk...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  console.log(`\n🎉 Aggressive parallel processing completed!`);
  console.log(`📊 Total processed: ${processedCount}`);
  console.log(`✅ Successful: ${successCount}`);
  console.log(`❌ Failed: ${processedCount - successCount}`);
}
/**
 * Batch process all content without embeddings
 */
export async function processAllContent(
  batchSize: number = 20,  // Increased for paid plans
  delayMs: number = 500    // Reduced delay for paid plans
): Promise<void> {
  console.log('🚀 Starting batch processing of all content...');
  
  // Get all content that needs embeddings using raw SQL
  const allContentResult = await prismaPoc.$queryRaw`
    SELECT id, title 
    FROM app_data."Content" 
    WHERE title_embedding IS NULL 
      AND raw_data_embedding IS NULL 
      AND user_notes_embedding IS NULL 
      AND structured_data_embedding IS NULL
    ORDER BY "createdAt" DESC
  `;

  const allContent = allContentResult as Array<{id: string, title: string}>;

  console.log(`📊 Found ${allContent.length} content items to process`);

  if (allContent.length === 0) {
    console.log('✅ All content already has embeddings!');
    return;
  }

  let processedCount = 0;
  let successCount = 0;

  // Process in batches
  for (let i = 0; i < allContent.length; i += batchSize) {
    const batch = allContent.slice(i, i + batchSize);
    
    console.log(`\n📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allContent.length / batchSize)}`);
    
    for (const content of batch) {
      try {
        await generateContentEmbeddings(content.id);
        successCount++;
      } catch (error) {
        console.error(`❌ Failed to process content ${content.id}:`, error);
      }
      processedCount++;
    }

    console.log(`📈 Progress: ${processedCount}/${allContent.length} (${successCount} successful)`);

    // Add delay between batches to avoid rate limiting
    if (i + batchSize < allContent.length) {
      console.log(`⏸️ Waiting ${delayMs}ms before next batch...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  console.log(`\n🎉 Batch processing completed!`);
  console.log(`📊 Total processed: ${processedCount}`);
  console.log(`✅ Successful: ${successCount}`);
  console.log(`❌ Failed: ${processedCount - successCount}`);
}

/**
 * Perform semantic search on POC data
 */
export async function pocSemanticSearch(
  query: string,
  userId?: string,
  tripId?: string,
  limit: number = 10
): Promise<any[]> {
  try {
    console.log(`🔍 Searching for: "${query}"`);
    
    // Generate embedding for the search query
    const queryEmbedding = await generateEmbedding(query);
    const embeddingVector = `[${queryEmbedding.join(',')}]`;

    // Build the WHERE clause
    let whereClause = '1=1'; // Start with always true
    const params: any[] = [];
    
    if (userId) {
      whereClause += ` AND "userId" = $${params.length + 1}`;
      params.push(userId);
    }
    
    if (tripId) {
      whereClause += ` AND "tripId" = $${params.length + 1}`;
      params.push(tripId);
    }

    // Perform semantic search using raw SQL
    const searchQuery = `
      SELECT 
        id, 
        title, 
        "rawData",
        "userNotes", 
        "structuredData",
        "tripId",
        "userId",
        "createdAt",
        thumbnail,
        pins_count,
        -- Calculate similarity scores for each field
        CASE 
          WHEN title_embedding IS NOT NULL 
          THEN 1 - (title_embedding <=> $${params.length + 1}::vector) 
          ELSE 0 
        END as title_similarity,
        CASE 
          WHEN raw_data_embedding IS NOT NULL 
          THEN 1 - (raw_data_embedding <=> $${params.length + 1}::vector) 
          ELSE 0 
        END as raw_data_similarity,
        CASE 
          WHEN user_notes_embedding IS NOT NULL 
          THEN 1 - (user_notes_embedding <=> $${params.length + 1}::vector) 
          ELSE 0 
        END as user_notes_similarity,
        CASE 
          WHEN structured_data_embedding IS NOT NULL 
          THEN 1 - (structured_data_embedding <=> $${params.length + 1}::vector) 
          ELSE 0 
        END as structured_data_similarity
      FROM app_data."Content" 
      WHERE ${whereClause}
        AND (
          title_embedding IS NOT NULL OR 
          raw_data_embedding IS NOT NULL OR 
          user_notes_embedding IS NOT NULL OR 
          structured_data_embedding IS NOT NULL
        )
      ORDER BY GREATEST(
        COALESCE(1 - (title_embedding <=> $${params.length + 1}::vector), 0),
        COALESCE(1 - (raw_data_embedding <=> $${params.length + 1}::vector), 0),
        COALESCE(1 - (user_notes_embedding <=> $${params.length + 1}::vector), 0),
        COALESCE(1 - (structured_data_embedding <=> $${params.length + 1}::vector), 0)
      ) DESC
      LIMIT $${params.length + 2}
    `;

    params.push(embeddingVector, limit);

    const results = await prismaPoc.$queryRawUnsafe(searchQuery, ...params);
    
    console.log(`📊 Found ${(results as any[]).length} results`);
    return results as any[];
    
  } catch (error) {
    console.error('❌ Error performing semantic search:', error);
    throw new Error('Semantic search failed');
  }
}

/**
 * Get stats about embeddings
 */
export async function getEmbeddingStats(): Promise<any> {
  const totalContent = await prismaPoc.content.count();
  
  // Since we can't use Prisma filters for vector columns, we'll use raw SQL
  const withTitleEmbedding = await prismaPoc.$queryRaw`
    SELECT COUNT(*) as count 
    FROM app_data."Content" 
    WHERE title_embedding IS NOT NULL
  `;
  
  const withRawDataEmbedding = await prismaPoc.$queryRaw`
    SELECT COUNT(*) as count 
    FROM app_data."Content" 
    WHERE raw_data_embedding IS NOT NULL
  `;
  
  const withUserNotesEmbedding = await prismaPoc.$queryRaw`
    SELECT COUNT(*) as count 
    FROM app_data."Content" 
    WHERE user_notes_embedding IS NOT NULL
  `;
  
  const withStructuredDataEmbedding = await prismaPoc.$queryRaw`
    SELECT COUNT(*) as count 
    FROM app_data."Content" 
    WHERE structured_data_embedding IS NOT NULL
  `;

  const withAnyEmbedding = await prismaPoc.$queryRaw`
    SELECT COUNT(*) as count 
    FROM app_data."Content" 
    WHERE title_embedding IS NOT NULL 
       OR raw_data_embedding IS NOT NULL 
       OR user_notes_embedding IS NOT NULL 
       OR structured_data_embedding IS NOT NULL
  `;

  return {
    totalContent,
    withAnyEmbedding: Number((withAnyEmbedding as any)[0]?.count || 0),
    withTitleEmbedding: Number((withTitleEmbedding as any)[0]?.count || 0),
    withRawDataEmbedding: Number((withRawDataEmbedding as any)[0]?.count || 0),
    withUserNotesEmbedding: Number((withUserNotesEmbedding as any)[0]?.count || 0),
    withStructuredDataEmbedding: Number((withStructuredDataEmbedding as any)[0]?.count || 0),
    percentageComplete: ((Number((withAnyEmbedding as any)[0]?.count || 0) / totalContent) * 100).toFixed(1)
  };
}

/**
 * Get all pins from semantic search results
 * @param semanticResults - Results from semantic search on content
 * @param query - Search query for logging
 * @returns Array of pins with semantic scores
 */
export async function getPinsFromSemanticResults(
  semanticResults: any[],
  query: string
): Promise<any[]> {
  try {
    if (!semanticResults || semanticResults.length === 0) {
      return [];
    }

    console.log(`📍 Getting pins from ${semanticResults.length} semantic content matches`);
    
    // Get all pins for the matching content IDs
    const contentIds = semanticResults.map(result => result.id);
    
    const pinsQuery = `
      SELECT 
        p.id as pin_id,
        p."contentId",
        p.name as pin_name,
        c."rawData",
        c.title as content_title,
        0.3 as base_score,
        'semantic' as match_type
      FROM app_data."Pin" p
      INNER JOIN app_data."Content" c ON p."contentId" = c.id
      WHERE p."contentId" = ANY($1)
      ORDER BY p."createdAt" DESC
    `;

    const pins = await prismaPoc.$queryRawUnsafe(pinsQuery, contentIds);
    
    // Enhance pins with semantic scores from their parent content
    const enhancedPins = (pins as any[]).map(pin => {
      const parentContent = semanticResults.find(content => content.id === pin.contentId);
      const semanticScore = parentContent ? Math.max(
        parentContent.title_similarity || 0,
        parentContent.raw_data_similarity || 0,
        parentContent.user_notes_similarity || 0,
        parentContent.structured_data_similarity || 0
      ) : 0.3;
      
      return {
        ...pin,
        similarity_score: Math.max(0.3, semanticScore), // Ensure minimum semantic score
        match_type: 'semantic'
      };
    });

    console.log(`📍 Found ${enhancedPins.length} pins from semantic results`);
    return enhancedPins;
    
  } catch (error) {
    console.error('❌ Error getting pins from semantic results:', error);
    return [];
  }
}

/**
 * Text-based search for Pin names using PostgreSQL trigram similarity and ILIKE
 * @param query - Search query (e.g., "Pizza Hut", "McDonald's")
 * @param userId - Optional user ID filter
 * @param tripId - Optional trip ID filter
 * @param limit - Maximum results to return (default 10)
 * @returns Array of matching pins with similarity scores
 */
export async function searchPinNames(
  query: string,
  userId?: string,
  tripId?: string,
  limit: number = 10
): Promise<any[]> {
  try {
    console.log(`🔍 Text search for pin names: "${query}"`);
    
    if (!query || query.trim() === '') {
      return [];
    }

    // Build the WHERE clause for content filtering
    let contentWhereClause = '1=1';
    const params: any[] = [];
    
    if (userId) {
      contentWhereClause += ` AND c."userId" = $${params.length + 1}`;
      params.push(userId);
    }
    
    if (tripId) {
      contentWhereClause += ` AND c."tripId" = $${params.length + 1}`;
      params.push(tripId);
    }

    // Add query parameter
    params.push(query.trim());
    params.push(`%${query.trim()}%`); // For ILIKE
    params.push(limit);

    // Search using both trigram similarity and ILIKE for comprehensive matching
    const searchQuery = `
      WITH pin_matches AS (
        SELECT 
          p.id as pin_id,
          p.name as pin_name,
          p."contentId",
          c.title,
          c.thumbnail,
          c."tripId",
          c."userId",
          c."createdAt",
          c."rawData",
          -- Calculate trigram similarity (requires pg_trgm extension)
          CASE 
            WHEN public.similarity(p.name, $${params.length - 2}) > 0.3 
            THEN public.similarity(p.name, $${params.length - 2})
            ELSE 0
          END as trigram_similarity,
          -- ILIKE match gets high score
          CASE 
            WHEN p.name ILIKE $${params.length - 1}
            THEN 0.95
            ELSE 0
          END as ilike_score
        FROM app_data."Pin" p
        INNER JOIN app_data."Content" c ON p."contentId" = c.id
        WHERE ${contentWhereClause}
          AND (
            p.name ILIKE $${params.length - 1}
            OR public.similarity(p.name, $${params.length - 2}) > 0.3
          )
      )
      SELECT 
        pin_id,
        pin_name,
        "contentId",
        title,
        thumbnail,
        "tripId", 
        "userId",
        "createdAt",
        "rawData",
        GREATEST(trigram_similarity, ilike_score) as similarity_score,
        'pin_name' as match_type
      FROM pin_matches
      WHERE GREATEST(trigram_similarity, ilike_score) > 0
      ORDER BY similarity_score DESC, "createdAt" DESC
      LIMIT $${params.length}
    `;

    console.log('🔍 Executing pin name search query:', {
      query: query.trim(),
      userId,
      tripId,
      limit
    });

    const results = await prismaPoc.$queryRawUnsafe(searchQuery, ...params);
    
    console.log(`📊 Found ${(results as any[]).length} pin name matches`);
    return results as any[];
    
  } catch (error) {
    console.error('❌ Error performing pin name search:', error);
    // Fallback to simple ILIKE search if trigram extension is not available
    return await fallbackPinNameSearch(query, userId, tripId, limit);
  }
}

/**
 * Fallback pin name search using only ILIKE (no trigram extension required)
 */
async function fallbackPinNameSearch(
  query: string,
  userId?: string,
  tripId?: string,
  limit: number = 10
): Promise<any[]> {
  try {
    console.log(`🔄 Fallback pin name search: "${query}"`);

    let contentWhereClause = '1=1';
    const params: any[] = [];
    
    if (userId) {
      contentWhereClause += ` AND c."userId" = $${params.length + 1}`;
      params.push(userId);
    }
    
    if (tripId) {
      contentWhereClause += ` AND c."tripId" = $${params.length + 1}`;
      params.push(tripId);
    }

    params.push(`%${query.trim()}%`);
    params.push(limit);

    const fallbackQuery = `
      SELECT 
        p.id as pin_id,
        p.name as pin_name,
        p."contentId",
        c.title,
        c.thumbnail,
        c."tripId",
        c."userId", 
        c."createdAt",
        c."rawData",
        0.8 as similarity_score,
        'pin_name_fallback' as match_type
      FROM app_data."Pin" p
      INNER JOIN app_data."Content" c ON p."contentId" = c.id
      WHERE ${contentWhereClause}
        AND p.name ILIKE $${params.length - 1}
      ORDER BY 
        CASE 
          WHEN LOWER(p.name) = LOWER($${params.length - 1}) THEN 1
          WHEN LOWER(p.name) LIKE LOWER($${params.length - 1}) THEN 2
          ELSE 3
        END,
        c."createdAt" DESC
      LIMIT $${params.length}
    `;

    const results = await prismaPoc.$queryRawUnsafe(fallbackQuery, ...params);
    console.log(`📊 Fallback search found ${(results as any[]).length} results`);
    return results as any[];
    
  } catch (error) {
    console.error('❌ Error in fallback pin name search:', error);
    return [];
  }
}