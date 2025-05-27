import { PrismaClient, User } from "@prisma/client";

import { v4 as uuidv4 } from 'uuid';



const prisma = new PrismaClient();

// Create a new Content entry
export const createContent = async (
  url: string,
  description: string,
  userId: string,
  tripId: string,
  userNotes?: string
) => {
  return await prisma.content.create({
    data: {
      url: url,
      rawData: description,
      structuredData: "",
      userId: userId,
      tripId: tripId,
      userNotes: userNotes,
    },
  });
};
// Update an existing Content entry with structured data
export const updateContent = async (contentId: string, structuredData: any) => {
  return await prisma.content.update({
    where: { id: contentId },
    data: {
      structuredData:
        typeof structuredData === "string"
          ? structuredData
          : JSON.stringify(structuredData),
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
  userLastLogin: Date | null
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
      createdAt: true, // Added to check against last login
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

  // Fetch all place cache entries related to those pins
  const placeCacheList = await prisma.placeCache.findMany({
    where: {
      id: {
        in: pinsList
          .map((pin) => pin.placeCacheId)
          .filter((id): id is string => id !== null),
      },
    },
  });

  return {
    contentList: contentListWithIsNew,
    pinsList: pinsListWithIsNew,
    placeCacheList,
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
  const prisma = new PrismaClient();
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
