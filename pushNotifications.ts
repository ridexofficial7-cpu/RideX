import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { createRideXFetch } from "./shared/api/client";

const RIDEX_NOTIFICATION_CHANNEL_ID = "ridex";
const DEFAULT_APP_VERSION = String(process.env.EXPO_PUBLIC_APP_VERSION ?? "");

let pushTokenSubscription: Notifications.EventSubscription | null = null;
let activeRegistration: RideXPushRegistrationParams | null = null;
let registeredNativeToken: string | null = null;

/**
 * RideX notifications must remain visible when the application is foregrounded.
 * The backend remains the source of truth; this handler only controls local
 * presentation of an already delivered notification.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export type RideXNotificationHandlers = {
  onReceived?: (notification: Notifications.Notification) => void;
  onResponse?: (response: Notifications.NotificationResponse) => void;
};

export type RideXPushRegistrationParams = {
  api: string;
  authToken: string;
  appVersion?: string;
};

export type RideXPushRegistrationResult =
  | {
      registered: true;
      tokenType?: string;
      platform: "ANDROID" | "IOS";
    }
  | {
      registered: false;
      reason: string;
    };

/**
 * Subscribes to foreground-received notifications and notification-tap
 * responses. Returns an unsubscribe function that removes both listeners.
 */
export function subscribeRideXNotificationHandlers(
  handlers: RideXNotificationHandlers,
) {
  const received = Notifications.addNotificationReceivedListener(
    (notification) => {
      handlers.onReceived?.(notification);
    },
  );

  const response = Notifications.addNotificationResponseReceivedListener(
    (notificationResponse) => {
      handlers.onResponse?.(notificationResponse);
    },
  );

  return () => {
    received.remove();
    response.remove();
  };
}

/**
 * Creates/updates the Android notification channel used by RideX.
 * iOS does not use Android notification channels.
 */
async function configureRideXNotificationPlatform() {
  if (Platform.OS !== "android") return;

  await Notifications.setNotificationChannelAsync(
    RIDEX_NOTIFICATION_CHANNEL_ID,
    {
      name: "RideX",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lockscreenVisibility:
        Notifications.AndroidNotificationVisibility.PUBLIC,
      sound: "default",
      enableVibrate: true,
      enableLights: true,
    },
  );
}

function normalizePlatform(tokenType?: string): "ANDROID" | "IOS" {
  const type = String(tokenType ?? "").toLowerCase();

  if (type === "apns") return "IOS";
  if (type === "fcm") return "ANDROID";

  return Platform.OS === "ios" ? "IOS" : "ANDROID";
}

function getAppVersion(appVersion?: string): string {
  const value = String(appVersion ?? "").trim();
  return value || DEFAULT_APP_VERSION;
}

async function getNativeDeviceToken(): Promise<{
  token: string;
  tokenType?: string;
}> {
  const native = await Notifications.getDevicePushTokenAsync();
  const token = String(native.data ?? "").trim();

  if (!token) {
    throw new Error("NO_NATIVE_TOKEN");
  }

  return {
    token,
    tokenType: native.type,
  };
}

async function registerNativePushToken(params: {
  api: string;
  authToken: string;
  nativeToken: string;
  tokenType?: string;
  appVersion?: string;
}) {
  const token = String(params.nativeToken ?? "").trim();
  if (!token) throw new Error("NO_NATIVE_TOKEN");
  if (!params.authToken) throw new Error("NO_AUTH_TOKEN");

  const rideXFetch = createRideXFetch({
    apiUrl: params.api,
    token: params.authToken,
  });

  const platform = normalizePlatform(params.tokenType);

  const response = await rideXFetch("/devices/register", {
    method: "POST",
    body: JSON.stringify({
      token,
      platform,
      appVersion: getAppVersion(params.appVersion),
      deviceName: Platform.OS,
    }),
  });

  if (!response.ok) {
    let message = `API_${response.status}`;

    try {
      const body = await response.json();
      if (body?.message) message = String(body.message);
    } catch {
      // Keep the HTTP status based error when the response is not JSON.
    }

    throw new Error(message);
  }

  return { registered: true as const, platform };
}

/**
 * Requests notification permission when needed, configures the native
 * notification platform, obtains the native APNs/FCM token, and registers it
 * against the authenticated RideX user through /devices/register.
 *
 * A token-refresh listener is installed after successful registration. When
 * Expo reports a changed native token, RideX re-registers it automatically.
 */
export async function registerRideXPushToken(
  params: RideXPushRegistrationParams,
): Promise<RideXPushRegistrationResult> {
  const api = String(params.api ?? "").trim();
  const authToken = String(params.authToken ?? "").trim();

  if (!authToken) {
    return { registered: false, reason: "NO_AUTH_TOKEN" };
  }

  if (!api) {
    return { registered: false, reason: "NO_API_URL" };
  }

  if (Platform.OS === "web") {
    return { registered: false, reason: "WEB_NOT_CONFIGURED" };
  }

  try {
    const permissions = await Notifications.getPermissionsAsync();
    let finalStatus = permissions.status;

    if (finalStatus !== "granted") {
      const requested = await Notifications.requestPermissionsAsync();
      finalStatus = requested.status;
    }

    if (finalStatus !== "granted") {
      return { registered: false, reason: "PERMISSION_DENIED" };
    }

    await configureRideXNotificationPlatform();

    const native = await getNativeDeviceToken();

    const registrationParams: RideXPushRegistrationParams = {
      api,
      authToken,
      appVersion: getAppVersion(params.appVersion),
    };

    await registerNativePushToken({
      api,
      authToken,
      nativeToken: native.token,
      tokenType: native.tokenType,
      appVersion: registrationParams.appVersion,
    });

    removePushTokenSubscription();

    activeRegistration = registrationParams;
    registeredNativeToken = native.token;

    pushTokenSubscription = Notifications.addPushTokenListener(
      async (nextToken) => {
        const refreshed = String(nextToken?.data ?? "").trim();
        if (!refreshed) return;

        const current = activeRegistration;
        if (!current) return;

        if (refreshed === registeredNativeToken) return;

        try {
          await registerNativePushToken({
            api: current.api,
            authToken: current.authToken,
            nativeToken: refreshed,
            tokenType: nextToken.type,
            appVersion: current.appVersion,
          });

          registeredNativeToken = refreshed;
        } catch {
          // A future authenticated registration attempt retries the token.
        }
      },
    );

    const platform = normalizePlatform(native.tokenType);

    return {
      registered: true,
      tokenType: native.tokenType,
      platform,
    };
  } catch (error) {
    return {
      registered: false,
      reason:
        error instanceof Error
          ? error.message
          : "PUSH_REGISTRATION_FAILED",
    };
  }
}

/**
 * Explicitly deactivates a native push token on the backend.
 * This is useful during logout so the backend will stop targeting the current
 * device for the authenticated RideX user.
 */
export async function deactivateRideXPushToken(params: {
  api: string;
  authToken: string;
  token?: string;
}) {
  const api = String(params.api ?? "").trim();
  const authToken = String(params.authToken ?? "").trim();
  const token = String(params.token ?? registeredNativeToken ?? "").trim();

  if (!api) return { deactivated: false, reason: "NO_API_URL" };
  if (!authToken) return { deactivated: false, reason: "NO_AUTH_TOKEN" };
  if (!token) return { deactivated: false, reason: "NO_NATIVE_TOKEN" };

  try {
    const rideXFetch = createRideXFetch({
      apiUrl: api,
      token: authToken,
    });

    const response = await rideXFetch("/devices/deactivate", {
      method: "POST",
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      return { deactivated: false, reason: `API_${response.status}` };
    }

    registeredNativeToken = null;
    return { deactivated: true as const };
  } catch (error) {
    return {
      deactivated: false,
      reason:
        error instanceof Error
          ? error.message
          : "PUSH_DEACTIVATION_FAILED",
    };
  }
}

/**
 * Removes the native token-refresh listener and clears in-memory registration
 * state. It does not call the backend; use deactivateRideXPushToken() first
 * when a logout/deactivation should also update backend device state.
 */
function removePushTokenSubscription() {
  if (pushTokenSubscription) {
    pushTokenSubscription.remove();
    pushTokenSubscription = null;
  }
}

export function unregisterRideXPushTokenListener() {
  removePushTokenSubscription();
  activeRegistration = null;
  registeredNativeToken = null;
}
