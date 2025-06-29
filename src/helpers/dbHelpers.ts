import { PrismaClient } from "@prisma/client";

import { v4 as uuidv4 } from 'uuid';



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
        viewCount: true
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
}

export const getUserByFirebaseId = async (
  firebaseId: string
): Promise<UserModel | null> => {
  return await prisma.user.findFirst({
    // TODO: change to findUnique once firebaseId is unique
    where: { firebaseId },
  });
};

export const getUserById = async (userId: string) => {
  return await prisma.user.findUnique({
    where: { id: userId },
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

export const getTripContentData = async (
  tripId: string,
  userLastLogin: Date | null,
) => {
  // Fetch all content linked to the trip
  const contentList = await prisma.content.findMany({
    where: { tripId },
    select: {
      id: true,
      url: true,
      structuredData: true,
      userId: true,
      tripId: true,
      userNotes: true,
      createdAt: true,
      title: true,
      thumbnail: true,
      pins_count: true,
    },
  });

  // Add isNew flag to content items
  const contentListWithIsNew = contentList.map((content) => ({
    ...content,
    isNew: userLastLogin ? content.createdAt > userLastLogin : false,
  }));

  // Fetch all pins related to those content entries
  const pinsList = await prisma.pin.findMany({
    where: {
      contentId: { in: contentList.map((content) => content.id) },
    },
    select: {
      id: true,
      name: true,
      category: true,
      description: true,
      contentId: true, // Foreign key linking to content
      placeCacheId: true, // Foreign key linking to place cache
      createdAt: true, // Added to check against last login
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
        },
        select: {
          id: true, // Just need to know if it exists
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
    mustDo: place.userPlaceMustDos.length > 0, // True if user has marked this as must-do for this trip
  }));

  return {
    contentList: contentListWithIsNew,
    pinsList: pinsListWithIsNew,
    placeCacheList: placeCacheListWithMustDo,
  };
};


export const getContentPinsPlaceNested = async (tripId: string) => {
  // === Fetch Nested Data Separately ===
  const nestedTrip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      contents: {
        include: {
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
          userId
        }
      }
    });
    
    if (existingTripUser) {
      return existingTripUser;
    }
    
    const tripUser = await prisma.tripUser.create({
      data: {
        tripId,
        userId,
        role
      }
    });
    
    return tripUser;
  } catch (error) {
    console.error("Error adding user to trip:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
};

export const getUsersFromTrip = async (tripId: string) => {
  const users = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      tripUsers: {
        include: {
          user: true,
        },
      },
    },
  });
  // users is json object with tripUsers array
  if (users) {
    return users.tripUsers.map((tripUser) => tripUser.user?.name);
  } else {
    return [];
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

export const getMessagesByTime = async (
  tripId: string,
  beforeDate: string,
  queryLimit: number
) => {
  const messages = await prisma.chatMessage.findMany({
    where: {
      tripId: tripId as string,
      ...(beforeDate && { createdAt: { lt: beforeDate } }),
    },
    orderBy: { createdAt: "desc" },
    take: queryLimit,
    include: {
      user: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
  return messages;
};

export const getUsername = async (userId: any) => {
  const user = await prisma.user.findUnique({
    where: { id: userId as string },
    select: { name: true },
  });
  return user;
};

export const getUsersByIds = async (userIds: string[]) => {
  if (!userIds || userIds.length === 0) return [];
  return await prisma.user.findMany({
    where: { id: { in: userIds } },
  });
};



// === Share Token Helper Functions ===

// Function to generate a unique token
export const generateUniqueToken = (): string => {
  return uuidv4().replace(/-/g, '');
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
        expiresAt
      }
    });
    
    return shareToken;
  } catch (error) {
    console.error("Error creating share token:", error);
    throw error;
  }
};

// Function to get share token details by token
export const getShareTokenDetails = async (
  token: string
): Promise<any> => {
  try {
    const shareToken = await prisma.shareToken.findUnique({
      where: {
        token
      },
      include: {
        trip: true
      }
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
    const tripUser = await prisma.tripUser.findUnique({
      where: {
        tripId_userId: {
          tripId,
          userId
        }
      }
    });
    
    return !!tripUser;
  } catch (error) {
    console.error("Error checking if user is in trip:", error);
    throw error;
  }
};

// Function to get the number of members in a trip
export const getTripMemberCount = async (
  tripId: string
): Promise<number> => {
  try {
    const count = await prisma.tripUser.count({
      where: { tripId }
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
          tripId
        }
      },
      include: {
        placeCache: true,
        trip: true
      }
    });

    if (existingEntry) {
      return { alreadyMarked: true, entry: existingEntry };
    }

    // Create new must-do entry
    const mustDoEntry = await prisma.userPlaceMustDo.create({
      data: {
        userId,
        placeCacheId,
        tripId
      },
      include: {
        placeCache: true,
        trip: true
      }
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
          tripId
        }
      }
    });
    return !!deletedEntry;
  } catch (error) {
    if ((error as any).code === 'P2025') {
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
      select: { contentId: true }
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
      where: { contentId: pin.contentId }
    });

    await prisma.content.update({
      where: { id: pin.contentId },
      data: { pins_count: remainingPinsCount }
    });

  } catch (error) {
    console.error("Error deleting pin:", error);
    throw error;
  }
};

// === Verification Helper Functions ===


// Helper function to verify if a place exists
export const verifyPlaceExists = async (placeCacheId: string): Promise<boolean> => {
  try {
    const place = await prisma.placeCache.findUnique({
      where: { id: placeCacheId }
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
      where: { id: tripId }
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
              where: { userId: userId }
            }
          }
        }
      }
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
                  where: { userId: userId }
                }
              }
            }
          }
        }
      }
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