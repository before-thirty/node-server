// Remove node-cron import - no longer needed
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

// Your Google Maps API configuration
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GOOGLE_MAPS_IMAGE_API = "https://places.googleapis.com/v1";

interface PhotoRefreshResult {
  placeCacheId: string;
  placeId: string;
  success: boolean;
  newImages?: string[];
  error?: string;
}

/**
 * Fetch fresh photo URLs for a specific place using Google Places API
 */
async function fetchFreshPhotoUrls(placeId: string): Promise<string[]> {
  try {
    // First, get place details to get fresh photo names
    const url = `https://places.googleapis.com/v1/places/${placeId}`;
    const config = {
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": "photos",
      },
    };

    const response = await axios.get(url, config);
    const place = response.data;
    
    if (!place.photos || place.photos.length === 0) {
      console.log(`No photos found for place ${placeId}`);
      return [];
    }

    const photos = place.photos;
    const photoUrls: string[] = [];

    // Fetch fresh URL for the first photo only
    for (const photo of photos) {
      if (photo.name) {
        try {
          const imageUrl = `${GOOGLE_MAPS_IMAGE_API}/${photo.name}/media?maxWidthPx=800&skipHttpRedirect=true&key=${GOOGLE_MAPS_API_KEY}`;
          const imageResponse = await axios.get(imageUrl);
          
          if (imageResponse.status === 200 && imageResponse.data.photoUri) {
            photoUrls.push(imageResponse.data.photoUri);
            break; // Only get the first image, then stop
          }
        } catch (photoError) {
          console.error(`Failed to fetch photo URL for ${photo.name}:`, photoError);
          // Continue to try the next photo if this one fails
        }
      }
    }

    return photoUrls;
  } catch (error) {
    console.error(`Error fetching fresh photos for place ${placeId}:`, error);
    throw error;
  }
}

/**
 * Refresh image URLs for places that are 25 days old
 * This function will be called by the App Engine cron HTTP endpoint
 */
export async function refreshExpiredImageUrls(): Promise<void> {
  console.log('Starting image URL refresh job...');
  
  try {
    // Calculate the date 25 days ago
    const twentyFiveDaysAgo = new Date();
    twentyFiveDaysAgo.setDate(twentyFiveDaysAgo.getDate() - 30);
    
    console.log(`🗓️ Looking for places last cached before: ${twentyFiveDaysAgo.toISOString()}`);

    // Find places that were last cached 25+ days ago
    const placesToRefresh = await prisma.placeCache.findMany({
      where: {
        lastCached: {
          lt: twentyFiveDaysAgo, // Less than 25 days ago (older than 25 days)
        },
        // Only refresh places that have images
        images: {
          isEmpty: false,
        },
      },
      select: {
        id: true,
        placeId: true,
        name: true,
        images: true,
        lastCached: true,
        createdAt: true,
      },
    });

    console.log(`Found ${placesToRefresh.length} places to refresh`);
    
    if (placesToRefresh.length > 0) {
      console.log('\n📋 Places found for refresh:');
      placesToRefresh.forEach((place, index) => {
        const daysSinceLastCached = Math.floor((Date.now() - place.lastCached.getTime()) / (1000 * 60 * 60 * 24));
        console.log(`${index + 1}. ${place.name} (ID: ${place.placeId})`);
        console.log(`   Last cached: ${place.lastCached.toISOString()} (${daysSinceLastCached} days ago)`);
        console.log(`   Current images count: ${place.images.length}`);
        console.log(`   Current image: ${place.images.length > 0 ? place.images[0] : 'None'}`);
        console.log('');
      });
    }

    if (placesToRefresh.length === 0) {
      console.log('No places found that need image URL refresh');
      return;
    }

    const results: PhotoRefreshResult[] = [];

    // Process each place
    for (const place of placesToRefresh) {
      try {
        const daysSinceLastCached = Math.floor((Date.now() - place.lastCached.getTime()) / (1000 * 60 * 60 * 24));
        console.log(`\n🔄 Refreshing images for place: ${place.name} (ID: ${place.placeId})`);
        console.log(`📅 Last cached: ${place.lastCached.toISOString()} (${daysSinceLastCached} days ago)`);
        console.log(`🖼️ Current image: ${place.images.length > 0 ? place.images[0] : 'None'}`);
        
        const freshImageUrls = await fetchFreshPhotoUrls(place.placeId);
        
        if (freshImageUrls.length > 0) {
          console.log(`🆕 Fresh image fetched: ${freshImageUrls[0]}`);

          // Always store as array with single image [urls[0]]
          await prisma.placeCache.update({
            where: { id: place.id },
            data: {
              images: [freshImageUrls[0]], // Always store the first URL as [urls[0]]
              lastCached: new Date(),
            },
          });

          results.push({
            placeCacheId: place.id,
            placeId: place.placeId,
            success: true,
            newImages: [freshImageUrls[0]],
          });

          console.log(`✅ Successfully refreshed image for ${place.name}`);
        } else {
          results.push({
            placeCacheId: place.id,
            placeId: place.placeId,
            success: false,
            error: 'No photos available',
          });

          console.log(`⚠️ No photos available for ${place.name}`);
        }

        // Add a small delay to avoid hitting rate limits
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        results.push({
          placeCacheId: place.id,
          placeId: place.placeId,
          success: false,
          error: errorMessage,
        });

        console.error(`❌ Failed to refresh images for ${place.name}:`, errorMessage);
      }
    }

    // Summary
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(`\n📊 Image URL refresh completed:`);
    console.log(`✅ Successfully refreshed: ${successful} places`);
    console.log(`❌ Failed to refresh: ${failed} places`);
    
    if (failed > 0) {
      console.log('\n❌ Failed places:');
      results
        .filter(r => !r.success)
        .forEach(r => console.log(`  - ${r.placeId}: ${r.error}`));
    }

  } catch (error) {
    console.error('Error in refreshExpiredImageUrls:', error);
    throw error;
  } finally {
    // Close Prisma connection
    await prisma.$disconnect();
  }
}


/**
 * Manual execution function for testing
 */
export async function runImageRefreshManually(): Promise<void> {
  console.log('🔧 Running image URL refresh manually...');
  await refreshExpiredImageUrls();
}

/**
 * Debug version - refresh places older than specified days (for testing)
 */
export async function runImageRefreshDebug(daysAgo: number = 1): Promise<void> {
  console.log(`🔧 Running DEBUG image URL refresh for places older than ${daysAgo} days...`);
  
  try {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - daysAgo);
    
    console.log(`🗓️ Looking for places last cached before: ${targetDate.toISOString()}`);

    const placesToRefresh = await prisma.placeCache.findMany({
      where: {
        lastCached: {
          lt: targetDate,
        },
        images: {
          isEmpty: false,
        },
      },
      select: {
        id: true,
        placeId: true,
        name: true,
        images: true,
        lastCached: true,
        createdAt: true,
      },
    });

    console.log(`Found ${placesToRefresh.length} places to refresh`);
    
    if (placesToRefresh.length === 0) {
      console.log('No places found that need image URL refresh');
      
      // Show some recent places for debugging
      const recentPlaces = await prisma.placeCache.findMany({
        where: {
          images: {
            isEmpty: false,
          },
        },
        select: {
          id: true,
          placeId: true,
          name: true,
          images: true,
          lastCached: true,
          createdAt: true,
        },
        orderBy: {
          lastCached: 'desc',
        },
        take: 5,
      });
      
      console.log(`\n🔍 Recent 5 places with images for reference:`);
      recentPlaces.forEach((place, index) => {
        const daysSinceLastCached = Math.floor((Date.now() - place.lastCached.getTime()) / (1000 * 60 * 60 * 24));
        console.log(`${index + 1}. ${place.name}`);
        console.log(`   Last cached: ${place.lastCached.toISOString()} (${daysSinceLastCached} days ago)`);
        console.log(`   Images: ${place.images.length}`);
      });
      
      return;
    }

    // Continue with the same processing logic...
    const results: PhotoRefreshResult[] = [];

    for (const place of placesToRefresh) {
      try {
        const daysSinceLastCached = Math.floor((Date.now() - place.lastCached.getTime()) / (1000 * 60 * 60 * 24));
        console.log(`\n🔄 Refreshing images for place: ${place.name} (ID: ${place.placeId})`);
        console.log(`📅 Last cached: ${place.lastCached.toISOString()} (${daysSinceLastCached} days ago)`);
        console.log(`🖼️ Current image: ${place.images.length > 0 ? place.images[0] : 'None'}`);
        
        const freshImageUrls = await fetchFreshPhotoUrls(place.placeId);
        
        if (freshImageUrls.length > 0) {
          console.log(`🆕 Fresh image fetched: ${freshImageUrls[0]}`);

          await prisma.placeCache.update({
            where: { id: place.id },
            data: {
              images: [freshImageUrls[0]], // Store only the first image
              lastCached: new Date(),
            },
          });

          results.push({
            placeCacheId: place.id,
            placeId: place.placeId,
            success: true,
            newImages: [freshImageUrls[0]],
          });

          console.log(`✅ Successfully refreshed image for ${place.name}`);
        } else {
          results.push({
            placeCacheId: place.id,
            placeId: place.placeId,
            success: false,
            error: 'No photos available',
          });

          console.log(`⚠️ No photos available for ${place.name}`);
        }

        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        results.push({
          placeCacheId: place.id,
          placeId: place.placeId,
          success: false,
          error: errorMessage,
        });

        console.error(`❌ Failed to refresh images for ${place.name}:`, errorMessage);
      }
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(`\n📊 DEBUG Image URL refresh completed:`);
    console.log(`✅ Successfully refreshed: ${successful} places`);
    console.log(`❌ Failed to refresh: ${failed} places`);

  } catch (error) {
    console.error('Error in debug refresh:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// If running this file directly, execute manually
if (require.main === module) {
  // Check if debug mode is requested
  const args = process.argv.slice(2);
  const debugMode = args.includes('--debug');
  const daysArg = args.find(arg => arg.startsWith('--days='));
  const days = daysArg ? parseInt(daysArg.split('=')[1]) : 1;

  if (debugMode) {
    runImageRefreshDebug(days)
      .then(() => {
        console.log('Debug refresh completed');
        process.exit(0);
      })
      .catch((error) => {
        console.error('Debug refresh failed:', error);
        process.exit(1);
      });
  } else {
    runImageRefreshManually()
      .then(() => {
        console.log('Manual refresh completed');
        process.exit(0);
      })
      .catch((error) => {
        console.error('Manual refresh failed:', error);
        process.exit(1);
      });
  }
}