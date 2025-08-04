import { sendNotificationToUsers } from './notificationService';

// Trip-related notifications
export const sendTripInviteNotification = async (inviterName: string, tripName: string, userIds: string[]) => {
  return await sendNotificationToUsers(userIds, {
    title: `You're invited to ${tripName}!`,
    body: `${inviterName} invited you to join their trip`,
    data: {
      type: 'trip_invite',
      tripName,
      inviterName,
    },
  });
};

export const sendNewContentNotification = async (authorName: string, tripName: string, userIds: string[]) => {
  return await sendNotificationToUsers(userIds, {
    title: `New content in ${tripName}`,
    body: `${authorName} added new content to your trip`,
    data: {
      type: 'new_content',
      tripName,
      authorName,
    },
  });
};

export const sendNewPinNotification = async (authorName: string, placeName: string, tripName: string, userIds: string[]) => {
  return await sendNotificationToUsers(userIds, {
    title: `New pin added: ${placeName}`,
    body: `${authorName} pinned ${placeName} in ${tripName}`,
    data: {
      type: 'new_pin',
      placeName,
      tripName,
      authorName,
    },
  });
};

export const sendTripMessageNotification = async (senderName: string, tripName: string, messagePreview: string, userIds: string[]) => {
  return await sendNotificationToUsers(userIds, {
    title: `${senderName} in ${tripName}`,
    body: messagePreview,
    data: {
      type: 'trip_message',
      tripName,
      senderName,
    },
  });
};

// User activity notifications
export const sendUserJoinedTripNotification = async (newMemberName: string, tripName: string, userIds: string[]) => {
  return await sendNotificationToUsers(userIds, {
    title: `${newMemberName} joined your trip`,
    body: `${newMemberName} is now part of ${tripName}`,
    data: {
      type: 'user_joined_trip',
      tripName,
      newMemberName,
    },
  });
};

export const sendMustDoPlaceNotification = async (userName: string, placeName: string, tripName: string, userIds: string[]) => {
  return await sendNotificationToUsers(userIds, {
    title: `Must-visit place: ${placeName}`,
    body: `${userName} marked ${placeName} as must-visit in ${tripName}`,
    data: {
      type: 'must_do_place',
      placeName,
      tripName,
      userName,
    },
  });
};

// System notifications
export const sendWelcomeNotification = async (userName: string, userIds: string[]) => {
  return await sendNotificationToUsers(userIds, {
    title: `Welcome to BeforeThirty, ${userName}!`,
    body: 'Start planning your adventures and discover amazing places',
    data: {
      type: 'welcome',
      userName,
    },
  });
};

export const sendTripReminderNotification = async (tripName: string, daysUntilTrip: number, userIds: string[]) => {
  return await sendNotificationToUsers(userIds, {
    title: `${tripName} is coming up!`,
    body: `Only ${daysUntilTrip} days until your trip starts`,
    data: {
      type: 'trip_reminder',
      tripName,
      daysUntilTrip: daysUntilTrip.toString(),
    },
  });
};