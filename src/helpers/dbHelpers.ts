import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();


// Create a new Content entry
export const createContent = async (url: string, description: string, userId: string, tripId: string) => {
    return await prisma.content.create({
        data: {
            url: url,
            rawData: description, // Store raw description data
            structuredData: "", // Initially empty, will update later
            userId: userId,
            tripId: tripId,
        }
    });
};

// Update an existing Content entry with structured data
export const updateContent = async (contentId: string, structuredData: any) => {
    return await prisma.content.update({
        where: { id: contentId },
        data: {
            structuredData: typeof structuredData === 'string' ? structuredData : JSON.stringify(structuredData),
        }
    });
};

// Function to get the PlaceCache by placeId
export const getPlaceCacheById = async (placeId: string) => {
    return await prisma.placeCache.findUnique({
        where: { placeId: placeId },
    });
};

// Function to create a new PlaceCache entry
export const createPlaceCache = async (placeId: string, coordinates: { lat: number, lng: number }) => {
    return await prisma.placeCache.create({
        data: {
            placeId: placeId,
            lat: coordinates.lat,
            lng: coordinates.lng,
            lastCached: new Date(),
        },
    });
};

// Create a new Pin linked to the Content and PlaceCache
export const createPin = async (name: string, category: string, contentId: string, placeCacheId: string) => {
    return await prisma.pin.create({
        data: {
            name: name ?? "Unnamed Pin",
            category: category ?? "Uncategorized",
            contentId: contentId,
            placeCacheId: placeCacheId,
        },
    });
};

// dbHelpers.ts
// dbHelpers.ts
export const getTripsByUserId = async (userId: string) => {
    try {
        // Fetch all the trips associated with the user through the TripUser model
        const tripUsers = await prisma.tripUser.findMany({
            where: { userId: userId },  // Filter by userId
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
        throw new Error('Error fetching trips');
    }
};

export const getAllUsers = async () => {
    try {
        // Fetch all users from the User model without selecting specific fields
        const users = await prisma.user.findMany();

        return users;
    } catch (error) {
        console.error('Error fetching users:', error);
        throw new Error('Error fetching users');
    }
};


export const createTrip = async (name: string, startDate: Date, endDate: Date, description: string) => {
    return await prisma.trip.create({
        data: {
            name : name ?? "Untitled",
            startDate: startDate ?? "NA",
            endDate: endDate ?? "NA",
            description: description
        }
    });
}

export const createUserTrip = async (role: string, userId: string, tripId: string) => {
    return await prisma.tripUser.create({
        data: {
            role: role ?? "",
            userId: userId,
            tripId: tripId
        }
    });
}