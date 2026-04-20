import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

type Role = 'rider' | 'driver';

/**
 * Requests notification permission and registers the Expo push token with
 * the backend. Call once after the user is signed in.
 *
 * Safe to call multiple times — silently no-ops if permission is denied
 * or if the Expo projectId is missing (standalone builds only).
 *
 * IMPORTANT: setNotificationHandler is called here (not at module scope) so it
 * runs after the React Native bridge is fully initialised. Calling it at module
 * scope causes a native iOS crash because the notification delegate is not yet
 * ready when the JS bundle first evaluates.
 *
 * @param role     Which backend endpoint to register with
 * @param accessToken Supabase session access token
 */
export async function registerPushToken(role: Role, accessToken: string): Promise<void> {
  // Set the foreground handler before requesting permissions so that any
  // permission-grant notification is handled immediately.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('[push] notification permission denied');
      return;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      console.warn('[push] EAS projectId not configured — skipping push registration');
      return;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    await fetch(`${API_URL}/api/${role}s/push-token`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ token }),
    });
  } catch (err) {
    // Never throw — push token registration is best-effort.
    console.warn('[push] token registration failed:', err);
  }
}
