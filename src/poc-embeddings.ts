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