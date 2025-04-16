import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Create a new Content entry
export const createContent = async (
  url: string,
  description: string,
  userId: string,
  tripId: string
) => {
  return await prisma.content.create({
    data: {
      url: url,
      rawData: description, // Store raw description data
      structuredData: "", // Initially empty, will update later
      userId: userId,
      tripId: tripId,
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
            images: placeDetails.images
        },
    });
};

// Create a new Pin linked to the Content and PlaceCache
export const createPin = async (pinDetails: {
  name: string;
  category: string;
  contentId: string;
  placeCacheId: string;
  coordinates: { lat: number; lng: number };
}) => {
  return await prisma.pin.create({
    data: {
      name: pinDetails.name ?? "Unnamed Pin",
      category: pinDetails.category ?? "Uncategorized",
      contentId: pinDetails.contentId,
      placeCacheId: pinDetails.placeCacheId,
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

export const getTripContentData = async (tripId: string) => {
  // Fetch all content linked to the trip
  const contentList = await prisma.content.findMany({
    where: { tripId },
    select: {
      id: true,
      url: true,
      structuredData: true,
      userId: true,
      tripId: true,
    },
  });

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
    },
  });

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

  return { contentList, pinsList, placeCacheList };
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

export const addUserToTrip = async (tripId: string, userId: string) => {
  const tripUser = await prisma.tripUser.create({
    data: {
      userId: userId,
      tripId: tripId,
      role: "Admin", 
    },
  });

  // need to add socket.io code here
  
  return tripUser;
}

export const getUsersFromTrip = async (tripId: string) => {
  const users = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { tripUsers: true },
  });
  // users is json object with tripUsers array
  if (users) {
    return users.tripUsers.map((tripUser) => tripUser.userId);
  } else {
    return [];
  };
}

export const addMessage = async (tripId: string, userId: string, message: string, timestamp: Date) => {
  const newMessage = await prisma.chatMessage.create({
    data: {
      id : crypto.randomUUID(),
      tripId: tripId,
      userId: userId,
      text: message,
      createdAt: timestamp
    },
  });
  return newMessage;
}

export const getMessageById = async (tripId: string, messageId: string) => {
  const response = await prisma.chatMessage.findUnique({
    where: { id: messageId as string },
    select: { createdAt: true },
  });
  return response;
}

export const getMessagesByTime = async (tripId: string, beforeDate: string, queryLimit: number) => {
  const messages = await prisma.chatMessage.findMany({
    where: {
      tripId: tripId as string,
      ...(beforeDate && { createdAt: { lt: beforeDate } }),
    },
    orderBy: { createdAt: 'desc' },
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
}