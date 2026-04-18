// Push notifications via the Expo Push HTTP API v2.
// We call the HTTP endpoint directly instead of using expo-server-sdk,
// which is ESM-only and incompatible with our CommonJS TypeScript build.
// Docs: https://docs.expo.dev/push-notifications/sending-notifications/

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Returns true if the token looks like a valid Expo push token.
 * Expo tokens start with "ExponentPushToken[" or "ExpoPushToken[".
 */
function isExpoPushToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[.+\]$/.test(token);
}

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
  if (!isExpoPushToken(token)) {
    console.warn('[push] invalid Expo push token, skipping:', token);
    return;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Accept-Encoding': 'gzip, deflate',
  };

  const accessToken = process.env.EXPO_ACCESS_TOKEN;
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify([{
        to:        token,
        sound:     'default',
        title,
        body,
        data:      data ?? {},
        priority:  'high',
        channelId: 'wasel-trips',
      }]),
    });

    if (!res.ok) {
      console.error('[push] HTTP error:', res.status, await res.text());
      return;
    }

    const result = await res.json() as { data?: Array<{ status: string; message?: string }> };
    const ticket = result.data?.[0];
    if (ticket?.status === 'error') {
      console.error('[push] send error:', ticket.message);
    }
  } catch (err) {
    console.error('[push] unexpected error:', err);
  }
}
