import type { CustomerScreen } from "../navigation/routes";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  Linking,
  Pressable,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  StatusBar as RNStatusBar,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { CameraView, useCameraPermissions } from "expo-camera";
import QRCode from "react-native-qrcode-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createRideXFetch, getRideXApiUrl } from "../shared/api/client";
import { registerRideXPushToken } from "../pushNotifications";
import MapView, { Marker, PROVIDER_GOOGLE, MapType } from "react-native-maps";
import { CUSTOMER_ASSETS } from "../shared/assets";




type CustomerIconName = keyof typeof CUSTOMER_ASSETS.icons;

function AssetIcon({
  name,
  size = 24,
}: {
  name: string;
  size?: number;
}) {
  if (!Object.prototype.hasOwnProperty.call(CUSTOMER_ASSETS.icons, name)) {
    return null;
  }

  const source = CUSTOMER_ASSETS.icons[name as CustomerIconName];

  return (
    <Image
      source={source}
      style={{ width: size, height: size }}
      resizeMode="contain"
    />
  );
}

const LEGACY_ICON_TO_ASSET: Record<string, CustomerIconName> = {
  "🛡": "safety",
  "🍃": "verified",
  "👥": "passengers",
  "🚕": "ride",
  "🛺": "ride",
  "🛻": "truck",
  "📦": "parcel",
  "▣": "wallet",
  "%": "promo",
  "◷": "schedule",
  "▤": "edit",
  "↗": "liveLocation",
  "◉": "notification",
  "☎": "phone",
  "📞": "phone",
  "♙": "profile",
  "⌂": "home",
  "▰": "workSaved",
  "✈": "route",
  "●": "pickup",
  "👤": "profile",
  "🔒": "security",
  "🔐": "otp",
  "★": "rating",
  "📷": "camera",
  "🆘": "sos",
  "💬": "liveChat",
  "▦": "receipt",
  "≋": "layers",
  "⌖": "recenter",
  "⚙": "settings",
  "🎟": "promo",
  "✉": "email",
  "☷": "receipt",
  "⇥": "logout",
  "🖼": "gallery",
  "☑": "check",
  "☐": "check",
  "₹": "rupee",
  "✓": "verified",
};



function LegacyIcon({glyph, size=24}: {glyph:string; size?:number}) {
  const assetName = LEGACY_ICON_TO_ASSET[glyph];
  return assetName ? <AssetIcon name={assetName} size={size} /> : <Text>{glyph}</Text>;
}


const API = getRideXApiUrl();

const GALLERY_STORAGE_KEY = "ridex_customer_gallery_v1";
const EMERGENCY_CONTACT_STORAGE_KEY = "ridex_customer_emergency_contact_v1";
const CUSTOMER_SESSION_STORAGE_KEY = "ridex_customer_session_v2";
const RIDEX_TEST_MODE = String(process.env.EXPO_PUBLIC_RIDEX_TEST_MODE ?? "false").toLowerCase() === "true";
const CUSTOMER_AUTH_TOKEN_KEY = "ridex_customer_auth_token_v1";
const TIMEZONE = "Asia/Kolkata";

const ridexFetch = createRideXFetch({ tokenKey: CUSTOMER_AUTH_TOKEN_KEY, apiUrl: API });

/**
 * RideX integration contract
 * - Customer, Driver and Admin apps talk only to the RideX backend.
 * - Production/local API URL can be changed without editing this file:
 *   Expo: EXPO_PUBLIC_API_URL
 * - Optional integrations stay non-blocking. Missing provider URLs/keys do
 *   not prevent the core Customer app from starting.
 */
const RIDEX_OPTIONAL_CONFIG = {
  routingUrl: process.env.EXPO_PUBLIC_ROUTING_URL || "",
  mapsKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY || "",
  notificationsUrl: process.env.EXPO_PUBLIC_NOTIFICATIONS_URL || "",
};

// Android edge-to-edge devices can draw app content underneath the system
// status/navigation bars. Keep the existing layouts intact, but reserve the
// system-safe space so headers, maps and bottom actions are never covered.
const ANDROID_TOP_INSET =
  Platform.OS === "android" ? RNStatusBar.currentHeight ?? 24 : 0;
const ANDROID_BOTTOM_INSET = Platform.OS === "android" ? 32 : 0;

type Screen = CustomerScreen;

type RideType =
  | "FULL_RIDE"
  | "SHARED_RIDE"
  | "CONNECTION_RIDE";

type PaymentMethod = "CASH" | "UPI" | "WALLET";
type VehicleType = "E_RICKSHAW" | "PICKUP_TRUCK";
type BookingMode = "RIDE" | "GOODS";
type GoodsSize = "SMALL" | "MEDIUM" | "LARGE";
type AmPm = "AM" | "PM";

function clampPassengerCount(value: number) {
  return Math.max(1, Math.min(4, Math.trunc(value || 1)));
}

function formatRideType(type: RideType) {
  return type.replace(/_/g, " ");
}

function makeTomorrowDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function makeScheduledIso(
  dateText: string,
  timeText: string,
  period: AmPm
) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(
    dateText.trim()
  );
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(
    timeText.trim()
  );

  if (!dateMatch || !timeMatch) {
    return null;
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 1 ||
    hour > 12 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  if (period === "AM") {
    if (hour === 12) hour = 0;
  } else if (hour !== 12) {
    hour += 12;
  }

  // Asia/Kolkata is UTC+05:30.
  const utcMillis =
    Date.UTC(year, month - 1, day, hour, minute) -
    5.5 * 60 * 60 * 1000;

  const result = new Date(utcMillis);
  if (Number.isNaN(result.getTime())) {
    return null;
  }

  return result;
}

export default function App({ onBeDriver, onAdminLogin }: { onBeDriver?: () => void; onAdminLogin?: () => void } = {}) {
  const [screen, setScreen] = useState<Screen>("login");

  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerFullName, setCustomerFullName] = useState("Ravi Kumar");
  const [customerEmail, setCustomerEmail] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);

  const [pickup, setPickup] = useState("");
  const [drop, setDrop] = useState("");
  const [pickupLat, setPickupLat] = useState(Number.NaN);
  const [pickupLng, setPickupLng] = useState(Number.NaN);
  const [dropLat, setDropLat] = useState(Number.NaN);
  const [dropLng, setDropLng] = useState(Number.NaN);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    recordedAt?: string;
  } | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const locationSubscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const customerMapRef = useRef<MapView | null>(null);
  const [customerMapType, setCustomerMapType] = useState<MapType>("standard");
  const [customerMapLayersOpen, setCustomerMapLayersOpen] = useState(false);

  const [bookingMode, setBookingMode] = useState<BookingMode>("RIDE");
  const [rideType, setRideType] = useState<RideType>("FULL_RIDE");
  const [passengers, setPassengers] = useState(1);

  const [scheduled, setScheduled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(makeTomorrowDate());
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [schedulePeriod, setSchedulePeriod] = useState<AmPm>("AM");

  const [goodsVehicle, setGoodsVehicle] =
    useState<VehicleType>("PICKUP_TRUCK");
  const [goodsType, setGoodsType] = useState("");
  const [goodsDescription, setGoodsDescription] = useState("");
  const [parcelMode, setParcelMode] = useState<"FULL"|"MULTI">("FULL");
  const [parcelRows, setParcelRows] = useState<Array<{weight:string;description:string}>>([{weight:"",description:""}]);
  const [weight, setWeight] = useState("");
  const [size, setSize] = useState<GoodsSize>("SMALL");
  const [receiverName, setReceiverName] = useState("");
  const [receiverMobile, setReceiverMobile] = useState("");
  const [waiting, setWaiting] = useState("0");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [stops, setStops] = useState<string[]>([]);

  const [bookingId, setBookingId] = useState("");
  const [customerHistory, setCustomerHistory] = useState<any[]>([]);
  const [selectedHistoryBooking, setSelectedHistoryBooking] = useState<any | null>(null);
  const [bookingStatus, setBookingStatus] = useState("NEW");
  const [driverId, setDriverId] = useState("");
  const [driverLocation, setDriverLocation] = useState<{
    latitude: number;
    longitude: number;
    recordedAt?: string;
  } | null>(null);
  const [fare, setFare] = useState(80);

  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>("CASH");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [verificationMethod, setVerificationMethod] = useState<"OTP"|"QR">("OTP");
  const [verificationCredential, setVerificationCredential] = useState("");
  const [activeLegId, setActiveLegId] = useState("");
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const authToken = await AsyncStorage.getItem(CUSTOMER_AUTH_TOKEN_KEY);
      if (!cancelled && authToken) {
        void registerRideXPushToken({ api: API, authToken });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (screen === "rides" && customerId) void loadCustomerHistory();
    if (screen === "location" && customerId) void loadSavedLocations();
    if ((screen === "profile" || screen === "editProfile") && customerId) void loadCustomerProfile();
  }, [screen, customerId]);

  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState("");

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [quick, setQuick] = useState<any[]>([]);
  const [quickCategory, setQuickCategory] = useState("");
  const [savedLocations, setSavedLocations] = useState<any[]>([]);

  const [galleryPhotos, setGalleryPhotos] = useState<string[]>([]);

  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyMobile, setEmergencyMobile] = useState("");
  const [sosReason, setSosReason] = useState("Unsafe situation");
  const [sosConfirm, setSosConfirm] = useState(false);

  // Optional providers are intentionally non-blocking.
  // They can be wired later via environment variables without App.tsx changes.
  void RIDEX_OPTIONAL_CONFIG;

  const previewDistanceKm = useMemo(() => {
    const latKm =
      (Number(pickupLat) - Number(dropLat)) * 111;
    const lngKm =
      (Number(pickupLng) - Number(dropLng)) * 111;

    return Math.max(
      1,
      Math.sqrt(latKm * latKm + lngKm * lngKm)
    );
  }, [pickupLat, pickupLng, dropLat, dropLng]);

  function previewFullRideFare(km: number) {
    // Master pricing: ₹80 first 1.2 km, then ₹2 per additional 200 m.
    if (km <= 1.2) return 80;
    return 80 + Math.ceil((km - 1.2) / 0.2) * 2;
  }

  function previewDistanceFare(km: number) {
    if (km <= 1) return 10;
    return 10 + Math.ceil(km - 1) * 20;
  }

  function previewGoodsFare(vehicle: VehicleType, km: number) {
    const firstKm = vehicle === "PICKUP_TRUCK" ? 500 : 200;
    const extraKm = vehicle === "PICKUP_TRUCK" ? 100 : 50;
    if (km <= 1) return firstKm;
    return firstKm + Math.ceil(km - 1) * extraKm;
  }

  const estimated = useMemo(() => {
    if (bookingMode === "GOODS") {
      return previewGoodsFare(goodsVehicle, previewDistanceKm);
    }

    if (rideType === "FULL_RIDE") {
      return previewFullRideFare(previewDistanceKm);
    }

    if (rideType === "SHARED_RIDE") {
      return clampPassengerCount(passengers) * 20;
    }

    return previewDistanceFare(previewDistanceKm);
  }, [
    bookingMode,
    rideType,
    passengers,
    goodsVehicle,
    previewDistanceKm,
  ]);

  useEffect(() => {
    async function restoreSession() {
      try {
        const stored = await AsyncStorage.getItem(
          CUSTOMER_SESSION_STORAGE_KEY
        );
        if (!stored) return;
        const parsed = JSON.parse(stored);
        const storedToken = String(parsed?.token || "").trim();
        if (storedToken) {
          await AsyncStorage.setItem(CUSTOMER_AUTH_TOKEN_KEY, storedToken);
        }
        const storedCustomerId = String(parsed?.customerId || "");
        const storedBookingId = String(parsed?.bookingId || "");
        const storedBookingStatus = String(parsed?.bookingStatus || "NEW");

        if (storedCustomerId) {
          setCustomerId(storedCustomerId);
        }
        if (storedBookingId) {
          setBookingId(storedBookingId);
          setBookingStatus(storedBookingStatus);
          setScreen("confirmed");
        }
      } catch (error) {
        console.error("CUSTOMER SESSION RESTORE ERROR:", error);
      }
    }

    void restoreSession();
  }, []);

  useEffect(() => {
    async function loadGallery() {
      try {
        const stored = await AsyncStorage.getItem(
          GALLERY_STORAGE_KEY
        );
        if (!stored) return;
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setGalleryPhotos(
            parsed.filter(
              (item): item is string =>
                typeof item === "string"
            )
          );
        }
      } catch (error) {
        console.error("GALLERY LOAD ERROR:", error);
      }
    }

    loadGallery();

    async function loadEmergencyContact() {
      try {
        const stored = await AsyncStorage.getItem(
          EMERGENCY_CONTACT_STORAGE_KEY
        );
        if (!stored) return;
        const parsed = JSON.parse(stored);
        if (parsed?.name) setEmergencyName(String(parsed.name));
        if (parsed?.mobile) setEmergencyMobile(String(parsed.mobile));
      } catch (error) {
        console.error("EMERGENCY CONTACT LOAD ERROR:", error);
      }
    }

    loadEmergencyContact();
  }, []);

  useEffect(() => {
    const backAction = () => {
      if (screen === "welcome" || screen === "login" || screen === "home") {
        return false;
      }

      goBack();
      return true;
    };

    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      backAction
    );

    return () => subscription.remove();
  }, [screen, bookingMode]);

  async function refreshCurrentLocation(useAsPickup = false) {
    try {
      setLocationLoading(true);
      const permission = await Location.requestForegroundPermissionsAsync();

      if (permission.status !== Location.PermissionStatus.GRANTED) {
        setMessage("Location permission is required to use your current location.");
        return null;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const nextLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        recordedAt: new Date().toISOString(),
      };

      setUserLocation(nextLocation);

      if (useAsPickup) {
        setPickupLat(nextLocation.latitude);
        setPickupLng(nextLocation.longitude);
        if (!pickup.trim()) {
          setPickup("Current location");
        }
      }

      setMessage(
        `Current location updated${typeof nextLocation.accuracy === "number" ? ` (±${Math.round(nextLocation.accuracy)} m)` : ""}.`
      );
      return nextLocation;
    } catch (error) {
      console.error("CUSTOMER CURRENT LOCATION ERROR:", error);
      setMessage("Unable to get your current location. Check GPS/location services.");
      return null;
    } finally {
      setLocationLoading(false);
    }
  }

  useEffect(() => {
    if (screen === "home" && !pickup.trim()) {
      void refreshCurrentLocation(true);
    }
  }, [screen]);

  useEffect(() => {
    if (screen !== "location" && screen !== "confirmed") {
      locationSubscriptionRef.current?.remove();
      locationSubscriptionRef.current = null;
      return;
    }

    let active = true;

    async function startLocationWatch() {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== Location.PermissionStatus.GRANTED) return;

        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (active) {
          setUserLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            recordedAt: new Date().toISOString(),
          });

          if (screen === "location" && !pickup.trim()) {
            setPickupLat(position.coords.latitude);
            setPickupLng(position.coords.longitude);
            setPickup("Current location");
          }
        }

        locationSubscriptionRef.current?.remove();
        locationSubscriptionRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 5000,
            distanceInterval: 10,
          },
          (next) => {
            if (!active) return;
            setUserLocation({
              latitude: next.coords.latitude,
              longitude: next.coords.longitude,
              accuracy: next.coords.accuracy,
              recordedAt: new Date().toISOString(),
            });
          }
        );
      } catch (error) {
        console.error("CUSTOMER LOCATION WATCH ERROR:", error);
      }
    }

    void startLocationWatch();

    return () => {
      active = false;
      locationSubscriptionRef.current?.remove();
      locationSubscriptionRef.current = null;
    };
  }, [screen]);

  async function saveGallery(nextPhotos: string[]) {
    const unique = Array.from(new Set(nextPhotos)).slice(0, 50);
    setGalleryPhotos(unique);

    try {
      await AsyncStorage.setItem(
        GALLERY_STORAGE_KEY,
        JSON.stringify(unique)
      );
    } catch (error) {
      console.error("GALLERY SAVE ERROR:", error);
    }
  }

  async function openCamera() {
    try {
      const permission =
        await ImagePicker.requestCameraPermissionsAsync();

      if (!permission.granted) {
        setMessage(
          "Camera permission is required to take a photo."
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.9,
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      await saveGallery([
        result.assets[0].uri,
        ...galleryPhotos,
      ]);
      setMessage("Photo captured and saved to RideX Gallery.");
    } catch (error) {
      console.error("CAMERA ERROR:", error);
      setMessage("Unable to open camera.");
    }
  }

  async function chooseFromGallery() {
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        setMessage(
          "Photo library permission is required to choose photos."
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        selectionLimit: 10,
        quality: 0.9,
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      await saveGallery([
        ...result.assets.map((asset) => asset.uri),
        ...galleryPhotos,
      ]);
      setMessage("Photos added to RideX Gallery.");
    } catch (error) {
      console.error("GALLERY PICK ERROR:", error);
      setMessage("Unable to open photo gallery.");
    }
  }

  async function removePhoto(uri: string) {
    await saveGallery(
      galleryPhotos.filter((photo) => photo !== uri)
    );
  }

  async function saveEmergencyContact() {
    const name = emergencyName.trim();
    const mobileNumber = emergencyMobile.replace(/\D/g, "");

    if (!name) {
      setMessage("Please enter emergency contact name.");
      return;
    }

    if (mobileNumber.length < 10) {
      setMessage("Please enter a valid emergency contact mobile number.");
      return;
    }

    try {
      await AsyncStorage.setItem(
        EMERGENCY_CONTACT_STORAGE_KEY,
        JSON.stringify({ name, mobile: mobileNumber })
      );
      setEmergencyName(name);
      setEmergencyMobile(mobileNumber);
      setMessage("Emergency contact saved on this device.");
    } catch (error) {
      console.error("EMERGENCY CONTACT SAVE ERROR:", error);
      setMessage("Unable to save emergency contact.");
    }
  }

  async function callEmergencyContact() {
    const mobileNumber = emergencyMobile.replace(/\D/g, "");
    if (!mobileNumber) {
      setMessage("Please save an emergency contact first.");
      return;
    }

    try {
      await Linking.openURL(`tel:${mobileNumber}`);
    } catch (error) {
      console.error("CALL CONTACT ERROR:", error);
      setMessage("Unable to start the phone call.");
    }
  }

  async function createSupportCase(subject: string, description: string, priority = "NORMAL") {
    if (!customerId) {
      setMessage("Please login before contacting support.");
      return false;
    }
    try {
      setLoading(true);
      const response = await ridexFetch(`${API}/support/cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorType: "CUSTOMER", actorId: customerId, bookingId: bookingId || undefined, subject, description, priority }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        setMessage(data.message || "Unable to create support case.");
        return false;
      }
      setMessage("Support case created. RideX Support has received your request.");
      return true;
    } catch (error) {
      console.error("SUPPORT CASE ERROR:", error);
      setMessage("Unable to reach RideX Support.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function callSupport() {
    try { await Linking.openURL("tel:+9118001234567"); }
    catch { setMessage("Unable to open the support call."); }
  }

  async function emailSupport() {
    try { await Linking.openURL("mailto:support@ridex.in"); }
    catch { setMessage("Unable to open email."); }
  }

  async function openWhatsAppSupport() {
    const url = "https://wa.me/9118001234567?text=RideX%20Support%20Request";
    try { await Linking.openURL(url); }
    catch { setMessage("Unable to open WhatsApp."); }
  }

  async function triggerSos() {
    if (!bookingId) {
      setMessage("SOS is available from an active booking.");
      return;
    }

    if (!sosConfirm) {
      setMessage("Please confirm before sending SOS.");
      return;
    }

    try {
      setLoading(true);
      setMessage("Sending SOS to RideX Safety...");

      const response = await ridexFetch(`${API}/sos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          bookingId,
          driverId: driverId || undefined,
          latitude: Number(userLocation?.latitude ?? pickupLat),
          longitude: Number(userLocation?.longitude ?? pickupLng),
          reason: sosReason,
          source: "CUSTOMER_APP",
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setMessage(data.message || "Unable to send SOS. Please contact emergency services.");
        return;
      }

      setSosConfirm(false);
      setMessage("SOS sent to RideX Safety.");
    } catch (error) {
      console.error("SOS ERROR:", error);
      setMessage("SOS could not reach RideX Safety. Please use your phone's emergency services.");
    } finally {
      setLoading(false);
    }
  }

  function goBack() {
    if (screen === "qrScanner") { setQrScannerOpen(false); setScreen("confirmed"); return; }
    if (screen === "location") {
      setMessage("");
      setScreen("home");
      return;
    }

    if (screen === "rideType") {
      setMessage("");
      setScreen("location");
      return;
    }

    if (screen === "goods") {
      setMessage("");
      setScreen("home");
      return;
    }

    if (screen === "fare") {
      setMessage("");
      setScreen(
        bookingMode === "GOODS" ? "goods" : "rideType"
      );
      return;
    }

  if (screen === "confirmed") {
      setMessage(
        "Booking is already created. Back returns to the booking summary."
      );
      return;
    }

    if (screen === "payment") {
      setScreen("confirmed");
      return;
    }

    if (screen === "rating") {
      setScreen("payment");
      return;
    }

    if (screen === "gallery") {
      setScreen("home");
      return;
    }

    if (screen === "safety") {
      setScreen(bookingId ? "confirmed" : "home");
      return;
    }

    if (screen === "rebook") {
      setScreen("home");
    }
  }


  async function sendOtp() {
    if (mobile.trim().length !== 10) {
      setMessage("Please enter a valid 10-digit mobile number.");
      return;
    }

    try {
      setLoading(true);
      setMessage("Sending OTP...");

      const response = await ridexFetch(
        `${API}/auth/send-otp`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mobile: mobile.trim(), userType: "CUSTOMER" }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        setMessage(data.message || "Unable to send OTP.");
        return;
      }

      setOtp("");
      setMessage(RIDEX_TEST_MODE ? "OTP sent successfully. Demo OTP: 1234" : "OTP sent successfully.");
      setScreen("otp");
    } catch (error) {
      console.error("SEND OTP ERROR:", error);
      setMessage("Backend not reachable. Check API URL.");
    } finally {
      setLoading(false);
    }
  }

  async function verify() {
    if (otp.trim().length !== 4) {
      setMessage("Please enter 4-digit OTP.");
      return;
    }

    try {
      setLoading(true);
      setMessage("Verifying OTP...");

      const response = await ridexFetch(
        `${API}/auth/verify-otp`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mobile: mobile.trim(),
            otp: otp.trim(),
            userType: "CUSTOMER",
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        setMessage(data.message || "Invalid OTP.");
        return;
      }

      const returnedCustomerId = data.data?.customerId;
      if (!returnedCustomerId) {
        setMessage("Customer ID not received from backend.");
        return;
      }

      setCustomerId(returnedCustomerId);
      try {
        const token = String(data.data?.token || "").trim();
        if (token) await AsyncStorage.setItem(CUSTOMER_AUTH_TOKEN_KEY, token);
        await AsyncStorage.setItem(
          CUSTOMER_SESSION_STORAGE_KEY,
          JSON.stringify({ customerId: returnedCustomerId, token, mobile: mobile.trim() })
        );
      } catch (error) {
        console.error("CUSTOMER SESSION SAVE ERROR:", error);
      }
      setMessage("Login successful!");
      setScreen("home");
    } catch (error) {
      console.error("VERIFY OTP ERROR:", error);
      setMessage("Backend not reachable. Check API URL.");
    } finally {
      setLoading(false);
    }
  }

  async function loadCustomerProfile() {
    if (!customerId) return;
    try {
      const response = await ridexFetch(`${API}/customer/${encodeURIComponent(customerId)}/profile`);
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.success && data.data) {
        setCustomerFullName(String(data.data.fullName || ""));
        setCustomerEmail(String(data.data.email || ""));
      }
    } catch (error) { console.error("CUSTOMER PROFILE LOAD ERROR:", error); }
  }

  async function saveCustomerProfile() {
    if (!customerId || !customerFullName.trim()) { setMessage("Enter your full name."); return; }
    try {
      setProfileSaving(true);
      const response = await ridexFetch(`${API}/customer/${encodeURIComponent(customerId)}/profile`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: customerFullName.trim(), email: customerEmail.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) { setMessage(data?.message || "Unable to save profile."); return; }
      setCustomerFullName(String(data.data?.fullName || customerFullName));
      setCustomerEmail(String(data.data?.email || customerEmail));
      setMessage("Profile updated successfully.");
      setScreen("profile");
    } catch (error) { console.error("CUSTOMER PROFILE SAVE ERROR:", error); setMessage("Unable to save profile."); }
    finally { setProfileSaving(false); }
  }

  async function loadSavedLocations() {
    if (!customerId) return;
    try {
      const response=await ridexFetch(`${API}/customer/${customerId}/saved-locations`);
      const data=await response.json();
      if (response.ok && data.success) setSavedLocations(Array.isArray(data.data) ? data.data : []);
    } catch(e) { console.error("SAVED LOCATIONS ERROR:",e); }
  }

  async function saveCurrentLocation(label: string) {
    if (!customerId || !pickup.trim()) { setMessage("Enter a location first."); return; }
    try {
      const response=await ridexFetch(`${API}/customer/${customerId}/saved-locations`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({label,address:pickup,latitude:pickupLat,longitude:pickupLng})});
      const data=await response.json();
      if (!response.ok || !data.success) { setMessage(data.message || "Unable to save location."); return; }
      await loadSavedLocations();
      setMessage(`${label} saved.`);
    } catch(e) { setMessage("Unable to save location."); }
  }

  async function deleteSavedLocation(id: string) {
    if (!customerId) return;
    try {
      await ridexFetch(`${API}/customer/${customerId}/saved-locations/${id}`,{method:"DELETE"});
      await loadSavedLocations();
    } catch(e) { setMessage("Unable to delete saved location."); }
  }

  async function loadQuick(category = "") {
    try {
      setLoading(true);

      const url = new URL(`${API}/quick-locations/`);
      url.searchParams.set("lat", String(pickupLat));
      url.searchParams.set("lng", String(pickupLng));

      if (category) {
        url.searchParams.set("category", category);
      }

      const response = await ridexFetch(url.toString());
      const data = await response.json();

      if (!response.ok || !data.success) {
        setMessage(
          data.message || "Quick Locations unavailable."
        );
        return;
      }

      setQuick(Array.isArray(data.data) ? data.data : []);
    } catch (error) {
      console.error("QUICK LOCATION ERROR:", error);
      setMessage("Quick Locations unavailable.");
    } finally {
      setLoading(false);
    }
  }

  function chooseQuick(item: any) {
    setDrop(item.name || "");
    setDropLat(Number(item.latitude));
    setDropLng(Number(item.longitude));
    setScreen("rideType");
  }

  async function selectDestinationFromMap(latitude: number, longitude: number) {
    try {
      setDropLat(latitude);
      setDropLng(longitude);
      setDrop("Selected location");
      setMessage("Destination selected. Resolving address...");

      const results = await Location.reverseGeocodeAsync({ latitude, longitude });
      const place = results?.[0];
      if (place) {
        const parts = [place.name, place.street, place.district, place.city, place.region]
          .filter((part, index, arr) => part && arr.indexOf(part) === index);
        if (parts.length) setDrop(parts.join(", "));
      }
      setMessage("Destination selected on map.");
    } catch (error) {
      console.error("CUSTOMER DESTINATION REVERSE GEOCODE ERROR:", error);
      setMessage("Destination selected on map.");
    }
  }

  function continueFromLocation() {
    if (!pickup.trim()) {
      setMessage("Please enter pickup location.");
      return;
    }

    if (!drop.trim() || !Number.isFinite(dropLat) || !Number.isFinite(dropLng)) {
      setMessage("Please select a destination on the map or choose a saved/quick location.");
      return;
    }

    if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) {
      setMessage("Please set your current pickup location first.");
      return;
    }

    setMessage("");
    setScreen("rideType");
  }

  function validateScheduledPickup() {
    if (!scheduled) return null;

    if (bookingMode !== "RIDE" || rideType !== "FULL_RIDE") {
      setMessage("Scheduled pickup is available only for Full Ride.");
      return false;
    }

    const parsed = makeScheduledIso(
      scheduleDate,
      scheduleTime,
      schedulePeriod
    );

    if (!parsed) {
      setMessage(
        "Use date YYYY-MM-DD and time H:MM, then select AM or PM."
      );
      return false;
    }

    if (parsed.getTime() <= Date.now()) {
      setMessage("Scheduled pickup time must be in the future.");
      return false;
    }

    return parsed;
  }

  function calculate() {
    if (!pickup.trim()) {
      setMessage("Please select pickup location.");
      return;
    }

    if (!drop.trim()) {
      setMessage("Please select drop location.");
      return;
    }

    if (
      bookingMode === "RIDE" &&
      (rideType === "SHARED_RIDE" ||
        rideType === "CONNECTION_RIDE") &&
      (passengers < 1 || passengers > 4)
    ) {
      setMessage("Maximum 4 passengers for this ride type.");
      return;
    }

    if (bookingMode === "GOODS" && !goodsType.trim()) {
      setMessage("Please select Parcel Delivery or Goods.");
      return;
    }
    if (bookingMode === "GOODS" && goodsType.trim() === "Parcel Delivery") {
      const kg = Number(weight || 0);
      if (!Number.isFinite(kg) || kg < 1 || kg > 300) { setMessage("Parcel weight must be between 1 kg and 300 kg."); return; }
      setGoodsVehicle("E_RICKSHAW");
    }
    if (bookingMode === "GOODS" && goodsType.trim() !== "Parcel Delivery") {
      setGoodsVehicle("PICKUP_TRUCK");
    }

    if (scheduled && !validateScheduledPickup()) {
      return;
    }

    setFare(Number(estimated));
    setMessage("");
    setScreen("fare");
  }

  async function book() {
    if (!customerId) {
      setMessage("Customer session not found. Please login again.");
      setScreen("login");
      return;
    }

    if (!pickup.trim() || !drop.trim()) {
      setMessage("Please enter pickup and drop locations.");
      return;
    }

    if (
      bookingMode === "RIDE" &&
      (rideType === "SHARED_RIDE" ||
        rideType === "CONNECTION_RIDE") &&
      (passengers < 1 || passengers > 4)
    ) {
      setMessage("Maximum 4 passengers for this ride type.");
      return;
    }

    if (bookingMode === "GOODS" && !goodsType.trim()) {
      setMessage("Please select Parcel Delivery or Goods.");
      return;
    }
    if (bookingMode === "GOODS" && goodsType.trim() === "Parcel Delivery") {
      const kg = Number(weight || 0);
      if (!Number.isFinite(kg) || kg < 1 || kg > 300) { setMessage("Parcel weight must be between 1 kg and 300 kg."); return; }
      setGoodsVehicle("E_RICKSHAW");
    }
    if (bookingMode === "GOODS" && goodsType.trim() !== "Parcel Delivery") {
      setGoodsVehicle("PICKUP_TRUCK");
    }

    const scheduledDate = scheduled
      ? validateScheduledPickup()
      : null;

    if (scheduled && !scheduledDate) {
      return;
    }

    try {
      setLoading(true);
      setMessage("Creating booking...");

      const effectivePassengerCount =
        bookingMode === "RIDE"
          ? rideType === "FULL_RIDE"
            ? 1
            : clampPassengerCount(passengers)
          : 1;

      const body: any = {
        customerId,
        bookingType: bookingMode,
        rideType:
          bookingMode === "RIDE" ? rideType : null,
        pickupAddress: pickup.trim(),
        pickupLat: Number(pickupLat),
        pickupLng: Number(pickupLng),
        dropAddress: drop.trim(),
        dropLat: Number(dropLat),
        dropLng: Number(dropLng),
        passengerCount: effectivePassengerCount,
        estimatedFare: Number(estimated),
        paymentMethod,
        paymentPreference: paymentMethod,
        requestedDurationMinutes: Number(durationMinutes || 0),
        stops: stops,
        timezone: TIMEZONE,
        isScheduled: Boolean(scheduled),
        pickupDatetime:
          scheduled && scheduledDate
            ? scheduledDate.toISOString()
            : undefined,
      };

      if (bookingMode === "GOODS") {
        Object.assign(body, {
          goodsVehicleType: goodsVehicle,
          goodsType: goodsType.trim(),
          goodsWeightKg: Number(weight || 0),
          goodsSize: size,
          receiverName: receiverName.trim(),
          receiverMobile: receiverMobile.trim(),
          waitingMinutes: Number(waiting || 0),
          serviceSubtype: goodsType.trim() === "Parcel Delivery" ? "PARCEL" : "GOODS",
          goodsDescription: goodsDescription.trim() || undefined,
          parcelItems: goodsType.trim() === "Parcel Delivery"
            ? (parcelMode === "MULTI" ? parcelRows : parcelRows.slice(0,1)).filter(row => Number(row.weight) >= 1).map((row, index) => ({
                description: row.description || `Parcel ${index + 1}`,
                weightKg: Number(row.weight),
                pickupAddress: pickup.trim(),
                pickupLat: Number(pickupLat), pickupLng: Number(pickupLng),
                dropAddress: drop.trim(), dropLat: Number(dropLat), dropLng: Number(dropLng),
              }))
            : undefined,
        });
      }


      const response = await ridexFetch(`${API}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setMessage(data.message || "Booking failed.");
        return;
      }

      const booking = data.data?.booking;
      if (!booking?.id) {
        setMessage("Booking ID not received.");
        return;
      }

      const newBookingStatus = booking.status || "NEW";
      const newDriverId =
        booking.assignedDriverId ||
        data.data?.matching?.driverId ||
        "";

      setBookingId(booking.id);
      setBookingStatus(newBookingStatus);
      setDriverId(newDriverId);
      const createdLeg = Array.isArray(booking.legs) ? (booking.legs.find((leg:any)=>!['COMPLETED','CANCELLED'].includes(String(leg.status))) || booking.legs[0]) : null;
      if (createdLeg?.id) setActiveLegId(String(createdLeg.id));

      try {
        await AsyncStorage.setItem(
          CUSTOMER_SESSION_STORAGE_KEY,
          JSON.stringify({
            customerId,
            bookingId: booking.id,
            bookingStatus: newBookingStatus,
          })
        );
      } catch (error) {
        console.error("CUSTOMER BOOKING SESSION SAVE ERROR:", error);
      }

      if (
        booking.estimatedFare !== null &&
        booking.estimatedFare !== undefined
      ) {
        setFare(Number(booking.estimatedFare));
      }

      setScreen("confirmed");
      setMessage(
        scheduled
          ? "Scheduled Full Ride created successfully."
          : "Booking created successfully."
      );
    } catch (error) {
      console.error("BOOKING ERROR:", error);
      setMessage("Backend not reachable. Check API URL.");
    } finally {
      setLoading(false);
    }
  }

  async function callAssignedDriver() {
    try {
      const response = await ridexFetch(`${API}/driver/${encodeURIComponent(driverId)}`);
      const data = await response.json().catch(() => ({}));
      const number = String(data?.data?.mobile || data?.data?.user?.mobile || "").replace(/\D/g, "");
      if (!number) { setMessage("Driver phone number is not available."); return; }
      await Linking.openURL(`tel:${number}`);
    } catch (error) { console.error("CALL ASSIGNED DRIVER ERROR:", error); setMessage("Unable to start the driver call."); }
  }

  async function cancelActiveBooking() {
    if (!bookingId) return;
    try {
      setLoading(true);
      const response = await ridexFetch(`${API}/bookings/${bookingId}/customer-cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId, reason: "Cancelled by customer" }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) { setMessage(data.message || "Unable to cancel ride."); return; }
      setMessage("Ride cancelled successfully.");
      await fetchBooking();
    } catch (error) { console.error("CUSTOMER CANCEL ACTIVE BOOKING ERROR:", error); setMessage("Unable to cancel ride."); }
    finally { setLoading(false); }
  }

  async function customerEndRide() {
    if (!bookingId) return;

    try {
      setLoading(true);
      setMessage("Ending ride...");

      const response = await ridexFetch(
        `${API}/bookings/${bookingId}/customer-end`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerId,
            reason:
              "Customer requested to end the ride early",
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        setMessage(data.message || "Unable to end ride.");
        return;
      }

      setMessage("Ride end request sent successfully.");
      await fetchBooking();
    } catch (error) {
      console.error("CUSTOMER END RIDE ERROR:", error);
      setMessage("Unable to end ride.");
    } finally {
      setLoading(false);
    }
  }

  async function fetchBooking() {
    if (!bookingId) return;

    try {
      const response = await ridexFetch(
        `${API}/bookings/${bookingId}`
      );
      const data = await response.json();

      if (!response.ok || !data.success) return;

      const booking = data.data;

      const nextStatus = booking.status || "NEW";
      setBookingStatus(nextStatus);
      const currentLeg = Array.isArray(booking.legs) ? (booking.legs.find((leg:any) => ["DRIVER_ARRIVED","STARTED","IN_PROGRESS"].includes(String(leg.status))) || booking.legs[0]) : null;
      if (currentLeg?.id) setActiveLegId(String(currentLeg.id));

      if (booking.assignedDriverId) {
        setDriverId(booking.assignedDriverId);
        try {
          const driverResponse = await ridexFetch(
            `${API}/driver/${encodeURIComponent(booking.assignedDriverId)}`
          );
          const driverData = await driverResponse.json().catch(() => ({}));
          if (
            driverResponse.ok &&
            driverData?.success &&
            Number.isFinite(Number(driverData?.data?.location?.latitude)) &&
            Number.isFinite(Number(driverData?.data?.location?.longitude))
          ) {
            setDriverLocation({
              latitude: Number(driverData.data.location.latitude),
              longitude: Number(driverData.data.location.longitude),
              recordedAt: driverData.data.location.recordedAt,
            });
          }
        } catch (error) {
          // Driver location is a live enhancement; booking status remains usable.
          console.log("CUSTOMER DRIVER LOCATION UNAVAILABLE:", error);
        }
      }

      try {
        await AsyncStorage.setItem(
          CUSTOMER_SESSION_STORAGE_KEY,
          JSON.stringify({
            customerId,
            bookingId,
            bookingStatus: nextStatus,
          })
        );
      } catch (error) {
        console.error("CUSTOMER BOOKING SESSION UPDATE ERROR:", error);
      }

      if (
        booking.finalFare !== null &&
        booking.finalFare !== undefined
      ) {
        setFare(Number(booking.finalFare));
      } else if (
        booking.estimatedFare !== null &&
        booking.estimatedFare !== undefined
      ) {
        setFare(Number(booking.estimatedFare));
      }

      if (booking.status === "COMPLETED") {
        setPaymentStatus(
          booking.payment?.status || "SUCCESS"
        );

        const backendPaymentMethod =
          booking.payment?.method;
        if (
          backendPaymentMethod === "CASH" ||
          backendPaymentMethod === "UPI" ||
          backendPaymentMethod === "WALLET"
        ) {
          setPaymentMethod(backendPaymentMethod);
        }

        setDriverLocation(null);
        setScreen("payment");
        return;
      }

      if (booking.status === "CANCELLED") {
        setDriverLocation(null);
        setScreen("rebook");
      }
    } catch (error) {
      console.error("BOOKING STATUS ERROR:", error);
    }
  }

  useEffect(() => {
    if (screen !== "confirmed" || !bookingId) {
      return;
    }

    fetchBooking();
    const timer = setInterval(fetchBooking, 3000);

    return () => clearInterval(timer);
  }, [screen, bookingId]);

  async function rebook() {
    if (!bookingId) {
      setMessage("Booking ID missing.");
      return;
    }

    try {
      setLoading(true);
      setMessage("Booking ride again...");

      const response = await ridexFetch(
        `${API}/bookings/${bookingId}/rebook`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        setMessage(data.message || "Rebook failed.");
        return;
      }

      const booking = data.data?.booking;
      setBookingId(booking?.id || "");
      setBookingStatus(booking?.status || "NEW");
      setDriverId(
        data.data?.matching?.driverId ||
          booking?.assignedDriverId ||
          ""
      );

      if (
        booking?.estimatedFare !== null &&
        booking?.estimatedFare !== undefined
      ) {
        setFare(Number(booking.estimatedFare));
      }

      setScreen("confirmed");
      setMessage("New booking created.");
    } catch (error) {
      console.error("REBOOK ERROR:", error);
      setMessage("Unable to book again.");
    } finally {
      setLoading(false);
    }
  }

  async function submitRating() {
    if (!bookingId) {
      setScreen("home");
      return;
    }

    try {
      setLoading(true);

      const response = await ridexFetch(`${API}/ratings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId,
          customerId,
          driverId,
          stars,
          comment: comment.trim(),
          target: "RIDE",
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setMessage(data.message || "Unable to save rating.");
        return;
      }

      setScreen("home");
      setMessage("Thank you for your rating!");
    } catch (error) {
      console.error("RATING ERROR:", error);
      setScreen("home");
      setMessage("Rating saved locally.");
    } finally {
      setLoading(false);
    }
  }

  async function loadCustomerHistory() {
    if (!customerId) return;
    try {
      const response = await ridexFetch(`${API}/bookings/customer/${encodeURIComponent(customerId)}/history`);
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.success && Array.isArray(data.data)) setCustomerHistory(data.data);
    } catch (error) {
      console.error("CUSTOMER HISTORY ERROR:", error);
    }
  }

  async function startNewBooking() {
    setBookingId("");
    setBookingStatus("NEW");
    setDriverId("");
    setPaymentStatus("");
    setStars(5);
    setComment("");
    setFare(80);
    setBookingMode("RIDE");
    setRideType("FULL_RIDE");
    setPassengers(1);
    setScheduled(false);
    setScheduleDate(makeTomorrowDate());
    setScheduleTime("09:00");
    setSchedulePeriod("AM");
    setGoodsVehicle("E_RICKSHAW");
    setGoodsType("");
    setWeight("");
    setSize("SMALL");
    setReceiverName("");
    setReceiverMobile("");
    setWaiting("0");
    setDurationMinutes("60");
    setStops([]);
    setVerificationMethod("OTP");
    setVerificationCredential("");
    setActiveLegId("");
    setDriverLocation(null);
    setMessage("");
    setScreen("home");
    try {
      await AsyncStorage.setItem(
        CUSTOMER_SESSION_STORAGE_KEY,
        JSON.stringify({ customerId })
      );
    } catch (error) {
      console.error("CUSTOMER RESET SESSION ERROR:", error);
    }
  }

  async function logoutCustomer() {
    setLoading(true);
    try {
      try {
        await ridexFetch(`${API}/auth/logout`, { method: "POST", headers: { "Content-Type": "application/json" } });
      } catch (error) { console.log("CUSTOMER LOGOUT BACKEND UNAVAILABLE:", error); }
      await AsyncStorage.multiRemove([CUSTOMER_AUTH_TOKEN_KEY, CUSTOMER_SESSION_STORAGE_KEY]);
    } catch (error) { console.error("CUSTOMER LOGOUT ERROR:", error); }
    finally {
      setCustomerId(""); setMobile(""); setOtp(""); setBookingId(""); setBookingStatus("NEW"); setDriverId("");
      setDriverLocation(null); setActiveLegId(""); setVerificationCredential(""); setPaymentStatus("");
      setMessage(""); setLoading(false); setScreen("login");
    }
  }


  const statusTheme = getStatusTheme(bookingStatus, bookingMode);
  const isSearching =
    bookingStatus === "NEW" ||
    bookingStatus === "MATCHING" ||
    bookingStatus === "PENDING";
  const isAssigned =
    bookingStatus === "DRIVER_ASSIGNED" ||
    bookingStatus === "DRIVER_ARRIVING";
  const isArrived = bookingStatus === "DRIVER_ARRIVED";
  const isTripStarted =
    bookingStatus === "STARTED" ||
    bookingStatus === "IN_PROGRESS";

  if (screen === "welcome") {
    return (
      <ScreenShell>
        <View style={s.welcomeHero}>
          <TopLanguage />
          <BrandLogo large />
          <Text style={s.tagline}>Your Ride, Your Way</Text>
          <Text style={s.heroSubline}>SAFE  |  CLEAN  |  AFFORDABLE  |  GREENER CITIES</Text>

          <View style={s.welcomeHeroImageWrap}>
            <Image
              source={CUSTOMER_ASSETS.hero}
              resizeMode="contain"
              style={s.welcomeHeroImage}
            />
          </View>

          <View style={s.serviceMiniRow}>
            {[
              ["ride", "Ride", "Go Anywhere"],
              ["shared", "Shared Ride", "Save Together"],
              ["parcel", "Parcel", "Send with Trust"],
              ["support", "Office Ride", "Daily Commute"],
            ].map(([icon, title, sub]) => (
              <View key={title} style={s.serviceMiniCard}>
                <View style={s.serviceMiniIcon}>
                  <AssetIcon name={icon} size={24} />
                </View>
                <Text style={s.serviceMiniTitle}>{title}</Text>
                <Text style={s.serviceMiniSub}>{sub}</Text>
              </View>
            ))}
          </View>

          <PrimaryButton
            title="Get Started"
            onPress={() => setScreen("login")}
            trailing="→"
          />
          <OutlineButton
            title="Login to Your Account"
            onPress={() => setScreen("login")}
          />

          <View style={s.dividerWithText}>
            <View style={s.dividerLine} />
            <Text style={s.muted}>Mobile + OTP first</Text>
            <View style={s.dividerLine} />
          </View>
          <Text style={s.authNote}>After first mobile + OTP login, Google, Apple or Facebook can be linked from Profile when backend social linking is enabled.</Text>

          <Text style={s.terms}>
            By continuing, you agree to our <Text style={s.redText}>Terms & Privacy Policy</Text>
          </Text>
        </View>
      </ScreenShell>
    );
  }

  if (screen === "login") {
    return (
      <ScreenShell>
        <AuthHeader onBack={() => setScreen("welcome")} />
        <View style={s.authHero}>
          <BrandLogo />
          <View style={s.authScene}><Image source={CUSTOMER_ASSETS.hero} resizeMode="contain" style={s.authSceneImage} /><View style={s.authSceneShade} /></View>
        </View>

        <Card style={s.authCard}>
          <Text style={s.authTitle}>Login or Sign Up</Text>
          <Text style={s.authSubtitle}>Enter your mobile number to continue</Text>
          <View style={s.phoneInput}>
            <Text style={s.flag}>🇮🇳</Text>
            <Text style={s.countryCode}>+91</Text>
            <View style={s.verticalLine} />
            <TextInput
              style={s.phoneTextInput}
              placeholder="98765 43210"
              keyboardType="phone-pad"
              maxLength={10}
              value={mobile}
              onChangeText={setMobile}
              placeholderTextColor={COLORS.muted}
            />
          </View>

          <PrimaryButton
            title={loading ? "Sending..." : "Send OTP"}
            onPress={sendOtp}
            disabled={loading}
            trailing="→"
          />

          {onBeDriver ? (
            <OutlineButton title="Be a Rider" onPress={onBeDriver} />
          ) : null}

          {onAdminLogin ? (
            <Pressable style={{ marginTop: 10, alignItems: "center", paddingVertical: 8 }} onPress={onAdminLogin}>
              <Text style={{ color: COLORS.muted, fontSize: 12, fontWeight: "700" }}>Admin Login</Text>
            </Pressable>
          ) : null}

          <View style={s.dividerWithText}>
            <View style={s.dividerLine} />
            <Text style={s.muted}>Secure first login</Text>
            <View style={s.dividerLine} />
          </View>
          <Text style={s.authNote}>RideX requires mobile number + OTP for the first login. Social accounts are added later from Profile, not used for initial account creation.</Text>

          <View style={s.featureRibbon}>
            <FeatureItem icon="🛡" title="Safe" sub="Rides" />
            <FeatureItem icon="🍃" title="Clean" sub="& Green" />
            <FeatureItem icon="₹" title="Affordable" sub="Travel" />
            <FeatureItem icon="👥" title="Stronger" sub="Communities" />
          </View>

          <Text style={s.terms}>
            By continuing, you agree to our <Text style={s.redText}>Terms & Privacy Policy</Text>
          </Text>
          <Text style={s.message}>{message}</Text>
        </Card>
      </ScreenShell>
    );
  }

  if (screen === "otp") {
    return (
      <ScreenShell>
        <AuthHeader onBack={() => setScreen("login")} />
        <View style={s.authHero}>
          <BrandLogo />
          <View style={s.authScene}><Image source={CUSTOMER_ASSETS.hero} resizeMode="contain" style={s.authSceneImage} /><View style={s.authSceneShade} /></View>
        </View>

        <Card style={s.authCard}>
          <Text style={s.authTitle}>Verify OTP</Text>
          <Text style={s.authSubtitle}>We have sent a 4-digit OTP to</Text>
          <Text style={s.otpMobile}>+91 {mobile}</Text>

          <TextInput
            style={s.otpInput}
            placeholder="1234"
            placeholderTextColor={COLORS.muted}
            keyboardType="number-pad"
            maxLength={4}
            value={otp}
            onChangeText={(value) => setOtp(value.replace(/\D/g, "").slice(0, 4))}
            autoFocus
            textAlign="center"
          />

          {RIDEX_TEST_MODE ? <Text style={s.otpHint}>Demo OTP: 1234</Text> : null}

          <PrimaryButton
            title={loading ? "Verifying..." : "Verify & Continue"}
            onPress={verify}
            disabled={loading}
            trailing="→"
          />

          <OutlineButton
            title="← Change Mobile Number"
            onPress={() => {
              setOtp("");
              setMessage("");
              setScreen("login");
            }}
          />

          <View style={s.featureRibbon}>
            <FeatureItem icon="🛡" title="Safe" sub="Rides" />
            <FeatureItem icon="🍃" title="Clean" sub="& Green" />
            <FeatureItem icon="₹" title="Affordable" sub="Travel" />
            <FeatureItem icon="👥" title="Stronger" sub="Communities" />
          </View>

          <Text style={s.message}>{message}</Text>
        </Card>
      </ScreenShell>
    );
  }

  if (screen === "home") {
    return (
      <ScreenShell scroll>
        <View style={s.homeTopHero}>
          <View style={s.homeTopRow}>
            <Pressable style={s.iconButton} onPress={() => setScreen("profile")}>
              <AssetIcon name="menu" size={24} />
            </Pressable>
            <BrandLogo />
            <View style={s.homeRightActions}>
              <Pressable style={s.locationPill}>
                <AssetIcon name="pickup" size={16} />
                <Text style={s.locationPillText}>Patna</Text>
                <Text style={s.locationPillText}>⌄</Text>
              </Pressable>
              <Pressable style={s.bellButton} onPress={() => setScreen("support")}>
                <AssetIcon name="notification" size={23} />
              </Pressable>
            </View>
          </View>

          <View style={s.homeHeroVisual}>
            <Text style={s.homeScript}>Move Together{"\n"}A Smarter{"\n"}Tomorrow</Text>
            <VehicleIllustration kind="E_RICKSHAW" hero />
            <View style={s.promiseRow}>
              <FeatureItem icon="🛡" title="Safe Rides" />
              <FeatureItem icon="🍃" title="Clean & Green" />
              <FeatureItem icon="₹" title="Affordable" />
              <FeatureItem icon="👥" title="Stronger" />
            </View>
          </View>
        </View>

        <View style={s.homeContent}>
          <Card>
            <View style={s.sectionHeaderRow}>
              <Text style={s.sectionTitleLarge}>📍 Where are you going?</Text>
              <PillButton label="🗺 On Map" onPress={() => setScreen("location")} />
            </View>
            <View style={s.routeInputCard}>
              <RoutePoint
                active
                color={COLORS.blue}
                title="Your current location"
                value={pickup || "Detecting current location…"}
                onPress={() => {
                  void refreshCurrentLocation(true);
                  setScreen("location");
                }}
              />
              <RoutePoint
                color={COLORS.red}
                title="Enter destination"
                value={drop || "Search location, area or landmark"}
                onPress={() => setScreen("location")}
              />
            </View>
            <View style={[s.routeInputCard,{marginTop:12}]}>
              <Text style={s.cardTitle}>Booking Duration</Text>
              <TextInput style={s.scheduleInput} value={durationMinutes} onChangeText={setDurationMinutes} keyboardType="number-pad" placeholder="Minutes" />
              <Text style={s.cardTitle}>Stops (optional)</Text>
              <TextInput style={s.scheduleInput} value={stops.join(" • ")} onChangeText={(v)=>setStops(v ? v.split("•").map(x=>x.trim()).filter(Boolean) : [])} placeholder="Stop 1 • Stop 2 • Stop 3" />
            </View>
          </Card>

          <Card style={{ backgroundColor: COLORS.mapBg }}>
            <RideXMap
              pickupLat={pickupLat}
              pickupLng={pickupLng}
              dropLat={dropLat}
              dropLng={dropLng}
              pickupLabel={pickup}
              dropLabel={drop}
              showVehicles
              compact
              currentLocation={userLocation}
            />
          </Card>

          <View style={s.quickPlacesRow}>
            {[
              ["⌂", "Home", "Add"],
              ["▣", "Work", "Add"],
              ["●", "Add Location", ""],
              ["★", "Saved Places", ""],
            ].map(([icon, title, sub]) => (
              <Pressable key={title} style={s.quickPlace} onPress={() => setScreen("location")}>
                <LegacyIcon glyph={icon} size={24} />
                <Text style={s.quickPlaceTitle}>{title}</Text>
                {sub ? <Text style={s.quickPlaceSub}>{sub}</Text> : null}
              </Pressable>
            ))}
          </View>

          <View style={s.rideChoiceRow}>
            <RideChoice
              selected={bookingMode === "RIDE"}
              icon="🛺"
              title="Passenger"
              price="Full · Share · Connect"
              onPress={() => { setBookingMode("RIDE"); setRideType("FULL_RIDE"); setPassengers(1); setScreen("rideType"); }}
            />
            <RideChoice
              selected={bookingMode === "GOODS" && goodsType === "Parcel Delivery"}
              icon="📦"
              title="Parcel"
              price="1–300 kg"
              onPress={() => { setBookingMode("GOODS"); setGoodsVehicle("E_RICKSHAW"); setGoodsType("Parcel Delivery"); setParcelMode("FULL"); setScreen("goods"); }}
            />
            <RideChoice
              selected={bookingMode === "GOODS" && goodsType === "Goods"}
              icon="🛻"
              title="Goods"
              price="Battery Pickup"
              onPress={() => { setBookingMode("GOODS"); setGoodsVehicle("PICKUP_TRUCK"); setGoodsType("Goods"); setScreen("goods"); }}
            />
          </View>
        </View>
      </ScreenShell>
    );
  }

  if (screen === "location") {
    return (
      <ScreenShell scroll>
        <HeaderBar title="Choose Location" onBack={goBack} right={<TopLanguage />} />
        <View style={s.mapLargeWrap}>
          <RideXMap
            pickupLat={pickupLat}
            pickupLng={pickupLng}
            dropLat={dropLat}
            dropLng={dropLng}
            pickupLabel={pickup}
            dropLabel={drop}
            showVehicles
            currentLocation={userLocation}
            onCurrentLocationPress={() => { void refreshCurrentLocation(true); }}
            onMapPress={(coordinate) => { void selectDestinationFromMap(coordinate.latitude, coordinate.longitude); }}
          />
          <View style={s.mapTopInputs}>
            <RoutePoint color={COLORS.red} title="Pickup Location" value={pickup || "Getting current location..."} />
            <RoutePoint color={COLORS.red} title="Destination" value={drop || "Tap the map to select destination"} />
          </View>
                    <Pressable
            style={[s.mapCenterButton, locationLoading && s.mapCenterButtonLoading]}
            onPress={() => { void refreshCurrentLocation(true); }}
            disabled={locationLoading}
          >
            <AssetIcon name={locationLoading ? "clock" : "recenter"} size={24} />
          </Pressable>
          <PillButton label="Map" red />
        </View>

        <Card>
          <Text style={s.cardTitle}>Saved Places</Text>
          <View style={s.quickPlacesRow}>
            <Pressable style={s.quickPlace} onPress={() => void saveCurrentLocation("Home")}>
              <AssetIcon name="homeSaved" size={24} /><Text style={s.quickPlaceTitle}>Home</Text><Text style={s.quickPlaceSub}>Save</Text>
            </Pressable>
            <Pressable style={s.quickPlace} onPress={() => void saveCurrentLocation("Work")}>
              <AssetIcon name="workSaved" size={24} /><Text style={s.quickPlaceTitle}>Work</Text><Text style={s.quickPlaceSub}>Save</Text>
            </Pressable>
          </View>
          {savedLocations.map((item) => (
            <View key={item.id} style={s.savedRow}>
              <Pressable style={{flex:1,flexDirection:"row",alignItems:"center",gap:10}} onPress={() => { setDrop(item.address); setDropLat(Number(item.latitude)); setDropLng(Number(item.longitude)); setScreen("rideType"); }}>
                <AssetIcon name={item.label === "Home" ? "homeSaved" : item.label === "Work" ? "workSaved" : "pickup"} size={20} />
                <View style={{flex:1}}><Text style={s.savedTitle}>{item.label}</Text><Text style={s.savedSub}>{item.address}</Text></View>
              </Pressable>
              <Pressable onPress={() => void deleteSavedLocation(item.id)}><AssetIcon name="close" size={16} /></Pressable>
            </View>
          ))}
          {savedLocations.length === 0 ? <Text style={s.savedSub}>No saved places yet. Save Home or Work above.</Text> : null}

          <View style={s.locationFormRow}>
            <TextInput
              style={s.compactInput}
              placeholder="Pickup location"
              value={pickup}
              onChangeText={(value) => {
                setPickup(value);
                if (value.trim() !== "Current location") {
                  setPickupLat(Number.NaN);
                  setPickupLng(Number.NaN);
                }
              }}
              placeholderTextColor={COLORS.muted}
            />
            <TextInput
              style={s.compactInput}
              placeholder="Destination"
              value={drop}
              onChangeText={(value) => {
                setDrop(value);
                setDropLat(Number.NaN);
                setDropLng(Number.NaN);
              }}
              placeholderTextColor={COLORS.muted}
            />
          </View>

          <View style={s.helpBanner}>
            <AssetIcon name="truck" size={42} />
            <View style={{ flex: 1 }}>
              <Text style={s.helpBannerTitle}>Need to Move Goods?</Text>
              <Text style={s.helpBannerSub}>Book Pickup Truck for items, luggage or business needs.</Text>
            </View>
            <Pressable onPress={() => {
              setBookingMode("GOODS");
              setGoodsVehicle("PICKUP_TRUCK");
              setScreen("goods");
            }}>
              <Text style={s.redText}>Select Truck ›</Text>
            </Pressable>
          </View>

          <PrimaryButton
            title="Confirm Pickup Location"
            trailing="→"
            onPress={continueFromLocation}
          />
          <View style={s.safeNoteRow}><AssetIcon name="safety" size={18}/><Text style={s.safeNote}>Your location is safe and secure with RideX</Text></View>

          <Text style={s.sectionLabel}>Quick Locations</Text>
          <View style={s.chipRow}>
            {["Hospital", "Market", "Computer Shop", "Electronics", "Showroom"].map((category) => (
              <Pressable
                key={category}
                style={[s.chip, quickCategory === category && s.chipSelected]}
                onPress={() => {
                  setQuickCategory(category);
                  loadQuick(category);
                }}
              >
                <Text style={s.chipText}>{category}</Text>
              </Pressable>
            ))}
          </View>
          {quick.map((item) => (
            <Pressable
              key={item.id}
              style={s.savedRow}
              onPress={() => chooseQuick(item)}
            >
              <AssetIcon name="pickup" size={18} />
              <View style={{ flex: 1 }}>
                <Text style={s.savedTitle}>{item.name}</Text>
                <Text style={s.savedSub}>{item.address}</Text>
              </View>
              <AssetIcon name="chevron_right" size={16} />
            </Pressable>
          ))}
        </Card>
      </ScreenShell>
    );
  }

  if (screen === "rideType") {
    return (
      <ScreenShell>
        <HeaderBar title="Choose Your Ride" onBack={goBack} right={<TopLanguage />} />
        <View style={s.rideMapTop}>
          <RideXMap pickupLat={pickupLat} pickupLng={pickupLng} dropLat={dropLat} dropLng={dropLng} pickupLabel={pickup} dropLabel={drop} showVehicles />
          <View style={s.routeSummary}>
            <View style={{ flex: 1 }}>
              <RoutePoint color={COLORS.red} title="Pickup" value={pickup || "Boring Road, Patna"} />
              <RoutePoint color={COLORS.red} title="Drop" value={drop || "Tap the map to select destination"} />
            </View>
            <View style={s.distanceBadge}>
              <Text style={s.distanceBig}>{previewDistanceKm.toFixed(1)} km</Text>
              <Text style={s.distanceSmall}>~ 18 mins</Text>
            </View>
          </View>
        </View>

        <View style={s.modeToggle}>
          <Pressable style={[s.modeToggleItem, s.modeActive]} onPress={() => {
            setBookingMode("RIDE");
          }}>
            <AssetIcon name="passengers" size={32} />
            <View>
              <Text style={s.modeTitle}>For Passengers</Text>
              <Text style={s.modeSub}>Auto, Shared, Connecting</Text>
            </View>
          </Pressable>
          <Pressable style={s.modeToggleItem} onPress={() => {
            setBookingMode("GOODS");
            setScreen("goods");
          }}>
            <AssetIcon name="parcel" size={32} />
            <View>
              <Text style={s.modeTitle}>For Goods</Text>
              <Text style={s.modeSub}>Parcel & Pickup Truck</Text>
            </View>
          </Pressable>
        </View>

        <Text style={s.sectionTitleLarge}>Choose Your Ride</Text>
        <RideOption
          selected={rideType === "FULL_RIDE"}
          icon="🛺"
          title="Auto"
          subtitle="Direct & Comfortable"
          meta="1–4"
          fare="₹30 – ₹60"
          onPress={() => {
            setRideType("FULL_RIDE");
            setPassengers(1);
          }}
        />
        <RideOption
          selected={rideType === "SHARED_RIDE"}
          icon="👥"
          title="Shared Auto"
          subtitle="Share ride, Save more"
          meta="1–3"
          fare="₹20 – ₹40"
          onPress={() => setRideType("SHARED_RIDE")}
        />
        <RideOption
          selected={rideType === "CONNECTION_RIDE"}
          icon="🔗"
          title="Connecting Auto"
          subtitle="For longer routes (with change)"
          meta="1–6"
          fare="₹40 – ₹70"
          onPress={() => setRideType("CONNECTION_RIDE")}
        />

        {(rideType === "SHARED_RIDE" || rideType === "CONNECTION_RIDE") && (
          <Card>
            <Text style={s.cardTitle}>Passengers</Text>
            <View style={s.chipRow}>
              {[1,2,3,4].map((n) => (
                <Pressable key={n} style={[s.chip, passengers === n && s.chipSelected]} onPress={() => setPassengers(n)}>
                  <Text style={s.chipText}>{n} passenger{n > 1 ? "s" : ""}</Text>
                </Pressable>
              ))}
            </View>
          </Card>
        )}

        {rideType === "FULL_RIDE" && (
          <Card>
            <View style={s.sectionHeaderRow}>
              <Text style={s.cardTitle}>Schedule</Text>
              <Pressable style={[s.switchPill, scheduled && s.switchPillOn]} onPress={() => setScheduled(!scheduled)}>
                <Text style={s.switchText}>{scheduled ? "ON" : "NOW"}</Text>
              </Pressable>
            </View>
            {scheduled ? (
              <View style={s.scheduleGrid}>
                <View style={s.scheduleDateTimeRow}>
                  <TextInput
                    style={s.scheduleDateInput}
                    value={scheduleDate}
                    onChangeText={setScheduleDate}
                    placeholder="YYYY-MM-DD"
                    keyboardType="numbers-and-punctuation"
                    autoCapitalize="none"
                  />
                  <TextInput
                    style={s.scheduleTimeInput}
                    value={scheduleTime}
                    onChangeText={setScheduleTime}
                    placeholder="09:00"
                    keyboardType="numbers-and-punctuation"
                    autoCapitalize="none"
                  />
                </View>
                <View style={s.schedulePeriodRow}>
                  <Pressable
                    style={[s.schedulePeriodButton, schedulePeriod === "AM" && s.chipSelected]}
                    onPress={() => setSchedulePeriod("AM")}
                  >
                    <Text style={s.schedulePeriodText}>AM</Text>
                  </Pressable>
                  <Pressable
                    style={[s.schedulePeriodButton, schedulePeriod === "PM" && s.chipSelected]}
                    onPress={() => setSchedulePeriod("PM")}
                  >
                    <Text style={s.schedulePeriodText}>PM</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </Card>
        )}

        <View style={s.paymentOfferRow}>
          <SoftTile icon="▣" title="Pay with" sub="UPI, Wallet or Cash" />
          <SoftTile icon="%" title="Have a Promo Code?" sub="Apply & Save more" />
        </View>
        <PrimaryButton title="Book Ride" trailing="→" onPress={calculate} />
        <BottomNav active="book" onHome={() => setScreen("home")} onRides={() => setScreen("rides")} onWallet={() => setScreen("support")} onProfile={() => setScreen("profile")} />
      </ScreenShell>
    );
  }

  if (screen === "goods") {
    return (
      <ScreenShell>
        <HeaderBar title="Choose Goods Service" onBack={goBack} right={<TopLanguage />} />
        <View style={s.rideMapTop}>
          <RideXMap pickupLat={pickupLat} pickupLng={pickupLng} dropLat={dropLat} dropLng={dropLng} pickupLabel={pickup} dropLabel={drop} showVehicles goods />
          <View style={s.routeSummary}>
            <View style={{ flex: 1 }}>
              <RoutePoint color={COLORS.red} title="Pickup" value={pickup || "Boring Road, Patna"} />
              <RoutePoint color={COLORS.red} title="Drop" value={drop || "Tap the map to select destination"} />
            </View>
            <View style={s.distanceBadge}>
              <Text style={s.distanceBig}>{previewDistanceKm.toFixed(1)} km</Text>
              <Text style={s.distanceSmall}>~ 18 mins</Text>
            </View>
          </View>
        </View>

        <View style={s.modeToggle}>
          <Pressable style={s.modeToggleItem} onPress={() => { setBookingMode("RIDE"); setScreen("rideType"); }}>
            <AssetIcon name="passengers" size={32} />
            <View><Text style={s.modeTitle}>Passenger</Text><Text style={s.modeSub}>Full · Share · Connection</Text></View>
          </Pressable>
          <Pressable style={[s.modeToggleItem, s.modeActive]}>
            <AssetIcon name={goodsType === "Parcel Delivery" ? "parcel" : "truck"} size={32} />
            <View><Text style={s.modeTitle}>{goodsType === "Parcel Delivery" ? "Parcel Delivery" : "Goods Booking"}</Text><Text style={s.modeSub}>{goodsType === "Parcel Delivery" ? "Passenger E-Rickshaw only" : "Battery Pickup Truck only"}</Text></View>
          </Pressable>
        </View>

        {goodsType === "Parcel Delivery" ? (
          <>
            <Text style={s.sectionTitleLarge}>Parcel Booking</Text>
            <View style={s.chipRow}>
              <Pressable style={[s.chip, parcelMode === "FULL" && s.chipSelected]} onPress={() => setParcelMode("FULL")}><Text style={s.chipText}>Full Parcel</Text></Pressable>
              <Pressable style={[s.chip, parcelMode === "MULTI" && s.chipSelected]} onPress={() => setParcelMode("MULTI")}><Text style={s.chipText}>Multi Parcel</Text></Pressable>
            </View>
            {(parcelMode === "MULTI" ? parcelRows : parcelRows.slice(0,1)).map((row, index) => (
              <Card key={index} style={{marginTop:10}}>
                <Text style={s.cardTitle}>Parcel {index + 1}</Text>
                <View style={s.twoInputRow}>
                  <TextInput style={[s.compactInput,{flex:1}]} placeholder="Weight (kg)" keyboardType="numeric" value={row.weight} onChangeText={v=>setParcelRows(rows=>rows.map((r,i)=>i===index?{...r,weight:v}:r))} />
                  <TextInput style={[s.compactInput,{flex:1}]} placeholder="Description" value={row.description} onChangeText={v=>setParcelRows(rows=>rows.map((r,i)=>i===index?{...r,description:v}:r))} />
                </View>
              </Card>
            ))}
            {parcelMode === "MULTI" && parcelRows.length < 10 ? <OutlineButton title="+ Add Parcel" onPress={() => setParcelRows(rows => [...rows,{weight:"",description:""}])} /> : null}
            <Text style={s.safeNote}>Passenger E-Rickshaw • Parcel capacity 1–300 kg per parcel</Text>
          </>
        ) : (
          <>
            <Text style={s.sectionTitleLarge}>Goods Vehicle Booking</Text>
            <GoodsOption
              selected={goodsVehicle === "PICKUP_TRUCK"}
              icon="🛻"
              title="Battery Pickup Truck"
              subtitle="Goods only • no passenger / parcel"
              meta="Dedicated goods vehicle"
              fare="Duration + distance rules"
              onPress={() => setGoodsVehicle("PICKUP_TRUCK")}
/>
            <Card style={{marginTop:10}}>
              <Text style={s.cardTitle}>Goods Details</Text>
              <View style={s.twoInputRow}>
                <TextInput style={[s.compactInput,{flex:1}]} placeholder="Estimated weight (kg)" keyboardType="numeric" value={weight} onChangeText={setWeight} />
                <TextInput style={[s.compactInput,{flex:1}]} placeholder="Description" value={goodsDescription} onChangeText={setGoodsDescription} />
              </View>
              <TextInput style={s.scheduleInput} placeholder="Duration (minutes)" keyboardType="numeric" value={durationMinutes} onChangeText={setDurationMinutes} />
            </Card>
          </>
        )}

        <View style={s.actionTwoCol}>
          <SoftTile icon="◷" title="Schedule for Later" sub="Choose date & time" onPress={() => {
            setBookingMode("RIDE");
            setRideType("FULL_RIDE");
            setScheduled(true);
            setScreen("rideType");
          }} />
          <SoftTile icon="▤" title="Add Note" sub="Fragile, handling info etc." />
        </View>

        <View style={s.actionTwoCol}>
          <SoftTile icon="▣" title="Pay with" sub="UPI, Wallet or Cash" />
          <SoftTile icon="%" title="Promo Code" sub="Apply & Save more" />
        </View>

        <PrimaryButton title="Confirm Goods Booking" trailing="→" onPress={() => {
          if (!pickup.trim() || !drop.trim() || !goodsType.trim()) {
            setMessage("Please enter pickup, drop and goods type.");
            return;
          }
          setFare(Number(estimated));
          setScreen("fare");
        }} />
        <View style={s.safeNoteRow}><AssetIcon name="security" size={18}/><Text style={s.safeNote}>Your goods are safe and secure with RideX</Text></View>
        <Text style={s.message}>{message}</Text>
      </ScreenShell>
    );
  }

  if (screen === "fare") {
    return (
      <ScreenShell>
        <HeaderBar title="Review & Confirm" onBack={goBack} right={<SupportPill onPress={() => setScreen("support")} />} />
        <ProgressSteps active={bookingMode === "GOODS" ? "Details" : "Review"} />
        <View style={s.mapReviewTop}>
          <RideXMap
            pickupLat={pickupLat}
            pickupLng={pickupLng}
            dropLat={dropLat}
            dropLng={dropLng}
            pickupLabel={pickup}
            dropLabel={drop}
            showVehicles={false}
            goods={bookingMode === "GOODS"}
            currentLocation={userLocation}
          />
        </View>

        <Card>
          <View style={s.sectionHeaderRow}>
            <Text style={s.cardTitle}>Selected Vehicle</Text>
            <Pressable onPress={goBack}><Text style={s.redText}>Change</Text></Pressable>
          </View>
          {bookingMode === "GOODS" ? (
            <VehicleSummary icon={goodsType === "Parcel Delivery" ? "📦" : "🛻"} title={goodsType === "Parcel Delivery" ? "Passenger E-Rickshaw · Parcel" : "Battery Pickup Truck · Goods"} fare={`₹${estimated}`} meta={goodsType === "Parcel Delivery" ? "1–300 kg" : "Goods vehicle"} />
          ) : (
            <VehicleSummary icon="🛺" title={rideType === "FULL_RIDE" ? "Auto" : rideType === "SHARED_RIDE" ? "Shared Auto" : "Connecting Auto"} fare={`₹${estimated}`} meta="1–4 passengers" />
          )}
        </Card>

        {bookingMode === "GOODS" ? (
          <Card>
            <View style={s.sectionHeaderRow}>
              <Text style={s.cardTitle}>Goods Details</Text>
              <Text style={s.muted}>Add Details ›</Text>
            </View>
            <View style={s.chipRow}>
              {(["SMALL","MEDIUM","LARGE"] as GoodsSize[]).map((sz) => (
                <Pressable key={sz} style={[s.chip, size === sz && s.chipSelected]} onPress={() => setSize(sz)}>
                  <Text style={s.chipText}>{sz === "SMALL" ? "Small Items" : sz === "MEDIUM" ? "Medium" : "Large"}</Text>
                </Pressable>
              ))}
            </View>
            <View style={s.twoInputRow}>
              <TextInput style={[s.compactInput,{flex:1}]} placeholder="Estimated weight (kg)" keyboardType="numeric" value={weight} onChangeText={setWeight} />
              <TextInput style={[s.compactInput,{flex:1}]} placeholder="Item Description" value={goodsType} onChangeText={setGoodsType} />
            </View>
          </Card>
        ) : (
          <Card>
            <Text style={s.cardTitle}>Ride Details</Text>
            <Text style={s.detailLine}>Ride Type: {formatRideType(rideType)}</Text>
            {(rideType !== "FULL_RIDE") && <Text style={s.detailLine}>Passengers: {passengers}</Text>}
            {scheduled && <Text style={s.detailLine}>Scheduled: {scheduleDate} {scheduleTime} {schedulePeriod}</Text>}
          </Card>
        )}

        <View style={s.actionTwoCol}>
          <SoftTile icon="schedule" title="Schedule" sub={scheduled ? `${scheduleDate} ${scheduleTime} ${schedulePeriod}` : "Now"} />
          <SoftTile icon="note" title="Add Note" sub="Optional" />
        </View>
        <Card>
          <View style={s.sectionHeaderRow}>
            <Text style={s.cardTitle}>Payment Method</Text>
            <Text style={s.muted}>Card payments unavailable</Text>
          </View>
          <View style={s.actionTwoCol}>
            {(["CASH","UPI","WALLET"] as PaymentMethod[]).map(method => (
              <Pressable key={method} style={[s.softCard, paymentMethod === method && s.chipSelected]} onPress={() => setPaymentMethod(method)}>
                <AssetIcon name={method === "CASH" ? "cash" : method === "UPI" ? "upi" : "wallet"} size={26} />
                <Text style={s.softTitle}>{method === "CASH" ? "Cash" : method === "UPI" ? "UPI" : "Wallet"}</Text>
                <Text style={s.softSub}>{method === "CASH" ? "Pay driver" : method === "UPI" ? "Online payment" : "Use balance"}</Text>
              </Pressable>
            ))}
          </View>
        </Card>
        <View style={s.actionTwoCol}>
          <SoftTile icon="promo" title="Promo Code" sub="Apply & Save more" />
        </View>

        <Card style={s.fareHighlight}>
          <Text style={s.fareLabel}>Estimated Fare</Text>
          <Text style={s.fare}>{`₹${fare}`}</Text>
          <Text style={s.muted}>Final fare may vary based on distance and load</Text>
        </Card>

        <PrimaryButton
          title={bookingMode === "GOODS" ? "Confirm Goods Booking" : "Confirm & Book Ride"}
          trailing="→"
          onPress={book}
          disabled={loading}
        />
        <Text style={s.message}>{message}</Text>
      </ScreenShell>
    );
  }

  if (screen === "qrScanner") {
    return <View style={{flex:1,backgroundColor:"#000"}}>
      <CameraView style={{flex:1}} facing="back" barcodeScannerSettings={{barcodeTypes:["qr"]}} onBarcodeScanned={async (event)=>{
        if(!qrScannerOpen) return;
        setQrScannerOpen(false); setScreen("confirmed"); setVerificationCredential(String(event.data||"")); setVerificationMethod("QR");
        try {
          const response=await ridexFetch(`${API}/trips/verification/verify`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({bookingId,legId:activeLegId,method:"QR",credential:String(event.data||"")})});
          const data=await response.json(); setMessage(response.ok && data.success ? "QR verified successfully." : (data.message || "QR verification failed")); await fetchBooking();
        } catch { setMessage("QR verification unavailable"); }
      }} />
      <View style={{position:"absolute",bottom:40,left:20,right:20}}><PrimaryButton title="Close Scanner" onPress={()=>{setQrScannerOpen(false);setScreen("confirmed");}} /></View>
    </View>;
  }

  if (screen === "confirmed") {
    return (
      <ScreenShell>
        <HeaderBar title={bookingMode === "GOODS" ? "RideX Goods" : "RideX Ride"} onBack={goBack} right={<SupportPill onPress={() => setScreen("support")} />} />

        {isSearching ? (
          <SearchState
            goods={bookingMode === "GOODS"}
            pickup={pickup}
            drop={drop}
            pickupLat={pickupLat}
            pickupLng={pickupLng}
            dropLat={dropLat}
            dropLng={dropLng}
            fare={Number(fare)}
            currentLocation={userLocation}
            locationLoading={locationLoading}
            onCurrentLocationPress={() => void refreshCurrentLocation(true)}
          />
        ) : isAssigned ? (
          <AssignedState
            goods={bookingMode === "GOODS"}
            driverId={driverId}
            distanceKm={previewDistanceKm}
            driverLocation={driverLocation}
            currentLocation={userLocation}
                    pickup={pickup}
            drop={drop}
            pickupLat={pickupLat}
            pickupLng={pickupLng}
            dropLat={dropLat}
            dropLng={dropLng}
            locationLoading={locationLoading}
            onCurrentLocationPress={() => void refreshCurrentLocation(false)}
            onSafety={() => { setSosConfirm(false); setScreen("safety"); }}
            onChat={() => void createSupportCase("Ride Chat", "Customer requested chat about the active ride.", "NORMAL").then(ok => { if (ok) setScreen("support"); })}
            onCancel={() => void cancelActiveBooking()}
            onCall={() => void callAssignedDriver()}
          />
        ) : isArrived ? (
          <ArrivedState
            goods={bookingMode === "GOODS"}
            driverLocation={driverLocation}
            driverId={driverId}
            currentLocation={userLocation}
            pickup={pickup}
            drop={drop}
            pickupLat={pickupLat}
            pickupLng={pickupLng}
            dropLat={dropLat}
            dropLng={dropLng}
            locationLoading={locationLoading}
            onCurrentLocationPress={() => void refreshCurrentLocation(false)}
            onSafety={() => { setSosConfirm(false); setScreen("safety"); }}
            onChat={() => void createSupportCase("Ride Chat", "Customer requested chat about the active ride.", "NORMAL").then(ok => { if (ok) setScreen("support"); })}
            onCancel={() => void cancelActiveBooking()}
            onCall={() => void callAssignedDriver()}
          />
        ) : isTripStarted ? (
          <TripInProgressState
            goods={bookingMode === "GOODS"}
            driverLocation={driverLocation}
            driverId={driverId}
            currentLocation={userLocation}
            pickup={pickup}
            drop={drop}
            pickupLat={pickupLat}
            pickupLng={pickupLng}
            dropLat={dropLat}
            dropLng={dropLng}
            locationLoading={locationLoading}
            onCurrentLocationPress={() => void refreshCurrentLocation(false)}
            onSafety={() => { setSosConfirm(false); setScreen("safety"); }}
            onChat={() => void createSupportCase("Ride Chat", "Customer requested chat about the active ride.", "NORMAL").then(ok => { if (ok) setScreen("support"); })}
            onCancel={() => void cancelActiveBooking()}
            onCall={() => void callAssignedDriver()}
          />
        ) : (
          <AssignedState
            goods={bookingMode === "GOODS"}
            driverId={driverId}
            distanceKm={previewDistanceKm}
            driverLocation={driverLocation}
            currentLocation={userLocation}
            pickup={pickup}
            drop={drop}
            pickupLat={pickupLat}
            pickupLng={pickupLng}
            dropLat={dropLat}
            dropLng={dropLng}
            locationLoading={locationLoading}
            onCurrentLocationPress={() => void refreshCurrentLocation(false)}
            onSafety={() => { setSosConfirm(false); setScreen("safety"); }}
            onChat={() => void createSupportCase("Ride Chat", "Customer requested chat about the active ride.", "NORMAL").then(ok => { if (ok) setScreen("support"); })}
            onCancel={() => void cancelActiveBooking()}
            onCall={() => void callAssignedDriver()}
          />
        )}

        <Card>
          <View style={s.tripInfoRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>Pickup & Drop Details</Text>
              <RoutePoint color={COLORS.red} title="Pickup" value={pickup || "Boring Road, Patna"} />
              <RoutePoint color={COLORS.red} title="Drop" value={drop || "Tap the map to select destination"} />
            </View>
            <View style={s.distancePanel}>
              <Text style={s.distanceBig}>{previewDistanceKm.toFixed(1)} km</Text>
              <Text style={s.distanceSmall}>~ 18 mins</Text>
            </View>
          </View>
        </Card>

        {isArrived && !isTripStarted && (
          <Card style={s.pinCard}>
            <Text style={s.pinTitle}>🔐 Choose Ride Verification</Text>
            <Text style={s.pinSub}>Choose OTP or QR. The backend binds verification to this customer, driver and active leg.</Text>
            <View style={s.actionTwoCol}>
              <Pressable style={[s.softCard, verificationMethod === "OTP" && s.chipSelected]} onPress={()=>setVerificationMethod("OTP")}><Text style={s.softTitle}>OTP</Text><Text style={s.softSub}>Customer OTP</Text></Pressable>
              <Pressable style={[s.softCard, verificationMethod === "QR" && s.chipSelected]} onPress={async()=>{setVerificationMethod("QR"); if(!cameraPermission?.granted) await requestCameraPermission();}}><Text style={s.softTitle}>QR</Text><Text style={s.softSub}>Scan Driver QR</Text></Pressable>
            </View>
            {verificationMethod === "OTP" ? <TextInput value={verificationCredential} onChangeText={v=>setVerificationCredential(v.replace(/\D/g,"").slice(0,4))} style={s.pinInput} keyboardType="number-pad" maxLength={4} placeholder="Enter OTP" /> : <PrimaryButton title="Open QR Scanner" onPress={async()=>{ if(!cameraPermission?.granted) await requestCameraPermission(); setQrScannerOpen(true); setScreen("qrScanner"); }} />}
            <PrimaryButton title="Verify Ride" onPress={async()=>{
              try {
                if(!activeLegId) { await fetchBooking(); }
                const response=await ridexFetch(`${API}/trips/verification/verify`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({bookingId,legId:activeLegId,method:verificationMethod,credential:verificationCredential})});
                const data=await response.json();
                if(!response.ok || !data.success) { setMessage(data.message || "Verification failed"); return; }
                setMessage("Ride verified successfully. Driver can start."); await fetchBooking();
              } catch(e) { setMessage("Unable to verify ride"); }
            }} />
          </Card>
        )}

        {isTripStarted && (
          <Card style={s.verifyCard}>
            <Text style={s.pinTitle}>🔐 Verify Driver & Start Trip</Text>
            <Text style={s.pinSub}>PIN verified • Trip in progress</Text>
            <View style={s.pinBoxes}>
              {[1,2,3,4].map(n => <View key={n} style={s.pinBox}><Text style={s.pinNumber}>{n}</Text></View>)}
            </View>
            <Text style={s.greenText}>✓ PIN verified</Text>
          </Card>
        )}

        <View style={s.actionTwoCol}>
          <SoftTile icon="↗" title="Trip Summary / Share" sub="Share distance, time & vehicle number" onPress={()=>setScreen("rides")} />
          <SoftTile icon="🛡" title="Safety Center" sub="Your safety is our priority" onPress={() => {
            setSosConfirm(false);
            setScreen("safety");
          }} />
        </View>

        {bookingStatus === "IN_PROGRESS" && (
          <PrimaryButton title={loading ? "Ending..." : "End Ride"} onPress={customerEndRide} disabled={loading} />
        )}

        <View style={s.tripBottomRow}>
          <OutlineButton title="Refresh Status" onPress={fetchBooking} />
          <OutlineButton title="Go to Home" onPress={() => setScreen("home")} />
        </View>
      </ScreenShell>
    );
  }

  if (screen === "payment") {
    return (
      <ScreenShell>
        <HeaderBar title="Trip Completed" onBack={() => setScreen("home")} right={<SupportPill onPress={() => setScreen("support")} />} />
        <View style={s.completedBanner}>
          <View style={s.completedCircle}><AssetIcon name="verified" size={38} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.completedTitle}>{bookingMode === "GOODS" ? "Goods Delivered!" : "Trip Completed!"}</Text>
            <Text style={s.completedSub}>You have reached your destination safely.</Text>
          </View>
        </View>

        <RideXMap pickupLat={pickupLat} pickupLng={pickupLng} dropLat={dropLat} dropLng={dropLng} pickupLabel={pickup} dropLabel={drop} completed />

        <Card>
          <DriverSummary driverId={driverId} goods={bookingMode === "GOODS"} />
        </Card>

        <Card style={s.fareReceiptCard}>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>Fare Details</Text>
            <Text style={s.detailLine}>Base Fare <Text style={s.rightAmount}>₹40.00</Text></Text>
            <Text style={s.detailLine}>Distance ({previewDistanceKm.toFixed(1)} km) <Text style={s.rightAmount}>₹{Math.max(20, Math.round(fare * .45)).toFixed(2)}</Text></Text>
            <Text style={s.detailLine}>Time (18 mins) <Text style={s.rightAmount}>₹{Math.max(10, Math.round(fare * .15)).toFixed(2)}</Text></Text>
            <View style={s.receiptTotalRow}>
              <Text style={s.receiptTotalLabel}>Total Fare</Text>
              <Text style={s.receiptTotal}>₹{fare}</Text>
            </View>
          </View>
          <View style={s.paymentSuccess}>
            <AssetIcon name={paymentStatus === "SUCCESS" ? "verified" : paymentMethod === "CASH" ? "cash" : paymentMethod === "UPI" ? "upi" : "wallet"} size={40} />
            <Text style={s.paymentSuccessTitle}>{paymentStatus === "SUCCESS" ? "Payment Successful" : paymentMethod === "CASH" ? "Cash Collection Pending" : "Payment Pending"}</Text>
            <Text style={s.paymentSuccessSub}>{paymentMethod === "CASH" ? "Collect from the driver flow" : `Method: ${paymentMethod}`}</Text>
            <Pressable onPress={() => setScreen("rides")}><Text style={s.redText}>View Receipt ›</Text></Pressable>
          </View>
        </Card>

        <Card>
          <Text style={s.cardTitle}>Rate Your Driver</Text>
          <Text style={s.muted}>How was your ride with the driver?</Text>
          <View style={s.stars}>
            {[1,2,3,4,5].map((n) => (
              <Pressable key={n} onPress={() => setStars(n)}><Text style={n <= stars ? s.starActive : s.starInactive}>★</Text></Pressable>
            ))}
          </View>
          <TextInput
            style={s.commentInput}
            multiline
            placeholder="Write a review (optional)..."
            value={comment}
            onChangeText={setComment}
            placeholderTextColor={COLORS.muted}
          />
          <PrimaryButton title="Submit" onPress={submitRating} disabled={loading} />
        </Card>

        <View style={s.tripBottomRow}>
          <OutlineButton title="Book Another Ride" onPress={startNewBooking} />
          <PrimaryButton title="Go to Home" onPress={() => setScreen("home")} />
        </View>
        <Card style={s.greenThanks}>
          <View style={s.greenThanksRow}><AssetIcon name="verified" size={20} /><Text style={s.greenThanksTitle}>Thank you for riding with RideX!</Text></View>
          <Text style={s.muted}>Safer Cities. Happier Journeys.</Text>
        </Card>
      </ScreenShell>
    );
  }

  if (screen === "rating") {
    return (
      <ScreenShell>
        <HeaderBar title="Rate Your Driver" onBack={goBack} />
        <Card>
          <Text style={s.authTitle}>How was your ride?</Text>
          <View style={s.stars}>
            {[1,2,3,4,5].map((n) => (
              <Pressable key={n} onPress={() => setStars(n)}>
                <Text style={n <= stars ? s.starActive : s.starInactive}>★</Text>
              </Pressable>
            ))}
          </View>
          <TextInput style={s.commentInput} multiline value={comment} onChangeText={setComment} placeholder="Optional comment" />
          <PrimaryButton title={loading ? "Submitting..." : "Submit Rating"} onPress={submitRating} disabled={loading} />
          <OutlineButton title="Skip for now" onPress={() => setScreen("home")} />
        </Card>
      </ScreenShell>
    );
  }

  if (screen === "rides") {
    const history = customerHistory;
    return (
      <ScreenShell>
        <HeaderBar title="My Rides" onBack={() => setScreen("home")} right={<PillButton label="All Rides" />} />
        <Text style={s.authSubtitle}>Your ride history and receipts</Text>
        <View style={s.tabRow}>
          {["All Rides", "Passenger Rides", "Goods Rides"].map((tab, idx) => (
            <Pressable key={tab} style={[s.tab, idx === 0 && s.tabActive]}><Text style={idx === 0 ? s.tabActiveText : s.tabText}>{tab}</Text></Pressable>
          ))}
        </View>
        {!history.length ? <Card><Text style={s.muted}>No rides found yet.</Text></Card> : null}
        {history.map((item, i) => (
          <Card key={item.id || i} style={s.historyCard}>
            <View style={s.historyTop}>
              <Text style={s.historyDate}>{new Date(item.createdAt || Date.now()).toLocaleDateString()}</Text>
              <Text style={s.historyTime}>{new Date(item.createdAt || Date.now()).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}</Text>
              <View style={[s.statusPill, String(item.status) === "CANCELLED" && s.statusCancelled]}><Text style={s.statusPillText}>{String(item.status || "NEW")}</Text></View>
            </View>
            <RoutePoint color={COLORS.green} title="" value={item.pickupAddress || "Pickup"} />
            <RoutePoint color={COLORS.red} title="" value={item.dropAddress || "Drop"} />
            <View style={s.historyBottom}>
              <View><Text style={s.historyFare}>₹{Number(item.finalFare ?? item.estimatedFare ?? 0).toFixed(2)}</Text><Text style={s.muted}>{item.rideType || item.serviceSubtype || item.bookingType || "Ride"}</Text></View>
              <View style={s.historyActions}>
                <OutlineButton title="View Details" onPress={() => { setSelectedHistoryBooking(item); setScreen("rideDetails"); }} small />
                {String(item.status) === "CANCELLED" ? <OutlineButton title="Book Again" onPress={() => setScreen("home")} small /> : <OutlineButton title="View Receipt" onPress={() => { setSelectedHistoryBooking(item); setScreen("rideDetails"); }} small />}
              </View>
            </View>
          </Card>
        ))}
        <BottomNav active="rides" onHome={() => setScreen("home")} onRides={() => setScreen("rides")} onWallet={() => setScreen("support")} onProfile={() => setScreen("profile")} />
      </ScreenShell>
    );
  }

  if (screen === "rideDetails") {
    const item = selectedHistoryBooking;
    if (!item) return <ScreenShell><HeaderBar title="Ride Details" onBack={() => setScreen("rides")} /><Card><Text style={s.muted}>Ride not found.</Text></Card></ScreenShell>;
    return (
      <ScreenShell>
        <HeaderBar title="Ride Details" onBack={() => setScreen("rides")} />
        <Card>
          <View style={s.historyTop}><Text style={s.historyDate}>{new Date(item.createdAt || Date.now()).toLocaleDateString()}</Text><View style={[s.statusPill, String(item.status) === "CANCELLED" && s.statusCancelled]}><Text style={s.statusPillText}>{String(item.status || "NEW")}</Text></View></View>
          <RoutePoint color={COLORS.green} title="Pickup" value={item.pickupAddress || "—"} />
          <RoutePoint color={COLORS.red} title="Drop" value={item.dropAddress || "—"} />
          <View style={s.receiptTotalRow}><Text style={s.receiptTotalLabel}>Fare</Text><Text style={s.receiptTotal}>₹{Number(item.finalFare ?? item.estimatedFare ?? 0).toFixed(2)}</Text></View>
          <Text style={s.muted}>Ride type: {item.rideType || item.serviceSubtype || item.bookingType || "Ride"}</Text>
          <Text style={s.muted}>Payment: {item.paymentPreference || item.payment?.method || "—"}</Text>
          {item.assignedDriver?.name ? <Text style={s.muted}>Driver: {item.assignedDriver.name}</Text> : null}
          {item.vehicle?.registrationNumber ? <Text style={s.muted}>Vehicle: {item.vehicle.registrationNumber}</Text> : null}
          <Text style={s.muted}>Booking ID: {item.id}</Text>
        </Card>
        <PrimaryButton title="Book Again" onPress={() => setScreen("home")} />
      </ScreenShell>
    );
  }

  if (screen === "profile") {
    return (
      <ScreenShell>
        <HeaderBar title="My Profile" onBack={() => setScreen("home")} right={<Pressable style={s.iconButton}><AssetIcon name="settings" size={22} /></Pressable>} />
        <Text style={s.authSubtitle}>Manage your account and preferences</Text>
        <Card style={s.profileCard}>
          <View style={s.profileTop}>
            <View style={s.avatar}><Text style={s.avatarText}>RK</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={s.profileName}>{customerFullName || "RideX Customer"}</Text>
              <Text style={s.profileLine}>+91 {mobile} ✓</Text>
              <Text style={s.profileLine}>{customerEmail || "Add your email"}</Text>
            </View>
            <OutlineButton title="Edit Profile" onPress={() => setScreen("editProfile")} small />
          </View>
          <View style={s.memberPill}><Text>👑 RideX Member</Text><Text>Since Jun 2025</Text></View>
        </Card>

        <View style={s.walletCard}>
          <View style={s.walletIcon}><AssetIcon name="wallet" size={24}/></View>
          <View style={{ flex: 1 }}>
            <Text style={s.walletLabel}>Wallet Balance</Text>
            <Text style={s.walletAmount}>₹250.00</Text>
          </View>
          <PrimaryButton title="+ Add Money" onPress={() => {
            Alert.alert(
              "Add Money",
              "Choose a supported wallet top-up method.",
              [
                { text: "UPI", onPress: () => setMessage("UPI wallet top-up will use the configured payment provider.") },
                { text: "Wallet", onPress: () => setMessage("Wallet top-up requires a configured payment provider.") },
                { text: "Cancel", style: "cancel" },
              ]
            );
          }} small />
        </View>

        <View style={s.statsRow}>
          <StatCard icon="ride" value="12" label="Total Rides" />
          <StatCard icon="parcel" value="3" label="Goods Rides" />
          <StatCard icon="rating" value="4.8" label="Average Rating" />
        </View>

        <Card>
          {[
            ["♙", "Personal Information", "Name, mobile number, email"],
            ["●", "Saved Addresses", "Home, Work and other locations"],
            ["▣", "Payment Methods", "UPI, Wallet"],
            ["🎟", "Offers & Rewards", "View your offers and discounts"],
            ["◷", "My Rides", "See your ride history"],
            ["◉", "Help & Support", "Get help, contact us"],
            ["⚙", "Settings", "App preferences, notifications"],
            ["🛡", "Privacy & Security", "Manage your data and security"],
          ].map(([icon,title,sub]) => (
            <Pressable
              key={title}
              style={s.profileRow}
              onPress={() => {
                if (title === "Personal Information") { setScreen("editProfile"); return; }
                if (title === "Saved Addresses") { setScreen("location"); return; }
                if (title === "My Rides") { setScreen("rides"); return; }
                if (title === "Help & Support") { setScreen("support"); return; }
                if (title === "Payment Methods") {
                  Alert.alert("Payment Methods", "RideX supports UPI and Wallet. Card payment is not enabled.");
                  return;
                }
                if (title === "Offers & Rewards") {
                  Alert.alert("Offers & Rewards", "Offers and promotions will appear here when available.");
                  return;
                }
                if (title === "Settings") {
                  Alert.alert("Settings", "App preferences and notification settings are managed here. Provider-specific settings require backend configuration.");
                  return;
                }
                if (title === "Privacy & Security") {
                  Alert.alert("Privacy & Security", "Your authenticated RideX session and account data are protected by the RideX backend. Contact Support for account/privacy requests.");
                }
              }}>
              <Text style={s.profileRowIcon}>{icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.profileRowTitle}>{title}</Text>
                <Text style={s.profileRowSub}>{sub}</Text>
              </View>
              <AssetIcon name="chevron_right" size={16} />
            </Pressable>
          ))}
          <Pressable style={s.profileRow} onPress={() => void logoutCustomer()}>
            <Text style={[s.profileRowIcon, { color: COLORS.red }]}>⇥</Text>
            <Text style={[s.profileRowTitle,{color:COLORS.red}]}>Logout</Text>
            <AssetIcon name="chevron_right" size={16} />
          </Pressable>
        </Card>

        <BottomNav active="profile" onHome={() => setScreen("home")} onRides={() => setScreen("rides")} onWallet={() => setScreen("support")} onProfile={() => setScreen("profile")} />
      </ScreenShell>
    );
  }

  if (screen === "editProfile") {
    return (
      <ScreenShell>
        <HeaderBar title="Edit Profile" onBack={() => setScreen("profile")} />
        <Text style={s.authSubtitle}>Update your name and email address</Text>
        <Card>
          <Text style={s.fieldLabel}>Full Name</Text>
          <TextInput value={customerFullName} onChangeText={setCustomerFullName} style={s.input} placeholder="Full name" />
          <Text style={s.fieldLabel}>Mobile Number</Text>
          <View style={[s.input, { justifyContent: "center", backgroundColor: "#F4F5F7" }]}><Text style={s.muted}>+91 {mobile}</Text></View>
          <Text style={s.fieldLabel}>Email</Text>
          <TextInput value={customerEmail} onChangeText={setCustomerEmail} style={s.input} autoCapitalize="none" keyboardType="email-address" placeholder="Email address" />
        </Card>
        <PrimaryButton title={profileSaving ? "Saving..." : "Save Changes"} onPress={() => void saveCustomerProfile()} disabled={profileSaving} />
        {!!message && <Text style={s.message}>{message}</Text>}
      </ScreenShell>
    );
  }

  if (screen === "support") {
    return (
      <ScreenShell>
        <HeaderBar title="Help & Support" onBack={() => setScreen("home")} right={<PillButton label="☎ Emergency" />} />
        <Text style={s.authSubtitle}>We are here to help you, always.</Text>
        <Card style={s.safetyHero}>
          <View style={s.safetyHeroIcon}><AssetIcon name="safety" size={44}/></View>
          <View style={{ flex: 1 }}>
            <Text style={s.safetyHeroTitle}>Safety Center</Text>
            <Text style={s.safetyHeroSub}>Your safety is our top priority</Text>
          </View>
          <VehicleIllustration kind="E_RICKSHAW" compact />
        </Card>

        <View style={s.supportGrid}>
          <SupportTile icon="💬" title="Live Chat" sub="Chat with our support team" onPress={() => void createSupportCase("Live Chat", "Customer requested live support chat.", "NORMAL")} />
          <SupportTile icon="☎" title="Call Support" sub="+91 1800 123 4567" onPress={() => void callSupport()} />
          <SupportTile icon="✉" title="Email Us" sub="support@ridex.in" onPress={() => void emailSupport()} />
          <SupportTile icon="☷" title="Report an Issue" sub="Tell us your problem" onPress={() => void createSupportCase("Customer Issue", "Customer reported an issue from the Help & Support screen.", "HIGH")} />
        </View>

        <View style={s.sectionHeaderRow}>
          <Text style={s.sectionTitleLarge}>Frequently Asked Questions</Text>
          <Pressable onPress={() => void createSupportCase("Help Center", "Customer requested the full RideX Help Center / FAQ list.", "NORMAL")}>
            <Text style={s.redText}>View All ›</Text>
          </Pressable>
        </View>
        {[
          ["🚕", "Booking & Rides", "How to book a ride, cancel a ride, modify booking"],
          ["▣", "Payments & Refunds", "UPI, Wallet, refunds and invoices"],
          ["📦", "Goods & Parcel Delivery", "Booking, pricing, tracking and delivery issues"],
          ["♙", "Account & Profile", "Phone number, email, KYC and account settings"],
          ["⚙", "App & Technical Issues", "App not working, location, OTP, and more"],
          ["🛡", "Safety & Security", "Safety features, emergency, and reports"],
          ["★", "Offers & Rewards", "Coupons, cashback and promotions"],
        ].map(([icon,title,sub]) => (
          <Pressable
            key={title}
            style={s.faqRow}
            onPress={() => {
              Alert.alert(title, sub, [
                { text: "Close", style: "cancel" },
                {
                  text: "Contact Support",
                  onPress: () => {
                    void createSupportCase(
                      title,
                      `${sub}. Customer opened this Help Center category.`,
                      "NORMAL"
                    );
                  },
                },
              ]);
            }}>
            <View style={s.faqIcon}><LegacyIcon glyph={icon} size={22}/></View>
            <View style={{flex:1}}><Text style={s.profileRowTitle}>{title}</Text><Text style={s.profileRowSub}>{sub}</Text></View>
            <AssetIcon name="chevron_right" size={16} />
          </Pressable>
        ))}

        <View style={s.actionTwoCol}>
          <SoftTile icon="◉" title="Chat on WhatsApp" sub="Get quick support on WhatsApp" onPress={() => void openWhatsAppSupport()} />
          <SoftTile icon="☎" title="Request a Callback" sub="We'll call you back" onPress={() => void createSupportCase("Callback Request", "Customer requested a support callback.", "NORMAL")} />
        </View>
        <Pressable style={s.emergencyStrip} onPress={() => {
          setSosConfirm(false);
          setScreen("safety");
        }}>
          <AssetIcon name="sos" size={44} />
          <View style={{flex:1}}>
            <Text style={s.emergencyTitle}>Emergency SOS</Text>
            <Text style={s.emergencySub}>Get immediate help in case of an emergency</Text>
          </View>
          <Text style={s.emergencyCall}>Tap to Call</Text>
        </Pressable>

        <BottomNav active="support" onHome={() => setScreen("home")} onRides={() => setScreen("rides")} onWallet={() => setScreen("support")} onProfile={() => setScreen("profile")} />
      </ScreenShell>
    );
  }

  if (screen === "safety") {
    return (
      <ScreenShell>
        <HeaderBar title="Safety Center" onBack={goBack} />
        <Card style={s.safetyCard}>
          <View style={s.inlineTitle}><AssetIcon name="sos" size={28}/><Text style={s.authTitle}>RideX Safety</Text></View>
          <Text style={s.message}>Use SOS only for a real safety emergency. SOS requires confirmation before it is sent.</Text>
          <Text style={s.sectionLabel}>Emergency Contact</Text>
          <TextInput style={s.input} placeholder="Contact name" value={emergencyName} onChangeText={setEmergencyName} />
          <TextInput style={s.input} placeholder="Contact mobile" keyboardType="phone-pad" value={emergencyMobile} onChangeText={setEmergencyMobile} />
          <View style={s.actionTwoCol}>
            <OutlineButton title="Save Contact" onPress={saveEmergencyContact} />
            <OutlineButton title="Call Contact" onPress={callEmergencyContact} />
          </View>
          <Text style={s.sectionLabel}>Reason</Text>
          <View style={s.chipRow}>
            {["Unsafe situation","Accident","Medical emergency","Harassment","Vehicle breakdown","Other"].map((reason) => (
              <Pressable key={reason} style={[s.chip, sosReason === reason && s.chipSelected]} onPress={() => setSosReason(reason)}>
                <Text style={s.chipText}>{reason}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={[s.confirmBox, sosConfirm && s.confirmBoxSelected]} onPress={() => setSosConfirm(v => !v)}>
            <Text>{sosConfirm ? "☑" : "☐"} I confirm that I need RideX Safety assistance.</Text>
          </Pressable>
          <PrimaryButton title={loading ? "Sending SOS..." : "SEND SOS"} onPress={triggerSos} disabled={loading} />
          <Text style={s.muted}>Emergency-number integration will be verified separately before production launch.</Text>
          <Text style={s.message}>{message}</Text>
        </Card>
      </ScreenShell>
    );
  }

  if (screen === "gallery") {
    return (
      <ScreenShell>
        <HeaderBar title="RideX Gallery" onBack={goBack} />
        <Text style={s.muted}>Saved photos are kept on this device and shown here.</Text>
        <View style={s.actionTwoCol}>
          <PrimaryButton title="Camera" onPress={openCamera} />
          <OutlineButton title="Choose Photos" onPress={chooseFromGallery} />
        </View>
        {galleryPhotos.length === 0 ? (
          <Card><Text style={s.cardTitle}>No photos yet</Text><Text style={s.muted}>Use Camera or Choose Photos.</Text></Card>
        ) : (
          <View style={s.photoGrid}>
            {galleryPhotos.map((uri) => (
              <View key={uri} style={s.photoCard}>
                <Image source={{uri}} style={s.photo} />
                <Pressable style={s.photoRemove} onPress={() => removePhoto(uri)}><Text style={s.redText}>Remove</Text></Pressable>
              </View>
            ))}
          </View>
        )}
      </ScreenShell>
    );
  }

  if (screen === "rebook") {
    return (
      <ScreenShell>
        <HeaderBar title="Ride Cancelled" onBack={goBack} />
        <Card>
          <Text style={s.authTitle}>Booking cancelled</Text>
          <Text style={s.muted}>The previous booking was cancelled. You can try booking again.</Text>
          <PrimaryButton title="YES — Book Ride Again" onPress={rebook} disabled={loading} />
          <OutlineButton title="NO — Back to Home" onPress={() => setScreen("home")} />
        </Card>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell>
      <HeaderBar title="RideX" onBack={() => setScreen("home")} />
      <Card><Text style={s.authTitle}>RideX</Text><Text style={s.muted}>Something went wrong.</Text></Card>
    </ScreenShell>
  );
}


function BottomNav({active,onHome,onRides,onWallet,onProfile}:{active:"home"|"rides"|"book"|"support"|"profile";onHome:()=>void;onRides:()=>void;onWallet:()=>void;onProfile:()=>void}) {
  const items = [
    ["home","home","Home",onHome],
    ["rides","history","My Rides",onRides],
    ["book","ride","Book Ride",onHome],
    ["support","support","Support",onWallet],
    ["profile","profile","Profile",onProfile],
  ] as const;
  return <View style={s.bottomNav}>{items.map(([key,icon,label,fn])=><Pressable key={key} style={[s.navItem,active===key&&s.navActive]} onPress={fn}><AssetIcon name={icon} size={24}/><Text style={active===key?s.navActiveText:s.navLabel}>{label}</Text></Pressable>)}</View>;
}

const COLORS = {
  red: "#F31B2D",
  darkRed: "#D90F21",
  black: "#111111",
  text: "#172033",
  muted: "#6D7B91",
  line: "#DFE4EB",
  bg: "#FFFFFF",
  softRed: "#FFF0F1",
  softGreen: "#EAF9EF",
  green: "#18A957",
  softBlue: "#EAF4FF",
  blue: "#2F80ED",
  mapBg: "#F3F6F7",
};

function ScreenShell({children, scroll=true}:{children:React.ReactNode;scroll?:boolean}) {
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[s.scrollShell, { paddingBottom: 96 + ANDROID_BOTTOM_INSET }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      nestedScrollEnabled
      automaticallyAdjustKeyboardInsets
    >
      {children}
    </ScrollView>
  ) : children;
  return (
    <SafeAreaView
      style={[
        s.shell,
        {
          paddingTop: ANDROID_TOP_INSET,
          paddingBottom: ANDROID_BOTTOM_INSET,
        },
      ]}
    >
      {content}
    </SafeAreaView>
  );
}

function Card({children, style}:{children:React.ReactNode;style?:any}) {
  return <View style={[s.card, style]}>{children}</View>;
}


function BrandLogo({large=false}:{large?:boolean}) {
  return (
    <View style={large ? s.logoWrapLarge : s.logoWrap}>
      <Image source={CUSTOMER_ASSETS.logo} resizeMode="contain" style={large ? s.logoImageLarge : s.logoImage} />
    </View>
  );
}

function TopLanguage() {
  return (
    <View style={s.languagePill}><AssetIcon name="language" size={16}/><Text style={s.languageText}>English</Text><AssetIcon name="chevron_down" size={12}/></View>
  );
}

function AuthHeader({onBack}:{onBack?:()=>void}) {
  return <View style={s.authHeader}>
    {onBack ? <Pressable onPress={onBack} style={s.headerBack}><AssetIcon name="back" size={20}/></Pressable> : <View style={s.headerBackSpacer}/>}
    <TopLanguage />
  </View>;
}

function HeaderBar({title,onBack,right}:{title:string;onBack?:()=>void;right?:React.ReactNode}) {
  return (
    <View style={s.headerBar}>
      {onBack ? <Pressable style={s.headerBackCircle} onPress={onBack}><AssetIcon name="back" size={20}/></Pressable> : <View style={s.headerBackCircle}/>}
      <View style={s.headerBrand}><BrandLogo /></View>
      {right || <View style={s.headerBackCircle}/>}
    </View>
  );
}

function SupportPill({onPress}:{onPress?:()=>void}) {
  return <Pressable style={s.supportPill} onPress={onPress}><AssetIcon name="support" size={18}/><Text style={s.supportPillText}>Help</Text></Pressable>;
}

function PrimaryButton({title,onPress,trailing,disabled=false,small=false}:{title:string;onPress:()=>void;trailing?:string;disabled?:boolean;small?:boolean}) {
  return <Pressable disabled={disabled} onPress={onPress} style={[s.primaryBtn,small&&s.primaryBtnSmall,disabled&&s.primaryDisabled]}>
    <Text style={[s.primaryBtnText,small&&s.primaryBtnTextSmall]}>{title}</Text>
    {trailing ? <View style={s.btnArrow}><Text style={s.btnArrowText}>{trailing}</Text></View> : null}
  </Pressable>;
}
function OutlineButton({title,onPress,small=false}:{title:string;onPress:()=>void;small?:boolean}) {
  return <Pressable onPress={onPress} style={[s.outlineBtn,small&&s.outlineBtnSmall]}><Text style={[s.outlineBtnText,small&&s.outlineBtnTextSmall]}>{title}</Text></Pressable>;
}
function PillButton({label,red=false,onPress}:{label:string;red?:boolean;onPress?:()=>void}) {
  const content = <Text style={[s.pillButtonText,red&&s.pillButtonTextRed]}>{label}</Text>;
  if (onPress) {
    return <Pressable onPress={onPress} style={[s.pillButton,red&&s.pillButtonRed]}>{content}</Pressable>;
  }
  return <View style={[s.pillButton,red&&s.pillButtonRed]}>{content}</View>;
}
function SocialButton({label}:{label:string}) {
  return <View style={s.socialCircle}><Text style={s.socialCircleText}>{label}</Text></View>;
}
function FeatureItem({icon,title,sub}:{icon:string;title:string;sub?:string}) {
  return <View style={s.featureItem}><View style={s.featureIcon}><LegacyIcon glyph={icon} size={25}/></View><Text style={s.featureTitle}>{title}</Text>{sub ? <Text style={s.featureSub}>{sub}</Text> : null}</View>;
}
function RoutePoint({color,title,value,active=false,onPress}:{color:string;title:string;value:string;active?:boolean;onPress?:()=>void}) {
  const content = <><View style={[s.routeDot,{borderColor:color,backgroundColor:color==="#2F80ED"?"#EAF4FF":"#FFF"}]}><View style={[s.routeDotInner,{backgroundColor:color}]}/></View><View style={{flex:1}}><Text style={s.routeTitle}>{title}</Text><Text style={s.routeValue}>{value}</Text></View></>;
  if (onPress) {
    return <Pressable onPress={onPress} style={s.routePoint} accessibilityRole="button">{content}</Pressable>;
  }
  return <View style={s.routePoint}>{content}</View>;
}
function RideChoice({selected,icon,title,price,onPress}:{selected:boolean;icon:string;title:string;price:string;onPress:()=>void}) {
  return <Pressable onPress={onPress} style={[s.rideChoice,selected&&s.rideChoiceSelected]}><View style={s.rideChoiceIcon}><LegacyIcon glyph={icon} size={34}/></View><Text style={s.rideChoiceTitle}>{title}</Text><Text style={s.rideChoicePrice}>{price}</Text><Text style={s.infoCircle}>i</Text></Pressable>;
}
function RideOption({selected,icon,title,subtitle,meta,fare,onPress}:{selected:boolean;icon:string;title:string;subtitle:string;meta:string;fare:string;onPress:()=>void}) {
  return <Pressable onPress={onPress} style={[s.rideOption,selected&&s.rideOptionSelected]}>
    <View style={s.rideOptionIcon}><LegacyIcon glyph={icon} size={52}/></View><View style={{flex:1}}><Text style={s.rideOptionTitle}>{title}</Text><Text style={s.rideOptionSub}>{subtitle}</Text><View style={s.iconMetaRow}><LegacyIcon glyph="👤" size={14}/><Text style={s.rideOptionMeta}>{meta}</Text><Text style={s.metaDot}>•</Text><LegacyIcon glyph="🍃" size={14}/><Text style={s.rideOptionMeta}>Eco Friendly</Text></View></View><View style={s.rideOptionRight}><Text style={s.rideOptionFare}>{fare}</Text><View style={[s.checkCircle,selected&&s.checkCircleSelected]}><Text>{selected?"✓":""}</Text></View></View>
  </Pressable>;
}
function GoodsOption({selected,icon,title,subtitle,meta,fare,onPress}:{selected:boolean;icon:string;title:string;subtitle:string;meta:string;fare:string;onPress:()=>void}) {
  const vehicleKind = title.includes("Truck") ? "PICKUP_TRUCK" : "E_RICKSHAW";
  const isParcel = title.includes("Parcel");
  return <Pressable onPress={onPress} style={[s.goodsOption,selected&&s.goodsOptionSelected]}>
    <View style={s.goodsIcon}>{isParcel ? <AssetIcon name="parcelSet" size={56}/> : <VehicleIllustration kind={vehicleKind} compact />}</View><View style={{flex:1}}><Text style={s.rideOptionTitle}>{title}</Text><Text style={s.rideOptionSub}>{subtitle}</Text><View style={s.iconMetaRow}><LegacyIcon glyph="▣" size={14}/><Text style={s.rideOptionMeta}>{meta}</Text><Text style={s.metaDot}>•</Text><LegacyIcon glyph="🍃" size={14}/><Text style={s.rideOptionMeta}>Best for short distance</Text></View></View><View style={s.rideOptionRight}><Text style={s.rideOptionFare}>{fare}</Text><View style={[s.checkCircle,selected&&s.checkCircleSelected]}><Text>{selected?"✓":""}</Text></View></View>
  </Pressable>;
}
function VehicleSummary({icon,title,fare,meta}:{icon:string;title:string;fare:string;meta:string}) {
  return <View style={s.vehicleSummary}><VehicleIllustration kind={icon==="🛻"?"PICKUP_TRUCK":"E_RICKSHAW"} compact/><View style={{flex:1}}><Text style={s.cardTitle}>{title}</Text><Text style={s.muted}>{meta}</Text></View><Text style={s.fareSmall}>{fare}</Text></View>;
}
function SoftTile({icon,title,sub,onPress}:{icon:string;title:string;sub:string;onPress?:()=>void}) {
  return <Pressable onPress={onPress} style={s.softTile}><View style={s.softTileIcon}><LegacyIcon glyph={icon} size={24}/></View><View style={{flex:1}}><Text style={s.softTitle}>{title}</Text><Text style={s.softSub}>{sub}</Text></View><AssetIcon name="chevron_right" size={16} /></Pressable>;
}
function ProgressSteps({active}:{active:string}) {
  const steps=["Details","Review","Payment","Confirm"];
  const icons = ["pickup","ride","paymentCard","check"] as const;
  return <View style={s.progressRow}>{steps.map((step,i)=><React.Fragment key={step}><View style={s.progressItem}><View style={[s.progressCircle,step===active&&s.progressActive]}><AssetIcon name={icons[i]} size={15}/></View><Text style={[s.progressLabel,step===active&&s.progressLabelActive]}>{step}</Text></View>{i<steps.length-1?<View style={s.progressLine}/>:null}</React.Fragment>)}</View>;
}
function SearchState({goods,pickup,drop,pickupLat,pickupLng,dropLat,dropLng,fare,currentLocation,locationLoading,onCurrentLocationPress}:{goods:boolean;pickup:string;drop:string;pickupLat:number;pickupLng:number;dropLat:number;dropLng:number;fare:number;currentLocation:{latitude:number;longitude:number;accuracy?:number|null;recordedAt?:string}|null;locationLoading:boolean;onCurrentLocationPress?:()=>void}) {
  return <>
    <View style={s.stateHeader}><View style={s.stateIcon}><Text>{goods?"🛻":"🛺"}</Text></View><View style={{flex:1}}><Text style={s.stateTitle}>Finding a Driver for Your {goods?"Goods":"Ride"}</Text><Text style={s.stateSub}>Please wait, we are connecting you with the nearest driver</Text></View></View>
    <RideXMap pickupLat={pickupLat} pickupLng={pickupLng} dropLat={dropLat} dropLng={dropLng} pickupLabel={pickup||"Pickup Location"} dropLabel={drop||"Drop Location"} searching goods={goods} currentLocation={currentLocation} locationLoading={locationLoading} onCurrentLocationPress={onCurrentLocationPress} />
    <Card><View style={s.stepTrack}>{["Searching for driver","Driver accepting","Driver en route","Arriving at pickup"].map((x,i)=><View style={s.stepNode} key={x}><View style={[s.trackCircle,i===0&&s.trackCircleActive]}><Text>{i===0?"●":" "}</Text></View><Text style={s.trackText}>{x}</Text></View>)}</View></Card>
    <Card><VehicleSummary icon={goods?"🛻":"🛺"} title={goods?"Battery Pickup Truck · Goods":"E-Rickshaw"} fare={`₹${fare}`} meta={goods?"Goods only":"1–4 passengers"}/><Text style={s.muted}>Your booking is being matched with a nearby verified driver.</Text></Card>
  </>;
}
function AssignedState({goods,driverId,distanceKm,pickup,drop,pickupLat,pickupLng,dropLat,dropLng,driverLocation,currentLocation,locationLoading,onCurrentLocationPress,onChat,onCancel,onCall,onSafety}:{goods:boolean;driverId:string;distanceKm:number;pickup:string;drop:string;pickupLat:number;pickupLng:number;dropLat:number;dropLng:number;driverLocation:{latitude:number;longitude:number;recordedAt?:string}|null;currentLocation?:{latitude:number;longitude:number;accuracy?:number|null;recordedAt?:string}|null;locationLoading:boolean;onCurrentLocationPress?:()=>void;onChat:()=>void;onCancel:()=>void;onCall:()=>void;onSafety:()=>void}) {
  return <><View style={s.stateBanner}><View style={s.stateIcon}><Text>{goods?"🛻":"🚕"}</Text></View><View style={{flex:1}}><Text style={s.stateTitle}>Driver Assigned!</Text><Text style={s.stateSub}>Your driver is on the way to pick you up.</Text></View><View style={s.etaBox}><Text style={s.etaBig}>{Math.max(3,Math.round(distanceKm*4))} min</Text><Text style={s.etaSmall}>({distanceKm.toFixed(1)} km away)</Text></View></View><RideXMap pickupLat={pickupLat} pickupLng={pickupLng} dropLat={dropLat} dropLng={dropLng} pickupLabel={pickup||"Your Pickup Location"} dropLabel={drop || "Destination"} driver goods={goods} driverLocation={driverLocation} currentLocation={currentLocation} locationLoading={locationLoading} onCurrentLocationPress={onCurrentLocationPress}/><Card><DriverSummary driverId={driverId} goods={goods}/><View style={s.driverActions}><Pressable style={s.callBtn} onPress={onCall}><Text style={s.callBtnText}>Call</Text></Pressable><OutlineButton title="💬 Chat" onPress={onChat}/><Pressable style={s.sosQuick} onPress={onSafety}><Text style={s.sosQuickText}>🛡 SOS</Text></Pressable><OutlineButton title="✕ Cancel" onPress={onCancel}/></View><StatusTimeline status="assigned"/></Card></>;
}
function ArrivedState({goods,driverLocation,driverId,pickup,drop,pickupLat,pickupLng,dropLat,dropLng,currentLocation,locationLoading,onCurrentLocationPress,onChat,onCancel,onCall,onSafety}:{goods:boolean;driverLocation:{latitude:number;longitude:number;recordedAt?:string}|null;driverId?:string;pickup:string;drop:string;pickupLat:number;pickupLng:number;dropLat:number;dropLng:number;currentLocation?:{latitude:number;longitude:number;accuracy?:number|null;recordedAt?:string}|null;locationLoading:boolean;onCurrentLocationPress?:()=>void;onChat:()=>void;onCancel:()=>void;onCall:()=>void;onSafety:()=>void}) {
  return <><View style={s.arrivedBanner}><View style={s.arrivedIcon}><Text>✓</Text></View><View style={{flex:1}}><Text style={s.stateTitle}>Driver has arrived!</Text><Text style={s.stateSub}>Your driver is waiting at the pickup location.</Text></View><View style={s.etaBoxGreen}><Text style={s.etaGreenBig}>0 min</Text><Text style={s.etaSmall}>(At your location)</Text></View></View><RideXMap pickupLat={pickupLat} pickupLng={pickupLng} dropLat={dropLat} dropLng={dropLng} pickupLabel="Pickup Location" dropLabel={drop || "Destination"} arrived driver goods={goods} driverLocation={driverLocation} currentLocation={currentLocation} locationLoading={locationLoading} onCurrentLocationPress={onCurrentLocationPress}/><Card><DriverSummary driverId={driverId||"test-passenger"} goods={goods}/><View style={s.driverActions}><Pressable style={s.callBtn} onPress={onCall}><Text style={s.callBtnText}>Call</Text></Pressable><OutlineButton title="💬 Chat" onPress={onChat}/><Pressable style={s.sosQuick} onPress={onSafety}><Text style={s.sosQuickText}>🛡 SOS</Text></Pressable><OutlineButton title="✕ Cancel" onPress={onCancel}/></View><StatusTimeline status="assigned"/><Card style={s.pinCard}><Text style={s.pinTitle}>🔒 Start Trip with PIN</Text><Text style={s.pinSub}>Ask the driver for the 4-digit PIN to start your trip.</Text><View style={s.pinBoxes}>{[0,1,2,3].map(i=><View key={i} style={s.pinBox}><Text style={s.pinDash}>—</Text></View>)}</View><Text style={s.blueInfo}>ℹ Check the vehicle and driver details before starting.</Text></Card></Card></>;
}
function TripInProgressState({goods,driverLocation,driverId,pickup,drop,pickupLat,pickupLng,dropLat,dropLng,currentLocation,locationLoading,onCurrentLocationPress,onChat,onCancel,onCall,onSafety}:{goods:boolean;driverLocation:{latitude:number;longitude:number;recordedAt?:string}|null;driverId?:string;pickup:string;drop:string;pickupLat:number;pickupLng:number;dropLat:number;dropLng:number;currentLocation?:{latitude:number;longitude:number;accuracy?:number|null;recordedAt?:string}|null;locationLoading:boolean;onCurrentLocationPress?:()=>void;onChat:()=>void;onCancel:()=>void;onCall:()=>void;onSafety:()=>void}) {
  const distance = Math.max(0, Math.hypot(dropLat-pickupLat,dropLng-pickupLng)*111);
  return <><View style={s.startedBanner}><View style={s.stateIcon}><Text>✓</Text></View><View style={{flex:1}}><Text style={s.stateTitle}>Trip Started!</Text><Text style={s.stateSub}>Your {goods?"goods":"driver"} are on the way to the destination.</Text></View><View style={s.etaBox}><Text style={s.etaBig}>8 min</Text><Text style={s.etaSmall}>({distance.toFixed(1)} km away)</Text></View></View><RideXMap pickupLat={pickupLat} pickupLng={pickupLng} dropLat={dropLat} dropLng={dropLng} pickupLabel={pickup||"Pickup"} dropLabel={drop || "Destination"} inProgress driver goods={goods} driverLocation={driverLocation} currentLocation={currentLocation} locationLoading={locationLoading} onCurrentLocationPress={onCurrentLocationPress}/><Card><DriverSummary driverId={driverId||"test-passenger"} goods={goods}/><View style={s.driverActions}><Pressable style={s.callBtn} onPress={onCall}><Text style={s.callBtnText}>Call</Text></Pressable><OutlineButton title="💬 Chat" onPress={onChat}/><Pressable style={s.sosQuick} onPress={onSafety}><Text style={s.sosQuickText}>🛡 SOS</Text></Pressable><OutlineButton title="✕ Cancel" onPress={onCancel}/></View><StatusTimeline status="started"/><View style={s.verifyCard}><Text style={s.pinTitle}>🔐 Verify Driver & Start Trip</Text><Text style={s.pinSub}>PIN verified • Trip in progress</Text><View style={s.pinBoxes}>{[1,2,3,4].map(n=><View key={n} style={s.pinBox}><Text style={s.pinNumber}>{n}</Text></View>)}</View><Text style={s.greenText}>✓ PIN verified</Text></View></Card></>;
}
function StatusTimeline({status}:{status:"assigned"|"started"}) {
  const labels=status==="assigned"?["Driver Assigned","On the way","Arrived","Trip Started","Trip Completed"]:["Driver Assigned","Picked Up","In Transit","Arriving Soon","Delivered"];
  const active=status==="assigned"?0:2;
  return <View style={s.timeline}>{labels.map((label,i)=><View key={label} style={s.timelineItem}><View style={[s.timelineDot,i<=active&&s.timelineDotActive]}><Text>{i<active?"✓":""}</Text></View><Text style={[s.timelineLabel,i<=active&&s.timelineLabelActive]}>{label}</Text></View>)}</View>;
}
function DriverSummary({driverId,goods}:{driverId:string;goods:boolean}) {
  return <View style={s.driverSummary}><View style={s.avatarDriver}><Text style={s.avatarDriverText}>RK</Text></View><View style={{flex:1}}><Text style={s.driverName}>Rajesh Kumar <Text style={s.starInline}>★</Text> 4.8</Text><Text style={s.driverVehicle}>{goods?"Battery Pickup Truck":"E-Rickshaw"}  •  {driverId || "BR01EZ8421"}</Text><Text style={s.driverStatus}>● Online</Text></View><VehicleIllustration kind={goods?"PICKUP_TRUCK":"E_RICKSHAW"} compact/></View>;
}
function VehicleIllustration({kind,large=false,compact=false,hero=false}:{kind:"E_RICKSHAW"|"PICKUP_TRUCK";large?:boolean;compact?:boolean;hero?:boolean}) {
  const source = kind === "PICKUP_TRUCK" ? CUSTOMER_ASSETS.pickupTruck : CUSTOMER_ASSETS.eRickshaw;
  return (
    <View style={[s.vehicleIllustration, large && s.vehicleLarge, compact && s.vehicleCompact, hero && s.vehicleHero]}>
      <Image
        source={source}
        resizeMode="contain"
        style={s.vehicleImage}
      />
    </View>
  );
}
function RideXMap({
  pickupLabel,
  dropLabel,
  showVehicles = false,
  driver = false,
  arrived = false,
  inProgress = false,
  completed = false,
  searching = false,
  goods = false,
  compact = false,
  pickupLat: pickupLatitude,
  pickupLng: pickupLongitude,
  dropLat: dropLatitude,
  dropLng: dropLongitude,
  driverLocation = null,
  currentLocation = null,
  onCurrentLocationPress,
  onMapPress,
  locationLoading = false,
}: {
  pickupLabel: string;
  dropLabel: string;
  showVehicles?: boolean;
  driver?: boolean;
  arrived?: boolean;
  inProgress?: boolean;
  completed?: boolean;
  searching?: boolean;
  goods?: boolean;
  compact?: boolean;
  pickupLat?: number;
  pickupLng?: number;
  dropLat?: number;
  dropLng?: number;
  driverLocation?: { latitude: number; longitude: number; recordedAt?: string } | null;
  currentLocation?: { latitude: number; longitude: number; accuracy?: number | null; recordedAt?: string } | null;
  onCurrentLocationPress?: () => void;
  onMapPress?: (coordinate: { latitude: number; longitude: number }) => void;
  locationLoading?: boolean;
}) {
  const mapRef = useRef<MapView | null>(null);

  const pickupCandidate = {
    latitude: Number(pickupLatitude),
    longitude: Number(pickupLongitude),
  };
  const dropCandidate = {
    latitude: Number(dropLatitude),
    longitude: Number(dropLongitude),
  };

  // These coordinates belonged to the old demo/fake-map implementation.
  // They are intentionally never rendered as user/booking locations.
  const isDemoCoordinate = (latitude: number, longitude: number) =>
    [
      [25.5392, 87.5717],
      [25.5480, 87.5790],
      [25.5941, 85.1376],
    ].some(
      ([demoLat, demoLng]) =>
        Math.abs(latitude - demoLat) < 0.000001 &&
        Math.abs(longitude - demoLng) < 0.000001,
    );

  const hasRealPickup =
    Number.isFinite(pickupCandidate.latitude) &&
    Number.isFinite(pickupCandidate.longitude) &&
    !isDemoCoordinate(pickupCandidate.latitude, pickupCandidate.longitude);

  const hasRealDrop =
    Number.isFinite(dropCandidate.latitude) &&
    Number.isFinite(dropCandidate.longitude) &&
    !isDemoCoordinate(dropCandidate.latitude, dropCandidate.longitude);

  const pickup = hasRealPickup ? pickupCandidate : null;
  const drop = hasRealDrop ? dropCandidate : null;

  const center = currentLocation
    ? {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
      }
    : pickup
      ? pickup
      : drop
        ? drop
        : {
            latitude: 20.5937,
            longitude: 78.9629,
          };

  const points = [pickup, drop].filter(
    (point): point is { latitude: number; longitude: number } => Boolean(point),
  );

  const singlePointDelta = compact ? 0.025 : 0.035;
  const latitudeDelta =
    points.length >= 2
      ? Math.max(0.02, Math.abs(points[0].latitude - points[1].latitude) * 1.8 + 0.018)
      : singlePointDelta;
  const longitudeDelta =
    points.length >= 2
      ? Math.max(0.02, Math.abs(points[0].longitude - points[1].longitude) * 1.8 + 0.018)
      : singlePointDelta;

  useEffect(() => {
    if (!mapRef.current) return;

    if (currentLocation) {
      mapRef.current.animateToRegion(
        {
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude,
          latitudeDelta: compact ? 0.02 : 0.03,
          longitudeDelta: compact ? 0.02 : 0.03,
        },
        450,
      );
      return;
    }

    if (points.length >= 2) {
      mapRef.current.fitToCoordinates(points, {
        edgePadding: { top: 90, right: 70, bottom: 90, left: 70 },
        animated: true,
      });
    } else if (pickup || drop) {
      mapRef.current.animateToRegion(
        {
          ...center,
          latitudeDelta,
          longitudeDelta,
        },
        450,
      );
    }
  }, [
    currentLocation?.latitude,
    currentLocation?.longitude,
    pickup?.latitude,
    pickup?.longitude,
    drop?.latitude,
    drop?.longitude,
    compact,
  ]);

  return (
    <View style={[s.rideMapCard, compact && s.rideMapCardCompact]}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          ...center,
          latitudeDelta,
          longitudeDelta,
        }}
        mapType="standard"
        showsCompass={false}
        showsScale={false}
        showsTraffic={false}
        showsBuildings={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
        showsUserLocation={Boolean(currentLocation)}
        showsMyLocationButton={false}
        loadingEnabled
        zoomEnabled
        rotateEnabled
        scrollEnabled
        pitchEnabled
        moveOnMarkerPress
        onPress={onMapPress ? (event) => onMapPress(event.nativeEvent.coordinate) : undefined}
      >
        {pickup ? (
          <Marker
            coordinate={pickup}
            title={pickupLabel || "Pickup location"}
            description="RideX pickup location"
            pinColor="#F31B2D"
          />
        ) : null}

        {drop ? (
          <Marker
            coordinate={drop}
            title={dropLabel || "Destination"}
            description="RideX destination"
            pinColor={completed ? "#18A957" : "#F31B2D"}
          />
        ) : null}

        {driver && driverLocation ? (
          <Marker
            coordinate={{
              latitude: driverLocation.latitude,
              longitude: driverLocation.longitude,
            }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
            title="RideX Driver"
            description={inProgress ? "Driver location" : "Driver is on the way"}
          >
            <View style={s.googleDriverMarkerWrap}>
              <View style={s.googleDriverPulse} />
              <Image
                source={goods ? CUSTOMER_ASSETS.pickupTruck : CUSTOMER_ASSETS.eRickshaw}
                style={s.googleDriverMarker}
                resizeMode="contain"
              />
            </View>
          </Marker>
        ) : null}
      </MapView>

      {searching ? (
        <View style={s.searchBubble}>
          <Text style={s.mapBubbleTitle}>Looking for nearby drivers...</Text>
          <Text style={s.muted}>RideX is matching your booking</Text>
        </View>
      ) : null}

      {onCurrentLocationPress ? (
        <View style={s.mapControlCol}>
          <Pressable
            style={[s.mapControl, locationLoading && s.mapControlDisabled]}
            onPress={onCurrentLocationPress}
            disabled={locationLoading}
            accessibilityRole="button"
            accessibilityLabel="Use current location"
          >
            <AssetIcon name={locationLoading ? "clock" : "recenter"} size={20} />
          </Pressable>

        </View>
      ) : null}

      {arrived ? (
        <View style={s.mapBubble}>
          <Text style={s.mapBubbleTitle}>Your driver has arrived</Text>
          <Text style={s.muted}>at the pickup location</Text>
        </View>
      ) : null}
      {completed ? (
        <View style={s.mapBubbleGreen}>
          <Text style={s.mapBubbleTitle}>Trip completed successfully</Text>
        </View>
      ) : null}
      {inProgress ? (
        <View style={s.mapBubbleBlue}>
          <Text style={s.mapBubbleTitle}>On the way to destination</Text>
        </View>
      ) : null}
    </View>
  );
}

function getStatusTheme(status:string,mode:BookingMode){return status==="COMPLETED"?COLORS.green:mode==="GOODS"?COLORS.red:COLORS.red;}
function farePreviewForStatus(){return 80;}
function previewStatusDistance(){return 2.8;}
function statStatusText(status:string){return status;}
function StatCard({icon,value,label}:{icon:string;value:string;label:string}){return <View style={s.statCard}><Text style={s.statIcon}>{icon}</Text><Text style={s.statValue}>{value}</Text><Text style={s.statLabel}>{label}</Text></View>}
function SupportTile({icon,title,sub,onPress}:{icon:string;title:string;sub:string;onPress?:()=>void}){return <Pressable style={s.supportTile} onPress={onPress}><View style={s.supportTileIcon}><Text>{icon}</Text></View><Text style={s.supportTileTitle}>{title}</Text><Text style={s.supportTileSub}>{sub}</Text></Pressable>}
function StatusBadge({label}:{label:string}){return <View style={s.statusPill}><Text style={s.statusPillText}>{label}</Text></View>}

const _sUnused = [StatusBadge, StatusBadge, SupportTile, StatCard, statStatusText, getStatusTheme];

const s = StyleSheet.create({
  shell:{flex:1,backgroundColor:COLORS.bg},
  scrollShell:{paddingHorizontal:0,paddingTop:0,paddingBottom:96},
  welcomeHero:{paddingHorizontal:18,paddingTop:12,paddingBottom:20},
  welcomeHeroImageWrap:{width:"100%",height:200,borderRadius:24,overflow:"hidden",marginTop:10,marginBottom:14,backgroundColor:"#FFFFFF",alignSelf:"center"},
  welcomeHeroImage:{width:"100%",height:"100%",backgroundColor:"#FFFFFF"},
  logoWrapLarge:{alignItems:"center",marginTop:12},
  logoWrap:{alignItems:"center"},
  logoTextLarge:{fontSize:58,fontWeight:"900",color:COLORS.black,letterSpacing:-5},
  logoText:{fontSize:32,fontWeight:"900",color:COLORS.black,letterSpacing:-3},
  logoX:{color:COLORS.red},
  logoTaglineLarge:{fontSize:19,fontWeight:"800",color:COLORS.black,marginTop:-4},
  logoImage:{width:120,height:36},
  logoImageLarge:{width:230,height:66},
  logoTagline:{fontSize:10,fontWeight:"800",color:COLORS.black,marginTop:-2},
  tagline:{fontSize:22,fontWeight:"800",textAlign:"center",marginTop:2},
  heroSubline:{fontSize:10,letterSpacing:1.5,textAlign:"center",color:COLORS.text,marginVertical:9},
  languagePill:{backgroundColor:"#fff",borderWidth:1,borderColor:COLORS.line,borderRadius:24,paddingHorizontal:16,paddingVertical:10,alignSelf:"flex-end"},
  languageText:{fontWeight:"700",color:COLORS.black},
  cityScene:{height:300,borderRadius:28,overflow:"hidden",backgroundColor:"#EAF1F7",position:"relative",marginVertical:6},
  cityBackdropSmall:{position:"absolute",left:0,right:0,top:0,bottom:0,backgroundColor:"#EAF1F7"},
  sun:{position:"absolute",width:100,height:100,borderRadius:50,backgroundColor:"#FFE38C",top:52,right:55},
  cityTower:{position:"absolute",bottom:62,width:46,backgroundColor:"#AFC5D7",borderTopLeftRadius:4,borderTopRightRadius:4},
  roadStrip:{position:"absolute",left:0,right:0,bottom:0,height:60,backgroundColor:"#626D78"},
  heroScript:{position:"absolute",left:18,top:52,color:COLORS.red,fontSize:31,fontWeight:"800",fontStyle:"italic",lineHeight:32},
  serviceMiniRow:{flexDirection:"row",gap:7,marginTop:12},
  serviceMiniCard:{flex:1,borderWidth:1,borderColor:COLORS.line,backgroundColor:"#fff",borderRadius:18,padding:8,alignItems:"center",minHeight:86},
  serviceMiniIcon:{width:36,height:36,borderRadius:18,backgroundColor:"#F7F9FC",alignItems:"center",justifyContent:"center"},
  serviceMiniTitle:{fontWeight:"800",fontSize:12,marginTop:3},
  serviceMiniSub:{fontSize:9,color:COLORS.muted,textAlign:"center"},
  authHero:{paddingTop:6},
  authScene:{height:170,marginTop:4,overflow:"hidden",backgroundColor:"#EEF3F7",position:"relative"},
  authSceneImage:{position:"absolute",left:0,top:0,width:"100%",height:"100%"},
  authSceneShade:{position:"absolute",left:0,right:0,top:0,bottom:0,backgroundColor:"rgba(255,255,255,.06)"},
  heroScriptSmall:{position:"absolute",left:18,top:34,color:COLORS.red,fontSize:24,fontWeight:"800",fontStyle:"italic",lineHeight:25,zIndex:2},
  authCard:{marginTop:-4,borderTopLeftRadius:30,borderTopRightRadius:30,padding:20},
  authTitle:{fontSize:30,fontWeight:"900",color:COLORS.black,textAlign:"center"},
  authSubtitle:{fontSize:16,color:COLORS.muted,textAlign:"center",marginTop:4,marginBottom:14},
  authHeader:{padding:14,flexDirection:"row",justifyContent:"space-between",alignItems:"center"},
  headerBack:{width:44,height:44,borderRadius:22,backgroundColor:"#fff",borderWidth:1,borderColor:COLORS.line,alignItems:"center",justifyContent:"center"},
  headerBackSpacer:{width:44},
  headerBackText:{fontSize:30,color:COLORS.black,lineHeight:32},
  phoneInput:{height:58,borderRadius:16,borderWidth:1,borderColor:"#CBD2DD",flexDirection:"row",alignItems:"center",paddingHorizontal:14,marginVertical:10},
  flag:{fontSize:23},
  countryCode:{fontWeight:"800",marginLeft:8},
  verticalLine:{height:30,width:1,backgroundColor:COLORS.line,marginHorizontal:10},
  phoneTextInput:{flex:1,fontSize:17,color:COLORS.black},
  primaryBtn:{minHeight:56,borderRadius:18,backgroundColor:COLORS.red,alignItems:"center",justifyContent:"center",paddingHorizontal:20,marginVertical:7,flexDirection:"row",position:"relative"},
  primaryBtnSmall:{minHeight:44,borderRadius:14,paddingHorizontal:14},
  primaryDisabled:{opacity:.6},
  primaryBtnText:{color:"#fff",fontSize:18,fontWeight:"900"},
  primaryBtnTextSmall:{fontSize:14},
  btnArrow:{position:"absolute",right:12,width:38,height:38,borderRadius:19,backgroundColor:"#fff",alignItems:"center",justifyContent:"center"},
  btnArrowText:{fontSize:24,color:COLORS.red,fontWeight:"900"},
  outlineBtn:{minHeight:54,borderRadius:18,borderWidth:2,borderColor:COLORS.red,alignItems:"center",justifyContent:"center",paddingHorizontal:16,marginVertical:7,backgroundColor:"#fff"},
  outlineBtnSmall:{minHeight:42,borderRadius:13,borderWidth:1},
  outlineBtnText:{color:COLORS.red,fontSize:16,fontWeight:"800"},
  outlineBtnTextSmall:{fontSize:13},
  dividerWithText:{flexDirection:"row",alignItems:"center",gap:10,marginVertical:12},
  dividerLine:{height:1,flex:1,backgroundColor:COLORS.line},
  muted:{color:COLORS.muted,fontSize:12},
  socialRow:{flexDirection:"row",justifyContent:"center",gap:18},
  socialLabelRow:{flexDirection:"row",justifyContent:"center",gap:28,marginBottom:14},
  socialCircle:{width:54,height:54,borderRadius:27,borderWidth:1,borderColor:COLORS.line,alignItems:"center",justifyContent:"center",backgroundColor:"#fff"},
  socialCircleText:{fontSize:22,fontWeight:"900"},
  socialLabel:{textAlign:"center",fontSize:11,marginTop:4},
  otpMobile:{textAlign:"center",fontSize:22,fontWeight:"900",color:COLORS.red,marginTop:8,marginBottom:14},
  otpInput:{alignSelf:"center",width:"72%",borderWidth:2,borderColor:"#FFD0D4",borderRadius:18,backgroundColor:"#FFF8F8",paddingVertical:14,fontSize:30,fontWeight:"900",color:COLORS.black,letterSpacing:12},
  otpHint:{textAlign:"center",color:COLORS.muted,fontSize:13,marginTop:8,marginBottom:8},
  featureRibbon:{backgroundColor:COLORS.softRed,borderRadius:20,padding:12,marginVertical:14,flexDirection:"row"},
  featureItem:{flex:1,alignItems:"center"},
  featureIcon:{width:38,height:38,borderRadius:19,backgroundColor:"#fff",alignItems:"center",justifyContent:"center",marginBottom:4},
  featureTitle:{fontSize:11,fontWeight:"800",textAlign:"center"},
  featureSub:{fontSize:10,textAlign:"center",color:COLORS.text},
  terms:{fontSize:11,color:COLORS.muted,textAlign:"center",marginTop:10},
  redText:{color:COLORS.red,fontWeight:"800"},
  message:{fontSize:12,textAlign:"center",marginTop:10,color:COLORS.red},
  homeTopHero:{backgroundColor:"#F4F7FA",paddingBottom:2},
  homeTopRow:{paddingHorizontal:14,paddingTop:8,paddingBottom:4,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  homeRightActions:{flexDirection:"row",alignItems:"center",gap:5,flexShrink:1},
  iconButton:{width:42,height:42,borderRadius:21,borderWidth:1,borderColor:COLORS.line,backgroundColor:"#fff",alignItems:"center",justifyContent:"center"},
  iconGlyph:{fontSize:22},
  locationPill:{borderWidth:1,borderColor:COLORS.line,backgroundColor:"#fff",borderRadius:20,paddingHorizontal:10,paddingVertical:8,flexDirection:"row",alignItems:"center",gap:5,flexShrink:1},
  locationPin:{color:COLORS.red,fontSize:15},
  locationPillText:{fontWeight:"800",fontSize:13},
  bellButton:{width:40,height:40,borderRadius:20,backgroundColor:"#fff",alignItems:"center",justifyContent:"center"},
  bell:{fontSize:25},
  homeHeroVisual:{height:220,position:"relative",overflow:"hidden",alignItems:"center"},
  homeScript:{position:"absolute",left:26,top:30,color:COLORS.red,fontSize:28,fontWeight:"900",fontStyle:"italic",lineHeight:31,zIndex:2},
  promiseRow:{position:"absolute",bottom:7,left:10,right:10,flexDirection:"row",backgroundColor:"rgba(255,255,255,.92)",borderRadius:18,padding:8},
  homeContent:{padding:10},
  sectionTitleLarge:{fontSize:19,fontWeight:"900",color:COLORS.black,marginVertical:8},
  card:{backgroundColor:"#fff",borderWidth:1,borderColor:COLORS.line,borderRadius:20,padding:14,marginVertical:7},
  sectionHeaderRow:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},
  routeInputCard:{borderRadius:18,borderWidth:1,borderColor:"#EDF0F4",padding:10,marginTop:8},
  routePoint:{flexDirection:"row",alignItems:"center",paddingVertical:6,gap:10},
  routeDot:{width:18,height:18,borderRadius:9,borderWidth:2,alignItems:"center",justifyContent:"center"},
  routeDotInner:{width:8,height:8,borderRadius:4},
  routeTitle:{fontSize:12,color:COLORS.muted},
  routeValue:{fontSize:14,fontWeight:"700",marginTop:1},
  cardTitle:{fontSize:16,fontWeight:"900",color:COLORS.black},
  rideMapCard:{height:230,borderRadius:18,overflow:"hidden",backgroundColor:"#EDF3EA",position:"relative"},
  rideMapCardCompact:{height:190},
  mapWater:{position:"absolute",top:0,right:-60,width:190,height:"100%",backgroundColor:"#BDE0F4",transform:[{rotate:"8deg"}]},
  mapStreet:{position:"absolute",left:-20,right:-20,height:4,backgroundColor:"#E8C86B",opacity:.75},
  mapStreetHorizontal:{position:"absolute",top:42,bottom:-20,width:3,backgroundColor:"#fff",opacity:.85,transform:[{rotate:"15deg"}]},
  mapCity:{position:"absolute",left:"43%",top:"45%",fontSize:23,fontWeight:"900",color:"#234"},
  mapLandmark:{position:"absolute",right:12,top:18,color:"#075BD4",fontWeight:"800"},
  mapPark:{position:"absolute",right:15,top:128,color:"#1A9A5B",fontWeight:"800"},
  mapVehicle:{position:"absolute",fontSize:22},
  mapDriver:{left:"42%",top:"50%",fontSize:32},
  searchBubble:{position:"absolute",left:"33%",top:"42%",padding:10,backgroundColor:"#fff",borderRadius:16,borderWidth:1,borderColor:COLORS.line},
  mapPin:{position:"absolute",width:34,height:34,borderRadius:17,backgroundColor:"#fff",borderWidth:5,borderColor:COLORS.red,alignItems:"center",justifyContent:"center"},
  mapPickup:{left:40,bottom:44},
  mapDrop:{right:62,top:68},
  mapPinText:{color:COLORS.red},
  routeLine:{position:"absolute",height:5,left:54,right:90,bottom:57,backgroundColor:COLORS.red,transform:[{rotate:"-12deg"}],borderRadius:5},
  mapLabelPickup:{position:"absolute",left:15,bottom:85,paddingHorizontal:9,paddingVertical:6,borderRadius:12,backgroundColor:"#fff",borderWidth:1,borderColor:COLORS.line},
  mapLabelDrop:{position:"absolute",right:8,top:38,paddingHorizontal:9,paddingVertical:6,borderRadius:12,backgroundColor:"#fff",borderWidth:1,borderColor:COLORS.line},
  mapLabelTitle:{fontSize:11,fontWeight:"800"},
  mapControlCol:{position:"absolute",right:8,bottom:14,gap:7},
  mapControl:{width:38,height:38,borderRadius:19,backgroundColor:"#fff",alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:COLORS.line},
  mapControlDisabled:{opacity:.6},
  mapControlActive:{backgroundColor:"#F4F7F5",borderColor:COLORS.green},
  mapLayerMenu:{position:"absolute",right:46,bottom:0,minWidth:112,padding:6,borderRadius:14,backgroundColor:"#fff",borderWidth:1,borderColor:COLORS.line,shadowColor:"#000",shadowOpacity:.08,shadowRadius:8,shadowOffset:{width:0,height:3},elevation:4},
  mapLayerOption:{paddingHorizontal:10,paddingVertical:9,borderRadius:10},
  mapLayerOptionActive:{backgroundColor:"#EAF8F1"},
  mapLayerOptionText:{fontSize:12,fontWeight:"800",color:COLORS.black},
  mapCenterButtonText:{fontSize:20,color:COLORS.black,fontWeight:"800"},
  mapCenterButtonLoading:{opacity:.6},
  mapBubble:{position:"absolute",left:"27%",top:"46%",backgroundColor:"#fff",padding:10,borderRadius:15,borderWidth:1,borderColor:COLORS.line},
  mapBubbleGreen:{position:"absolute"},
  mapBubbleBlue:{position:"absolute",left:"35%",top:"36%",backgroundColor:COLORS.softBlue,padding:10,borderRadius:15},
  quickPlacesRow:{flexDirection:"row",gap:6,marginVertical:8},
  quickPlace:{flex:1,alignItems:"center",padding:8,borderRadius:16,borderWidth:1,borderColor:COLORS.line,backgroundColor:"#fff",minWidth:70},
  quickPlaceIcon:{fontSize:20},
  quickPlaceTitle:{fontSize:10,fontWeight:"800",textAlign:"center"},
  quickPlaceSub:{fontSize:9,color:COLORS.muted},
  rideChoiceRow:{flexDirection:"row",gap:7},
  rideChoice:{flex:1,minHeight:118,borderRadius:16,borderWidth:1,borderColor:COLORS.line,padding:9,backgroundColor:"#fff",position:"relative"},
  rideChoiceSelected:{borderColor:COLORS.red,backgroundColor:"#FFF7F7"},
  rideChoiceIcon:{width:42,height:42,alignItems:"center",justifyContent:"center",marginBottom:4},
  rideChoiceTitle:{fontSize:12,fontWeight:"900"},
  rideChoicePrice:{fontSize:11,color:COLORS.muted,marginTop:3},
  infoCircle:{position:"absolute",right:8,bottom:8,width:20,height:20,borderRadius:10,borderWidth:1,borderColor:COLORS.line,textAlign:"center",lineHeight:18,color:COLORS.muted},
  actionTwoCol:{flexDirection:"row",gap:7},
  softCard:{flex:1,backgroundColor:COLORS.softRed,borderRadius:17,padding:11,flexDirection:"row",alignItems:"center",gap:8},
  softIcon:{fontSize:26,color:COLORS.red},
  softTitle:{fontSize:12,fontWeight:"800",color:COLORS.black},
  softSub:{fontSize:10,color:COLORS.muted},
  chevron:{fontSize:24,color:COLORS.black},
  bottomNav:{position:"relative",marginTop:8,borderTopWidth:1,borderColor:COLORS.line,backgroundColor:"#fff",flexDirection:"row",paddingTop:8},
  navItem:{flex:1,alignItems:"center",padding:6,borderRadius:14},
  navActive:{backgroundColor:COLORS.softRed},
  navIcon:{fontSize:22},
  navLabel:{fontSize:10,color:COLORS.text},
  navActiveText:{fontSize:10,fontWeight:"900",color:COLORS.red},
  headerBar:{height:68,paddingHorizontal:10,flexDirection:"row",alignItems:"center",justifyContent:"space-between",backgroundColor:"#fff",borderBottomWidth:1,borderBottomColor:COLORS.line},
  headerBackCircle:{width:42,height:42,borderRadius:21,backgroundColor:"#fff",borderWidth:1,borderColor:COLORS.line,alignItems:"center",justifyContent:"center"},
  headerBrand:{flex:1,alignItems:"center"},
  supportPill:{flexDirection:"row",alignItems:"center",gap:5,borderRadius:20,borderWidth:1,borderColor:COLORS.line,paddingHorizontal:12,paddingVertical:8,backgroundColor:"#fff"},
  supportPillIcon:{fontSize:18},
  supportPillText:{fontWeight:"800"},
  mapLargeWrap:{padding:8,backgroundColor:COLORS.mapBg,position:"relative"},
  mapTopInputs:{position:"absolute",left:18,right:18,top:18,backgroundColor:"#fff",borderRadius:18,padding:9,borderWidth:1,borderColor:COLORS.line},
  mapCenterButton:{position:"absolute",right:18,bottom:58,width:44,height:44,borderRadius:22,backgroundColor:"#fff",alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:COLORS.line},
  pillButton:{borderRadius:18,paddingHorizontal:12,paddingVertical:8,borderWidth:1,borderColor:COLORS.line,backgroundColor:"#fff"},
  pillButtonRed:{borderColor:COLORS.red,backgroundColor:COLORS.red},
  pillButtonText:{fontSize:12,fontWeight:"800"},
  pillButtonTextRed:{color:"#fff"},
  input:{borderWidth:1,borderColor:COLORS.line,borderRadius:13,paddingHorizontal:12,paddingVertical:12,fontSize:15,marginVertical:6},
  compactInput:{borderWidth:1,borderColor:COLORS.line,borderRadius:13,paddingHorizontal:12,paddingVertical:11,fontSize:14,flex:1},
  locationFormRow:{gap:7},
  helpBanner:{marginTop:10,padding:12,borderRadius:18,backgroundColor:COLORS.softRed,flexDirection:"row",alignItems:"center",gap:8},
  helpBannerIcon:{fontSize:30},
  helpBannerTitle:{fontWeight:"900"},
  helpBannerSub:{fontSize:11,color:COLORS.muted},
  safeNote:{textAlign:"center",color:COLORS.text,fontSize:12,marginVertical:9},
  sectionLabel:{fontSize:15,fontWeight:"900",marginTop:10,marginBottom:6},
  chipRow:{flexDirection:"row",flexWrap:"wrap",gap:8},
  chip:{borderWidth:1,borderColor:COLORS.line,borderRadius:18,paddingHorizontal:12,paddingVertical:9,backgroundColor:"#fff"},
  chipSelected:{borderColor:COLORS.red,backgroundColor:COLORS.softRed},
  chipText:{fontSize:12,fontWeight:"700"},
  savedRow:{flexDirection:"row",alignItems:"center",gap:10,borderBottomWidth:1,borderBottomColor:COLORS.line,paddingVertical:12},
  savedIcon:{color:COLORS.red,fontSize:18},
  savedTitle:{fontWeight:"800"},
  savedSub:{fontSize:11,color:COLORS.muted},
  rideMapTop:{backgroundColor:COLORS.mapBg,padding:8},
  routeSummary:{marginTop:7,padding:10,borderRadius:18,borderWidth:1,borderColor:COLORS.line,backgroundColor:"#fff",flexDirection:"row"},
  distanceBadge:{width:84,alignItems:"center",justifyContent:"center",borderLeftWidth:1,borderColor:COLORS.line},
  distanceBig:{fontSize:20,fontWeight:"900"},
  distanceSmall:{fontSize:10,color:COLORS.muted},
  modeToggle:{flexDirection:"row",gap:8,padding:10},
  modeToggleItem:{flex:1,borderRadius:16,borderWidth:1,borderColor:COLORS.line,padding:11,flexDirection:"row",gap:8,alignItems:"center"},
  modeActive:{borderColor:COLORS.red,backgroundColor:COLORS.softRed},
  modeIcon:{fontSize:25},
  modeTitle:{fontSize:13,fontWeight:"900"},
  modeSub:{fontSize:10,color:COLORS.muted},
  rideOption:{borderWidth:1,borderColor:COLORS.line,borderRadius:19,padding:11,flexDirection:"row",alignItems:"center",gap:10,marginBottom:8,backgroundColor:"#fff"},
  rideOptionSelected:{borderColor:COLORS.red,backgroundColor:"#FFF8F8"},
  rideOptionIcon:{width:68,height:58,borderRadius:14,backgroundColor:"#F6F7F9",alignItems:"center",justifyContent:"center"},
  rideOptionIconText:{fontSize:34},
  rideOptionTitle:{fontSize:16,fontWeight:"900"},
  rideOptionSub:{fontSize:12,color:COLORS.muted},
  rideOptionMeta:{fontSize:10,color:COLORS.muted,marginTop:5},
  iconMetaRow:{flexDirection:"row",alignItems:"center",gap:4,marginTop:5,flexWrap:"wrap"},
  metaDot:{fontSize:10,color:COLORS.muted},
  rideOptionRight:{alignItems:"flex-end",gap:8},
  rideOptionFare:{fontSize:16,fontWeight:"900"},
  checkCircle:{width:25,height:25,borderRadius:13,borderWidth:1,borderColor:"#D2D8E2",alignItems:"center",justifyContent:"center"},
  checkCircleSelected:{backgroundColor:COLORS.red,borderColor:COLORS.red},
  goodsOption:{borderWidth:1,borderColor:COLORS.line,borderRadius:19,padding:11,flexDirection:"row",alignItems:"center",gap:10,marginBottom:8,backgroundColor:"#fff"},
  goodsOptionSelected:{borderColor:COLORS.red,backgroundColor:"#FFF8F8"},
  goodsIcon:{width:78,height:62,borderRadius:14,backgroundColor:"#F6F7F9",alignItems:"center",justifyContent:"center"},
  scheduleDateTimeRow:{flexDirection:"row",gap:8,width:"100%"},
  scheduleDateInput:{borderWidth:1,borderColor:COLORS.line,borderRadius:13,paddingHorizontal:12,paddingVertical:11,flex:1,minWidth:0,height:52},
  scheduleTimeInput:{borderWidth:1,borderColor:COLORS.line,borderRadius:13,paddingHorizontal:12,paddingVertical:11,flex:1,minWidth:0,height:52},
  schedulePeriodRow:{flexDirection:"row",gap:8,width:"100%"},
  schedulePeriodButton:{borderWidth:1,borderColor:COLORS.line,borderRadius:13,minHeight:50,flex:1,alignItems:"center",justifyContent:"center"},
  schedulePeriodText:{fontWeight:"800"},
  scheduleGrid:{flexDirection:"row",gap:7,flexWrap:"wrap",marginTop:8},
  scheduleInput:{borderWidth:1,borderColor:COLORS.line,borderRadius:13,padding:10,flex:1,minWidth:120},
  centerPill:{alignItems:"center",justifyContent:"center",minWidth:70},
  switchPill:{borderRadius:20,paddingHorizontal:13,paddingVertical:8,backgroundColor:"#EEF1F5"},
  switchPillOn:{backgroundColor:COLORS.softGreen},
  switchText:{fontWeight:"900"},
  paymentOfferRow:{flexDirection:"row",gap:7,marginVertical:5},
  progressRow:{flexDirection:"row",alignItems:"center",paddingHorizontal:12,paddingVertical:10},
  progressItem:{alignItems:"center",width:62},
  progressCircle:{width:30,height:30,borderRadius:15,backgroundColor:"#E7EBF0",alignItems:"center",justifyContent:"center"},
  progressActive:{backgroundColor:COLORS.red},
  progressLabel:{fontSize:10,color:COLORS.muted,marginTop:4},
  progressLabelActive:{color:COLORS.red,fontWeight:"800"},
  progressLine:{height:2,backgroundColor:"#CBD1DA",flex:1,marginTop:-18},
  mapReviewTop:{paddingHorizontal:8},
  vehicleSummary:{flexDirection:"row",alignItems:"center",gap:10},
  vehicleImage:{width:"100%",height:"100%"},
  mapVehicleImage:{position:"absolute",width:82,height:52},
  mapDriverImage:{width:110,height:70},
  vehicleIllustration:{width:150,height:95,position:"relative",alignSelf:"center"},
  vehicleHero:{width:190,height:115,marginTop:2,alignSelf:"center"},
  vehicleLarge:{width:320,height:170},
  vehicleCompact:{width:88,height:60,marginLeft:"auto"},
  vehicleRoof:{position:"absolute",left:26,right:20,top:18,height:14,borderRadius:9},
  vehicleCab:{position:"absolute",left:34,right:24,top:28,bottom:18,borderRadius:15,borderWidth:3,borderColor:"#111",backgroundColor:"#FFF4F2"},
  vehicleWindow:{position:"absolute",left:8,right:8,top:6,height:26,borderRadius:9,borderWidth:2,borderColor:"#111",backgroundColor:"#CFE7F6"},
  vehicleSeat:{position:"absolute",left:20,right:24,bottom:12,height:10,borderRadius:5,backgroundColor:"#8B4A32"},
  vehiclePanel:{position:"absolute",right:8,bottom:18,width:48,height:30,borderRadius:7,backgroundColor:COLORS.red,alignItems:"center",justifyContent:"center"},
  vehicleBrand:{color:"#fff",fontWeight:"900",fontSize:11},
  wheelLeft:{position:"absolute",left:28,bottom:0,width:26,height:26,borderRadius:13,backgroundColor:"#111",borderWidth:5,borderColor:"#DCE2E7"},
  wheelRight:{position:"absolute",right:24,bottom:0,width:26,height:26,borderRadius:13,backgroundColor:"#111",borderWidth:5,borderColor:"#DCE2E7"},
  vehicleBumper:{position:"absolute",left:18,right:14,bottom:12,height:4,backgroundColor:"#111",borderRadius:3},
  twoInputRow:{flexDirection:"row",gap:8,marginTop:8},
  fareHighlight:{backgroundColor:"#FFF8F8",borderColor:"#FFD0D4"},
  fareLabel:{fontSize:13,color:COLORS.muted},
  fare:{fontSize:34,fontWeight:"900",color:COLORS.black,marginTop:3},
  fareSmall:{fontSize:17,fontWeight:"900"},
  fareReceiptCard:{flexDirection:"row",gap:12},
  rightAmount:{position:"absolute",right:0},
  receiptTotalRow:{flexDirection:"row",justifyContent:"space-between",marginTop:10,paddingTop:10,borderTopWidth:1,borderColor:COLORS.line},
  receiptTotalLabel:{fontWeight:"900"},
  receiptTotal:{fontSize:20,fontWeight:"900",color:COLORS.green},
  paymentSuccess:{flex:1,backgroundColor:COLORS.softGreen,borderRadius:15,padding:12,alignItems:"center",justifyContent:"center"},
  completedBanner:{padding:14,backgroundColor:COLORS.softGreen,borderRadius:18,margin:10,flexDirection:"row",alignItems:"center",gap:12},
  completedCircle:{width:56,height:56,borderRadius:28,backgroundColor:COLORS.green,alignItems:"center",justifyContent:"center"},
  completedCheck:{color:"#fff",fontSize:32,fontWeight:"900"},
  completedTitle:{fontSize:22,fontWeight:"900"},
  completedSub:{fontSize:12,color:COLORS.muted},
  completedCheckSmall:{fontSize:26,color:COLORS.green},
  paymentSuccessTitle:{fontSize:12,fontWeight:"900",textAlign:"center",marginTop:4},
  paymentSuccessSub:{fontSize:11,color:COLORS.muted,textAlign:"center",marginBottom:4},
  stars:{flexDirection:"row",justifyContent:"center",gap:4,marginVertical:12},
  starActive:{fontSize:33,color:"#FFC107"},
  starInactive:{fontSize:33,color:"#CBD0D8"},
  commentInput:{borderWidth:1,borderColor:COLORS.line,borderRadius:14,minHeight:88,padding:12,textAlignVertical:"top",marginTop:7},
  greenThanks:{backgroundColor:COLORS.softGreen,borderColor:"#BDE5CC"},
  greenThanksTitle:{fontSize:15,fontWeight:"900",color:COLORS.green},
  tripBottomRow:{flexDirection:"row",gap:8},
  stateHeader:{padding:14,backgroundColor:"#FFF2F3",flexDirection:"row",alignItems:"center",gap:10},
  stateBanner:{padding:14,backgroundColor:"#FFF2F3",flexDirection:"row",alignItems:"center",gap:10},
  stateIcon:{width:54,height:54,borderRadius:27,backgroundColor:COLORS.red,alignItems:"center",justifyContent:"center"},
  stateTitle:{fontSize:19,fontWeight:"900"},
  stateSub:{fontSize:12,color:COLORS.muted,marginTop:2},
  etaBox:{backgroundColor:"#FFE7EA",borderRadius:14,padding:8,alignItems:"center",minWidth:82},
  etaBig:{fontSize:18,fontWeight:"900",color:COLORS.red},
  etaSmall:{fontSize:9,color:COLORS.muted},
  arrivedBanner:{padding:14,backgroundColor:COLORS.softGreen,flexDirection:"row",alignItems:"center",gap:10},
  arrivedIcon:{width:54,height:54,borderRadius:27,backgroundColor:COLORS.green,alignItems:"center",justifyContent:"center"},
  etaBoxGreen:{backgroundColor:"#DFF3E7",borderRadius:14,padding:8,alignItems:"center",minWidth:82},
  etaGreenBig:{fontSize:18,fontWeight:"900",color:COLORS.green},
  startedBanner:{padding:14,backgroundColor:COLORS.softGreen,flexDirection:"row",alignItems:"center",gap:10},
  driverSummary:{flexDirection:"row",alignItems:"center",gap:10},
  avatarDriver:{width:60,height:60,borderRadius:30,backgroundColor:"#D7DEE8",alignItems:"center",justifyContent:"center"},
  avatarDriverText:{fontSize:22,fontWeight:"900"},
  driverName:{fontSize:15,fontWeight:"900"},
  starInline:{color:"#FFC107"},
  driverVehicle:{fontSize:12,color:COLORS.muted,marginTop:3},
  driverStatus:{fontSize:11,color:COLORS.green,marginTop:3},
  driverActions:{flexDirection:"row",gap:7,marginTop:10,flexWrap:"wrap"},
  callBtn:{flex:1,minWidth:80,minHeight:42,borderRadius:15,backgroundColor:COLORS.green,alignItems:"center",justifyContent:"center"},
  callBtnText:{color:"#fff",fontWeight:"900"},
  sosQuick:{flex:1,minWidth:80,minHeight:42,borderRadius:15,backgroundColor:COLORS.red,alignItems:"center",justifyContent:"center"},
  sosQuickText:{color:"#fff",fontWeight:"900"},
  timeline:{flexDirection:"row",marginTop:16,paddingTop:10,borderTopWidth:1,borderColor:COLORS.line},
  timelineItem:{flex:1,alignItems:"center"},
  timelineDot:{width:27,height:27,borderRadius:14,backgroundColor:"#D5DAE2",alignItems:"center",justifyContent:"center"},
  timelineDotActive:{backgroundColor:COLORS.red},
  timelineLabel:{fontSize:9,color:COLORS.muted,textAlign:"center",marginTop:4},
  timelineLabelActive:{color:COLORS.red,fontWeight:"800"},
  pinCard:{backgroundColor:"#FFF5F6",borderColor:"#FFD9DD"},
  pinTitle:{fontSize:16,fontWeight:"900"},
  pinSub:{fontSize:12,color:COLORS.muted,marginTop:4},
  pinBoxes:{flexDirection:"row",gap:8,marginTop:10},
  pinBox:{flex:1,height:48,borderRadius:10,borderWidth:1,borderColor:"#DDE2EA",backgroundColor:"#fff",alignItems:"center",justifyContent:"center"},
  pinDash:{fontSize:25,color:"#ADB6C3"},
  pinNumber:{fontSize:18,fontWeight:"900"},
  blueInfo:{marginTop:10,color:COLORS.blue,fontSize:11},
  verifyCard:{backgroundColor:COLORS.softBlue,borderColor:"#D0E4FB"},
  greenText:{color:COLORS.green,fontWeight:"900",marginTop:8},
  profileCard:{backgroundColor:COLORS.softRed,borderColor:"#FFE0E3"},
  profileTop:{flexDirection:"row",gap:12,alignItems:"center"},
  avatar:{width:78,height:78,borderRadius:39,backgroundColor:"#DCE3EC",alignItems:"center",justifyContent:"center",borderWidth:3,borderColor:"#fff"},
  avatarText:{fontSize:28,fontWeight:"900"},
  profileName:{fontSize:20,fontWeight:"900"},
  profileLine:{fontSize:12,color:COLORS.text,marginTop:2},
  memberPill:{marginTop:12,backgroundColor:"#FFFBE6",borderRadius:13,padding:9,flexDirection:"row",justifyContent:"space-between"},
  walletCard:{marginVertical:7,backgroundColor:COLORS.softGreen,borderRadius:20,padding:14,flexDirection:"row",alignItems:"center",gap:10},
  walletIcon:{width:48,height:48,borderRadius:24,backgroundColor:COLORS.green,alignItems:"center",justifyContent:"center"},
  walletLabel:{fontSize:12,fontWeight:"700"},
  walletAmount:{fontSize:26,fontWeight:"900"},
  statsRow:{flexDirection:"row",gap:7,marginBottom:7},
  statCard:{flex:1,backgroundColor:"#F7F9FC",borderRadius:16,padding:10,alignItems:"center",borderWidth:1,borderColor:COLORS.line},
  statIcon:{fontSize:22},
  statValue:{fontSize:19,fontWeight:"900"},
  statLabel:{fontSize:10,color:COLORS.muted,textAlign:"center"},
  profileRow:{flexDirection:"row",alignItems:"center",gap:12,paddingVertical:13,borderBottomWidth:1,borderBottomColor:COLORS.line},
  profileRowIcon:{fontSize:23,width:30,textAlign:"center"},
  profileRowTitle:{fontSize:14,fontWeight:"800"},
  profileRowSub:{fontSize:11,color:COLORS.muted,marginTop:2},
  supportGrid:{flexDirection:"row",flexWrap:"wrap",gap:7,padding:10},
  supportTile:{width:"48%",borderWidth:1,borderColor:COLORS.line,borderRadius:17,padding:12,backgroundColor:"#fff"},
  supportTileIcon:{width:42,height:42,borderRadius:21,backgroundColor:COLORS.softGreen,alignItems:"center",justifyContent:"center"},
  supportTileTitle:{fontSize:13,fontWeight:"900",marginTop:7},
  supportTileSub:{fontSize:10,color:COLORS.muted},
  safetyHero:{backgroundColor:COLORS.softRed,flexDirection:"row",alignItems:"center",gap:10},
  safetyHeroIcon:{width:52,height:52,alignItems:"center",justifyContent:"center"},
  safetyHeroTitle:{fontSize:19,fontWeight:"900"},
  safetyHeroSub:{fontSize:11,color:COLORS.muted},
  faqRow:{flexDirection:"row",alignItems:"center",padding:12,borderRadius:16,borderWidth:1,borderColor:COLORS.line,marginVertical:4,backgroundColor:"#fff"},
  faqIcon:{width:34,height:34,borderRadius:17,backgroundColor:"#F4F5F7",alignItems:"center",justifyContent:"center"},
  emergencyStrip:{margin:10,padding:12,borderRadius:17,backgroundColor:COLORS.softRed,borderWidth:1,borderColor:"#FFD6DA",flexDirection:"row",alignItems:"center",gap:9},
  emergencyIcon:{width:44,height:44,borderRadius:22,backgroundColor:COLORS.red,color:"#fff",textAlign:"center",textAlignVertical:"center",fontWeight:"900",paddingTop:13},
  emergencyTitle:{fontSize:13,fontWeight:"900",color:COLORS.red},
  emergencySub:{fontSize:10,color:COLORS.muted},
  emergencyCall:{color:"#fff",backgroundColor:COLORS.red,paddingHorizontal:12,paddingVertical:9,borderRadius:12,fontWeight:"900"},
  safetyCard:{paddingBottom:18},
  confirmBox:{padding:13,borderWidth:1,borderColor:COLORS.line,borderRadius:14,marginVertical:10,backgroundColor:"#fff"},
  confirmBoxSelected:{borderColor:COLORS.red,backgroundColor:COLORS.softRed},
  photoGrid:{flexDirection:"row",flexWrap:"wrap",gap:8},
  photoCard:{width:"48%",borderRadius:16,borderWidth:1,borderColor:COLORS.line,overflow:"hidden"},
  photo:{width:"100%",height:140},
  photoRemove:{padding:9,alignItems:"center"},
  historyCard:{padding:11},
  historyTop:{flexDirection:"row",alignItems:"center",gap:8,marginBottom:6},
  historyDate:{fontWeight:"800",flex:1},
  historyTime:{color:COLORS.muted,fontSize:11},
  statusPill:{paddingHorizontal:8,paddingVertical:5,borderRadius:9,backgroundColor:"#DDF3E5"},
  statusCancelled:{backgroundColor:"#E9ECF1"},
  statusPillText:{fontSize:10,fontWeight:"900",color:COLORS.green},
  historyBottom:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginTop:8},
  historyFare:{fontSize:18,fontWeight:"900"},
  historyActions:{flexDirection:"row",gap:6,flexShrink:1,flexWrap:"wrap",justifyContent:"flex-end"},
  tabRow:{flexDirection:"row",gap:7,padding:10},
  tab:{flex:1,padding:10,borderRadius:14,backgroundColor:"#F1F3F6",alignItems:"center"},
  tabActive:{backgroundColor:COLORS.red},
  tabText:{fontSize:11,color:COLORS.text},
  tabActiveText:{fontSize:11,color:"#fff",fontWeight:"900"},
  googleMapVehicleMarker:{width:52,height:34},
  googleDriverMarker:{width:86,height:56},
  googleDriverMarkerWrap:{width:90,height:72,alignItems:"center",justifyContent:"center"},
  googleDriverPulse:{position:"absolute",width:64,height:64,borderRadius:32,backgroundColor:"rgba(243,27,45,.14)",borderWidth:2,borderColor:"rgba(243,27,45,.28)"},
  googleCurrentLocationMarker:{width:28,height:28,borderRadius:14,backgroundColor:"rgba(47,128,237,.22)",alignItems:"center",justifyContent:"center"},
  googleCurrentLocationDot:{width:13,height:13,borderRadius:7,backgroundColor:COLORS.blue,borderWidth:2,borderColor:"#fff"},
  googleMapTopShade:{position:"absolute",left:0,right:0,top:0,height:18,backgroundColor:"rgba(255,255,255,.12)"},
  mapBubbleTitle:{fontSize:12,fontWeight:"900",color:COLORS.black},
  scheduleGridDummy:{},
  paymentSuccessTitleDummy:{},
  photoRemoveDummy:{},
  stateIconDummy:{},
  stateHeaderTextDummy:{},
  tripInfoRow:{flexDirection:"row",gap:8},
  distancePanel:{width:95,alignItems:"center",justifyContent:"center",backgroundColor:"#F6F8FA",borderRadius:14},
  detailLine:{fontSize:12,color:COLORS.text,marginTop:5},
  pinCardSpacing:{marginTop:8},
  safeNoteRow:{flexDirection:"row",alignItems:"center",justifyContent:"center",gap:7,marginVertical:6},
  pinInput:{borderWidth:1,borderColor:"#FFD0D4",borderRadius:14,backgroundColor:"#fff",paddingHorizontal:12,paddingVertical:11,fontSize:18,letterSpacing:5,textAlign:"center",marginTop:10},
  greenThanksRow:{flexDirection:"row",alignItems:"center",gap:7},
  fieldLabel:{fontSize:12,fontWeight:"800",color:COLORS.text,marginTop:8},
  inlineTitle:{flexDirection:"row",alignItems:"center",gap:8,marginBottom:8},
  authNote:{fontSize:11,lineHeight:17,color:COLORS.muted,textAlign:"center",marginTop:6,marginBottom:8},
  softTile:{flex:1,minHeight:72,borderWidth:1,borderColor:COLORS.line,borderRadius:17,backgroundColor:"#fff",padding:10,flexDirection:"row",alignItems:"center",gap:8},
  softTileIcon:{width:38,height:38,borderRadius:19,backgroundColor:COLORS.softRed,alignItems:"center",justifyContent:"center"},
  stepTrack:{flexDirection:"row",justifyContent:"space-between",gap:6,paddingVertical:10},
  stepNode:{flex:1,alignItems:"center"},
  trackCircle:{width:26,height:26,borderRadius:13,backgroundColor:"#E2E6EC",alignItems:"center",justifyContent:"center"},
  trackCircleActive:{backgroundColor:COLORS.softRed,borderWidth:1,borderColor:COLORS.red},
  trackText:{fontSize:9,color:COLORS.muted,textAlign:"center",marginTop:4}
});
