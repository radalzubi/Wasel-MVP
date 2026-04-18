import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

// Show notifications as alerts while the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

/**
 * Requests notification permission and registers the Expo push token
 * with the backend. Call once after the user is signed in.
 * Safe to call multiple times — silently no-ops if permission is denied.
 */
export async function registerPushToken(accessToken: string): Promise<void> {
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

    await fetch(`${API_URL}/api/riders/push-token`, {
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
