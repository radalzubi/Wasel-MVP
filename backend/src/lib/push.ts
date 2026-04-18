import Expo, { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';

// Singleton Expo client — reused across all requests.
const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

/**
 * Sends a push notification to a single Expo push token.
 * Fire-and-forget — never throws, never blocks the caller.
 *
 * @param token - Expo push token (e.g. "ExponentPushToken[xxxxxx]")
 * @param title - Notification title
 * @param body  - Notification body text
 * @param data  - Optional payload delivered to the app on tap
 */
export async function sendPush(
  token: string | null | undefined,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  if (!token) return;
  if (!Expo.isExpoPushToken(token)) {
    console.warn('[push] invalid Expo push token, skipping:', token);
    return;
  }

  const message: ExpoPushMessage = {
    to: token,
    sound: 'default',
    title,
    body,
    data: data ?? {},
    priority: 'high',
    channelId: 'wasel-trips',
  };

  try {
    const chunks = expo.chunkPushNotifications([message]);
    for (const chunk of chunks) {
      const tickets: ExpoPushTicket[] = await expo.sendPushNotificationsAsync(chunk);
      for (const ticket of tickets) {
        if (ticket.status === 'error') {
          console.error('[push] send error:', ticket.message, ticket.details);
        }
      }
    }
  } catch (err) {
    console.error('[push] unexpected error:', err);
  }
}
