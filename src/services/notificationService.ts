import { PrismaClient } from '@prisma/client';
import { admin } from '../utils/firebase/firebase';

const prisma = new PrismaClient();

export interface NotificationPayload {
  title: string;
  body: string;
  data?: { [key: string]: string };
  imageUrl?: string;
}

export interface SendNotificationOptions {
  userIds?: string[];
  fcmTokens?: string[];
  payload: NotificationPayload;
}

// Register or update FCM token for a user
export const registerFcmToken = async (
  userId: string,
  fcmToken: string,
  deviceInfo?: any
): Promise<void> => {
  try {
    await prisma.fcmToken.upsert({
      where: { fcmToken },
      update: {
        userId,
        deviceInfo,
        isActive: true,
        updatedAt: new Date(),
      },
      create: {
        userId,
        fcmToken,
        deviceInfo,
        isActive: true,
      },
    });
    console.log(`FCM token registered for user ${userId}`);
  } catch (error) {
    console.error('Error registering FCM token:', error);
    throw error;
  }
};

// Remove FCM token
export const unregisterFcmToken = async (fcmToken: string): Promise<void> => {
  try {
    await prisma.fcmToken.updateMany({
      where: { fcmToken },
      data: { isActive: false },
    });
    console.log(`FCM token unregistered: ${fcmToken}`);
  } catch (error) {
    console.error('Error unregistering FCM token:', error);
    throw error;
  }
};

// Get active FCM tokens for specific users
export const getFcmTokensForUsers = async (userIds: string[]): Promise<string[]> => {
  try {
    const tokens = await prisma.fcmToken.findMany({
      where: {
        userId: { in: userIds },
        isActive: true,
      },
      select: { fcmToken: true },
    });
    return tokens.map(token => token.fcmToken);
  } catch (error) {
    console.error('Error fetching FCM tokens:', error);
    throw error;
  }
};

// Send notification to specific users
export const sendNotificationToUsers = async (
  userIds: string[],
  payload: NotificationPayload
): Promise<{ successCount: number; failureCount: number; invalidTokens: string[] }> => {
  try {
    const fcmTokens = await getFcmTokensForUsers(userIds);
    return await sendNotificationToTokens(fcmTokens, payload);
  } catch (error) {
    console.error('Error sending notification to users:', error);
    throw error;
  }
};

// Send notification to specific FCM tokens
export const sendNotificationToTokens = async (
  fcmTokens: string[],
  payload: NotificationPayload
): Promise<{ successCount: number; failureCount: number; invalidTokens: string[] }> => {
  if (fcmTokens.length === 0) {
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }

  try {
    const messaging = admin.messaging();
    
    const message: admin.messaging.MulticastMessage = {
      tokens: fcmTokens,
      notification: {
        title: payload.title,
        body: payload.body,
        imageUrl: payload.imageUrl,
      },
      data: payload.data || {},
      android: {
        notification: {
          sound: 'default',
          channelId: 'default',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
          },
        },
      },
    };

    const response = await messaging.sendEachForMulticast(message);
    
    console.log(`Notification sent - Success: ${response.successCount}, Failure: ${response.failureCount}`);
    
    // Handle invalid tokens
    const invalidTokens: string[] = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success && resp.error) {
        const errorCode = resp.error.code;
        if (errorCode === 'messaging/invalid-registration-token' || 
            errorCode === 'messaging/registration-token-not-registered') {
          invalidTokens.push(fcmTokens[idx]);
        }
      }
    });

    // Clean up invalid tokens
    if (invalidTokens.length > 0) {
      await cleanupInvalidTokens(invalidTokens);
    }

    return {
      successCount: response.successCount,
      failureCount: response.failureCount,
      invalidTokens,
    };
  } catch (error) {
    console.error('Error sending notification:', error);
    throw error;
  }
};

// Clean up invalid/expired tokens
export const cleanupInvalidTokens = async (invalidTokens: string[]): Promise<void> => {
  try {
    await prisma.fcmToken.updateMany({
      where: { fcmToken: { in: invalidTokens } },
      data: { isActive: false },
    });
    console.log(`Cleaned up ${invalidTokens.length} invalid tokens`);
  } catch (error) {
    console.error('Error cleaning up invalid tokens:', error);
  }
};

// Send notification to all active users
export const sendBroadcastNotification = async (
  payload: NotificationPayload
): Promise<{ successCount: number; failureCount: number; invalidTokens: string[] }> => {
  try {
    const tokens = await prisma.fcmToken.findMany({
      where: { isActive: true },
      select: { fcmToken: true },
    });
    
    const fcmTokens = tokens.map(token => token.fcmToken);
    return await sendNotificationToTokens(fcmTokens, payload);
  } catch (error) {
    console.error('Error sending broadcast notification:', error);
    throw error;
  }
};

// Get user's notification statistics
export const getUserNotificationStats = async (userId: string) => {
  try {
    const activeTokens = await prisma.fcmToken.count({
      where: { userId, isActive: true },
    });
    
    const totalTokens = await prisma.fcmToken.count({
      where: { userId },
    });

    return { activeTokens, totalTokens };
  } catch (error) {
    console.error('Error fetching notification stats:', error);
    throw error;
  }
};