import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { createRideXFetch } from "./shared/api/client";

export async function registerRideXPushToken(params: {
  api: string;
  authToken: string;
  appVersion?: string;
}) {
  if (!params.authToken) return { registered: false, reason: "NO_AUTH_TOKEN" };
  if (Platform.OS === "web") return { registered: false, reason: "WEB_NOT_CONFIGURED" };

  try {
    const permissions = await Notifications.getPermissionsAsync();
    let finalStatus = permissions.status;
    if (finalStatus !== "granted") {
      const requested = await Notifications.requestPermissionsAsync();
      finalStatus = requested.status;
    }
    if (finalStatus !== "granted") return { registered: false, reason: "PERMISSION_DENIED" };

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("ridex", {
        name: "RideX",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        sound: "default",
      });
    }

    const native = await Notifications.getDevicePushTokenAsync();
    const token = String(native.data ?? "").trim();
    if (!token) return { registered: false, reason: "NO_NATIVE_TOKEN" };

    const platform = native.type === "apns" ? "IOS" : native.type === "fcm" ? "ANDROID" : Platform.OS.toUpperCase();
    const rideXFetch = createRideXFetch({
      apiUrl: params.api,
      token: params.authToken,
    });

    const response = await rideXFetch("/devices/register", {
      method: "POST",
      body: JSON.stringify({
        token,
        platform,
        appVersion: params.appVersion ?? String(Constants.expoConfig?.version ?? ""),
        deviceName: Platform.OS,
      }),
    });
    if (!response.ok) return { registered: false, reason: `API_${response.status}` };
    return { registered: true, tokenType: native.type };
  } catch (error) {
    return { registered: false, reason: error instanceof Error ? error.message : "PUSH_REGISTRATION_FAILED" };
  }
}
