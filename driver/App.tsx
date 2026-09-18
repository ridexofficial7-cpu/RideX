import type { DriverScreen } from "../navigation/routes";
import React, { useEffect, useRef, useState } from "react";
import * as Location from "expo-location";
import * as DocumentPicker from "expo-document-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createRideXFetch, getRideXApiUrl } from "../shared/api/client";
import { registerRideXPushToken } from "../pushNotifications";
import QRCode from "react-native-qrcode-svg";
import MapView, { Marker, Polyline } from "react-native-maps";
import { DRIVER_ASSETS } from "../shared/assets";

import {
  KeyboardAvoidingView,
  Linking,
  Modal,
  Image,
  Pressable,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
type DriverIconName = keyof typeof DRIVER_ASSETS.icons;

function DriverIcon({name,size=22}:{name:DriverIconName;size?:number}) {
  const source=DRIVER_ASSETS.icons[name];
  return source ? <Image source={source} resizeMode="contain" style={{width:size,height:size}} /> : null;
}
const DRIVER_GLYPH_MAP: Record<string,string> = {
  "⌂":"home", "▣":"rides", "▥":"earnings", "▤":"messages", "♙":"profile",
  "◉":"support", "●":"location", "⌖":"target", "➤":"navigate", "✓":"check",
  "!":"alert", "₹":"rupee", "◷":"clock", "👥":"passengers", "🛺":"passenger",
  "🚕":"passenger", "🛻":"goods", "▱":"both", "📦":"parcel", "⚙":"settings", "🔔":"notification",
  "☎":"phone", "💬":"chat", "🛡":"shield", "🆘":"sos", "✎":"edit",
};
function DriverLegacyIcon({glyph,size=22}:{glyph:string;size?:number}) {
  const name = DRIVER_GLYPH_MAP[glyph] as DriverIconName | undefined;
  return name && DRIVER_ASSETS.icons[name] ? <DriverIcon name={name} size={size}/> : <Text style={{fontSize:size}}>{glyph}</Text>;
}

const API = getRideXApiUrl();

const DEFAULT_DRIVER_ID = process.env.EXPO_PUBLIC_DRIVER_ID || "";
const DRIVER_AUTH_TOKEN_KEY = "ridex_driver_auth_token_v1";
const DRIVER_SESSION_KEY = "ridex_driver_session_v1";
const RIDEX_TEST_MODE = String(process.env.EXPO_PUBLIC_RIDEX_TEST_MODE ?? "false").toLowerCase() === "true";

const ridexFetch = createRideXFetch({ tokenKey: DRIVER_AUTH_TOKEN_KEY, apiUrl: API });

/**
 * RideX integration contract:
 * Customer <-> Driver <-> Admin are connected through the same backend/API.
 * Optional third-party providers remain non-blocking until configured.
 */
const RIDEX_OPTIONAL_CONFIG = {
  mapsKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY || "",
  routingUrl: process.env.EXPO_PUBLIC_ROUTING_URL || "",
  notificationsUrl: process.env.EXPO_PUBLIC_NOTIFICATIONS_URL || "",
};

type ServiceMode =
  | "PASSENGER"
  | "GOODS"
  | "BOTH";

type DriverRequest = {
  id: string;
  bookingId: string;
  driverId: string;
  vehicleId: string;
  legId?: string | null;
  status: string;
  distanceKm?: number | null;
  etaMinutes?: number | null;
  score?: number | null;
  offeredAt?: string;
  expiresAt?: string;
  booking?: any;
  vehicle?: any;
  leg?: any;
};

type ActiveRide = {
  request: DriverRequest;
  booking: any;
};

type Completion = {
  bookingId?: string;
  grossFare?: number | null;
  commission?: number | null;
  commissionRate?: string | number | null;
  driverEarning?: number | null;
  actualDistanceKm?: number | null;
  actualDurationMinutes?: number | null;
  tripId?: string;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
};

export default function App({
startAt = "login", onBackToCustomer}: {startAt?: "welcome" | "login"; onBackToCustomer?: () => void} = {}) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const authToken = await AsyncStorage.getItem(DRIVER_AUTH_TOKEN_KEY);
      if (!cancelled && authToken) {
        void registerRideXPushToken({ api: API, authToken });
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const [online, setOnline] =
    useState(false);

  // Keep the app resilient when an optional provider is not configured.
  void RIDEX_OPTIONAL_CONFIG;

  const [serviceMode, setServiceMode] =
    useState<ServiceMode>("BOTH");

  const [requests, setRequests] =
    useState<DriverRequest[]>([]);

  const [activeRide, setActiveRide] =
    useState<ActiveRide | null>(null);

  const [message, setMessage] =
    useState("Ready");

  const [loading, setLoading] =
    useState(false);

  const [actionLoading, setActionLoading] =
    useState<string | null>(null);
  const [driverNotifications, setDriverNotifications] = useState<any[]>([]);
  const [notificationFilter, setNotificationFilter] = useState("ALL");
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);

  const [tripPin, setTripPin] =
    useState("");
  const [verificationMethod, setVerificationMethod] = useState<"OTP"|"QR">("OTP");
  const [qrPayload, setQrPayload] = useState("");
  const [verificationExpiresAt, setVerificationExpiresAt] = useState("");

  const [lastCompletion, setLastCompletion] =
    useState<Completion | null>(null);

  // =====================================================
  // REAL DEVICE GPS
  // =====================================================

  // Fallback values are only used until the phone provides a
  // valid location. They are never published as live GPS once
  // the device location has been successfully read.
  const FALLBACK_LATITUDE = 25.5392;
  const FALLBACK_LONGITUDE = 87.5717;

  const [gpsLatitude, setGpsLatitude] =
    useState(FALLBACK_LATITUDE);

  const [gpsLongitude, setGpsLongitude] =
    useState(FALLBACK_LONGITUDE);

  const gpsLatitudeRef =
    useRef(FALLBACK_LATITUDE);

  const gpsLongitudeRef =
    useRef(FALLBACK_LONGITUDE);

  const [gpsEnabled, setGpsEnabled] =
    useState(false);

  const [lastGpsUpdate, setLastGpsUpdate] =
    useState<string | null>(null);

  const gpsSubscriptionRef =
    useRef<Location.LocationSubscription | null>(null);
  const driverMapRef = useRef<MapView | null>(null);
  const [driverMapType, setDriverMapType] = useState<"standard" | "satellite" | "hybrid" | "terrain">("standard");

  const [lastRequestCheck, setLastRequestCheck] =
    useState<string | null>(null);

  // Automatic new-booking popup.
  const [incomingRequest, setIncomingRequest] =
    useState<DriverRequest | null>(null);
  const [requestNow, setRequestNow] =
    useState(() => Date.now());
  const notifiedRequestIds =
    useRef(new Set<string>());

  // =====================================================
  // HELPERS
  // =====================================================

  function money(value: any) {
    const n = Number(value);

    return Number.isFinite(n)
      ? n.toFixed(2)
      : "0.00";
  }

  function formatTenure(createdAt: any) {
    const start = new Date(createdAt);
    if (!Number.isFinite(start.getTime())) return "—";
    const now = new Date();
    let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    if (now.getDate() < start.getDate()) months -= 1;
    if (months < 1) {
      const days = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86400000));
      return days <= 1 ? "1 Day" : `${days} Days`;
    }
    if (months < 12) return `${months} ${months === 1 ? "Month" : "Months"}`;
    const years = Math.floor(months / 12);
    const rem = months % 12;
    return rem ? `${years}y ${rem}m` : `${years} ${years === 1 ? "Year" : "Years"}`;
  }

  function rideLabel(booking: any) {
    if (
      booking?.bookingType ===
      "GOODS"
    ) {
      return "Goods";
    }

    if (
      booking?.rideType ===
      "FULL_RIDE"
    ) {
      return "Full Ride";
    }

    if (
      booking?.rideType ===
      "SHARED_RIDE"
    ) {
      return "Shared Ride";
    }

    if (
      booking?.rideType ===
      "CONNECTION_RIDE"
    ) {
      return "Connection Ride";
    }

    return "Passenger Ride";
  }

  function paymentLabel(booking: any) {
    const method = String(
      booking?.paymentPreference ||
      booking?.payment?.method ||
      "CASH"
    ).toUpperCase();
    if (method === "UPI") return "UPI";
    if (method === "WALLET") return "Wallet";
    return "Cash";
  }

  function statusLabel(
    status: string
  ) {
    switch (status) {
      case "NEW":
        return "New";

      case "MATCHING":
        return "Finding driver";

      case "DRIVER_ASSIGNED":
        return "Driver assigned";

      case "DRIVER_ARRIVING":
        return "Going to pickup";

      case "DRIVER_ARRIVED":
        return "Arrived at pickup";

      case "STARTED":
      case "IN_PROGRESS":
        return "Ride in progress";

      case "COMPLETED":
        return "Ride completed";

      case "CANCELLED":
        return "Ride cancelled";

      default:
        return status || "Unknown";
    }
  }

  async function loadDriverEarnings(id = driverId) {
    try {
      const response = await ridexFetch(`${API}/driver/${id}/earnings?limit=100`);
      const data = await response.json();
      if (!response.ok || !data.success) return;
      setEarningRows(Array.isArray(data.data?.rows) ? data.data.rows : []);
      setEarningTotals({
        gross: Number(data.data?.totals?.gross || 0),
        commission: Number(data.data?.totals?.commission || 0),
        net: Number(data.data?.totals?.net || 0),
      });
    } catch {}
  }

  async function loadPayoutProfile(id = driverId) {
    try {
      const response = await ridexFetch(`${API}/driver/${id}/payout-profile`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) return;
      const row = data.data || null;
      setPayoutProfile(row);
      setPayoutHolder(String(row?.accountHolderName || ""));
      setPayoutAccount(String(row?.accountNumber || ""));
      setPayoutIfsc(String(row?.ifsc || ""));
      setPayoutBank(String(row?.bankName || ""));
      setPayoutUpi(String(row?.upiId || ""));
    } catch {}
  }

  async function saveVehicle(vehicleId: string) {
    setActionLoading("vehicle-save");
    try {
      const response = await ridexFetch(`${API}/driver/${driverId}/vehicles/${vehicleId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vehicleNumber: vehicleNumberInput, capacity: Number(vehicleCapacityInput || 1) }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) { setMessage(data.message || "Unable to update vehicle"); return; }
      setDriverVehicles(prev => prev.map(v => v.id === vehicleId ? data.data : v));
      setEditingVehicle(null);
      setMessage("Vehicle details updated");
    } catch { setMessage("Unable to update vehicle"); } finally { setActionLoading(null); }
  }

  async function uploadKycDocument(documentId:string, documentType:string){
    if(!driverId || !documentId) return;
    try {
      setActionLoading(`kyc-upload-${documentType}`);
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/jpeg", "image/png"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const asset = result.assets[0];
      const response = await fetch(asset.uri);
      if (!response.ok) throw new Error("Unable to read selected file");
      const blob = await response.blob();
      const dataUrl:string = await new Promise((resolve,reject)=>{
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Unable to read selected file"));
        reader.readAsDataURL(blob);
      });
      const upload = await ridexFetch(`${API}/driver/${encodeURIComponent(driverId)}/documents/${encodeURIComponent(documentId)}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: asset.name || `${documentType.toLowerCase()}.bin`,
          mimeType: asset.mimeType || blob.type || "application/octet-stream",
          base64: dataUrl,
        }),
      });
      const body:any = await upload.json().catch(()=>({}));
      if(!upload.ok || !body.success) throw new Error(body?.message || "Unable to upload document");
      setDriverDocuments(prev => prev.map((doc:any) => doc.id===documentId ? body.data : doc));
      setMessage(`${documentType.replaceAll("_"," ")} uploaded. Awaiting verification.`);
    } catch(error:any) {
      setMessage(error?.message || "Unable to upload KYC document");
    } finally {
      setActionLoading("");
    }
  }

  async function savePayoutProfile() {
    setActionLoading("payout-save");
    try {
      const response = await ridexFetch(`${API}/driver/${driverId}/payout-profile`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountHolderName: payoutHolder, accountNumber: payoutAccount, ifsc: payoutIfsc, bankName: payoutBank, upiId: payoutUpi }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) { setMessage(data.message || "Unable to save bank details"); return; }
      setPayoutProfile(data.data);
      setMessage("Bank & payout details saved for admin verification");
    } catch { setMessage("Unable to save bank details"); } finally { setActionLoading(null); }
  }

  // =====================================================
  // UI NAVIGATION / AUTH
  // =====================================================

  const [screen, setScreen] = useState<DriverScreen>(startAt);
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const otpInputRef = useRef<TextInput | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [driverId, setDriverId] = useState(DEFAULT_DRIVER_ID);
  const [driverProfile, setDriverProfile] = useState<any | null>(null);
  const [driverVehicles, setDriverVehicles] = useState<any[]>([]);
  const [driverDocuments, setDriverDocuments] = useState<any[]>([]);
  const [earningRows, setEarningRows] = useState<any[]>([]);
  const [earningTotals, setEarningTotals] = useState({ gross: 0, commission: 0, net: 0 });
  const [editingVehicle, setEditingVehicle] = useState<any | null>(null);
  const [vehicleNumberInput, setVehicleNumberInput] = useState("");
  const [vehicleCapacityInput, setVehicleCapacityInput] = useState("");
  const [payoutProfile, setPayoutProfile] = useState<any | null>(null);
  const [payoutHolder, setPayoutHolder] = useState("");
  const [payoutAccount, setPayoutAccount] = useState("");
  const [payoutIfsc, setPayoutIfsc] = useState("");
  const [payoutBank, setPayoutBank] = useState("");
  const [payoutUpi, setPayoutUpi] = useState("");
  const [onlineSince, setOnlineSince] = useState<number | null>(null);
  const [onlineClock, setOnlineClock] = useState(Date.now());

  async function loadDriverNotifications() {
    if (!driverId) return;
    try {
      const [listResponse, countResponse] = await Promise.all([
        ridexFetch(`${API}/notifications?actorType=DRIVER&actorId=${encodeURIComponent(driverId)}&channel=IN_APP`),
        ridexFetch(`${API}/notifications/unread-count?actorType=DRIVER&actorId=${encodeURIComponent(driverId)}`),
      ]);
      const listData = await listResponse.json().catch(() => ({}));
      const countData = await countResponse.json().catch(() => ({}));
      if (listResponse.ok && listData.success) setDriverNotifications(Array.isArray(listData.data) ? listData.data : []);
      if (countResponse.ok && countData.success) setUnreadNotificationCount(Number(countData.data?.unreadCount || 0));
    } catch {
      // Keep the last successfully loaded notification state visible.
    }
  }

  async function markDriverNotificationRead(notificationId: string) {
    try {
      const response = await ridexFetch(`${API}/notifications/${notificationId}/read`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorType: "DRIVER", actorId: driverId }),
      });
      if (response.ok) {
        setDriverNotifications(rows => rows.map(n => n.id === notificationId ? { ...n, readAt: n.readAt || new Date().toISOString() } : n));
        setUnreadNotificationCount(c => Math.max(0, c - 1));
      }
    } catch {}
  }

  async function markAllDriverNotificationsRead() {
    try {
      const response = await ridexFetch(`${API}/notifications/read-all`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorType: "DRIVER", actorId: driverId }),
      });
      if (response.ok) {
        setDriverNotifications(rows => rows.map(n => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
        setUnreadNotificationCount(0);
      }
    } catch {}
  }

  useEffect(() => {
    if (!driverId) return;
    void loadDriverNotifications();
    const interval = setInterval(() => void loadDriverNotifications(), 30000);
    return () => clearInterval(interval);
  }, [driverId]);

  const DRIVER_HERO = DRIVER_ASSETS.hero;
  const DRIVER_AVATAR = DRIVER_ASSETS.avatar;
  const DRIVER_VEHICLE = DRIVER_ASSETS.vehicle;

  function goHome() {
    setIncomingRequest(null);
    setScreen("home");
  }

  async function createDriverSupportCase(subject: string, description: string, priority = "NORMAL") {
    if (!driverId) { setMessage("Driver profile is not available."); return false; }
    try {
      setActionLoading("support");
      const response = await ridexFetch(`${API}/support/cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorType: "DRIVER", actorId: driverId, bookingId: activeRequest?.bookingId || undefined, subject, description, priority }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) { setMessage(data.message || "Unable to create support case"); return false; }
      setMessage("Support case created. RideX Support has received your request.");
      return true;
    } catch (error) {
      console.error("DRIVER SUPPORT CASE ERROR:", error);
      setMessage("Unable to reach RideX Support.");
      return false;
    } finally { setActionLoading(null); }
  }

  async function callDriverSupport() {
    try { await Linking.openURL("tel:+9118001234567"); } catch { setMessage("Unable to open support call."); }
  }

  async function triggerDriverSos() {
    if (!driverId) { setMessage("Driver profile is not available."); return; }
    try {
      setActionLoading("sos");
      const location = await getRealDeviceLocation();
      if (!location) return;
      const response = await ridexFetch(`${API}/sos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driverId,
          bookingId: activeRequest?.bookingId || activeRide?.request?.bookingId || undefined,
          latitude: location.latitude,
          longitude: location.longitude,
          reason: "Driver emergency",
          source: "DRIVER_APP",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) { setMessage(data.message || "Unable to send SOS"); return; }
      setMessage("SOS sent to RideX Safety. Support has been alerted.");
      setScreen("sos");
    } catch (error) {
      console.error("DRIVER SOS ERROR:", error);
      setMessage("SOS could not reach RideX Safety.");
    } finally { setActionLoading(null); }
  }

  async function sendOtp() {
    const clean = mobile.replace(/\D/g, "").slice(0, 10);
    if (clean.length !== 10) {
      setAuthMessage("Enter a valid 10-digit mobile number");
      return;
    }
    setAuthLoading(true);
    setAuthMessage("");
    try {
      const response = await ridexFetch(`${API}/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: clean, userType: "DRIVER" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) {
        setAuthMessage(data.message || "Unable to send OTP");
        return;
      }
      setOtp("");
      setScreen("otp");
    } catch (error) {
      console.error("DRIVER SEND OTP ERROR:", error);
      setOtp("");
      setAuthMessage(
        RIDEX_TEST_MODE
          ? "Test backend is reachable only when OTP provider is configured. Use OTP 1234 after the backend accepts the request."
          : "Unable to reach RideX service."
      );
    } finally {
      setAuthLoading(false);
    }
  }

  async function verifyOtp() {
    const clean = mobile.replace(/\D/g, "").slice(0, 10);
    if (otp.length < 4) {
      setAuthMessage("Enter the OTP");
      return;
    }
    setAuthLoading(true);
    setAuthMessage("");
    try {
      const response = await ridexFetch(`${API}/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: clean, otp, userType: "DRIVER" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) {
        setAuthMessage(data.message || "Invalid OTP");
        return;
      }
      const returnedDriverId = String(data.data?.driverId || "").trim();
      const token = String(data.data?.token || "").trim();
      if (!returnedDriverId) {
        setAuthMessage("Driver account was not returned by backend");
        return;
      }
      setDriverId(returnedDriverId);
      await AsyncStorage.setItem(DRIVER_SESSION_KEY, JSON.stringify({ driverId: returnedDriverId }));
      if (token) await AsyncStorage.setItem(DRIVER_AUTH_TOKEN_KEY, token);
      await loadDriver(returnedDriverId);
      setScreen("home");
    } catch (error) {
      console.error("DRIVER VERIFY ERROR:", error);
      setAuthMessage("Unable to reach RideX service.");
    } finally {
      setAuthLoading(false);
    }
  }


  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(DRIVER_SESSION_KEY);
        const parsed = stored ? JSON.parse(stored) : null;
        const id = String(parsed?.driverId || "").trim();
        if (id) { setDriverId(id); await loadDriver(id); }
      } catch (error) { console.error("DRIVER SESSION RESTORE ERROR:", error); }
    })();
  }, []);

  useEffect(() => {
    if (incomingRequest) setScreen("request");
  }, [incomingRequest]);

  useEffect(() => {
    if (!online) return;
    const timer = setInterval(() => setOnlineClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [online]);

  useEffect(() => {
    if (!activeRide) return;
    const status = String(activeRide.booking?.status || "").toUpperCase();
    if (status === "DRIVER_ARRIVED") setScreen("arrived");
    else if (status === "IN_PROGRESS" || status === "STARTED") setScreen("trip");
    else if (status === "DRIVER_ASSIGNED" || status === "DRIVER_ARRIVING") setScreen("accepted");
  }, [activeRide?.booking?.status]);

  // =====================================================
  // LOAD DRIVER
  // =====================================================

  async function loadDriver(id = driverId) {
    try {
      const response =
        await ridexFetch(
          `${API}/driver/${id}`
        );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.success
      ) {
        setMessage(
          data.message ||
            "Unable to load driver"
        );

        return;
      }

      const driver = data.data;
      setDriverProfile(driver || null);
      setDriverVehicles(Array.isArray(driver?.vehicles) ? driver.vehicles : []);
      setDriverDocuments(Array.isArray(driver?.documents) ? driver.documents : []);
      void loadPayoutProfile(id);
      void loadDriverEarnings(id);

      const loadedOnline = driver?.driverStatus === "ONLINE";
      setOnline(loadedOnline);
      setOnlineSince(loadedOnline ? Date.now() : null);

      setServiceMode(
        driver?.dailyServiceMode ||
          "BOTH"
      );
    } catch (error) {
      console.error(
        "LOAD DRIVER ERROR:",
        error
      );

      setMessage(
        "Unable to load driver"
      );
    }
  }

  // =====================================================
  // REFRESH RIDE REQUESTS
  // =====================================================

  async function refreshRequests() {
    if (
      !online ||
      activeRide
    ) {
      return;
    }

    try {
      const response =
        await ridexFetch(
          `${API}/driver/${driverId}/ride-requests`
        );

      const data =
        await response.json();

      setLastRequestCheck(
        new Date().toISOString()
      );

      if (
        !response.ok ||
        !data.success
      ) {
        console.error(
          "REQUEST LOAD FAILED:",
          data
        );

        setMessage(
          data.message ||
            "Unable to load ride requests"
        );

        return;
      }

      const rows =
        Array.isArray(data.data)
          ? data.data
          : [];

      // Show an in-app popup once for each newly offered request.
      const newRequest = rows.find(
        (row: DriverRequest) =>
          !notifiedRequestIds.current.has(row.id)
      );

      rows.forEach((row: DriverRequest) => {
        notifiedRequestIds.current.add(row.id);
      });

      if (newRequest && !activeRide) {
        setIncomingRequest(newRequest);
      }

      // Backend is the source of truth.
      setRequests(rows);

      if (rows.length > 0) {
        console.log(
          "RIDE REQUESTS RECEIVED:",
          rows.length
        );
      }
    } catch (error) {
      console.error(
        "REQUEST REFRESH ERROR:",
        error
      );

      setLastRequestCheck(
        new Date().toISOString()
      );

      setMessage(
        "Unable to check new ride requests"
      );
    }
  }

  async function refreshRequestsNow() {
    if (!online) {
      setMessage(
        "Go online first"
      );
      return;
    }

    await refreshRequests();

    setMessage(
      "Ride requests refreshed"
    );
  }

  // =====================================================
  // REFRESH ACTIVE RIDE
  // =====================================================

  // =====================================================
  // CONNECTION / ACTIVE LEG HELPERS
  // =====================================================

  function isConnectionBooking(booking: any) {
    return (
      booking?.bookingType === "RIDE" &&
      booking?.rideType === "CONNECTION_RIDE"
    );
  }

  function getCurrentDriverLeg(booking: any) {
    const legs = Array.isArray(booking?.legs)
      ? booking.legs
      : [];

    return (
      legs.find(
        (leg: any) =>
          leg?.driverId === driverId &&
          !["COMPLETED", "CANCELLED"].includes(
            String(leg?.status || "").toUpperCase()
          )
      ) || null
    );
  }

  function getLegForRequest(
    booking: any,
    request: DriverRequest
  ) {
    const legs = Array.isArray(booking?.legs)
      ? booking.legs
      : [];

    return (
      legs.find(
        (leg: any) =>
          request?.legId &&
          leg?.id === request.legId
      ) ||
      legs.find(
        (leg: any) =>
          leg?.driverId === driverId &&
          !["COMPLETED", "CANCELLED"].includes(
            String(leg?.status || "").toUpperCase()
          )
      ) ||
      legs[0] ||
      null
    );
  }

  function getRequestForCurrentLeg(
    booking: any,
    legId: string
  ) {
    const rows = Array.isArray(booking?.rideRequests)
      ? booking.rideRequests
      : [];

    return (
      rows.find(
        (row: any) =>
          row?.driverId === driverId &&
          row?.legId === legId &&
          ["OFFERED", "ACCEPTED"].includes(
            String(row?.status || "").toUpperCase()
          )
      ) || null
    );
  }


  function getRequestLeg(request: DriverRequest | null) {
    if (!request) {
      return null;
    }

    return request.leg || null;
  }

  function isFutureConnectionLeg(
    booking: any,
    leg: any
  ) {
    if (!isConnectionBooking(booking) || !leg) {
      return false;
    }

    const legs = Array.isArray(booking?.legs)
      ? booking.legs
      : [];

    return legs.some(
      (row: any) =>
        Number(row?.sequence || 0) < Number(leg?.sequence || 0) &&
        !["COMPLETED", "CANCELLED"].includes(
          String(row?.status || "").toUpperCase()
        )
    );
  }

  // =====================================================
  // REFRESH ACTIVE RIDE
  // =====================================================

  async function refreshActiveRide() {
    if (!activeRide) {
      return;
    }

    try {
      const response =
        await ridexFetch(
          `${API}/bookings/${activeRide.request.bookingId}`
        );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.success
      ) {
        return;
      }

      const booking =
        data.data;

      // -------------------------------------------------
      // CUSTOMER ENDED / RIDE COMPLETED
      // -------------------------------------------------

      if (
        booking?.status ===
        "COMPLETED"
      ) {
        const earnings =
          Array.isArray(
            booking?.driverEarnings
          )
            ? booking.driverEarnings
            : [];

        const earning =
          earnings.find(
            (row: any) =>
              row.driverId ===
              driverId
          ) ||
          earnings[0] ||
          null;

        const completion: Completion = {
          bookingId:
            booking?.id,

          grossFare:
            earning?.grossFare ??
            booking?.finalFare ??
            null,

          commission:
            earning?.commission ??
            null,

          driverEarning:
            earning?.netEarning ??
            null,

          commissionRate:
            booking?.commissionRate ??
            null,
        };

        setLastCompletion(
          completion
        );

        setMessage(
          `Ride completed • Driver earning ₹${money(
            completion.driverEarning
          )}`
        );

        setActiveRide(null);
        setTripPin("");

        return;
      }

      // -------------------------------------------------
      // CANCELLED
      // -------------------------------------------------

      if (
        booking?.status ===
        "CANCELLED"
      ) {
        setMessage(
          "Ride was cancelled"
        );

        setActiveRide(null);
        setTripPin("");

        return;
      }

      // -------------------------------------------------
      // CONNECTION LEG OWNERSHIP
      // -------------------------------------------------
      //
      // One booking can contain several legs. After this
      // driver completes Leg 1, the backend may move the
      // booking to MATCHING and offer the next leg to
      // another driver. In that case this driver must leave
      // the active-ride screen so request polling can resume.
      //
      // If the next leg is assigned to the same driver, keep
      // the active ride and switch to the new leg automatically.
      // -------------------------------------------------

      if (isConnectionBooking(booking)) {
        const currentLeg =
          getCurrentDriverLeg(booking);

        if (!currentLeg) {
          setActiveRide(null);
          setTripPin("");

          if (
            ["MATCHING", "NEW", "DRIVER_ASSIGNED"].includes(
              String(booking?.status || "").toUpperCase()
            )
          ) {
            setMessage(
              "Current leg completed. Waiting for the next Connection Ride request..."
            );
          } else {
            setMessage(
              "This driver is no longer assigned to the active Connection leg."
            );
          }

          return;
        }

        const currentLegRequest =
          getRequestForCurrentLeg(
            booking,
            currentLeg.id
          );

        const nextTripPin =
          currentLeg.tripPin ||
          "";

        setTripPin(
          nextTripPin
        );

        setActiveRide(
          (current) =>
            current
              ? {
                  ...current,
                  request:
                    currentLegRequest
                      ? {
                          ...current.request,
                          id:
                            currentLegRequest.id,
                          legId:
                            currentLegRequest.legId,
                          status:
                            currentLegRequest.status,
                          vehicleId:
                            currentLegRequest.vehicleId,
                          distanceKm:
                            currentLegRequest.distanceKm,
                          etaMinutes:
                            currentLegRequest.etaMinutes,
                          score:
                            currentLegRequest.score,
                        }
                      : current.request,
                  booking,
                }
              : current
        );

        return;
      }

      // -------------------------------------------------
      // NORMAL NON-CONNECTION BOOKING
      // -------------------------------------------------

      if (
        booking?.assignedDriverId &&
        booking.assignedDriverId !== driverId
      ) {
        setActiveRide(null);
        setTripPin("");
        setMessage(
          "Ride assignment changed. Waiting for the next request..."
        );
        return;
      }

      // -------------------------------------------------
      // ACTIVE BOOKING UPDATE
      // -------------------------------------------------

      setActiveRide(
        (current) =>
          current
            ? {
                ...current,
                booking,
              }
            : current
      );
    } catch (error) {
      console.error(
        "ACTIVE RIDE REFRESH ERROR:",
        error
      );
    }
  }

  async function getRealDeviceLocation() {
    try {
      const { status } =
        await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        setGpsEnabled(false);
        setMessage(
          "Location permission is required"
        );
        return null;
      }

      const servicesEnabled =
        await Location.hasServicesEnabledAsync();

      if (!servicesEnabled) {
        setGpsEnabled(false);
        setMessage(
          "Please turn on phone Location"
        );
        return null;
      }

      const position =
        await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

      const latitude =
        position.coords.latitude;

      const longitude =
        position.coords.longitude;

      gpsLatitudeRef.current =
        latitude;

      gpsLongitudeRef.current =
        longitude;

      setGpsLatitude(latitude);
      setGpsLongitude(longitude);
      setGpsEnabled(true);

      return {
        latitude,
        longitude,
        recordedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error(
        "REAL GPS ERROR:",
        error
      );

      setGpsEnabled(false);
      setMessage(
        "Unable to read phone GPS"
      );

      return null;
    }
  }

  async function sendCoordinatesToBackend(
    latitude: number,
    longitude: number,
    accuracy?: number | null,
    heading?: number | null,
    speed?: number | null,
    recordedAt = new Date().toISOString()
  ) {
    if (!driverId) {
      return;
    }

    try {
      // GPS router is mounted at POST /api/v1/gps/location.
      const response =
        await ridexFetch(
          `${API}/gps/location`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              driverId,
              latitude,
              longitude,
              ...(accuracy != null ? { accuracy } : {}),
              ...(heading != null ? { heading } : {}),
              ...(speed != null ? { speed } : {}),
              recordedAt,
              isOnline: online,
            }),
          }
        );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.success
      ) {
        console.error(
          "LOCATION UPDATE FAILED:",
          data
        );

        setMessage(
          data.message ||
            "GPS update failed"
        );

        return false;
      }

      const serverRecordedAt =
        data.data?.location?.recordedAt ||
        data.data?.recordedAt ||
        recordedAt;

      setLastGpsUpdate(
        serverRecordedAt
      );

      console.log(
        "REAL DRIVER GPS UPDATED:",
        {
          latitude:
            data.data?.latitude ??
            latitude,
          longitude:
            data.data?.longitude ??
            longitude,
          recordedAt: serverRecordedAt,
        }
      );

      return true;
    } catch (error) {
      console.error(
        "LOCATION UPDATE ERROR:",
        error
      );

      setMessage(
        "GPS update failed"
      );

      return false;
    }
  }

  async function updateDriverLocation() {
    if (!online) {
      return false;
    }

    const location =
      await getRealDeviceLocation();

    if (!location) {
      return false;
    }

    return sendCoordinatesToBackend(
      location.latitude,
      location.longitude
    );
  }

  async function sendGpsNow() {
    if (!online) {
      setMessage(
        "Go online to send GPS"
      );
      return;
    }

    const sent =
      await updateDriverLocation();

    if (sent) {
      setMessage(
        "GPS location sent"
      );
    }
  }

  // =====================================================
  // SERVICE MODE
  // =====================================================

  async function changeServiceMode(
    mode: ServiceMode
  ) {
    try {
      setLoading(true);

      const response =
        await ridexFetch(
          `${API}/driver/${driverId}/service-mode`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              mode,
            }),
          }
        );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.success
      ) {
        setMessage(
          data.message ||
            "Unable to update service mode"
        );

        return;
      }

      setServiceMode(mode);

      setMessage(
        `Today's service: ${mode}`
      );
    } catch (error) {
      console.error(
        "SERVICE MODE ERROR:",
        error
      );

      setMessage(
        "Backend not reachable"
      );
    } finally {
      setLoading(false);
    }
  }

  // =====================================================
  // ONLINE / OFFLINE
  // =====================================================

  async function toggleOnline() {
    const next =
      !online;

    try {
      setLoading(true);

      let liveLocation: {
        latitude: number;
        longitude: number;
      } | null = null;

      if (next) {
        liveLocation =
          await getRealDeviceLocation();

        if (!liveLocation) {
          return;
        }
      }

      const response =
        await ridexFetch(
          `${API}/driver/${driverId}/online`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              online: next,

              ...(liveLocation
                ? {
                    latitude:
                      liveLocation.latitude,
                    longitude:
                      liveLocation.longitude,
                  }
                : {
                    latitude:
                      gpsLatitudeRef.current,
                    longitude:
                      gpsLongitudeRef.current,
                  }),
            }),
          }
        );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.success
      ) {
        setMessage(
          data.message ||
            "Unable to change online status"
        );

        return;
      }

      setOnline(next);
      setOnlineSince(next ? Date.now() : null);
      setOnlineClock(Date.now());

      if (!next) {
        gpsSubscriptionRef.current?.remove();
        gpsSubscriptionRef.current = null;
        setRequests([]);
        setLastRequestCheck(null);
        setMessage(
          "You are OFFLINE"
        );
        return;
      }

      if (liveLocation) {
        setGpsLatitude(
          liveLocation.latitude
        );
        setGpsLongitude(
          liveLocation.longitude
        );
        gpsLatitudeRef.current =
          liveLocation.latitude;
        gpsLongitudeRef.current =
          liveLocation.longitude;
      }

      setMessage(
        "You are ONLINE"
      );
    } catch (error) {
      console.error(
        "ONLINE STATUS ERROR:",
        error
      );

      setMessage(
        "Backend not reachable"
      );
    } finally {
      setLoading(false);
    }
  }


  // =====================================================
  // ACCEPT RIDE
  // =====================================================

  async function acceptRide(
    request: DriverRequest
  ) {
    try {
      setActionLoading(
        request.id
      );

      setMessage(
        "Accepting ride..."
      );

      const response =
        await ridexFetch(
          `${API}/driver/ride-requests/${request.id}/accept`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              driverId:
                driverId,
            }),
          }
        );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.success
      ) {
        setMessage(
          data.message ||
            "Unable to accept ride"
        );

        return;
      }

      // Get fresh booking so the exact accepted BookingLeg
      // and its own Trip PIN are used.
      const bookingResponse =
        await ridexFetch(
          `${API}/bookings/${request.bookingId}`
        );

      const bookingData =
        await bookingResponse.json();

      const booking =
        bookingData.success
          ? bookingData.data
          : request.booking;

      const acceptedLeg =
        getLegForRequest(
          booking,
          request
        );

      setTripPin(
        acceptedLeg?.tripPin ||
          ""
      );

      const acceptedRequest: DriverRequest = {
        ...request,
        legId:
          acceptedLeg?.id ??
          request.legId ??
          null,
      };

      setActiveRide({
        request:
          acceptedRequest,
        booking,
      });

      setIncomingRequest(null);

      // Publish the current driver position immediately
      // after accepting the booking.
      await updateDriverLocation();

      setRequests(
        (current) =>
          current.filter(
            (item) =>
              item.id !==
              request.id
          )
      );

      setLastCompletion(null);

      setMessage(
        isConnectionBooking(booking)
          ? `Connection Ride Leg ${
              acceptedLeg?.sequence ?? 1
            } accepted successfully`
          : "Ride accepted successfully"
      );
    } catch (error) {
      console.error(
        "ACCEPT RIDE ERROR:",
        error
      );

      setMessage(
        "Unable to accept ride"
      );
    } finally {
      setActionLoading(null);
    }
  }

  // =====================================================
  // REJECT RIDE
  // =====================================================


  // =====================================================

  async function rejectRide(
    requestId: string
  ) {
    try {
      setActionLoading(
        requestId
      );

      const response =
        await ridexFetch(
          `${API}/driver/ride-requests/${requestId}/reject`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              driverId:
                driverId,
            }),
          }
        );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.success
      ) {
        setMessage(
          data.message ||
            "Unable to reject ride"
        );

        return;
      }

      setRequests(
        (current) =>
          current.filter(
            (item) =>
              item.id !==
              requestId
          )
      );

      setMessage(
        "Ride rejected"
      );
    } catch (error) {
      console.error(
        "REJECT RIDE ERROR:",
        error
      );

      setMessage(
        "Unable to reject ride"
      );
    } finally {
      setActionLoading(null);
    }
  }

  // =====================================================
  // DRIVER ARRIVED
  // =====================================================

  async function markArrived() {
    if (!activeRide) {
      return;
    }

    try {
      setLoading(true);

      const response =
        await ridexFetch(
          `${API}/driver/bookings/${activeRide.request.bookingId}/arrived`,
          {
            method: "POST",
          }
        );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.success
      ) {
        setMessage(
          data.message ||
            "Unable to mark arrival"
        );

        return;
      }

      setActiveRide(
        (current) =>
          current
            ? {
                ...current,

                booking: {
                  ...current.booking,

                  status:
                    "DRIVER_ARRIVED",

                  driverArrivedAt:
                    data.data
                      ?.driverArrivedAt,

                  pickupWaitExpiresAt:
                    data.data
                      ?.waitExpiresAt,
                },
              }
            : current
      );

      setMessage(
        data.data?.waitExpiresAt
          ? `Driver arrived. Waiting until ${new Date(
              data.data.waitExpiresAt
            ).toLocaleTimeString()}`
          : "Driver arrived at pickup"
      );
    } catch (error) {
      console.error(
        "ARRIVED ERROR:",
        error
      );

      setMessage(
        "Unable to mark arrival"
      );
    } finally {
      setLoading(false);
    }
  }

  // =====================================================
  // START RIDE
  // =====================================================

  async function prepareVerification(method: "OTP"|"QR") {
    if (!activeRide) return;
    setVerificationMethod(method);
    try {
      const response = await ridexFetch(`${API}/trips/verification`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({bookingId:activeRide.request.bookingId,legId:activeRide.request.legId,method})});
      const data = await response.json();
      if(!response.ok || !data.success) { setMessage(data.message || "Unable to prepare verification"); return; }
      if(method === "QR") { setQrPayload(String(data.data?.qrPayload || "")); setVerificationExpiresAt(String(data.data?.expiresAt || "")); } else setTripPin("");
      setMessage(method === "QR" ? "Show this QR to the customer." : "Ask the customer for the OTP.");
    } catch { setMessage("Verification service unavailable"); }
  }

  async function startRide() {
    if (!activeRide) {
      return;
    }

    if (verificationMethod === "OTP" && !tripPin.trim()) {
      setMessage("Enter the 4-digit OTP");
      return;
    }
    if (verificationMethod === "QR" && !qrPayload) {
      setMessage("Generate and show the QR to the customer first");
      return;
    }

    try {
      setLoading(true);

      const response =
        await ridexFetch(
          `${API}/driver/bookings/${activeRide.request.bookingId}/start`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              verificationMethod,
              pin: tripPin.trim(),
              verificationCredential: verificationMethod === "QR" ? qrPayload.trim() : tripPin.trim(),
            }),
          }
        );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.success
      ) {
        setMessage(
          data.message ||
            "Unable to start ride"
        );

        return;
      }

      setActiveRide(
        (current) =>
          current
            ? {
                ...current,

                booking:
                  data.data ||
                  {
                    ...current.booking,

                    status:
                      "IN_PROGRESS",
                  },
              }
            : current
      );

      setMessage(
        "Ride started successfully"
      );
    } catch (error) {
      console.error(
        "START RIDE ERROR:",
        error
      );

      setMessage(
        "Unable to start ride"
      );
    } finally {
      setLoading(false);
    }
  }

  // =====================================================
  // COMPLETE RIDE
  // =====================================================

  async function completeRide() {
    if (!activeRide) {
      return;
    }

    try {
      setLoading(true);

      setMessage(
        "Completing ride..."
      );

      const response =
        await ridexFetch(
          `${API}/driver/bookings/${activeRide.request.bookingId}/complete`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              driverId:
                driverId,
            }),
          }
        );

      const data =
        await response.json();

      console.log(
        "COMPLETE RIDE RESPONSE:",
        JSON.stringify(
          data,
          null,
          2
        )
      );

      if (
        !response.ok ||
        !data.success
      ) {
        setMessage(
          data.message ||
            "Unable to complete ride"
        );

        return;
      }

      const result =
        data.data || {};

      const completion: Completion =
        {
          bookingId:
            result.bookingId,

          grossFare:
            result.grossFare,

          commission:
            result.commission,

          commissionRate:
            result.commissionRate,

          driverEarning:
            result.driverEarning,

          actualDistanceKm:
            result.actualDistanceKm,

          actualDurationMinutes:
            result.actualDurationMinutes,

          tripId:
            result.tripId,

          paymentMethod:
            result.payment?.method ??
            result.booking?.paymentPreference ??
            activeRide?.booking?.paymentPreference ??
            null,

          paymentStatus:
            result.payment?.status ??
            result.booking?.payment?.status ??
            null,
        };

      setLastCompletion(
        completion
      );

      setMessage(
        `Ride completed • Driver earning ₹${money(
          completion.driverEarning
        )}`
      );

      setActiveRide(null);
      setTripPin("");
      setScreen("completed");
    } catch (error) {
      console.error(
        "COMPLETE RIDE ERROR:",
        error
      );

      setMessage(
        "Unable to complete ride"
      );
    } finally {
      setLoading(false);
    }
  }

  // =====================================================
  // BACKEND CHECK
  // =====================================================

  async function testBackend() {
    try {
      setLoading(true);

      const response =
        await ridexFetch(
          `${API}/health`
        );

      const data =
        await response.json();

      setMessage(
        data.success
          ? "Backend connected"
          : "Backend error"
      );
    } catch (error) {
      console.error(
        "BACKEND CHECK ERROR:",
        error
      );

      setMessage(
        "Backend not reachable"
      );
    } finally {
      setLoading(false);
    }
  }

  // =====================================================
  // INITIAL LOAD
  // =====================================================

  useEffect(() => {
    loadDriver();
  }, []);

  // =====================================================
  // REQUEST POLLING
  // =====================================================

  useEffect(() => {
    if (!incomingRequest) {
      return;
    }

    const interval = setInterval(() => {
      const expiresAt = incomingRequest.expiresAt ? new Date(incomingRequest.expiresAt).getTime() : 0;
      const now = Date.now();
      setRequestNow(now);
      if (expiresAt > 0 && expiresAt <= now) {
        setIncomingRequest(null);
        setScreen((current) => current === "request" ? "home" : current);
        void refreshRequests();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [incomingRequest]);

  useEffect(() => {
    if (
      !online ||
      activeRide
    ) {
      return;
    }

    refreshRequests();

    const interval =
      setInterval(
        refreshRequests,
        5000
      );

    return () => {
      clearInterval(
        interval
      );
    };
  }, [
    online,
    activeRide,
  ]);

  // =====================================================
  // ACTIVE RIDE POLLING
  // =====================================================

  useEffect(() => {
    if (!activeRide) {
      return;
    }

    refreshActiveRide();

    const interval =
      setInterval(
        refreshActiveRide,
        3000
      );

    return () => {
      clearInterval(
        interval
      );
    };
  }, [activeRide]);

  // =====================================================
  // REAL DRIVER LOCATION
  // =====================================================

  useEffect(() => {
    if (!online) {
      gpsSubscriptionRef.current?.remove();
      gpsSubscriptionRef.current = null;
      return;
    }

    let cancelled = false;

    async function startGpsWatch() {
      try {
        const { status } =
          await Location.requestForegroundPermissionsAsync();

        if (
          cancelled ||
          status !== "granted"
        ) {
          setGpsEnabled(false);
          setMessage(
            "Location permission is required"
          );
          return;
        }

        const servicesEnabled =
          await Location.hasServicesEnabledAsync();

        if (
          cancelled ||
          !servicesEnabled
        ) {
          setGpsEnabled(false);
          setMessage(
            "Please turn on phone Location"
          );
          return;
        }

        gpsSubscriptionRef.current?.remove();

        gpsSubscriptionRef.current =
          await Location.watchPositionAsync(
            {
              accuracy:
                Location.Accuracy.High,
              timeInterval: 10000,
              distanceInterval: 10,
            },
            async (position) => {
              if (cancelled) {
                return;
              }

              const latitude =
                position.coords.latitude;

              const longitude =
                position.coords.longitude;

              gpsLatitudeRef.current =
                latitude;

              gpsLongitudeRef.current =
                longitude;

              setGpsLatitude(latitude);
              setGpsLongitude(longitude);
              setGpsEnabled(true);

              await sendCoordinatesToBackend(
                latitude,
                longitude,
                position.coords.accuracy,
                position.coords.heading,
                position.coords.speed,
                new Date(position.timestamp).toISOString()
              );
            }
          );
      } catch (error) {
        console.error(
          "GPS WATCH ERROR:",
          error
        );

        if (!cancelled) {
          setGpsEnabled(false);
          setMessage(
            "Unable to start live GPS"
          );
        }
      }
    }

    startGpsWatch();

    refreshRequests();

    return () => {
      cancelled = true;
      gpsSubscriptionRef.current?.remove();
      gpsSubscriptionRef.current = null;
    };
  }, [online]);

  // =====================================================
  // ACTIVE RIDE DATA
  // =====================================================

  const activeBooking =
    activeRide?.booking;

  const activeStatus =
    activeBooking?.status ||
    "UNKNOWN";

  const activeStops =
    Array.isArray(
      activeBooking?.stops
    )
      ? activeBooking.stops
      : [];

  const activeLegs =
    Array.isArray(
      activeBooking?.legs
    )
      ? activeBooking.legs
      : [];

  const currentDriverLeg =
    getCurrentDriverLeg(
      activeBooking
    );

  const currentConnectionLeg =
    isConnectionBooking(activeBooking)
      ? currentDriverLeg
      : null;

  const futureConnectionLeg =
    isFutureConnectionLeg(
      activeBooking,
      currentConnectionLeg
    );

  const legActionBlocked =
    Boolean(currentConnectionLeg) &&
    futureConnectionLeg;

  const canArrive =
    !legActionBlocked &&
    (activeStatus ===
      "DRIVER_ASSIGNED" ||
      activeStatus ===
        "DRIVER_ARRIVING");

  const canStart =
    !legActionBlocked &&
    activeStatus === "DRIVER_ARRIVED";

  const canComplete =
    !legActionBlocked &&
    (activeStatus ===
      "IN_PROGRESS" ||
      activeStatus ===
        "STARTED");


  // =====================================================
  // REFERENCE-MATCHED DRIVER APP UI
  // =====================================================

  const activeRequest = incomingRequest;
  const booking = activeRide?.booking || activeRequest?.booking || {};
  const currentLeg = activeBooking ? getCurrentDriverLeg(activeBooking) : getRequestLeg(activeRequest);
  const fare = money(currentLeg?.estimatedFare ?? booking?.estimatedFare ?? 70);
  const distance = Number(activeRide?.request?.distanceKm ?? activeRequest?.distanceKm ?? currentLeg?.distanceKm ?? 2.8);
  const eta = Number(activeRide?.request?.etaMinutes ?? activeRequest?.etaMinutes ?? currentLeg?.etaMinutes ?? 8);
  const customerName = booking?.customer?.name || "Amit Kumar";
  const pickup = currentLeg?.pickupAddress || booking?.pickupAddress || "Pickup location unavailable";
  const drop = currentLeg?.dropAddress || booking?.dropAddress || "Drop location unavailable";
  const vehicleLabel = booking?.goodsVehicleType === "PICKUP_TRUCK" ? "Pickup Truck" : "E-Rickshaw";

  const UI = {
    Header: ({back=false, help=true, backHandler}:{back?:boolean;help?:boolean;backHandler?:()=>void}) => (
      <View style={styles.header}>
        <Pressable style={styles.headerCircle} onPress={back ? (backHandler || goHome) : () => {}}>
          <DriverIcon name={back ? "back" : "menu"} size={21} />
        </Pressable>
        <View style={styles.brandBlock}>
          <Image source={DRIVER_ASSETS.logo} resizeMode="contain" style={styles.logoImage} />
        </View>
        {help ? (
          <Pressable style={styles.helpPill} onPress={() => setScreen("messages")}>
            <DriverIcon name="support" size={17}/><Text style={styles.helpText}>Help</Text>
          </Pressable>
        ) : <View style={{width:44}} />}
      </View>
    ),

    TopProfile: () => (
      <View style={styles.topProfile}>
        <Pressable onPress={() => setScreen("profile")} accessibilityRole="button" accessibilityLabel="Open driver profile">
          <Image source={DRIVER_AVATAR} style={styles.driverAvatar} />
        </Pressable>
        <View style={{flex:1,marginLeft:10}}>
          <View style={styles.onlinePill}><DriverIcon name="online" size={12} /><Text style={styles.onlinePillText}>{online ? "Online" : "Offline"}</Text></View>
        </View>
        <Pressable style={styles.bellBtn} onPress={() => setScreen("notifications")}>
          <DriverIcon name="notification" size={22} /><View style={styles.notificationDot}/>
        </Pressable>
      </View>
    ),

    BottomNav: ({active}:{active:"home"|"rides"|"earnings"|"messages"|"profile"}) => {
      const items = [
        ["home","home","Home"],["rides","rides","Rides"],["earnings","earnings","Earnings"],
        ["messages","messages","Messages"],["profile","profile","Profile"]
      ] as const;
      return (
        <View style={styles.bottomNav}>
          {items.map(([key,icon,label])=>(
            <Pressable key={key} style={[styles.navItem,active===key&&styles.navItemActive]}
              onPress={()=>setScreen(key === "rides" ? "history" : key as DriverScreen)}>
              <DriverIcon name={icon} size={22} />
              <Text style={[styles.navLabel,active===key&&styles.navLabelActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      );
    }
  };

  function Primary({title,onPress,disabled=false}:{title:string;onPress:()=>void;disabled?:boolean}) {
    return <Pressable style={[styles.primary,disabled&&styles.disabled]} onPress={onPress} disabled={disabled}><Text style={styles.primaryText}>{title}</Text><Text style={styles.primaryArrow}>›</Text></Pressable>;
  }

  function Outline({title,onPress}:{title:string;onPress:()=>void}) {
    return <Pressable style={styles.outline} onPress={onPress}><Text style={styles.outlineText}>{title}</Text><Text style={styles.outlineArrow}>›</Text></Pressable>;
  }

  function Metric({title,value,accent=false}:{title:string;value:string;accent?:boolean}) {
    return <View style={[styles.metric,accent&&styles.metricAccent]}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricTitle}>{title}</Text></View>;
  }

  function MapCard() {
    const driverCoordinate = {
      latitude: Number(gpsLatitude),
      longitude: Number(gpsLongitude),
    };

    const pickupCoordinate = {
      latitude: Number(currentLeg?.pickupLat ?? booking?.pickupLat),
      longitude: Number(currentLeg?.pickupLng ?? booking?.pickupLng),
    };

    const dropCoordinate = {
      latitude: Number(currentLeg?.dropLat ?? booking?.dropLat),
      longitude: Number(currentLeg?.dropLng ?? booking?.dropLng),
    };

    const hasPickup =
      Number.isFinite(pickupCoordinate.latitude) &&
      Number.isFinite(pickupCoordinate.longitude);
    const hasDrop =
      Number.isFinite(dropCoordinate.latitude) &&
      Number.isFinite(dropCoordinate.longitude);
    const hasDriver =
      gpsEnabled &&
      Number.isFinite(driverCoordinate.latitude) &&
      Number.isFinite(driverCoordinate.longitude);

    const routeCoordinates = [
      ...(hasDriver ? [driverCoordinate] : []),
      ...(hasPickup ? [pickupCoordinate] : []),
      ...(hasDrop ? [dropCoordinate] : []),
    ];

    const center = hasDriver
      ? driverCoordinate
      : hasPickup
        ? pickupCoordinate
        : { latitude: FALLBACK_LATITUDE, longitude: FALLBACK_LONGITUDE };

    function recenterMap() {
      const points = routeCoordinates.length >= 2
        ? routeCoordinates
        : [center];

      if (points.length >= 2) {
        driverMapRef.current?.fitToCoordinates(points, {
          edgePadding: { top: 70, right: 70, bottom: 110, left: 70 },
          animated: true,
        });
      } else {
        driverMapRef.current?.animateToRegion({
          ...center, latitudeDelta: 0.02, longitudeDelta: 0.02,
        }, 500);
      }
    }

    async function openNavigation() {
      const target = hasPickup ? pickupCoordinate : hasDrop ? dropCoordinate : null;
      if (!target) {
        setMessage("Route coordinates are not available.");
        return;
      }
      const url = `https://www.google.com/maps/dir/?api=1&destination=${target.latitude},${target.longitude}&travelmode=driving`;
      try {
        await Linking.openURL(url);
      } catch {
        setMessage("Unable to open navigation.");
      }
    }

    return (
      <View style={styles.map}>
        <MapView
          ref={driverMapRef}
          style={StyleSheet.absoluteFill}
          mapType={driverMapType}
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsCompass
          toolbarEnabled
          initialRegion={{
            ...center,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
          }}
          onMapReady={recenterMap}
        >
          {hasDriver ? (
            <Marker
              coordinate={driverCoordinate}
              title={gpsEnabled ? "Your live location" : "Driver location"}
              description={lastGpsUpdate ? `Updated ${new Date(lastGpsUpdate).toLocaleTimeString()}` : undefined}
            >
              <View style={styles.liveDriverMarker}>
                <DriverIcon name="location" size={18} />
              </View>
            </Marker>
          ) : null}

          {hasPickup ? (
            <Marker coordinate={pickupCoordinate} title="Pickup" description={pickup}>
              <View style={styles.mapMarker}><DriverIcon name="pickup" size={18} /></View>
            </Marker>
          ) : null}

          {hasDrop ? (
            <Marker coordinate={dropCoordinate} title="Drop" description={drop}>
              <View style={[styles.mapMarker, styles.dropMarkerPin]}><DriverIcon name="drop" size={18} /></View>
            </Marker>
          ) : null}

          {routeCoordinates.length >= 2 ? (
            <Polyline
              coordinates={routeCoordinates}
              strokeWidth={5}
              strokeColor="#1677FF"
              lineCap="round"
              lineJoin="round"
            />
          ) : null}
        </MapView>

        <View style={styles.mapOverlayTop}>
          <View style={styles.liveGpsPill}>
            <View style={[styles.liveGpsDot, gpsEnabled && styles.liveGpsDotOn]} />
            <Text style={styles.liveGpsText}>{gpsEnabled ? "LIVE GPS" : "GPS OFF"}</Text>
          </View>
          <Pressable
            style={styles.mapLayerButton}
            onPress={() => setDriverMapType((value) => value === "standard" ? "satellite" : value === "satellite" ? "hybrid" : "standard")}
          >
            <DriverIcon name="layers" size={19} />
          </Pressable>
        </View>

        <View style={styles.mapActions}>
          <Pressable style={styles.mapAction} onPress={recenterMap}>
            <DriverIcon name="target" size={20}/><Text style={styles.mapActionHint}>Center</Text>
          </Pressable>
          <Pressable style={styles.mapAction} onPress={openNavigation}>
            <DriverIcon name="navigate" size={20}/><Text style={styles.mapActionHint}>Navigate</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  function StatusBanner({title,sub,green=true}:{title:string;sub:string;green?:boolean}) {
    return <View style={[styles.statusBanner,green?styles.bannerGreen:styles.bannerRed]}>
      <View style={styles.statusIcon}><DriverIcon name={green?"check":"alert"} size={18}/></View>
      <View style={{flex:1}}><Text style={styles.statusTitle}>{title}</Text><Text style={styles.statusSub}>{sub}</Text></View>
    </View>;
  }

  function WelcomeScreen() {
    return <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.authScroll} showsVerticalScrollIndicator={false}>
        <View style={styles.welcomeTop}><UI.Header help={true}/></View>
        <View style={styles.driverBadge}><Text style={styles.driverBadgeText}>Driver App</Text></View>
        <Text style={styles.welcomeTitle}>Drive Today{"\n"}<Text style={styles.welcomeGreen}>A Better Tomorrow</Text></Text>
        <Text style={styles.welcomeSub}>Earn. Grow. Be Your Own Boss.</Text>
        <Image source={DRIVER_HERO} resizeMode="contain" style={styles.driverHeroImage}/>
        <View style={styles.welcomeBenefits}>
          <FeatureRow icon="₹" title="Good Earnings"/>
          <FeatureRow icon="◷" title="Flexible Working Hours"/>
          <FeatureRow icon="👥" title="More Ride Requests"/>
          <FeatureRow icon="✓" title="Safe & Secure Platform"/>
        </View>
        <View style={styles.dots}><Text style={styles.dotActive}>●</Text><Text>●</Text><Text>●</Text></View>
        <Primary title="Login as Driver" onPress={()=>setScreen("login")}/>
        <Outline title="New Driver? Register Now" onPress={()=>setScreen("login")}/>
        <Text style={styles.bottomScript}>Chalo Milkar{"\n"}Behtar Shehar Banaye</Text>
      </ScrollView>
    </SafeAreaView>;
  }

  function FeatureRow({icon,title}:{icon:string;title:string}) {
    return <View style={styles.benefitRow}><View style={styles.benefitIcon}><DriverLegacyIcon glyph={icon} size={24}/></View><Text style={styles.benefitText}>{title}</Text></View>;
  }

  function LoginScreen() {
    return <SafeAreaView style={styles.page}>
      <KeyboardAvoidingView
        style={{flex:1}}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.authScroll}
          keyboardShouldPersistTaps="always"
          keyboardDismissMode="none"
          automaticallyAdjustKeyboardInsets
        >
      <UI.Header back help={false} backHandler={onBackToCustomer || (()=>setScreen("welcome"))}/>
      <Image source={DRIVER_HERO} resizeMode="cover" style={styles.authHeroImage}/>
      <View style={styles.driverBadgeCenter}><Text style={styles.driverBadgeText}>Driver App</Text></View>
      <Text style={styles.authTitle}>Login as Driver</Text>
      <Text style={styles.authSub}>Enter your mobile number to continue</Text>
      <View style={styles.authCard}>
        <View style={styles.phoneBox}><Text style={styles.country}>+91</Text><View style={styles.vDivider}/><TextInput style={styles.phoneInput} placeholder="Enter your mobile number" placeholderTextColor="#9AA4B5" keyboardType="phone-pad" maxLength={10} value={mobile} onChangeText={setMobile}/></View>
        <Primary title={authLoading?"Sending...":"Send OTP"} onPress={sendOtp} disabled={authLoading}/>
        <Text style={styles.orLine}>Or continue with</Text>
        <Outline title="Continue with Google" onPress={()=>setAuthMessage("Google login is not enabled. Please use mobile OTP.")}/>
        <View style={styles.authValueCard}><View style={{flex:1}}><FeatureRow icon="₹" title="Earn More"/><FeatureRow icon="◷" title="Flexible Hours"/><FeatureRow icon="✓" title="Safe & Secure"/></View><Image source={DRIVER_VEHICLE} style={styles.authVehicleImage}/></View>
        <Text style={styles.bottomScript}>Driver Bano{"\n"}Apni Pehchaan Banao</Text>
        <Text style={styles.authMessage}>{authMessage}</Text>
      </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>;
  }

  function OtpScreen() {
    return <SafeAreaView style={styles.page}>
      <KeyboardAvoidingView
        style={{flex:1}}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.authScroll}
          keyboardShouldPersistTaps="always"
          keyboardDismissMode="none"
          automaticallyAdjustKeyboardInsets
        >
      <UI.Header back/>
      <Image source={DRIVER_HERO} resizeMode="cover" style={styles.authHeroImage}/>
      <View style={styles.driverBadgeCenter}><Text style={styles.driverBadgeText}>Driver App</Text></View>
      <Text style={styles.authTitle}>Verify OTP</Text>
      <Text style={styles.authSub}>We have sent a 4-digit OTP to</Text>
      <Text style={styles.phoneDisplay}>+91 {mobile}</Text>
      <Pressable style={styles.otpRow} onPress={() => otpInputRef.current?.focus()} accessibilityRole="button" accessibilityLabel="Enter 4 digit OTP">
        {[0,1,2,3].map(i => <View key={i} style={[styles.otpCell, otp[i] ? styles.otpCellFilled : null]}><Text style={styles.otpDigit}>{otp[i] || ""}</Text></View>)}
        <TextInput
          ref={otpInputRef}
          value={otp}
          onChangeText={(value) => setOtp(value.replace(/\D/g,"").slice(0,4))}
          style={styles.otpAutofillInput}
          maxLength={4}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          importantForAutofill="yes"
          autoFocus
          caretHidden
        />
      </Pressable>
      <Text style={styles.resend}>Resend OTP in <Text style={styles.greenText}>00:25</Text></Text>
      <Primary title={authLoading?"Verifying...":"Verify & Continue"} onPress={verifyOtp} disabled={authLoading}/>
      <Text style={styles.bottomScript}>Saath Chalenge{"\n"}Behtar Shehar Banayenge</Text>
      <Text style={styles.authMessage}>{authMessage || (RIDEX_TEST_MODE ? "Test OTP: 1234" : "Enter the OTP sent to your mobile")}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>;
  }

  function HomeScreen() {
    return <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={{padding:16,paddingBottom:120}} showsVerticalScrollIndicator={false}>
        <UI.TopProfile/>
        <View style={styles.homeBrandLine}><View><Text style={styles.hello}>Hello, {driverProfile?.fullName || driverProfile?.name || driverProfile?.user?.fullName || driverProfile?.user?.name || "Driver"}</Text><Text style={styles.helloSub}>Drive Safe, Earn More!</Text></View><Pressable onPress={toggleOnline} disabled={loading} style={[styles.onlineToggle,online&&styles.onlineToggleOn,loading&&styles.onlineToggleDisabled]} accessibilityRole="switch" accessibilityState={{checked:online,busy:loading}}><Text style={styles.onlineToggleText}>{loading?"Updating…":online?"Online":"Offline"}</Text><View style={styles.toggleKnob}/></Pressable></View>
        <MapCard/>
        {online ? <View style={styles.requestHomeSection}>
          <View style={styles.activityHeader}><View style={styles.sectionTitleWrap}><DriverIcon name="rides" size={18}/><Text style={styles.sectionTitle}>Ride Requests</Text></View><Text style={styles.requestCount}>{requests.length}/4</Text></View>
          {requests.length===0 ? <View style={styles.emptyRequestCard}><DriverIcon name="notification" size={24}/><View style={{flex:1}}><Text style={styles.emptyRequestTitle}>No new requests</Text><Text style={styles.emptyRequestSub}>We’ll show compatible rides from your approved working routes.</Text></View></View> : requests.slice(0,4).map((r: DriverRequest)=><Pressable key={r.id} style={styles.homeRequestCard} onPress={()=>{setIncomingRequest(r);setScreen("request");}}>
            <View style={styles.homeRequestIcon}><DriverIcon name={String(r.booking?.bookingType||"").toUpperCase()==="GOODS"?"goods":"rides"} size={22}/></View>
            <View style={{flex:1}}><Text style={styles.homeRequestTitle}>{String(r.booking?.bookingType||"RIDE").replaceAll("_"," ")}</Text><Text style={styles.homeRequestRoute}>{String(r.booking?.pickupAddress||"Pickup")} → {String(r.booking?.dropAddress||"Drop")}</Text><Text style={styles.homeRequestMeta}>{Number(r.distanceKm||0).toFixed(1)} km • {Number(r.etaMinutes||0)} min • ₹{money(r.leg?.estimatedFare ?? r.booking?.estimatedFare ?? 0)}</Text></View><DriverIcon name="chevron_right" size={18}/></Pressable>)}
        </View> : null}
        {activeRide ? <View style={styles.activeHomeCard}>
          <View style={styles.activityHeader}><View style={styles.sectionTitleWrap}><DriverIcon name="rides" size={18}/><Text style={styles.sectionTitle}>Active Ride</Text></View><Text style={styles.activeRideStatus}>{String(activeRide.booking?.status||"ACTIVE").replaceAll("_"," ")}</Text></View>
          <Text style={styles.homeRequestRoute}>{String(activeRide.booking?.pickupAddress||"Pickup")} → {String(activeRide.booking?.dropAddress||"Drop")}</Text>
          <Text style={styles.homeRequestMeta}>{Number(activeRide.request?.distanceKm||0).toFixed(1)} km • {Number(activeRide.request?.etaMinutes||0)} min</Text>
          <Primary title="Open Active Ride" onPress={()=>{const st=String(activeRide.booking?.status||""); setScreen(st==="DRIVER_ARRIVED"?"arrived":(st==="STARTED"||st==="IN_PROGRESS")?"trip":"accepted")}}/>
        </View> : null}
        <View style={styles.summaryRow}><View style={styles.todayEarn}><Text style={styles.todayLabel}>Today's Earnings</Text><Text style={styles.todayValue}>₹{money(earningRows.filter((r:any)=>{const d=new Date(r.createdAt||0); const n=new Date(); return d.toDateString()===n.toDateString();}).reduce((sum:number,r:any)=>sum+Number(r.netEarning||0),0))}</Text><Text style={styles.moreArrow}>›</Text></View><Metric title="Today's Rides" value={`${earningRows.filter((r:any)=>{const d=new Date(r.createdAt||0); const n=new Date(); return d.toDateString()===n.toDateString();}).length}`}/><Metric title="Online Time" value={onlineSince ? `${Math.floor((onlineClock-onlineSince)/3600000)}h ${Math.floor(((onlineClock-onlineSince)%3600000)/60000)}m` : "—"}/></View>
        <View style={styles.featureStrip}>
          {[
            ["▣","Ride History","history","#FDEDEE"],["▣","Wallet","support","#EFE8FF"],["▥","Earnings","earnings","#FFF1D9"],["◉","Support","messages","#E7F8EF"]
          ].map(x=><Pressable key={x[1]} style={styles.featureItem} onPress={()=>x[2]==="history"?setScreen("history"):x[2]==="earnings"?setScreen("earnings"):setScreen("messages")}><View style={[styles.featureCircle,{backgroundColor:x[3]}]}><Text>{x[0]}</Text></View><Text style={styles.featureLabel}>{x[1]}</Text></Pressable>)}
        </View>
        <View style={styles.promo}><View style={{flex:1}}><Text style={styles.promoTitle}>More Rides{"\n"}More Earnings</Text><Text style={styles.promoSub}>Keep your app online to get more ride requests.</Text></View><Image source={DRIVER_VEHICLE} style={styles.promoVehicle}/></View>
        <View style={styles.activity}><View style={styles.activityHeader}><Text style={styles.sectionTitle}>Today's Activity</Text><Pressable onPress={()=>setScreen("history")}><Text style={styles.link}>View All ›</Text></Pressable></View>
        {earningRows.slice(0,4).map((r:any)=>{
          const created = new Date(r.createdAt||Date.now());
          const status = String(r.booking?.status||r.status||"COMPLETED").toUpperCase();
          const cancelled = status.includes("CANCEL");
          const route = `${String(r.booking?.pickupAddress||"Pickup")} → ${String(r.booking?.dropAddress||"Drop")}`;
          return <View key={r.id} style={styles.activityRow}><Text style={styles.activityTime}>{created.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"})}</Text><View style={[styles.activityDot,{backgroundColor:cancelled?COLORS.red:"#0AA35A"}]}/><View style={{flex:1}}><Text style={styles.activityTitle}>{cancelled?"Cancelled Ride":"Completed Ride"}</Text><Text style={styles.activitySub}>{route}</Text></View><Text style={styles.activityFare}>₹{money(Number(r.netEarning||0))}</Text></View>;
        })}
        </View>
        <Pressable style={styles.serviceShortcut} onPress={()=>setScreen("serviceMode")}><Text style={styles.shortLabel}>Today's Service Mode</Text><Text style={styles.shortValue}>{serviceMode}</Text><Text style={styles.link}>Edit ›</Text></Pressable>
      </ScrollView><UI.BottomNav active="home"/>
    </SafeAreaView>;
  }

  function ServiceModeScreen() {
    const approvedVehicleStatuses = new Set(["ACTIVE","VERIFIED"]);
    const hasRickshaw = driverVehicles.some((v:any) => String(v?.vehicleType||"").toUpperCase() === "E_RICKSHAW" && approvedVehicleStatuses.has(String(v?.status||"").toUpperCase()));
    const hasPickup = driverVehicles.some((v:any) => String(v?.vehicleType||"").toUpperCase() === "PICKUP_TRUCK" && v?.goodsEligible !== false && approvedVehicleStatuses.has(String(v?.status||"").toUpperCase()));
    const modes: Array<{
      id: "PASSENGER" | "GOODS" | "BOTH";
      title: string;
      subtitle: string;
      icon: string;
      bg: string;
      checks: string[];
    }> = [
      ...(hasRickshaw ? [{id:"PASSENGER" as const,title:"Passenger + Parcel",subtitle:"Passenger rides and eligible Parcel delivery",icon:"passenger",bg:"#EAF8F1",checks:["Full / Shared / Connection rides","Parcel delivery","E-Rickshaw only"]}] : []),
      ...(hasPickup ? [{id:"GOODS" as const,title:"Goods Availability",subtitle:"Battery Pickup Truck • Goods only",icon:"goods",bg:"#F1ECFF",checks:["Goods only","Duration booking","No passenger / parcel"]}] : []),
      ...(hasRickshaw && hasPickup ? [{id:"BOTH" as const,title:"Both Services",subtitle:"Receive Passenger/Parcel + Goods requests",icon:"both",bg:"#FFF5E4",checks:["Use both eligible vehicles","Flexible work options","More requests"]}] : [])
    ];
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={{padding:16,paddingBottom:120}}>
      <UI.Header back/><Text style={styles.pageTitle}>Service Mode</Text><Text style={styles.pageSub}>Choose the type of rides you want to receive</Text>
      <View style={styles.infoGreen}><DriverIcon name="settings" size={18}/><Text style={styles.infoText}>You can change your service mode anytime.</Text></View>
      {modes.length===0 ? <View style={styles.infoGreen}><DriverIcon name="vehicle" size={20}/><Text style={styles.infoText}>No ACTIVE/VERIFIED eligible vehicle is linked to this driver. Complete vehicle approval in KYC before selecting a service mode.</Text></View> : null}
      {modes.map(m=><Pressable key={m.id} style={[styles.modeCard,{backgroundColor:m.bg},serviceMode===m.id&&styles.modeSelected]} onPress={()=>void changeServiceMode(m.id)}><View style={styles.modeVehicleBox}><DriverIcon name={m.icon as any} size={30} /></View><View style={{flex:1}}><Text style={styles.modeTitle}>{m.title}</Text><Text style={styles.modeSub}>{m.subtitle}</Text>{m.checks.map(x=><View key={x} style={styles.checkLineRow}><DriverIcon name="check" size={15}/><Text style={styles.checkLine}>{x}</Text></View>)}</View><View style={styles.radio}>{serviceMode===m.id?<DriverIcon name="check" size={20}/>:<View style={styles.radioEmpty}/>}</View></Pressable>)}
<View style={styles.infoGreen}><Text style={styles.infoText}>Parcel service follows Passenger E-Rickshaw eligibility. Goods is available only to the Battery Pickup Truck.</Text></View>      <Primary title="Save & Continue" onPress={goHome}/>
    </ScrollView></SafeAreaView>;
  }

  function RequestScreen() {
    const req=activeRequest;
    if(!req) return HomeScreen();
    const requestExpiresAt = req.expiresAt ? new Date(req.expiresAt).getTime() : requestNow + 300000;
    const remainingSeconds = Math.max(0, Math.ceil((requestExpiresAt - requestNow) / 1000));
    const reqFare=money(getRequestLeg(req)?.estimatedFare ?? req.booking?.estimatedFare ?? 70);
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={{padding:16,paddingBottom:120}}>
      <View style={styles.requestHead}><UI.Header help={false}/><Text style={styles.requestTitle}>New Ride Request</Text><Text style={styles.requestSub}>A new ride request is nearby!</Text><View style={styles.timer}><Text style={styles.timerNum}>{remainingSeconds}</Text><Text style={styles.timerText}>seconds</Text></View></View>
      <MapCard/>
      <View style={styles.requestCard}>
        <View style={styles.threeMetrics}><Metric title="Distance" value={`${distance.toFixed(1)} km`}/><Metric title="Estimated Fare" value={`₹${reqFare}`} accent/><Metric title="Pickup Time" value={`${eta} min`}/></View>
        <View style={styles.customerCard}><View style={styles.customerAvatar}><Text>AK</Text></View><View style={{flex:1}}><Text style={styles.customerName}>{customerName}</Text><Text style={styles.customerRating}>★ 4.8 (120 rides)</Text></View><Pressable style={styles.actionCircle} onPress={()=>{ if (booking?.customer?.mobile) Linking.openURL(`tel:${booking.customer.mobile}`); else setMessage("Customer phone number is not available."); }}><DriverIcon name="phone" size={18}/></Pressable><Pressable style={styles.actionCircleBlue} onPress={()=>setScreen("messages")}><DriverIcon name="chat" size={18}/></Pressable></View>
        <View style={styles.locationGrid}><View><View style={{flexDirection:"row",alignItems:"center",gap:6}}><DriverIcon name="pickup" size={15}/><Text style={styles.locationGreen}>Pickup Location</Text></View><Text style={styles.locationText}>{pickup}</Text><Text style={styles.locationSub}>Near ICICI Bank</Text></View><View><View style={{flexDirection:"row",alignItems:"center",gap:6}}><DriverIcon name="drop" size={15}/><Text style={styles.locationRed}>Drop Location</Text></View><Text style={styles.locationText}>{drop}</Text><Text style={styles.locationSub}>Platform No. 1</Text></View></View>
        <View style={styles.note}><Text style={styles.requestNoteTitle}>{req.booking?.bookingType==="GOODS"?"Goods":"Note from Passenger"}</Text><Text style={styles.noteText}>{req.booking?.bookingType==="GOODS"?`${req.booking?.goodsType||"Parcel"} • ${req.booking?.goodsWeightKg??50} kg • ${vehicleLabel}`:"I will be waiting near the main gate."}</Text></View>
        <View style={styles.acceptRow}><Pressable style={styles.decline} onPress={()=>{void rejectRide(req.id);setIncomingRequest(null);goHome()}}><Text style={styles.declineText}>Decline</Text></Pressable><Pressable style={[styles.accept, remainingSeconds===0&&{opacity:0.55}]} disabled={remainingSeconds===0 || actionLoading===req.id} onPress={()=>void acceptRide(req)}><Text style={styles.acceptText}>{remainingSeconds===0?'Expired':'Accept Ride'}</Text></Pressable></View>
      </View>
    </ScrollView></SafeAreaView>;
  }

  function ActiveRide({kind}:{kind:"accepted"|"arrived"|"trip"}) {
    const title = kind==="accepted"?"Ride Accepted!":kind==="arrived"?"Passenger has arrived!":"Trip in Progress";
    const sub = kind==="accepted"?"Head to the pickup location":kind==="arrived"?"Verify OTP/QR and start the trip":"Drive safely to the drop location";
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={{padding:16,paddingBottom:35}}>
      <UI.Header back/>
      <StatusBanner title={title} sub={sub}/>
      <MapCard/>
      <View style={styles.rideCard}>
        <View style={styles.customerCard}><Image source={DRIVER_AVATAR} style={styles.customerPhoto}/><View style={{flex:1}}><Text style={styles.customerName}>{customerName}</Text><Text style={styles.customerRating}>★ 4.8 (120 rides)</Text><Text style={styles.customerSub}>1 Passenger</Text></View><Pressable style={styles.actionCircle} onPress={()=>{ if (booking?.customer?.mobile) Linking.openURL(`tel:${booking.customer.mobile}`); else setMessage("Customer phone number is not available."); }}><DriverIcon name="phone" size={18}/></Pressable><Pressable style={styles.actionCircleBlue} onPress={()=>setScreen("messages")}><DriverIcon name="chat" size={18}/></Pressable></View>
        <View style={styles.locationGrid}><View><View style={{flexDirection:"row",alignItems:"center",gap:6}}><DriverIcon name="pickup" size={15}/><Text style={styles.locationGreen}>Pickup Location</Text></View><Text style={styles.locationText}>{pickup}</Text><Text style={styles.locationSub}>Near ICICI Bank</Text></View><View><View style={{flexDirection:"row",alignItems:"center",gap:6}}><DriverIcon name="drop" size={15}/><Text style={styles.locationRed}>Drop Location</Text></View><Text style={styles.locationText}>{drop}</Text><Text style={styles.locationSub}>Platform No. 1</Text></View></View>
        <View style={styles.fareRow}><Metric title="Estimated Fare" value={`₹${fare}`} accent/><Metric title="Payment" value={paymentLabel(activeRide?.booking)}/></View>
        {kind==="arrived" ? <View style={styles.pinCard}><View style={{flexDirection:"row",alignItems:"center",gap:8}}><DriverIcon name="shield" size={18}/><Text style={styles.pinTitle}>Ride Verification</Text></View><Text style={styles.pinSub}>Choose OTP or QR before starting the ride.</Text><View style={{flexDirection:"row",gap:8,marginTop:10}}><Pressable style={[styles.actionCircleBlue,verificationMethod==="OTP"&&styles.modeSelected]} onPress={()=>void prepareVerification("OTP")}><Text>OTP</Text></Pressable><Pressable style={[styles.actionCircleBlue,verificationMethod==="QR"&&styles.modeSelected]} onPress={()=>void prepareVerification("QR")}><Text>QR</Text></Pressable></View>{verificationMethod==="OTP"?<TextInput value={tripPin} onChangeText={v=>setTripPin(v.replace(/\D/g,"").slice(0,4))} style={styles.pinInput} keyboardType="number-pad" maxLength={4} placeholder="OTP" placeholderTextColor="#9CA5B3"/>:qrPayload?<View style={{alignItems:"center",padding:12}}><QRCode value={qrPayload} size={190}/><Text style={styles.pinSub}>Expires {verificationExpiresAt ? new Date(verificationExpiresAt).toLocaleTimeString() : "soon"}</Text></View>:<Text style={styles.pinSub}>Tap QR to generate.</Text>}</View>:null}
        {kind==="trip" ? <View style={styles.tripDetails}><Text style={styles.sectionTitle}>Trip Details</Text><View style={styles.detailLine}><DriverIcon name="pickup" size={15}/><Text style={{flex:1}}>{pickup}</Text><Text style={styles.detailTime}>08:15 PM</Text></View><View style={styles.detailLine}><DriverIcon name="drop" size={15}/><Text style={{flex:1}}>{drop}</Text><Text style={styles.detailTime}>08:25 PM (ETA)</Text></View></View>:null}
        {kind==="accepted" ? (
          <Primary
            title="Start Navigation"
            onPress={async () => {
              const targetLat = Number(currentLeg?.pickupLat ?? activeRequest?.booking?.pickupLat);
              const targetLng = Number(currentLeg?.pickupLng ?? activeRequest?.booking?.pickupLng);
              if (Number.isFinite(targetLat) && Number.isFinite(targetLng)) {
                const url = `https://www.google.com/maps/dir/?api=1&destination=${targetLat},${targetLng}&travelmode=driving`;
                try { await Linking.openURL(url); } catch { setMessage("Unable to open navigation."); }
              } else {
                setMessage("Pickup coordinates are not available for navigation.");
              }
            }}
          />
        ) : kind==="arrived" ? (
          <>
            <Primary title="Start Trip" onPress={startRide} disabled={!canStart||loading}/>
            <Outline title="Passenger Not Matching?" onPress={()=>setScreen("safety")}/>
          </>
        ) : (
          <>
            <Primary
              title="Navigate to Drop"
              onPress={async () => {
                const targetLat = Number(currentLeg?.dropLat ?? activeBooking?.dropLat);
                const targetLng = Number(currentLeg?.dropLng ?? activeBooking?.dropLng);
                if (Number.isFinite(targetLat) && Number.isFinite(targetLng)) {
                  const url = `https://www.google.com/maps/dir/?api=1&destination=${targetLat},${targetLng}&travelmode=driving`;
                  try { await Linking.openURL(url); } catch { setMessage("Unable to open navigation."); }
                } else {
                  setMessage("Drop coordinates are not available for navigation.");
                }
              }}
            />
            <Pressable style={styles.endTrip} onPress={completeRide} disabled={!canComplete||loading}><Text style={styles.endTripText}>End Trip</Text></Pressable>
            <Outline title="Contact Support" onPress={()=>setScreen("messages")}/>
          </>
        )}
      </View>
    </ScrollView></SafeAreaView>;
  }

  function CompletedScreen() {
    const earning=lastCompletion?.driverEarning??70;
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={{padding:16,paddingBottom:120}}>
      <UI.Header back/><StatusBanner title="Trip Completed!" sub="Great job! You have successfully completed the ride."/>
      <View style={styles.earnedHero}><Text style={styles.earnedLabel}>Total Fare Earned</Text><Text style={styles.earnedValue}>₹{money(earning)}</Text><View style={styles.cashPillRow}><DriverIcon name="rupee" size={15}/><Text style={styles.cashPill}>{paymentLabel({ paymentPreference: lastCompletion?.paymentMethod })} Payment</Text></View></View>
      <View style={styles.rideCard}><View style={styles.customerCard}><Image source={DRIVER_AVATAR} style={styles.customerPhoto}/><View style={{flex:1}}><Text style={styles.customerName}>{customerName}</Text><Text style={styles.customerRating}>★ 4.8 (120 rides)</Text><Text style={styles.customerSub}>1 Passenger</Text></View><Text style={styles.sectionTitle}>Trip Rating</Text></View><View style={styles.locationStack}><Text>🟢 {pickup}</Text><Text>🔴 {drop}</Text><Text>🛣 {distance.toFixed(1)} km   ◷ 13 min</Text></View></View>
      <View style={styles.keepUp}><Text style={styles.keepUpTitle}>🏆 Keep it up!</Text><Text style={styles.keepUpSub}>You are making cities move better. 🛺💚</Text></View>
      <View style={styles.rateCard}><Text style={styles.sectionTitle}>How was your passenger?</Text><Text style={styles.stars}>☆ ☆ ☆ ☆ ☆</Text><Text style={styles.rateHint}>Tap to rate (Optional)</Text></View>
      <Primary title="Go Online for Next Ride" onPress={()=>{setLastCompletion(null);goHome()}}/><Outline title="Back to Home" onPress={goHome}/>
    </ScrollView></SafeAreaView>;
  }

  function HistoryScreen() {
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={{padding:16,paddingBottom:120}}><UI.TopProfile/><Text style={styles.pageTitle}>Ride History</Text><Text style={styles.pageSub}>Your completed and cancelled rides</Text><View style={styles.filterRow}>{['All Rides','Completed','Cancelled'].map((x,i)=><Pressable key={x} style={[styles.filterPill,i===0&&styles.filterActive]}><Text style={[styles.filterText,i===0&&styles.filterActiveText]}>{x}</Text></Pressable>)}</View>{earningRows.length===0?<View style={styles.emptyState}><DriverIcon name="rides" size={30}/><Text style={styles.sectionTitle}>No ride history yet</Text><Text style={styles.docSub}>Completed driver earnings will appear here.</Text></View>:earningRows.map((row:any)=>{const b=row.booking||{};const status=String(b.status||row.status||'').toUpperCase();return <View key={row.id} style={styles.historyCard}><View style={styles.historyTop}><Text style={styles.historyDate}>{new Date(row.createdAt||Date.now()).toLocaleString()}</Text><Text style={[styles.historyStatus,status.includes('CANCEL')?styles.statusCancelled:styles.statusCompleted]}>{status||'COMPLETED'}</Text></View><Text style={styles.historyRoute}>{String(b.pickupAddress||'Pickup')}</Text><Text style={styles.historyRoute}>{String(b.dropAddress||'Drop')}</Text><View style={styles.historyBottom}><Text style={styles.historyFare}>₹{money(Number(row.netEarning||0))}</Text><Text style={styles.historyChevron}>›</Text></View></View>})}</ScrollView><UI.BottomNav active="rides"/></SafeAreaView>;
  }

  function EarningsScreen() {
    const rows = earningRows.slice(0,10);
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={{padding:16,paddingBottom:120}}><UI.TopProfile/><Text style={styles.pageTitle}>Earnings</Text><Text style={styles.pageSub}>Track your income and payouts</Text><View style={styles.earningsHero}><Text style={styles.earningsLabel}>Total Net Earnings</Text><Text style={styles.earningsValue}>₹{money(earningTotals.net)}</Text><View style={styles.earnStats}><Text>₹{money(earningRows.length?earningTotals.net/earningRows.length:0)}{"\n"}Avg. per Ride</Text><Text>{earningRows.length}{"\n"}Earning Records</Text><Text>₹{money(earningTotals.commission)}{"\n"}Commission</Text></View></View><View style={styles.fourCards}><Metric title="Gross Earnings" value={`₹${money(earningTotals.gross)}`}/><Metric title="Commission" value={`₹${money(earningTotals.commission)}`}/><Metric title="Net Earnings" value={`₹${money(earningTotals.net)}`}/><Metric title="Total Rides" value={`${earningRows.length}`}/></View><Text style={styles.sectionTitle}>Recent Earnings</Text>{rows.length===0?<View style={styles.emptyState}><DriverIcon name="earnings" size={30}/><Text style={styles.sectionTitle}>No earnings yet</Text><Text style={styles.docSub}>Completed trips will populate your earnings here.</Text></View>:rows.map((r:any)=><View key={r.id} style={styles.breakRow}><Text>{new Date(r.createdAt||Date.now()).toLocaleDateString()}</Text><Text>{r.booking?.serviceSubtype||'Ride'}</Text><Text style={styles.breakFare}>₹{money(Number(r.netEarning||0))}</Text></View>)}<Primary title="View Payout History" onPress={()=>setScreen("payout")}/></ScrollView><UI.BottomNav active="earnings"/></SafeAreaView>;
  }

  function ProfileScreen() {
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={{padding:16,paddingBottom:120}}><UI.Header back/><Text style={styles.pageTitle}>Driver Profile</Text><Text style={styles.pageSub}>Manage your profile, documents and settings</Text><View style={styles.profileCard}><Pressable onPress={() => setMessage("Profile photo management is available from KYC / account settings.")}><Image source={DRIVER_AVATAR} style={styles.profilePhoto}/></Pressable><View style={{flex:1}}><Text style={styles.profileName}>{driverProfile?.fullName || driverProfile?.name || driverProfile?.user?.fullName || driverProfile?.user?.name || "Driver"}</Text><Text style={styles.profileMeta}>{driverProfile?.user?.mobile || driverProfile?.mobile || driverProfile?.mobileNumber || "Mobile not available"}</Text><Text style={styles.profileRating}>★ {Number(driverProfile?.rating ?? 0).toFixed(1)} ({Number(driverProfile?.totalRides ?? 0)} rides)</Text><Text style={styles.profileMeta}>Member since {driverProfile?.createdAt ? new Date(driverProfile.createdAt).toLocaleDateString(undefined,{month:"short",year:"numeric"}) : "RideX"}</Text></View><View style={styles.profileOnline}><Text style={styles.profileOnlineText}>{online?"✓ Online":"○ Offline"}</Text></View></View><View style={styles.profileStats}>
  <Metric title={`${Number(driverProfile?.totalRides ?? driverProfile?.ridesCount ?? earningRows.length ?? 0)}`} value="Total Rides"/>
  <Metric title={`${Number(driverProfile?.rating ?? driverProfile?.averageRating ?? 0).toFixed(1)}`} value="Rating"/>
  <Metric title={driverProfile?.createdAt ? formatTenure(driverProfile.createdAt) : "—"} value="With RideX"/>
</View>{[["▣","KYC Documents","Aadhaar, PAN, Driving License, etc.",()=>setScreen("kyc")],["🚕","Vehicle Details","E-Rickshaw / Vehicle info",()=>setScreen("kyc")],["⚙","Service Mode","Passenger / Parcel / Goods / Both",()=>setScreen("serviceMode")],["▦","Bank & Payout Details","Manage your bank account",()=>setScreen("payout")],["⚙","App Settings","Notifications, Language, etc.",()=>setScreen("notifications")],["◉","Help & Support","Get help anytime",()=>setScreen("messages")]].map(x=><Pressable key={x[1] as string} style={styles.profileRow} onPress={x[3] as any}><Text style={styles.profileRowIcon}>{x[0] as string}</Text><View style={{flex:1}}><Text style={styles.profileRowTitle}>{x[1] as string}</Text><Text style={styles.profileRowSub}>{x[2] as string}</Text></View><Text style={styles.historyChevron}>›</Text></Pressable>)}<Pressable style={styles.logout} onPress={async()=>{try{await ridexFetch(`${API}/auth/logout`,{method:"POST"});}catch{} await AsyncStorage.multiRemove([DRIVER_AUTH_TOKEN_KEY,DRIVER_SESSION_KEY]); setDriverId(""); setScreen("login");}}><Text style={styles.logoutText}>⇱ Logout</Text><Text style={styles.logoutText}>›</Text></Pressable></ScrollView><UI.BottomNav active="profile"/></SafeAreaView>;
  }

  function KycScreen() {
    const vehicle = driverVehicles[0];
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={{padding:16,paddingBottom:120}}>
      <UI.Header back/><Text style={styles.pageTitle}>KYC & Vehicle Details</Text><Text style={styles.pageSub}>Manage verified documents and vehicle information</Text>
      <View style={styles.sectionBar}><View style={styles.sectionTitleWrap}><DriverIcon name="kyc" size={18}/><Text style={styles.sectionTitle}>KYC Documents</Text></View><Text style={styles.verified}>{vehicle ? "Driver account linked" : "Pending"}</Text></View>
      {["AADHAAR","PAN","DRIVING_LICENSE","SELFIE"].map(type=>{
        const doc:any=(driverDocuments||[]).find((d:any)=>String(d.documentType||"").toUpperCase()===type);
        const label=type==="AADHAAR"?"Aadhaar Card":type==="PAN"?"PAN Card":type==="DRIVING_LICENSE"?"Driving License":"Selfie / Live Photo";
        const approved=String(doc?.status||"").toUpperCase()==="APPROVED";
        return <View key={type} style={styles.docRow}>
          <View style={styles.docIcon}><DriverIcon name="document" size={22}/></View>
          <View style={{flex:1}}><Text style={styles.docTitle}>{label}</Text><Text style={styles.docSub}>{doc?.status || "Not submitted"}</Text></View>
          {doc ? (approved ? <View style={styles.docStatusIcon}><DriverIcon name="check" size={20}/></View> : <Primary title={actionLoading===`kyc-upload-${type}`?"Uploading…":doc?.fileUrl?"Replace":"Upload"} onPress={()=>void uploadKycDocument(doc.id,type)}/>) : <Text style={styles.docSub}>No document slot</Text>}
        </View>;
      })}
      <View style={styles.sectionBar}><View style={styles.sectionTitleWrap}><DriverIcon name="vehicle" size={18}/><Text style={styles.sectionTitle}>Vehicle Details</Text></View><Text style={styles.verified}>{vehicle?.status || "Pending"}</Text></View>
      {vehicle ? <View style={styles.vehicleEditCard}><View style={styles.docRow}><View style={styles.docIcon}><DriverIcon name="vehicle" size={22}/></View><View style={{flex:1}}><Text style={styles.docTitle}>{vehicle.vehicleType}</Text><Text style={styles.docSub}>{vehicle.vehicleNumber} • Capacity {vehicle.capacity}</Text></View></View><Primary title="Edit Vehicle Details" onPress={()=>{setEditingVehicle(vehicle);setVehicleNumberInput(String(vehicle.vehicleNumber||""));setVehicleCapacityInput(String(vehicle.capacity||""));}}/></View> : <Text style={styles.docSub}>No vehicle is linked yet.</Text>}
      {editingVehicle ? <View style={styles.editPanel}><Text style={styles.sectionTitle}>Edit Vehicle</Text><TextInput value={vehicleNumberInput} onChangeText={setVehicleNumberInput} placeholder="Vehicle number" style={styles.formInput}/><TextInput value={vehicleCapacityInput} onChangeText={setVehicleCapacityInput} placeholder="Capacity" keyboardType="numeric" style={styles.formInput}/><View style={styles.buttonRow}><Outline title="Cancel" onPress={()=>setEditingVehicle(null)}/><Primary title={actionLoading==="vehicle-save"?"Saving…":"Save"} onPress={()=>void saveVehicle(editingVehicle.id)}/></View></View>:null}
    </ScrollView></SafeAreaView>;
  }

  function PayoutScreen() {
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={{padding:16,paddingBottom:120}}><UI.Header back/><Text style={styles.pageTitle}>Bank & Payout Details</Text><Text style={styles.pageSub}>Manage the bank account used for driver settlements</Text><View style={styles.infoGreen}><DriverIcon name="bank" size={20}/><Text style={styles.infoText}>{payoutProfile?.status || "Not submitted"}</Text></View><Text style={styles.fieldLabel}>Account Holder Name</Text><TextInput value={payoutHolder} onChangeText={setPayoutHolder} placeholder="Name as per bank account" style={styles.formInput}/><Text style={styles.fieldLabel}>Account Number</Text><TextInput value={payoutAccount} onChangeText={setPayoutAccount} placeholder="Bank account number" keyboardType="numeric" secureTextEntry style={styles.formInput}/><Text style={styles.fieldLabel}>IFSC</Text><TextInput value={payoutIfsc} onChangeText={setPayoutIfsc} placeholder="IFSC code" autoCapitalize="characters" style={styles.formInput}/><Text style={styles.fieldLabel}>Bank Name</Text><TextInput value={payoutBank} onChangeText={setPayoutBank} placeholder="Bank name" style={styles.formInput}/><Text style={styles.fieldLabel}>UPI ID (Optional)</Text><TextInput value={payoutUpi} onChangeText={setPayoutUpi} placeholder="name@bank" autoCapitalize="none" style={styles.formInput}/><Primary title={actionLoading==="payout-save"?"Saving…":"Save Bank & Payout Details"} onPress={()=>void savePayoutProfile()}/><Text style={styles.docSub}>Saved changes remain pending until Admin/provider verification is completed.</Text></ScrollView></SafeAreaView>;
  }

  function SafetyScreen() {
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={{padding:16,paddingBottom:120}}><UI.Header back/><Text style={styles.pageTitle}>Safety & Support</Text><Text style={styles.pageSub}>Your safety is our priority</Text><View style={styles.safetyHero}><View style={{flex:1}}><Text style={styles.safetyTitle}>Drive Safe, Stay Secure</Text><Text style={styles.safetySub}>We are always here for you</Text></View><Text style={styles.safetyPerson}>👨🏻</Text></View><View style={styles.safetyTiles}><Pressable style={styles.safetyTileRed} onPress={()=>void triggerDriverSos()}><Text style={styles.safetyCircle}>SOS</Text><Text style={styles.safetyTileTitle}>Emergency SOS</Text><Text style={styles.tileSub}>Get help instantly</Text></Pressable><Pressable style={styles.safetyTileGreen} onPress={()=>setScreen("messages")}><Text style={styles.safetyCircle}>☎</Text><Text style={styles.safetyTileTitle}>Call Support</Text><Text style={styles.tileSub}>Talk to our team</Text></Pressable><Pressable style={styles.safetyTileBlue} onPress={()=>setScreen("messages")}><Text style={styles.safetyCircle}>▤</Text><Text style={styles.safetyTileTitle}>Live Chat</Text><Text style={styles.tileSub}>Chat with support</Text></Pressable></View>{["Share Live Location","Emergency Contacts","Safety Tips","Report an Issue","Help Center","App Guidelines"].map(x=><Pressable key={x} style={styles.safetyRow} onPress={()=>setScreen("messages")}><View style={styles.safetyRowIcon}><Text>✓</Text></View><View style={{flex:1}}><Text style={styles.profileRowTitle}>{x}</Text><Text style={styles.profileRowSub}>Tap to manage or view details</Text></View><Text>›</Text></Pressable>)}<View style={styles.safetyFooter}><Text style={styles.safetyFooterTitle}>✓ You are not alone</Text><Text style={styles.safetyFooterSub}>Our team is available 24/7 to support you</Text></View></ScrollView><UI.BottomNav active="home"/></SafeAreaView>;
  }

  function SosScreen() {
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.authScroll}><UI.Header back/><Text style={styles.pageTitle}>Emergency SOS</Text><Text style={styles.pageSub}>We are getting you help</Text><Pressable style={styles.sosBig} onPress={()=>void triggerDriverSos()}><Text style={styles.sosPhone}>☎</Text><Text style={styles.sosBigText}>SOS</Text></Pressable><Text style={styles.sosAlert}>Emergency Alert Sent</Text><Text style={styles.sosHelp}>Help is on the way</Text><View style={styles.sosPanel}><Text>🚨 Your live location has been shared with</Text><Text>✓ RideX Support Team</Text><Text>✓ Your Emergency Contacts</Text><Text>✓ Local Police (112)</Text></View><View style={styles.locationBox}><Text style={styles.sectionTitle}>Your Current Location</Text><Text>{pickup}</Text><Outline title="View on Map" onPress={goHome}/></View><Pressable style={styles.cancelSos} onPress={()=>setScreen("safety")}><Text style={styles.cancelSosText}>■ Cancel SOS</Text></Pressable><View style={styles.infoBlue}><Text style={styles.infoBlueTitle}>ⓘ Important</Text><Text>Use SOS only in genuine emergency situations.</Text></View></ScrollView></SafeAreaView>;
  }

  function NotificationsScreen() {
    const filterMap: Record<string, string[]> = {
      ALL: [],
      RIDES: ["RIDE", "BOOKING", "DRIVER"],
      EARNINGS: ["PAYOUT", "PAYMENT", "EARNING"],
      ACCOUNT: ["ACCOUNT", "KYC", "VERIFICATION"],
      OFFERS: ["OFFER", "PROMO", "INCENTIVE"],
    };
    const allowed = filterMap[notificationFilter] || [];
    const visible = driverNotifications.filter((n:any) => {
      if (!allowed.length) return true;
      const haystack = `${n.type || ""} ${n.title || ""} ${n.body || ""}`.toUpperCase();
      return allowed.some(token => haystack.includes(token));
    });
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={{padding:16,paddingBottom:120}}><UI.TopProfile/><View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between"}}><View style={{flex:1}}><Text style={styles.pageTitle}>Notifications</Text><Text style={styles.pageSub}>Stay updated with your rides, earnings and more</Text></View><Pressable onPress={()=>void markAllDriverNotificationsRead()} disabled={!unreadNotificationCount}><Text style={[styles.markAllText,!unreadNotificationCount&&styles.disabledText]}>Mark all read</Text></Pressable></View><View style={styles.filterRow}>{[["ALL","All"],["RIDES","Rides"],["EARNINGS","Earnings"],["ACCOUNT","Account"],["OFFERS","Offers"]].map(([key,label])=><Pressable key={key} onPress={()=>setNotificationFilter(key)} style={[styles.filterPill,notificationFilter===key&&styles.filterActive]}><Text style={[styles.filterText,notificationFilter===key&&styles.filterActiveText]}>{label}</Text></Pressable>)}</View>{visible.length===0?<View style={styles.emptyState}><DriverIcon name="notification" size={30}/><Text style={styles.sectionTitle}>No notifications</Text><Text style={styles.docSub}>New ride, earnings, account and support updates will appear here.</Text></View>:visible.map((n:any)=>{
      const unread=!n.readAt;
      const icon = String(n.type||"").toUpperCase().includes("PAY") || String(n.title||"").toUpperCase().includes("PAYOUT") ? "rupee" : String(n.type||"").toUpperCase().includes("RIDE") ? "rides" : String(n.type||"").toUpperCase().includes("SUPPORT") ? "support" : "notification";
      return <Pressable key={n.id} onPress={()=>unread&&void markDriverNotificationRead(n.id)} style={[styles.notificationRow,unread&&styles.notificationUnread]}><View style={styles.noteIcon}><DriverIcon name={icon} size={22}/></View><View style={{flex:1}}><Text style={styles.noteTitle}>{n.title || n.type || "RideX Notification"}</Text><Text style={styles.noteSub}>{n.body || ""}</Text></View><Text style={styles.noteTime}>{n.createdAt ? new Date(n.createdAt).toLocaleString() : ""}</Text><Text style={styles.historyChevron}>{unread?"●":"›"}</Text></Pressable>;
    })}</ScrollView><UI.BottomNav active="messages"/></SafeAreaView>;
  }

  function MessagesScreen() {
    const msgs=[["Priya Sharma","I am near the main gate","08:14 PM","2"],["Rahul Verma","Thanks for the ride! 👍","Yesterday","1"],["RideX Support","Your query has been resolved....","Yesterday",""],["RideX Updates","New Incentive Scheme is Live!","2 Sep",""],["Neha Singh","Where are you?","1 Sep",""],["Amit Kumar","Please come to the back side","31 Aug",""]];
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={{padding:16,paddingBottom:120}}><UI.TopProfile/><Text style={styles.pageTitle}>Messages & Support</Text><Text style={styles.pageSub}>Chat with riders and get help from our support team</Text><View style={styles.filterRow}>{["Chats","Support","FAQ"].map((x,i)=><Pressable key={x} style={[styles.filterPill,i===0&&styles.filterActive]}><Text style={[styles.filterText,i===0&&styles.filterActiveText]}>{x}</Text></Pressable>)}</View>{msgs.map(m=><Pressable key={m[0]} style={styles.messageRow}><View style={styles.messageAvatar}><Text>{m[0]==="Priya Sharma"?"PS":m[0]==="Rahul Verma"?"RV":"●"}</Text></View><View style={{flex:1}}><Text style={styles.messageName}>{m[0]}</Text><Text style={styles.messagePreview}>{m[1]}</Text></View><View><Text style={styles.messageTime}>{m[2]}</Text>{m[3]?<Text style={styles.unread}>{m[3]}</Text>:null}</View><Text>›</Text></Pressable>)}<View style={styles.supportBox}><Text style={styles.supportTitle}>Need Help?</Text><Text style={styles.supportSub}>Our support team is available 24/7 to help you with any issue.</Text><Primary title="Chat with Support" onPress={()=>void createDriverSupportCase("Live Chat", "Driver requested live support chat.", "NORMAL")}/></View><View style={styles.supportActions}><Outline title="Call Support" onPress={()=>void callDriverSupport()}/><Outline title="Raise a Ticket" onPress={()=>void createDriverSupportCase("Driver Support Ticket", "Driver raised a support ticket from the Messages & Support screen.", "HIGH")}/></View></ScrollView><UI.BottomNav active="messages"/></SafeAreaView>;
  }

  return (
    <>
      {incomingRequest && screen !== "request" ? <Modal transparent visible animationType="slide" onRequestClose={()=>setIncomingRequest(null)}><View style={styles.modalOverlay}><View style={styles.quickModal}><Text style={styles.quickTitle}>New Ride Request</Text><Text style={styles.quickSub}>A new ride request is nearby!</Text><View style={styles.acceptRow}><Pressable style={styles.decline} onPress={()=>setIncomingRequest(null)}><Text style={styles.declineText}>Later</Text></Pressable><Pressable style={styles.accept} onPress={()=>setScreen("request")}><Text style={styles.acceptText}>View Request</Text></Pressable></View></View></View></Modal> : null}
      {screen==="welcome"&&WelcomeScreen()}
      {screen==="login"&&LoginScreen()}
      {screen==="otp"&&OtpScreen()}
      {screen==="home"&&HomeScreen()}
      {screen==="serviceMode"&&ServiceModeScreen()}
      {screen==="request"&&RequestScreen()}
      {screen==="accepted"&&ActiveRide({kind:"accepted"})}
      {screen==="arrived"&&ActiveRide({kind:"arrived"})}
      {screen==="trip"&&ActiveRide({kind:"trip"})}
      {screen==="completed"&&CompletedScreen()}
      {screen==="history"&&HistoryScreen()}
      {screen==="earnings"&&EarningsScreen()}
      {screen==="profile"&&ProfileScreen()}
      {screen==="kyc"&&KycScreen()}
      {screen==="payout"&&PayoutScreen()}
      {screen==="safety"&&SafetyScreen()}
      {screen==="sos"&&SosScreen()}
      {screen==="notifications"&&NotificationsScreen()}
      {screen==="messages"&&MessagesScreen()}
    </>
  );
}

const COLORS = {
  green:"#069B4A", greenDark:"#087A3E", softGreen:"#EAF8F0",
  red:"#FF1F2D", softRed:"#FFE7E8", black:"#0E1420", muted:"#65738B",
  border:"#E0E6EE", blue:"#2E80ED"
};

const styles = StyleSheet.create({
  page:{flex:1,backgroundColor:"#fff"},
  authScroll:{padding:16,paddingBottom:30},
  header:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingVertical:6},
  headerCircle:{width:44,height:44,borderRadius:22,borderWidth:1,borderColor:COLORS.border,alignItems:"center",justifyContent:"center"},
  headerCircleText:{fontSize:30,color:COLORS.black},
  brandBlock:{alignItems:"center",flex:1},
  logoImage:{width:140,height:40},
  logo:{fontSize:42,fontWeight:"900",letterSpacing:-3,color:"#05070A"},
  logoRed:{color:COLORS.red},
  logoTag:{fontSize:11,fontWeight:"800",marginTop:-4,color:COLORS.black},
  helpPill:{borderWidth:1,borderColor:COLORS.border,borderRadius:22,paddingHorizontal:13,paddingVertical:10,flexDirection:"row",alignItems:"center",backgroundColor:"#fff"},
  helpIcon:{fontSize:16,marginRight:6},helpText:{fontSize:14,fontWeight:"800"},
  welcomeTop:{marginBottom:4},
  driverBadge:{alignSelf:"flex-start",backgroundColor:COLORS.green,borderRadius:10,paddingHorizontal:18,paddingVertical:6,marginTop:8},
  driverBadgeCenter:{alignSelf:"center",backgroundColor:COLORS.green,borderRadius:10,paddingHorizontal:18,paddingVertical:6,marginTop:8},
  driverBadgeText:{color:"#fff",fontSize:18,fontWeight:"900"},
  welcomeTitle:{fontSize:38,fontWeight:"900",lineHeight:41,marginTop:22},
  welcomeGreen:{color:COLORS.greenDark},
  welcomeSub:{fontSize:18,color:COLORS.muted,marginTop:8},
  driverHeroImage:{width:"100%",height:420,marginTop:4},
  welcomeBenefits:{marginTop:-24},
  benefitRow:{flexDirection:"row",alignItems:"center",marginVertical:7},
  benefitIcon:{width:54,height:54,borderRadius:27,backgroundColor:COLORS.green,alignItems:"center",justifyContent:"center"},
  benefitIconText:{color:"#fff",fontSize:25,fontWeight:"900"},benefitText:{fontSize:18,fontWeight:"700",marginLeft:14},
  dots:{flexDirection:"row",justifyContent:"center",gap:9,marginVertical:8,color:"#C7CDD5"},dotActive:{color:COLORS.green},
  primary:{backgroundColor:COLORS.green,borderRadius:18,minHeight:58,paddingHorizontal:20,flexDirection:"row",alignItems:"center",justifyContent:"center",marginVertical:8},
  primaryText:{color:"#fff",fontSize:20,fontWeight:"900"},primaryArrow:{color:"#fff",fontSize:36,marginLeft:12},disabled:{opacity:.45},
  outline:{borderWidth:1.8,borderColor:COLORS.green,borderRadius:18,minHeight:54,paddingHorizontal:18,flexDirection:"row",alignItems:"center",justifyContent:"center",marginVertical:8,backgroundColor:"#fff"},
  outlineText:{color:COLORS.greenDark,fontSize:17,fontWeight:"800"},outlineArrow:{color:COLORS.greenDark,fontSize:30,marginLeft:10},
  bottomScript:{fontSize:23,fontStyle:"italic",fontWeight:"600",textAlign:"center",marginVertical:18,color:"#102035"},
  authHeroImage:{width:"100%",height:245,borderRadius:18,marginTop:8},
  authTitle:{fontSize:32,fontWeight:"900",textAlign:"center",marginTop:14},
  authSub:{fontSize:17,color:COLORS.muted,textAlign:"center",marginTop:5},phoneDisplay:{fontSize:20,fontWeight:"900",textAlign:"center",color:COLORS.greenDark,marginTop:10},
  authCard:{borderWidth:1,borderColor:COLORS.border,borderRadius:22,padding:16,marginTop:14},
  phoneBox:{height:64,borderWidth:1.5,borderColor:"#CED6E1",borderRadius:16,flexDirection:"row",alignItems:"center",paddingHorizontal:14},
  country:{fontSize:18,fontWeight:"800"},vDivider:{width:1,height:34,backgroundColor:"#D3DAE4",marginHorizontal:12},phoneInput:{flex:1,fontSize:17,color:COLORS.black},
  orLine:{textAlign:"center",color:COLORS.muted,marginVertical:10,fontSize:15},
  authValueCard:{backgroundColor:COLORS.softGreen,borderRadius:18,padding:14,flexDirection:"row",alignItems:"center",marginTop:8},authVehicleImage:{width:150,height:160,resizeMode:"contain"},
  authMessage:{textAlign:"center",color:COLORS.red,marginTop:8},otpRow:{flexDirection:"row",justifyContent:"space-between",marginVertical:20},otpCell:{width:45,height:56,borderWidth:1.5,borderColor:"#D5DDE7",borderRadius:12,alignItems:"center",justifyContent:"center",backgroundColor:"#fff"},otpCellFilled:{borderColor:COLORS.green,backgroundColor:"#F0FFF6"},otpDigit:{fontSize:24,fontWeight:"800",color:COLORS.black},otpAutofillInput:{position:"absolute",width:1,height:1,opacity:0.01},resend:{textAlign:"center",color:COLORS.muted,marginBottom:6},greenText:{color:COLORS.green,fontWeight:"900"},
  topProfile:{flexDirection:"row",alignItems:"center",paddingVertical:5},driverAvatar:{width:58,height:58,borderRadius:29,borderWidth:2,borderColor:"#fff"},onlinePill:{alignSelf:"flex-start",flexDirection:"row",alignItems:"center",backgroundColor:COLORS.green,borderRadius:15,paddingHorizontal:10,paddingVertical:4},onlineDot:{fontSize:10,color:"#fff"},onlinePillText:{fontSize:12,color:"#fff",fontWeight:"800",marginLeft:4},bellBtn:{width:46,height:46,borderRadius:23,borderWidth:1,borderColor:COLORS.border,alignItems:"center",justifyContent:"center",position:"relative"},bell:{fontSize:24},notificationDot:{width:8,height:8,borderRadius:4,backgroundColor:COLORS.red,position:"absolute",top:7,right:8},
  homeBrandLine:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginVertical:10},hello:{fontSize:27,fontWeight:"900"},helloSub:{fontSize:16,color:COLORS.muted,marginTop:3},onlineToggle:{width:128,height:48,borderRadius:24,backgroundColor:"#DDE4EC",flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingHorizontal:8},onlineToggleOn:{backgroundColor:COLORS.green},onlineToggleDisabled:{opacity:0.65},onlineToggleText:{color:"#fff",fontWeight:"900"},toggleKnob:{width:34,height:34,borderRadius:17,backgroundColor:"#fff"},
  summaryRow:{flexDirection:"row",gap:8},todayEarn:{flex:1.4,minHeight:92,backgroundColor:COLORS.softGreen,borderRadius:16,padding:14,position:"relative"},todayLabel:{fontSize:12,color:"#35546F"},todayValue:{fontSize:28,fontWeight:"900",marginTop:7},moreArrow:{position:"absolute",right:12,top:34,fontSize:30},metric:{flex:1,minHeight:92,borderRadius:16,backgroundColor:"#F2F4F8",padding:10,alignItems:"center",justifyContent:"center"},metricAccent:{backgroundColor:COLORS.softGreen},metricValue:{fontSize:18,fontWeight:"900"},metricTitle:{fontSize:11,color:COLORS.muted,textAlign:"center",marginTop:4},
  featureStrip:{flexDirection:"row",justifyContent:"space-between",marginVertical:16},featureItem:{width:"24%",alignItems:"center"},featureCircle:{width:48,height:48,borderRadius:24,alignItems:"center",justifyContent:"center"},featureLabel:{fontSize:11,fontWeight:"800",textAlign:"center",marginTop:5},
  promo:{flexDirection:"row",alignItems:"center",backgroundColor:"#F3F7FD",borderRadius:18,padding:16,marginBottom:14},promoTitle:{fontSize:26,fontWeight:"900"},promoSub:{fontSize:13,color:COLORS.muted,lineHeight:18,marginTop:5},promoVehicle:{width:150,height:125,resizeMode:"contain"},
  activity:{borderWidth:1,borderColor:COLORS.border,borderRadius:18,padding:13},activityHeader:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},sectionTitle:{fontSize:19,fontWeight:"900"},link:{color:"#123AA6",fontWeight:"800"},activityRow:{flexDirection:"row",alignItems:"center",gap:8,paddingVertical:10,borderTopWidth:1,borderTopColor:"#EEF1F5"},activityTime:{width:57,fontSize:11,color:COLORS.muted},activityDot:{width:10,height:10,borderRadius:5},activityTitle:{fontSize:13,fontWeight:"800"},activitySub:{fontSize:11,color:COLORS.muted,marginTop:2},activityFare:{fontWeight:"900"},
  serviceShortcut:{borderWidth:1,borderColor:COLORS.border,borderRadius:15,padding:13,marginTop:13},shortLabel:{fontSize:12,color:COLORS.muted},shortValue:{fontSize:19,fontWeight:"900",marginVertical:3},
  pageTitle:{fontSize:31,fontWeight:"900",marginTop:14},pageSub:{fontSize:16,color:"#4E6484",marginTop:4,marginBottom:12},infoGreen:{backgroundColor:COLORS.softGreen,borderRadius:14,padding:14,flexDirection:"row",alignItems:"center",marginBottom:8},infoIcon:{fontSize:21,color:COLORS.green},infoText:{fontSize:14,color:COLORS.greenDark,fontWeight:"700",marginLeft:8},
  modeCard:{borderWidth:1,borderColor:"#DDE5EE",borderRadius:18,padding:13,marginVertical:7,flexDirection:"row",alignItems:"center",minHeight:150},modeSelected:{borderWidth:2,borderColor:COLORS.green},modeVehicleBox:{width:96,height:94,borderRadius:14,backgroundColor:"rgba(255,255,255,.75)",alignItems:"center",justifyContent:"center",marginRight:10},modeEmoji:{fontSize:60},modeTitle:{fontSize:19,fontWeight:"900"},modeSub:{fontSize:13,color:"#405C7F",marginVertical:5},checkLine:{color:"#0B8B4D",fontSize:12,marginTop:3,fontWeight:"700"},radio:{width:34,height:34,alignItems:"center",justifyContent:"center"},
  requestHead:{backgroundColor:COLORS.green,marginHorizontal:-16,paddingHorizontal:16,paddingBottom:16,position:"relative"},requestTitle:{color:"#fff",fontSize:28,fontWeight:"900",marginTop:12},requestSub:{color:"#E1F8EA",fontSize:15,marginTop:4},timer:{position:"absolute",right:18,top:118,width:76,height:76,borderRadius:38,borderWidth:4,borderColor:"#C6F0D3",backgroundColor:"#fff",alignItems:"center",justifyContent:"center"},timerNum:{fontSize:22,fontWeight:"900"},timerText:{fontSize:11,color:COLORS.muted},
  map:{height:300,borderRadius:20,overflow:"hidden",backgroundColor:"#E7EEE9",marginVertical:12,borderWidth:1,borderColor:"#D6DFE8",position:"relative"},liveDriverMarker:{width:34,height:34,borderRadius:17,backgroundColor:"#1677FF",alignItems:"center",justifyContent:"center",borderWidth:3,borderColor:"#fff"},dropMarkerPin:{backgroundColor:COLORS.red},mapOverlayTop:{position:"absolute",left:10,right:10,top:10,flexDirection:"row",justifyContent:"space-between",alignItems:"center"},liveGpsPill:{backgroundColor:"rgba(255,255,255,0.94)",borderRadius:16,paddingHorizontal:10,paddingVertical:7,flexDirection:"row",alignItems:"center",gap:6,elevation:2},liveGpsDot:{width:8,height:8,borderRadius:4,backgroundColor:"#9AA4B5"},liveGpsDotOn:{backgroundColor:"#0AA35A"},liveGpsText:{fontSize:10,fontWeight:"900",color:"#445"},mapLayerButton:{width:38,height:38,borderRadius:19,backgroundColor:"#fff",alignItems:"center",justifyContent:"center",elevation:2},mapActionHint:{fontSize:8,fontWeight:"800",marginTop:2},water:{position:"absolute",right:-40,top:-20,width:245,height:120,borderRadius:80,backgroundColor:"#CFEFFF"},road:{position:"absolute",height:6,backgroundColor:"#fff",borderRadius:3,opacity:.9},roadA:{width:360,left:-30,top:144,transform:[{rotate:"12deg"}]},roadB:{width:320,left:10,top:93,transform:[{rotate:"-22deg"}]},roadC:{width:280,left:90,top:215,transform:[{rotate:"-7deg"}]},ganga:{position:"absolute",right:18,top:18,color:"#006BD1",fontWeight:"900"},mapPatna:{position:"absolute",left:145,top:128,fontSize:22,fontWeight:"900"},route:{position:"absolute",left:62,top:96,width:250,height:145},route1:{position:"absolute",width:135,height:6,backgroundColor:"#2F80ED",borderRadius:4,top:18,transform:[{rotate:"20deg"}]},route2:{position:"absolute",width:105,height:6,backgroundColor:"#2F80ED",borderRadius:4,left:104,top:52,transform:[{rotate:"-15deg"}]},route3:{position:"absolute",width:95,height:6,backgroundColor:"#2F80ED",borderRadius:4,left:165,top:96,transform:[{rotate:"18deg"}]},mapMarker:{position:"absolute",width:32,height:32,borderRadius:16,alignItems:"center",justifyContent:"center"},pickMarker:{left:52,top:78,backgroundColor:COLORS.green},dropMarker:{right:57,bottom:48,backgroundColor:COLORS.red},markerWhite:{color:"#fff"},pickLabel:{position:"absolute",left:82,top:55,backgroundColor:"#fff",borderRadius:12,padding:9,elevation:2},dropLabel:{position:"absolute",right:12,bottom:68,backgroundColor:"#fff",borderRadius:12,padding:9,elevation:2},pickLabelGreen:{color:COLORS.greenDark,fontWeight:"900",fontSize:11},pickLabelRed:{color:COLORS.red,fontWeight:"900",fontSize:11},mapLabelText:{fontWeight:"800",fontSize:12,marginTop:3,maxWidth:150},mapVehicle:{position:"absolute",left:"49%",top:"50%",width:48,height:68,resizeMode:"contain"},mapActions:{position:"absolute",right:10,bottom:12,gap:8,flexDirection:"row",alignItems:"flex-end"},mapAction:{minWidth:58,height:58,borderRadius:29,backgroundColor:"#fff",alignItems:"center",justifyContent:"center",paddingHorizontal:5,elevation:3},
  statusBanner:{borderRadius:16,padding:13,flexDirection:"row",alignItems:"center",marginVertical:7},bannerGreen:{backgroundColor:COLORS.softGreen},bannerRed:{backgroundColor:COLORS.softRed},statusIcon:{width:50,height:50,borderRadius:25,backgroundColor:COLORS.green,alignItems:"center",justifyContent:"center",marginRight:12},statusIconText:{color:"#fff",fontSize:25,fontWeight:"900"},statusTitle:{fontSize:23,fontWeight:"900"},statusSub:{fontSize:14,color:"#4C6380",marginTop:3},
  requestHomeSection:{borderWidth:1,borderColor:COLORS.border,borderRadius:18,padding:13,marginTop:12,backgroundColor:"#fff"},requestCount:{color:COLORS.muted,fontWeight:"900"},emptyRequestCard:{flexDirection:"row",alignItems:"center",gap:10,marginTop:10,padding:12,borderRadius:14,backgroundColor:"#F7FAF8"},emptyRequestTitle:{fontWeight:"900"},emptyRequestSub:{fontSize:11,color:COLORS.muted,marginTop:3,lineHeight:16},homeRequestCard:{flexDirection:"row",alignItems:"center",gap:10,paddingVertical:11,borderTopWidth:1,borderTopColor:"#EEF1F5"},homeRequestIcon:{width:42,height:42,borderRadius:12,alignItems:"center",justifyContent:"center",backgroundColor:"#EAF8F1"},homeRequestTitle:{fontWeight:"900",fontSize:13},homeRequestRoute:{fontWeight:"800",fontSize:13,marginTop:3},homeRequestMeta:{color:COLORS.muted,fontSize:11,marginTop:3},activeHomeCard:{borderWidth:1,borderColor:"#BFE7CF",borderRadius:18,padding:13,marginTop:12,backgroundColor:"#F6FCF8"},activeRideStatus:{color:COLORS.greenDark,fontWeight:"900",fontSize:11},requestCard:{backgroundColor:"#fff"},threeMetrics:{flexDirection:"row",gap:8},customerCard:{flexDirection:"row",alignItems:"center",gap:9,paddingVertical:10,borderTopWidth:1,borderTopColor:"#EEF2F6",marginTop:7},customerAvatar:{width:56,height:56,borderRadius:28,backgroundColor:"#EEF2F7",alignItems:"center",justifyContent:"center"},customerPhoto:{width:58,height:58,borderRadius:29},customerName:{fontSize:19,fontWeight:"900"},customerRating:{color:"#D89600",fontWeight:"900",marginTop:3},customerSub:{color:COLORS.muted,marginTop:3},actionCircle:{width:46,height:46,borderRadius:23,backgroundColor:"#E7F8EF",alignItems:"center",justifyContent:"center"},actionCircleBlue:{width:46,height:46,borderRadius:23,backgroundColor:"#E7F0FF",alignItems:"center",justifyContent:"center"},locationGrid:{flexDirection:"row",justifyContent:"space-between",gap:10,borderTopWidth:1,borderTopColor:"#EEF2F6",paddingVertical:11},locationGreen:{color:COLORS.greenDark,fontWeight:"900",fontSize:11},locationRed:{color:COLORS.red,fontWeight:"900",fontSize:11},locationText:{fontWeight:"800",marginTop:3,maxWidth:150},locationSub:{fontSize:11,color:COLORS.muted,marginTop:2},note:{backgroundColor:"#F5F8FB",borderRadius:13,padding:12},requestNoteTitle:{fontWeight:"900"},noteText:{color:"#385775",marginTop:4,lineHeight:18},acceptRow:{flexDirection:"row",gap:10,marginTop:13},decline:{flex:1,backgroundColor:"#FFE7E6",borderRadius:15,paddingVertical:15,alignItems:"center"},declineText:{color:COLORS.red,fontWeight:"900",fontSize:17},accept:{flex:1,backgroundColor:COLORS.green,borderRadius:15,paddingVertical:15,alignItems:"center"},acceptText:{color:"#fff",fontWeight:"900",fontSize:17},
  rideCard:{borderWidth:1,borderColor:COLORS.border,borderRadius:18,padding:12},fareRow:{flexDirection:"row",gap:8,borderTopWidth:1,borderTopColor:"#EEF2F6",paddingTop:8},pinCard:{backgroundColor:COLORS.softGreen,borderRadius:15,padding:12,flexDirection:"row",alignItems:"center",gap:9,marginTop:10},pinCircle:{width:42,height:42,borderRadius:21,backgroundColor:COLORS.green,alignItems:"center",justifyContent:"center"},pinTitle:{fontSize:13,fontWeight:"900"},pinSub:{fontSize:11,color:COLORS.muted,marginTop:4},pinInput:{width:80,height:50,borderWidth:1.5,borderColor:COLORS.green,borderRadius:12,textAlign:"center",fontSize:20,fontWeight:"900",backgroundColor:"#fff"},tripDetails:{borderWidth:1,borderColor:COLORS.border,borderRadius:14,padding:12,marginTop:10},detailLine:{paddingVertical:7,fontWeight:"700"},detailTime:{color:COLORS.muted,position:"absolute",right:0},endTrip:{backgroundColor:"#FFE6E7",borderRadius:15,minHeight:55,alignItems:"center",justifyContent:"center",marginTop:10},endTripText:{color:COLORS.red,fontSize:19,fontWeight:"900"},
  earnedHero:{backgroundColor:COLORS.softGreen,borderRadius:17,padding:18,marginVertical:11},earnedLabel:{color:COLORS.greenDark,fontWeight:"800"},earnedValue:{fontSize:38,fontWeight:"900",color:COLORS.greenDark,marginTop:4},cashPillRow:{flexDirection:"row",alignItems:"center",gap:6,alignSelf:"center"},cashPill:{alignSelf:"flex-end",marginTop:-26,color:COLORS.greenDark,fontWeight:"800"},locationStack:{gap:10,paddingTop:8},keepUp:{backgroundColor:COLORS.softGreen,borderRadius:15,padding:14,marginTop:11},keepUpTitle:{fontSize:18,fontWeight:"900",color:COLORS.greenDark},keepUpSub:{color:COLORS.muted,marginTop:3},rateCard:{borderWidth:1,borderColor:COLORS.border,borderRadius:15,padding:13,alignItems:"center",marginVertical:11},stars:{fontSize:34,color:"#F2A300",marginTop:8},rateHint:{color:COLORS.muted},
  filterRow:{flexDirection:"row",gap:6,marginVertical:10},filterPill:{flex:1,backgroundColor:"#F2F4F8",paddingVertical:9,borderRadius:10,alignItems:"center"},filterActive:{backgroundColor:COLORS.green},filterText:{fontSize:11,fontWeight:"800"},filterActiveText:{color:"#fff"},historyCard:{borderWidth:1,borderColor:COLORS.border,borderRadius:16,padding:13,marginVertical:5},historyTop:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},historyDate:{fontSize:12,color:"#3E5775",fontWeight:"800"},historyStatus:{paddingHorizontal:9,paddingVertical:4,borderRadius:10,fontSize:10,fontWeight:"900"},statusCompleted:{backgroundColor:"#E5F7EC",color:COLORS.greenDark},statusCancelled:{backgroundColor:"#FFE7E7",color:COLORS.red},historyRoute:{fontSize:15,fontWeight:"800",marginTop:8},historyBottom:{flexDirection:"row",justifyContent:"space-between",marginTop:9},historyFare:{fontSize:21,fontWeight:"900"},historyChevron:{fontSize:26},
  earningsHero:{backgroundColor:"#059C4C",borderRadius:17,padding:17},earningsLabel:{color:"#DDF8E8"},earningsValue:{color:"#fff",fontSize:40,fontWeight:"900",marginTop:2},earnStats:{flexDirection:"row",justifyContent:"space-between",borderTopWidth:1,borderTopColor:"rgba(255,255,255,.35)",paddingTop:10,marginTop:10,color:"#fff"},fourCards:{flexDirection:"row",gap:6,marginVertical:12},breakRow:{flexDirection:"row",justifyContent:"space-between",borderWidth:1,borderColor:COLORS.border,borderRadius:12,padding:12,marginTop:6},breakFare:{fontWeight:"900"},
  profileCard:{flexDirection:"row",alignItems:"center",borderWidth:1,borderColor:COLORS.border,borderRadius:18,padding:13,marginTop:12},profilePhoto:{width:88,height:88,borderRadius:44,marginRight:12},profileName:{fontSize:21,fontWeight:"900"},profileMeta:{color:"#4B607E",marginTop:3},profileRating:{color:"#D08B00",fontWeight:"900",marginTop:4},profileOnline:{backgroundColor:COLORS.green,borderRadius:10,paddingHorizontal:9,paddingVertical:6},profileOnlineText:{color:"#fff",fontWeight:"900",fontSize:11},profileStats:{flexDirection:"row",gap:7,marginVertical:10},profileRow:{flexDirection:"row",alignItems:"center",paddingVertical:13,borderTopWidth:1,borderTopColor:"#EEF1F5",paddingHorizontal:7},profileRowIcon:{width:38,fontSize:20},profileRowTitle:{fontSize:15,fontWeight:"800"},profileRowSub:{fontSize:12,color:COLORS.muted,marginTop:2},logout:{flexDirection:"row",justifyContent:"space-between",backgroundColor:"#FFE7E7",borderRadius:13,padding:14,marginTop:10},logoutText:{color:COLORS.red,fontWeight:"900"},
  sectionTitleWrap:{flexDirection:"row",alignItems:"center",gap:8},fieldLabel:{fontSize:12,fontWeight:"800",color:COLORS.black,marginTop:8},formInput:{borderWidth:1,borderColor:COLORS.border,borderRadius:12,paddingHorizontal:12,paddingVertical:11,fontSize:14,color:COLORS.black,backgroundColor:"#FFF",marginTop:6},vehicleEditCard:{marginTop:8},editPanel:{marginTop:10,padding:14,borderWidth:1,borderColor:COLORS.border,borderRadius:14,backgroundColor:"#FAFBFC"},buttonRow:{flexDirection:"row",gap:10,marginTop:8}, radioEmpty:{width:18,height:18,borderRadius:9,borderWidth:2,borderColor:COLORS.muted},  sectionBar:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",backgroundColor:COLORS.softGreen,borderRadius:12,padding:12,marginTop:10},verified:{color:COLORS.greenDark,fontWeight:"900"},docRow:{flexDirection:"row",alignItems:"center",padding:12,borderBottomWidth:1,borderBottomColor:"#EEF1F5"},docIcon:{width:40,height:40,borderRadius:12,backgroundColor:"#EEF2F6",alignItems:"center",justifyContent:"center"},docTitle:{fontSize:14,fontWeight:"800"},docSub:{fontSize:11,color:COLORS.muted,marginTop:3},docThumb:{width:46,height:38,borderRadius:8,backgroundColor:"#EEF2F6",alignItems:"center",justifyContent:"center"},editTag:{borderWidth:1,borderColor:COLORS.border,borderRadius:9,paddingHorizontal:10,paddingVertical:7,color:COLORS.muted,fontWeight:"800"},
  safetyHero:{backgroundColor:"#FFECEE",borderRadius:16,padding:14,flexDirection:"row",alignItems:"center"},safetyTitle:{fontSize:20,fontWeight:"900"},safetySub:{color:COLORS.muted,marginTop:3},safetyPerson:{fontSize:76},safetyTiles:{flexDirection:"row",gap:7,marginVertical:10},safetyTileRed:{flex:1,backgroundColor:"#FFE4E5",borderRadius:14,padding:10,alignItems:"center"},safetyTileGreen:{flex:1,backgroundColor:"#E4F8EE",borderRadius:14,padding:10,alignItems:"center"},safetyTileBlue:{flex:1,backgroundColor:"#E6F0FF",borderRadius:14,padding:10,alignItems:"center"},safetyCircle:{width:50,height:50,borderRadius:25,backgroundColor:"#fff",textAlign:"center",paddingTop:15,fontWeight:"900"},safetyTileTitle:{fontWeight:"900",marginTop:5,textAlign:"center",fontSize:12},tileSub:{fontSize:10,color:COLORS.muted,textAlign:"center",marginTop:2},safetyRow:{flexDirection:"row",alignItems:"center",padding:12,borderWidth:1,borderColor:COLORS.border,borderRadius:13,marginVertical:4},safetyRowIcon:{width:40,height:40,borderRadius:20,backgroundColor:"#EFF8F2",alignItems:"center",justifyContent:"center"},safetyFooter:{backgroundColor:COLORS.softGreen,borderRadius:13,padding:13,marginTop:8},safetyFooterTitle:{fontWeight:"900",color:COLORS.greenDark},safetyFooterSub:{fontSize:12,color:COLORS.muted,marginTop:3},
  sosBig:{alignSelf:"center",width:220,height:220,borderRadius:110,backgroundColor:COLORS.red,borderWidth:16,borderColor:"#FFE0E2",alignItems:"center",justifyContent:"center",marginTop:35},sosPhone:{color:"#fff",fontSize:50},sosBigText:{color:"#fff",fontSize:31,fontWeight:"900"},sosAlert:{fontSize:20,color:COLORS.red,fontWeight:"900",textAlign:"center",marginTop:14},sosHelp:{textAlign:"center",color:COLORS.muted,marginTop:4},sosPanel:{backgroundColor:"#FFEAEA",borderRadius:14,padding:15,marginTop:16,gap:8},locationBox:{borderWidth:1,borderColor:COLORS.border,borderRadius:14,padding:13,marginTop:12},cancelSos:{backgroundColor:"#FFCACC",borderRadius:14,padding:15,marginTop:10,alignItems:"center"},cancelSosText:{color:COLORS.red,fontWeight:"900"},infoBlue:{backgroundColor:"#E8F1FF",borderRadius:14,padding:14,marginTop:10},infoBlueTitle:{color:"#1C4B99",fontWeight:"900",marginBottom:3},
  bottomNav:{position:"absolute",left:0,right:0,bottom:Platform.OS==="android"?24:0,minHeight:68,flexDirection:"row",backgroundColor:"#fff",borderTopWidth:1,borderTopColor:"#E8EDF3",paddingTop:8,paddingBottom:8,elevation:8,zIndex:50},
  navItem:{flex:1,alignItems:"center",justifyContent:"center",paddingVertical:6,borderRadius:12},
  navItemActive:{backgroundColor:COLORS.softGreen},
  navLabel:{fontSize:10,fontWeight:"700",color:COLORS.muted,marginTop:3},
  navLabelActive:{color:COLORS.green,fontWeight:"900"},
  checkLineRow:{flexDirection:"row",alignItems:"center",gap:6,marginTop:5},
  emptyState:{alignItems:"center",justifyContent:"center",paddingVertical:30,paddingHorizontal:18,borderWidth:1,borderColor:COLORS.border,borderRadius:16,marginTop:10},
  docStatusIcon:{width:38,height:38,borderRadius:19,backgroundColor:COLORS.softGreen,alignItems:"center",justifyContent:"center"},
  notificationRow:{flexDirection:"row",alignItems:"center",padding:11,borderWidth:1,borderColor:COLORS.border,borderRadius:13,marginVertical:4,gap:8},notificationUnread:{backgroundColor:COLORS.softGreen},markAllText:{fontSize:11,color:COLORS.green,fontWeight:"900"},disabledText:{color:COLORS.muted},noteIcon:{width:44,height:44,borderRadius:22,backgroundColor:COLORS.softGreen,alignItems:"center",justifyContent:"center"},noteTitle:{fontSize:13,fontWeight:"900"},noteSub:{fontSize:11,color:COLORS.muted,marginTop:3},noteTime:{fontSize:10,color:COLORS.muted},
  messageRow:{flexDirection:"row",alignItems:"center",paddingVertical:12,borderBottomWidth:1,borderBottomColor:"#EEF1F5",gap:8},messageAvatar:{width:46,height:46,borderRadius:23,backgroundColor:"#EEF2F6",alignItems:"center",justifyContent:"center"},messageName:{fontSize:14,fontWeight:"900"},messagePreview:{fontSize:12,color:COLORS.muted,marginTop:2},messageTime:{fontSize:10,color:COLORS.muted},unread:{backgroundColor:COLORS.green,color:"#fff",width:20,height:20,borderRadius:10,textAlign:"center",paddingTop:2,fontWeight:"900",alignSelf:"flex-end"},supportBox:{backgroundColor:"#E8F8EF",borderRadius:16,padding:14,marginTop:10},supportTitle:{fontSize:19,fontWeight:"900"},supportSub:{color:COLORS.muted,fontSize:12,marginVertical:5},supportActions:{flexDirection:"row",gap:8},
  modalOverlay:{flex:1,backgroundColor:"rgba(0,0,0,.48)",justifyContent:"flex-end"},quickModal:{backgroundColor:"#fff",borderTopLeftRadius:22,borderTopRightRadius:22,padding:20},quickTitle:{fontSize:23,fontWeight:"900"},quickSub:{color:COLORS.muted,marginTop:4}
});
