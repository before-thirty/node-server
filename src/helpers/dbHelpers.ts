import { PrismaClient } from "@prisma/client";

import { v4 as uuidv4 } from "uuid";

const prisma = new PrismaClient();

// Create a new Content entry
export const createContent = async (
  url: string,
  description: string,
  userId: string,
  tripId: string,
  userNotes?: string,
  contentThumbnail?: string
) => {
  return await prisma.content.create({
    data: {
      url: url,
      rawData: description,
      structuredData: "",
      userId: userId,
      tripId: tripId,
      userNotes: userNotes,
      thumbnail: contentThumbnail,
    },
  });
};
// Update an existing Content entry with structured data
export const updateContent = async (
  contentId: string,
  structuredData: any,
  title?: string,
  pinsCount?: number
) => {
  return await prisma.content.update({
    where: { id: contentId },
    data: {
      structuredData:
        typeof structuredData === "string"
          ? structuredData
          : JSON.stringify(structuredData),
      ...(title !== undefined && { title }),
      ...(pinsCount !== undefined && { pins_count: pinsCount }),
    },
  });
};

// Append new content data to existing Content entry (for update-content API)
export const appendToContent = async (
  contentId: string,
  newContent: string,
  newStructuredData: any,
  actualPinsCount: number,
  newTitle?: string
) => {
  // First get the existing content
  const existingContent = await prisma.content.findUnique({
    where: { id: contentId },
    select: {
      rawData: true,
      structuredData: true,
      title: true,
      pins_count: true,
    },
  });

  if (!existingContent) {
    throw new Error("Content not found");
  }

  // Parse existing structured data
  let existingStructuredArray = [];
  try {
    existingStructuredArray = JSON.parse(existingContent.structuredData || "[]");
  } catch (error) {
    console.log("Failed to parse existing structured data, treating as empty array");
    existingStructuredArray = [];
  }

  // Ensure both old and new structured data are arrays
  const newStructuredArray = Array.isArray(newStructuredData) 
    ? newStructuredData 
    : (newStructuredData ? [newStructuredData] : []);

  // Combine the structured data arrays
  const combinedStructuredData = [...existingStructuredArray, ...newStructuredArray];

  // Append raw content with a separator
  const combinedRawData = existingContent.rawData + "\n\n--- APPENDED CONTENT ---\n\n" + newContent;

  // Use the new title if provided, otherwise keep existing
  const finalTitle = newTitle;

  // Calculate new pins count from combined structured data
  const newPinsCount = actualPinsCount + existingContent.pins_count

  return await prisma.content.update({
    where: { id: contentId },
    data: {
      rawData: combinedRawData,
      structuredData: JSON.stringify(combinedStructuredData),
      title: finalTitle,
      pins_count: newPinsCount,
      status: "COMPLETED"
    },
  });
};

export const appendPinCount = async (
  contentId: string,
  pinCount: number
) => {
  return await prisma.content.update({
    where: { id: contentId },
    data: {
      pins_count: pinCount
    },
  });
}

// Function to get the PlaceCache by placeId
export const getPlaceCacheById = async (placeId: string) => {
  return await prisma.placeCache.findUnique({
    where: { placeId: placeId },
  });
};

// Function to create a new PlaceCache entry with full details
export const createPlaceCache = async (placeDetails: {
  placeId: string;
  name: string;
  rating: number | null;
  userRatingCount: number | null;
  websiteUri: string | null;
  currentOpeningHours: any | null;
  regularOpeningHours: any | null;
  lat: number;
  lng: number;
  images: string[];
  utcOffsetMinutes: number | null;
}) => {
  return await prisma.placeCache.create({
    data: {
      placeId: placeDetails.placeId,
      name: placeDetails.name,
      rating: placeDetails.rating,
      userRatingCount: placeDetails.userRatingCount,
      websiteUri: placeDetails.websiteUri,
      currentOpeningHours: placeDetails.currentOpeningHours,
      regularOpeningHours: placeDetails.regularOpeningHours,
      lat: placeDetails.lat,
      lng: placeDetails.lng,
      lastCached: new Date(),
      images: placeDetails.images,
      utcOffsetMinutes: placeDetails.utcOffsetMinutes,
    },
  });
};

// Create a new Pin linked to the Content and PlaceCache
export const createPin = async (pinDetails: {
  name: string;
  category: string;
  contentId: string;
  placeCacheId: string;
  description: string;
  coordinates: { lat: number; lng: number };
}) => {
  return await prisma.pin.create({
    data: {
      name: pinDetails.name ?? "Unnamed Pin",
      category: pinDetails.category ?? "Uncategorized",
      contentId: pinDetails.contentId,
      placeCacheId: pinDetails.placeCacheId,
      description: pinDetails.description ?? "N/A",
    },
  });
};

// dbHelpers.ts
// dbHelpers.ts
export const getTripsByUserId = async (userId: string) => {
  try {
    // Fetch all the trips associated with the user through the TripUser model
    const tripUsers = await prisma.tripUser.findMany({
      where: { userId: userId }, // Filter by userId
      select: {
        trip: {
          select: {
            id: true,
            name: true,
            startDate: true,
            endDate: true,
            description: true,
          },
        },
      },
    });

    // Extract the trip details from the tripUser relation
    const trips = tripUsers.map((tripUser) => tripUser.trip);

    return trips;
  } catch (error) {
    console.error(`Error fetching trips for user ${userId}:`, error);
    throw new Error("Error fetching trips");
  }
};

export const getPublicTrips = async () => {
  const publicTrips = await prisma.trip.findMany({
    where: { isPublic: true },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      description: true,
      coverImage: true,
      likes: true,
      viewCount: true,
    },
  });
  return publicTrips;
};

export interface UserModel {
  id: string;
  name: string;
  email: string;
  phoneNumber: string;
  firebaseId: string;
  lastOpened?: Date | null;
}

export const getUserByFirebaseId = async (
  firebaseId: string
): Promise<UserModel | null> => {
  return await prisma.user.findFirst({
    // TODO: change to findUnique once firebaseId is unique
    where: { firebaseId },
    select: {
      id: true,
      name: true,
      email: true,
      phoneNumber: true,
      firebaseId: true,
      lastOpened: true,
    },
  });
};

export const getUserById = async (userId: string): Promise<UserModel | null> => {
  return await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      phoneNumber: true,
      firebaseId: true,
      lastOpened: true,
    },
  });
};

export const createTripAndTripUser = async (
  userId: string,
  name: string,
  startDate: Date,
  endDate: Date,
  description: string
) => {
  return await prisma.$transaction(async (tx) => {
    const trip = await tx.trip.create({
      data: {
        name,
        startDate,
        endDate,
        description,
      },
    });

    await tx.tripUser.create({
      data: {
        role: "owner",
        userId: userId,
        tripId: trip.id,
      },
    });

    return trip;
  });
};

export const createTrip = async (
  name: string,
  startDate: Date,
  endDate: Date,
  description: string
) => {
  return await prisma.trip.create({
    data: {
      name: name ?? "Untitled",
      startDate: startDate ?? "NA",
      endDate: endDate ?? "NA",
      description: description,
    },
  });
};

export const createUser = async (
  name: string,
  email: string,
  phoneNumber: string,
  firebaseId: string
) => {
  return await prisma.user.create({
    data: {
      firebaseId: firebaseId,
      name: name,
      email: email,
      phoneNumber: phoneNumber,
    },
  });
};

export const createUserTrip = async (
  role: string,
  userId: string,
  tripId: string
) => {
  return await prisma.tripUser.create({
    data: {
      role: role ?? "Member",
      userId: userId,
      tripId: tripId,
    },
  });
};

export const getTripById = async (tripId: string) => {
  return await prisma.trip.findUnique({
    where: { id: tripId },
    // Optionally, select or include additional fields/relations
  });
};


export const addUserToTrip = async (
  tripId: string,
  userId: string,
  role: string = "member"
): Promise<any> => {
  try {
    // Check if the user is already in the trip
    const existingTripUser = await prisma.tripUser.findUnique({
      where: {
        tripId_userId: {
          tripId,
          userId,
        },
      },
    });

    if (existingTripUser) {
      return existingTripUser;
    }

    const tripUser = await prisma.tripUser.create({
      data: {
        tripId,
        userId,
        role,
      },
    });

    return tripUser;
  } catch (error) {
    console.error("Error adding user to trip:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
};


export const addMessage = async (
  tripId: string,
  userId: string,
  message: string,
  timestamp: Date,
  type: string
) => {
  const newMessage = await prisma.chatMessage.create({
    data: {
      id: crypto.randomUUID(),
      tripId: tripId,
      userId: userId,
      text: message,
      createdAt: timestamp,
      type: type,
    },
  });
  return newMessage;
};

export const getMessageById = async (tripId: string, messageId: string) => {
  const response = await prisma.chatMessage.findUnique({
    where: { id: messageId as string },
    select: { createdAt: true },
  });
  return response;
};



export const getUsername = async (userId: any) => {
  const user = await prisma.user.findUnique({
    where: { id: userId as string },
    select: { name: true },
  });
  return user;
};



// === Share Token Helper Functions ===

// Function to generate a unique token
export const generateUniqueToken = (): string => {
  return uuidv4().replace(/-/g, "");
};

// Function to create a share token in the database
export const createShareToken = async (
  token: string,
  tripId: string,
  userId: string
): Promise<any> => {
  try {
    // Set expiration to 7 days from now
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const shareToken = await prisma.shareToken.create({
      data: {
        token,
        tripId,
        createdBy: userId,
        expiresAt,
      },
    });

    return shareToken;
  } catch (error) {
    console.error("Error creating share token:", error);
    throw error;
  }
};

// Function to get share token details by token
export const getShareTokenDetails = async (token: string): Promise<any> => {
  try {
    const shareToken = await prisma.shareToken.findUnique({
      where: {
        token,
      },
      include: {
        trip: true,
      },
    });

    return shareToken;
  } catch (error) {
    console.error("Error fetching share token:", error);
    throw error;
  }
};

// Function to check if a user is a member of a trip
export const isUserInTrip = async (
  userId: string,
  tripId: string
): Promise<boolean> => {
  try {
    // First check if the trip is public
    const trip = await prisma.trip.findUnique({
      where: {
        id: tripId,
      },
      select: {
        isPublic: true,
      },
    });

    // If trip doesn't exist, return false
    if (!trip) {
      return false;
    }

    // If trip is public, always return true
    if (trip.isPublic) {
      return true;
    }

    // If trip is not public, check if user is a member
    const tripUser = await prisma.tripUser.findUnique({
      where: {
        tripId_userId: {
          tripId,
          userId,
        },
      },
    });

    return !!tripUser;
  } catch (error) {
    console.error("Error checking if user is in trip:", error);
    throw error;
  }
};

// Function to get the number of members in a trip
export const getTripMemberCount = async (tripId: string): Promise<number> => {
  try {
    const count = await prisma.tripUser.count({
      where: { tripId },
    });

    return count;
  } catch (error) {
    console.error("Error getting trip member count:", error);
    throw error;
  }
};

// Helper function to mark a place as must-do for a user in a trip
export const markPlaceAsMustDo = async (
  userId: string,
  placeCacheId: string,
  tripId: string
): Promise<{ alreadyMarked: boolean; entry: any }> => {
  try {
    // Check if already marked as must-do
    const existingEntry = await prisma.userPlaceMustDo.findUnique({
      where: {
        userId_placeCacheId_tripId: {
          userId,
          placeCacheId,
          tripId,
        },
      },
      include: {
        placeCache: true,
        trip: true,
      },
    });

    if (existingEntry) {
      return { alreadyMarked: true, entry: existingEntry };
    }

    // Create new must-do entry
    const mustDoEntry = await prisma.userPlaceMustDo.create({
      data: {
        userId,
        placeCacheId,
        tripId,
      },
      include: {
        placeCache: true,
        trip: true,
      },
    });

    return { alreadyMarked: false, entry: mustDoEntry };
  } catch (error) {
    console.error("Error marking place as must-do:", error);
    throw error;
  }
};

// Helper function to unmark a place as must-do for a user in a trip
export const unmarkPlaceAsMustDo = async (
  userId: string,
  placeCacheId: string,
  tripId: string
): Promise<boolean> => {
  try {
    const deletedEntry = await prisma.userPlaceMustDo.delete({
      where: {
        userId_placeCacheId_tripId: {
          userId,
          placeCacheId,
          tripId,
        },
      },
    });
    return !!deletedEntry;
  } catch (error) {
    if ((error as any).code === "P2025") {
      // Record not found - it wasn't marked as must-do
      return false;
    }
    console.error("Error unmarking place as must-do:", error);
    throw error;
  }
};

// === Content Management Helper Functions ===

// Helper function to update user notes
export const updateUserNotes = async (
  contentId: string,
  userNotes: string
): Promise<any> => {
  try {
    const updatedContent = await prisma.content.update({
      where: { id: contentId },
      data: { userNotes },
    });
    return updatedContent;
  } catch (error) {
    console.error("Error updating user notes:", error);
    throw error;
  }
};

// Helper function to delete a pin
export const deletePin = async (pinId: string): Promise<void> => {
  try {
    // Get the pin to know which content it belongs to
    const pin = await prisma.pin.findUnique({
      where: { id: pinId },
      select: { contentId: true },
    });

    if (!pin) {
      throw new Error("Pin not found");
    }

    // Delete the pin
    await prisma.pin.delete({
      where: { id: pinId },
    });

    // Update the pins count in the associated content
    const remainingPinsCount = await prisma.pin.count({
      where: { contentId: pin.contentId },
    });

    await prisma.content.update({
      where: { id: pin.contentId },
      data: { pins_count: remainingPinsCount },
    });
  } catch (error) {
    console.error("Error deleting pin:", error);
    throw error;
  }
};

// Helper function to find existing content by URL (excluding current content ID)
export const findExistingContentByUrl = async (url: string, excludeContentId: string) => {
  return await prisma.content.findFirst({
    where: { 
      url: url,
      id: { not: excludeContentId }
    },
    select: {
      id: true,
      rawData: true,
      createdAt: true,
      userId: true,
      tripId: true,
    },
  });
};

// === Verification Helper Functions ===

// Helper function to verify if a place exists
export const verifyPlaceExists = async (
  placeCacheId: string
): Promise<boolean> => {
  try {
    const place = await prisma.placeCache.findUnique({
      where: { id: placeCacheId },
    });
    return !!place;
  } catch (error) {
    console.error("Error verifying place exists:", error);
    throw error;
  }
};

// Helper function to verify if a trip exists
export const verifyTripExists = async (tripId: string): Promise<boolean> => {
  try {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
    });
    return !!trip;
  } catch (error) {
    console.error("Error verifying trip exists:", error);
    throw error;
  }
};

// Helper function to verify user has access to content
export const verifyContentAccess = async (
  contentId: string,
  userId: string
): Promise<boolean> => {
  try {
    const content = await prisma.content.findUnique({
      where: { id: contentId },
      include: {
        trip: {
          include: {
            tripUsers: {
              where: { userId: userId },
            },
          },
        },
      },
    });

    if (!content) {
      return false;
    }

    // Check if user has access to this content through trip membership
    return content.trip.tripUsers.length > 0;
  } catch (error) {
    console.error("Error verifying content access:", error);
    throw error;
  }
};

// Helper function to verify user has access to pin
export const verifyPinAccess = async (
  pinId: string,
  userId: string
): Promise<boolean> => {
  try {
    const pin = await prisma.pin.findUnique({
      where: { id: pinId },
      include: {
        content: {
          include: {
            trip: {
              include: {
                tripUsers: {
                  where: { userId: userId },
                },
              },
            },
          },
        },
      },
    });

    if (!pin) {
      return false;
    }

    // Check if user has access to this pin through trip membership
    return pin.content.trip.tripUsers.length > 0;
  } catch (error) {
    console.error("Error verifying pin access:", error);
    throw error;
  }
};

// =============================================================================
// HELPER FUNCTIONS FOR USER BLOCKING
// =============================================================================

// Get list of user IDs that the current user has blocked
export const getBlockedUserIds = async (currentUserId: string): Promise<string[]> => {
  const blockedUsers = await prisma.userBlock.findMany({
    where: {
      blockingUserId: currentUserId
    },
    select: {
      blockedUserId: true
    }
  });
  
  return blockedUsers.map(block => block.blockedUserId);
};

// Check if a user is blocked by the current user
export const isUserBlocked = async (currentUserId: string, targetUserId: string): Promise<boolean> => {
  const block = await prisma.userBlock.findUnique({
    where: {
      blockingUserId_blockedUserId: {
        blockingUserId: currentUserId,
        blockedUserId: targetUserId
      }
    }
  });
  
  return !!block;
};

// =============================================================================
// UPDATED FUNCTIONS WITH BLOCKING LOGIC
// =============================================================================

// Updated getTripContentData to filter out blocked users' content
export const getTripContentData = async (
  tripId: string,
  userLastLogin: Date | null,
  currentUserId: string,
  showReportedContent: boolean = false // Optional parameter for admins
) => {
  // Get blocked user IDs first
  const blockedUserIds = await getBlockedUserIds(currentUserId);

  // Build content filtering conditions
  const contentWhereConditions: any = {
    tripId,
    userId: {
      notIn: blockedUserIds
    },
    user: {
      isBlocked: false
    }
  };

  // Add content moderation filters
  if (!showReportedContent) {
    contentWhereConditions.isHidden = false;
  }

  // Fetch all content linked to the trip with comprehensive filtering
  const contentList = await prisma.content.findMany({
    where: contentWhereConditions,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          isBlocked: true
        }
      },
      contentReports: {
        select: {
          id: true,
          status: true,
          reason: true,
          createdAt: true
        }
      }
    }
  });

  // Filter based on report status if needed
  const filteredContentList = contentList.filter(content => {
    if (showReportedContent) {
      return true; // Admins can see all content
    }

    // Regular users can't see content with pending or actioned reports
    const hasPendingReports = content.contentReports.some(
      report => report.status === 'PENDING'
    );
    const hasActionedReports = content.contentReports.some(
      report => report.status === 'ACTIONED'
    );

    return !hasPendingReports && !hasActionedReports;
  });

  // Add isNew flag to content items
  const contentListWithIsNew = filteredContentList.map((content) => ({
    id: content.id,
    url: content.url,
    structuredData: content.structuredData,
    userId: content.userId,
    tripId: content.tripId,
    userNotes: content.userNotes,
    createdAt: content.createdAt,
    title: content.title,
    thumbnail: content.thumbnail,
    pins_count: content.pins_count,
    user: content.user,
    isNew: userLastLogin ? content.createdAt > userLastLogin : false,
  }));

  // Fetch all pins related to those content entries
  const pinsList = await prisma.pin.findMany({
    where: {
      contentId: { in: contentListWithIsNew.map((content) => content.id) },
    },
    select: {
      id: true,
      name: true,
      category: true,
      description: true,
      contentId: true,
      placeCacheId: true,
      createdAt: true,
    },
  });

  // Add isNew flag to pin items
  const pinsListWithIsNew = pinsList.map((pin) => ({
    ...pin,
    isNew: userLastLogin ? pin.createdAt > userLastLogin : false,
  }));

  // Get unique place cache IDs
  const placeCacheIds = pinsList
    .map((pin) => pin.placeCacheId)
    .filter((id): id is string => id !== null);

  // Fetch all place cache entries with mustDo status for current user
  const placeCacheList = await prisma.placeCache.findMany({
    where: {
      id: { in: placeCacheIds },
    },
    include: {
      userPlaceMustDos: {
        where: {
          tripId: tripId,
          userId: currentUserId // Only check must-do status for current user
        },
        select: {
          id: true,
        },
      },
    },
  });

  // Transform place cache data to include mustDo flag
  const placeCacheListWithMustDo = placeCacheList.map((place) => ({
    id: place.id,
    placeId: place.placeId,
    lat: place.lat,
    lng: place.lng,
    createdAt: place.createdAt,
    lastCached: place.lastCached,
    currentOpeningHours: place.currentOpeningHours,
    name: place.name,
    rating: place.rating,
    regularOpeningHours: place.regularOpeningHours,
    userRatingCount: place.userRatingCount,
    websiteUri: place.websiteUri,
    images: place.images,
    utcOffsetMinutes: place.utcOffsetMinutes,
    mustDo: place.userPlaceMustDos.length > 0,
  }));

  return {
    contentList: contentListWithIsNew,
    pinsList: pinsListWithIsNew,
    placeCacheList: placeCacheListWithMustDo,
  };
};

// Updated getContentPinsPlaceNested to filter blocked users
export const getContentPinsPlaceNested = async (tripId: string, currentUserId: string) => {
  // Get blocked user IDs
  const blockedUserIds = await getBlockedUserIds(currentUserId);

  const nestedTrip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      contents: {
        where: {
          userId: {
            notIn: blockedUserIds
          },
          isHidden: false,
          user: {
            isBlocked: false
          }
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              isBlocked: true
            }
          },
          pins: {
            include: {
              placeCache: true,
            },
          },
        },
      },
    },
  });
  return nestedTrip;
};

// Updated getUsersFromTrip to filter blocked users
export const getUsersFromTrip = async (tripId: string, currentUserId?: string) => {
  const users = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      tripUsers: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              isBlocked: true
            }
          },
        },
      },
    },
  });

  if (!users) {
    return [];
  }

  let filteredUsers = users.tripUsers.map((tripUser) => tripUser.user);

  // Filter out globally blocked users
  filteredUsers = filteredUsers.filter(user => user && !user.isBlocked);

  // If currentUserId is provided, also filter out users blocked by current user
  if (currentUserId) {
    const blockedUserIds = await getBlockedUserIds(currentUserId);
    filteredUsers = filteredUsers.filter(user => user && !blockedUserIds.includes(user.id));
  }

  return filteredUsers.map(user => user?.name).filter(Boolean);
};

// Updated getMessagesByTime to filter blocked users
export const getMessagesByTime = async (
  tripId: string,
  beforeDate: string,
  queryLimit: number,
  currentUserId: string
) => {
  // Get blocked user IDs
  const blockedUserIds = await getBlockedUserIds(currentUserId);

  const messages = await prisma.chatMessage.findMany({
    where: {
      tripId: tripId as string,
      ...(beforeDate && { createdAt: { lt: beforeDate } }),
      userId: {
        notIn: blockedUserIds
      },
      isHidden: false, // Exclude hidden messages
      user: {
        isBlocked: false // Exclude messages from globally blocked users
      }
    },
    orderBy: { createdAt: "desc" },
    take: queryLimit,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          isBlocked: true
        },
      },
    },
  });
  return messages;
};

// Updated getUsersByIds to filter blocked and globally blocked users
export const getUsersByIds = async (userIds: string[], currentUserId?: string) => {
  if (!userIds || userIds.length === 0) return [];
  
  let filteredUserIds = userIds;
  
  // If currentUserId is provided, filter out blocked users
  if (currentUserId) {
    const blockedUserIds = await getBlockedUserIds(currentUserId);
    filteredUserIds = userIds.filter(id => !blockedUserIds.includes(id));
  }
  
  return await prisma.user.findMany({
    where: { 
      id: { in: filteredUserIds },
      isBlocked: false // Exclude globally blocked users
    },
    select: {
      id: true,
      name: true,
      email: true,
      phoneNumber: true,
      createdAt: true,
      updatedAt: true,
      firebaseId: true
    }
  });
};

// =============================================================================
// CONTENT MODERATION HELPER FUNCTIONS
// =============================================================================

// Helper function to hide content (for admin actions)
export const hideContent = async (
  contentId: string, 
  reason: string,
  adminUserId: string
): Promise<any> => {
  try {
    const updatedContent = await prisma.content.update({
      where: { id: contentId },
      data: {
        isHidden: true,
        hiddenAt: new Date(),
        hideReason: reason
      }
    });

    // Also update any related content reports
    await prisma.contentReport.updateMany({
      where: { 
        contentId: contentId,
        status: 'PENDING'
      },
      data: {
        status: 'ACTIONED',
        reviewedAt: new Date(),
        reviewedBy: adminUserId
      }
    });

    return updatedContent;
  } catch (error) {
    console.error("Error hiding content:", error);
    throw error;
  }
};

// Helper function to block user globally (for admin actions)
export const blockUserGlobally = async (
  userId: string, 
  reason: string,
  adminUserId: string
): Promise<any> => {
  try {
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        isBlocked: true,
        blockedAt: new Date(),
        blockReason: reason
      }
    });

    // Also update any related user reports
    await prisma.userReport.updateMany({
      where: { 
        reportedUserId: userId,
        status: 'PENDING'
      },
      data: {
        status: 'ACTIONED',
        reviewedAt: new Date(),
        reviewedBy: adminUserId
      }
    });

    return updatedUser;
  } catch (error) {
    console.error("Error blocking user globally:", error);
    throw error;
  }
};

// Helper function to unblock user globally (for admin actions)
export const unblockUserGlobally = async (userId: string): Promise<any> => {
  try {
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        isBlocked: false,
        blockedAt: null,
        blockReason: null
      }
    });

    return updatedUser;
  } catch (error) {
    console.error("Error unblocking user globally:", error);
    throw error;
  }
};

// Helper function to unhide content (for admin actions)
export const unhideContent = async (contentId: string): Promise<any> => {
  try {
    const updatedContent = await prisma.content.update({
      where: { id: contentId },
      data: {
        isHidden: false,
        hiddenAt: null,
        hideReason: null
      }
    });

    return updatedContent;
  } catch (error) {
    console.error("Error unhiding content:", error);
    throw error;
  }
};

// Helper function to get content reports for admin dashboard
export const getContentReports = async (
  status: 'PENDING' | 'REVIEWED' | 'ACTIONED' | 'DISMISSED' = 'PENDING',
  limit: number = 50,
  offset: number = 0
) => {
  try {
    const reports = await prisma.contentReport.findMany({
      where: { status },
      include: {
        content: {
          select: {
            id: true,
            title: true,
            rawData: true,
            url: true,
            createdAt: true,
            isHidden: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        },
        reporter: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset
    });

    const totalCount = await prisma.contentReport.count({
      where: { status }
    });

    return { reports, totalCount };
  } catch (error) {
    console.error("Error fetching content reports:", error);
    throw error;
  }
};

// Helper function to get user reports for admin dashboard
export const getUserReports = async (
  status: 'PENDING' | 'REVIEWED' | 'ACTIONED' | 'DISMISSED' = 'PENDING',
  limit: number = 50,
  offset: number = 0
) => {
  try {
    const reports = await prisma.userReport.findMany({
      where: { status },
      include: {
        reportedUser: {
          select: {
            id: true,
            name: true,
            email: true,
            isBlocked: true,
            createdAt: true
          }
        },
        reporter: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset
    });

    const totalCount = await prisma.userReport.count({
      where: { status }
    });

    return { reports, totalCount };
  } catch (error) {
    console.error("Error fetching user reports:", error);
    throw error;
  }
};

// Helper function to get moderation statistics
export const getModerationStats = async () => {
  try {
    const [
      pendingContentReports,
      pendingUserReports,
      totalHiddenContent,
      totalBlockedUsers,
      reportsLast24h
    ] = await Promise.all([
      prisma.contentReport.count({ where: { status: 'PENDING' } }),
      prisma.userReport.count({ where: { status: 'PENDING' } }),
      prisma.content.count({ where: { isHidden: true } }),
      prisma.user.count({ where: { isBlocked: true } }),
      prisma.contentReport.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
          }
        }
      })
    ]);

    return {
      pendingContentReports,
      pendingUserReports,
      totalHiddenContent,
      totalBlockedUsers,
      reportsLast24h
    };
  } catch (error) {
    console.error("Error fetching moderation stats:", error);
    throw error;
  }
};

// Get user's role in a specific trip
export const getUserRoleInTrip = async (
  userId: string,
  tripId: string
): Promise<string | null> => {
  const tripUser = await prisma.tripUser.findUnique({
    where: {
      tripId_userId: {
        tripId,
        userId,
      },
    },
    select: {
      role: true,
    },
  });
  
  return tripUser?.role || null;
};

// Get users who have contributed content to a trip (includes current members and ex-members)
export const getUsersWithContentInTrip = async (
  tripId: string, 
  currentUserId: string
) => {
  // Get blocked user IDs
  const blockedUserIds = await getBlockedUserIds(currentUserId);
  
  // Get all users who have content in this trip
  const contentUsers = await prisma.user.findMany({
    where: {
      contents: {
        some: {
          tripId: tripId,
        }
      },
      id: {
        notIn: blockedUserIds
      },
      isBlocked: false
    },
    select: {
      id: true,
      name: true,
      email: true,
      tripUsers: {
        where: { tripId },
        select: {
          role: true,
          createdAt: true
        }
      }
    }
  });

  // Map users with their membership status
  return contentUsers.map(user => ({
    id: user.id,
    name: user.name,
    membershipStatus: user.tripUsers.length > 0 ? 'current' : 'former',
    role: user.tripUsers.length > 0 ? user.tripUsers[0].role : null,
    displayName: user.tripUsers.length > 0 ? user.name : `${user.name} (Former Member)`,
    email:user.email
  }));
};

// Get content summary since user's last login
export const getContentSummarySinceLastLogin = async (
  currentUserId: string,
  lastLoginDate: Date | null
) => {
  // If no lastLoginDate, return empty summary
  if (!lastLoginDate) {
    return [];
  }

  // Get blocked user IDs
  const blockedUserIds = await getBlockedUserIds(currentUserId);

  // Get all trips the user is part of
  const userTrips = await prisma.tripUser.findMany({
    where: { userId: currentUserId },
    select: { tripId: true }
  });

  const tripIds = userTrips.map(trip => trip.tripId);

  if (tripIds.length === 0) {
    return [];
  }

  // Get content created after lastLoginDate in user's trips
  const newContent = await prisma.content.findMany({
    where: {
      tripId: { in: tripIds },
      createdAt: { gt: lastLoginDate },
      status: 'COMPLETED', // Only completed content
      userId: {
        notIn: [...blockedUserIds] // Exclude blocked users and current user's own content
      },
      isHidden: false,
      user: {
        isBlocked: false
      }
    },
    select: {
      id: true,
      tripId: true,
      pins_count: true,
      createdAt: true,
      trip: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });

  // Group by trip and sum pins
  const tripSummary = new Map<string, { tripId: string; tripName: string; totalPins: number }>();

  newContent.forEach(content => {
    const tripId = content.tripId;
    const tripName = content.trip.name;
    const pinsCount = content.pins_count || 0;

    if (tripSummary.has(tripId)) {
      const existing = tripSummary.get(tripId)!;
      existing.totalPins += pinsCount;
    } else {
      tripSummary.set(tripId, {
        tripId,
        tripName,
        totalPins: pinsCount
      });
    }
  });

  // Convert to array and filter out trips with 0 pins
  return Array.from(tripSummary.values()).filter(summary => summary.totalPins > 0);
};
