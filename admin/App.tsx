import type { AdminScreen } from "../navigation/routes";
import React, { useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { createRideXFetch, getRideXApiUrl } from "../shared/api/client";
import { openRideXEventStream, type RideXStreamEvent } from "../shared/realtime/client";
import RideXMotionSurface, { computeOperationalDriftScore } from "../shared/ui/RideXMotionSurface";

const API = getRideXApiUrl();
const ADMIN_AUTH_TOKEN_KEY = "ridex_admin_auth_token_v1";
const ADMIN_SESSION_KEY = "ridex_admin_session_v1";
const ADMIN_USER_KEY = "ridex_admin_user_v1";
const TEST_MODE = String(process.env.EXPO_PUBLIC_RIDEX_TEST_MODE ?? "false").toLowerCase() === "true";
const ADMIN_LOGIN_PURPOSE = "ADMIN.AUTH.LOGIN";

type Screen = AdminScreen;
type Panel =
  | "dashboard"
  | "finance"
  | "live"
  | "drivers"
  | "events"
  | "customers"
  | "bookings"
  | "payments"
  | "support"
  | "safety"
  | "notifications"
  | "promotions"
  | "pricing"
  | "zones"
  | "admins"
  | "roles"
  | "audit"
  | "settings"
  | "platform"
  | "test-data";

type AnyRecord = Record<string, any>;

type Dashboard = {
  customers?: number;
  drivers?: number;
  activeDrivers?: number;
  bookings?: number;
  completed?: number;
  ongoing?: number;
  cancelled?: number;
  sos?: number;
  vehicles?: number;
  pendingKyc?: number;
  pendingAdmins?: number;
  openSupport?: number;
};

const adminFetch = createRideXFetch({ tokenKey: ADMIN_AUTH_TOKEN_KEY, apiUrl: API });

function apiPath(path: string) {
  return `${API}/${path.replace(/^\/+/, "")}`;
}

async function readJson(response: Response) {
  return response.json().catch(() => ({}));
}

function cleanError(error: unknown) {
  return error instanceof Error ? error.message : "Request failed";
}

function Button({ title, onPress, secondary = false, danger = false, disabled = false }: { title: string; onPress: () => void; secondary?: boolean; danger?: boolean; disabled?: boolean }) {
  return (
    <Pressable disabled={disabled} style={[styles.button, secondary && styles.buttonSecondary, danger && styles.buttonDanger, disabled && styles.disabled]} onPress={onPress}>
      {disabled ? <ActivityIndicator color={secondary ? "#17304f" : "#fff"} /> : <Text style={[styles.buttonText, secondary && styles.buttonSecondaryText]}>{title}</Text>}
    </Pressable>
  );
}

function Field({ label, value, onChangeText, placeholder, keyboardType = "default", multiline = false }: { label: string; value: string; onChangeText: (v: string) => void; placeholder?: string; keyboardType?: any; multiline?: boolean }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#8b96a8"
        keyboardType={keyboardType}
        multiline={multiline}
        style={[styles.input, multiline && styles.multiline]}
      />
    </View>
  );
}

function StatCard({ label, value, tone = "green" }: { label: string; value: number | undefined; tone?: "green" | "blue" | "orange" | "red" }) {
  return <View style={[styles.statCard, tone === "blue" && styles.blue, tone === "orange" && styles.orange, tone === "red" && styles.red]}><Text style={styles.statValue}>{value ?? 0}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

function ModuleCard({ icon, title, subtitle, onPress }: { icon: string; title: string; subtitle: string; onPress: () => void }) {
  return <Pressable style={styles.moduleCard} onPress={onPress}><View style={styles.moduleIcon}><Text style={styles.moduleIconText}>{icon}</Text></View><View style={{ flex: 1 }}><Text style={styles.moduleTitle}>{title}</Text><Text style={styles.moduleSubtitle}>{subtitle}</Text></View><Text style={styles.chevron}>›</Text></Pressable>;
}

function RowCard({ item, onPress }: { item: AnyRecord; onPress?: () => void }) {
  const title = String(item.fullName || item.name || item.code || item.subject || item.id || "Record");
  const subtitle = [item.id, item.status, item.driverStatus, item.verificationStatus, item.paymentStatus, item.createdAt].filter(Boolean).join(" • ");
  const body = Object.entries(item).filter(([k]) => !["id", "createdAt", "updatedAt"].includes(k)).slice(0, 3).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v).slice(0, 90) : String(v)}`).join("\n");
  return <Pressable style={styles.rowCard} onPress={onPress}><Text style={styles.rowTitle}>{title}</Text>{subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}{body ? <Text style={styles.rowBody}>{body}</Text> : null}</Pressable>;
}

export default function AdminApp({ onBackToCustomer }: { onBackToCustomer?: () => void } = {}) {
  const [screen, setScreen] = useState<Screen>("login");
  const [panel, setPanel] = useState<Panel>("dashboard");
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [otpResendAfterSeconds, setOtpResendAfterSeconds] = useState(0);
  const [otpAttemptsRemaining, setOtpAttemptsRemaining] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [adminName, setAdminName] = useState("RideX Admin");
  const [adminId, setAdminId] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [records, setRecords] = useState<AnyRecord[]>([]);
  const [selected, setSelected] = useState<AnyRecord | null>(null);
  const [statusFilter, setStatusFilter] = useState("");

  const [broadcastAudience, setBroadcastAudience] = useState("ALL");
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastBody, setBroadcastBody] = useState("");

  const [promotion, setPromotion] = useState({ code: "", description: "", discountType: "FIXED", discountValue: "", maxDiscount: "", minFare: "", validFrom: "", validUntil: "", rideScope: "ALL" });
  const [pricing, setPricing] = useState({ name: "", serviceType: "", bookingType: "", rideType: "", vehicleType: "", baseFare: "", perKm: "", perMinute: "", waitingPerMinute: "", weightPerKg: "", multiplier: "1", minFare: "", maxFare: "", priority: "0" });
  const [zone, setZone] = useState({ name: "", city: "", centerLat: "", centerLng: "", radiusKm: "", connectionPoint: "true" });
  const [eventForm, setEventForm] = useState({ id: "", title: "", city: "", description: "", workingStart: "08:00", workingEnd: "22:00" });
  const [eventStopForm, setEventStopForm] = useState({ name: "", address: "", latitude: "", longitude: "", sequence: "1" });
  const [eventSessionForm, setEventSessionForm] = useState({ startAt: "", endAt: "", capacity: "", fare: "" });
  const [adminForm, setAdminForm] = useState({ name: "", mobile: "", email: "", role: "OPERATIONS", workingLocation: "", department: "", operatingRegion: "", workAddress: "", accessReason: "" });
  const [rolePermissions, setRolePermissions] = useState<Record<string, string[]>>({});
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [configStatus, setConfigStatus] = useState<AnyRecord[]>([]);
  const [releaseForm, setReleaseForm] = useState({ version: "", sourceLabel: "", checksum: "", notes: "", releaseId: "", testerMobile: "", passed: "0", failed: "0", errors: "0" });
  const [mergeForm, setMergeForm] = useState({ name: "Manual data merge", sourceScope: "HISTORICAL_CURRENT", sourceQuery: "", derivativeData: "", id: "", approved: "true" });
  const [confirmation, setConfirmation] = useState("");
  const [testEntity, setTestEntity] = useState("bookings");
  const [testId, setTestId] = useState("");
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [realtimeEvents, setRealtimeEvents] = useState<RideXStreamEvent[]>([]);
  const realtimeCleanupRef = React.useRef<(() => void) | null>(null);
  const realtimeReconnectRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const apiStatus = useMemo(() => API.replace(/^https?:\/\//, ""), []);

  useEffect(() => { void restoreAdminSession(); }, []);

  useEffect(() => {
    if (screen !== "dashboard") return;
    void loadDashboard();
  }, [screen]);

  useEffect(() => {
    if (screen !== "dashboard") return;
    const timer = setInterval(() => { void loadDashboard(); }, 15000);
    return () => clearInterval(timer);
  }, [screen]);

  useEffect(() => {
    if (screen !== "otp" || otpResendAfterSeconds <= 0) return;
    const timer = setTimeout(() => {
      setOtpResendAfterSeconds((current) => Math.max(0, current - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [screen, otpResendAfterSeconds]);

  useEffect(() => {
    if (!adminId) {
      realtimeCleanupRef.current?.();
      realtimeCleanupRef.current = null;
      setRealtimeConnected(false);
      return;
    }

    let stopped = false;
    let retry = 0;

    const clearRetry = () => {
      if (realtimeReconnectRef.current) {
        clearTimeout(realtimeReconnectRef.current);
        realtimeReconnectRef.current = null;
      }
    };

    const connect = async () => {
      if (stopped) return;
      const token = await AsyncStorage.getItem(ADMIN_AUTH_TOKEN_KEY);
      if (!token || stopped) return;

      realtimeCleanupRef.current?.();
      realtimeCleanupRef.current = openRideXEventStream({
        url: `${API}/realtime/stream?actorType=ADMIN&actorId=${encodeURIComponent(adminId)}`,
        headers: { Authorization: `Bearer ${token}` },
        heartbeatTimeoutMs: 65000,
        onOpen: () => { retry = 0; setRealtimeConnected(true); },
        onClose: () => setRealtimeConnected(false),
        onError: () => {
          setRealtimeConnected(false);
          if (stopped) return;
          const delay = Math.min(30000, 1500 * Math.pow(2, retry++));
          clearRetry();
          realtimeReconnectRef.current = setTimeout(connect, delay);
        },
        onEvent: (event) => {
          setRealtimeEvents((current) => [event, ...current].slice(0, 50));
          const type = String(event.type || "").toUpperCase();
          if (["DRIVER_ONLINE", "DRIVER_OFFLINE", "GPS_UPDATED", "REQUEST_CREATED", "REQUEST_ACCEPTED", "REQUEST_EXPIRED", "DRIVER_ARRIVING", "DRIVER_ARRIVED", "OTP_VERIFIED", "TRIP_STARTED", "TRIP_PROGRESS", "ROUTE_CHANGED", "SOS_TRIGGERED", "TRIP_COMPLETED", "PAYMENT_COMPLETED"].includes(type)) {
            void loadDashboard();
            if (panel === "live") void loadLiveData(setRecords, setMessage);
          }
        },
      });
    };

    void connect();
    return () => {
      stopped = true;
      clearRetry();
      realtimeCleanupRef.current?.();
      realtimeCleanupRef.current = null;
      setRealtimeConnected(false);
    };
  }, [adminId]);

  async function restoreAdminSession() {
    try {
      const [token, userRaw, sessionRaw] = await Promise.all([
        AsyncStorage.getItem(ADMIN_AUTH_TOKEN_KEY),
        AsyncStorage.getItem(ADMIN_USER_KEY),
        AsyncStorage.getItem(ADMIN_SESSION_KEY),
      ]);
      if (!token || !userRaw) return;
      const user = JSON.parse(userRaw);
      setAdminId(String(user.adminId || ""));
      setAdminName(String(user.name || "RideX Admin"));
      void sessionRaw;
      setScreen("dashboard");
      setPanel("dashboard");
      await loadDashboard();
    } catch (error) {
      console.error("ADMIN SESSION RESTORE ERROR", error);
      await AsyncStorage.multiRemove([ADMIN_AUTH_TOKEN_KEY, ADMIN_SESSION_KEY, ADMIN_USER_KEY]);
    }
  }

  async function requestOtp() {
    const normalized = mobile.replace(/\D/g, "").slice(-10);
    setMobile(normalized);
    setOtp("");
    setOtpAttemptsRemaining(null);
    setMessage("");
    if (!/^\d{10}$/.test(normalized)) {
      setMessage("Enter a valid 10-digit admin mobile number.");
      return;
    }
    setLoading(true);
    try {
      const response = await adminFetch(apiPath("auth/send-otp"), {
        method: "POST",
        body: JSON.stringify({
          actorType: "ADMIN",
          actorId: normalized,
          purposeCode: ADMIN_LOGIN_PURPOSE,
          mobile: normalized,
        }),
      });
      const body: AnyRecord = await readJson(response);
      if (!response.ok || body?.success === false) {
        throw new Error(body?.message || "Unable to send admin OTP");
      }
      setOtpResendAfterSeconds(Math.max(0, Number(body?.resendAfterSeconds ?? 60) || 60));
      setOtpAttemptsRemaining(Number.isFinite(Number(body?.attemptsRemaining)) ? Number(body.attemptsRemaining) : null);
      setScreen("otp");
      setMessage(TEST_MODE ? "TEST mode enabled. Enter the 4-digit OTP issued by the backend." : "OTP sent to your approved admin mobile.");
    } catch (error) {
      setMessage(cleanError(error));
    } finally {
      setLoading(false);
    }
  }

  async function resendAdminOtp() {
    const normalized = mobile.replace(/\D/g, "").slice(-10);
    setMobile(normalized);
    if (!/^\d{10}$/.test(normalized)) {
      setMessage("Enter a valid 10-digit admin mobile number first.");
      return;
    }
    if (otpResendAfterSeconds > 0) {
      setMessage(`Please wait ${otpResendAfterSeconds}s before requesting another resend.`);
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const response = await adminFetch(apiPath("auth/resend-otp"), {
        method: "POST",
        body: JSON.stringify({
          actorType: "ADMIN",
          actorId: normalized,
          purposeCode: ADMIN_LOGIN_PURPOSE,
          mobile: normalized,
        }),
      });
      const body: AnyRecord = await readJson(response);
      if (!response.ok || body?.success === false) {
        const retryAfter = Number(body?.retryAfterSeconds);
        if (Number.isFinite(retryAfter) && retryAfter > 0) setOtpResendAfterSeconds(retryAfter);
        throw new Error(body?.message || "Unable to resend admin OTP");
      }
      setOtpResendAfterSeconds(Math.max(0, Number(body?.resendAfterSeconds ?? 60) || 60));
      setOtpAttemptsRemaining(Number.isFinite(Number(body?.attemptsRemaining)) ? Number(body.attemptsRemaining) : otpAttemptsRemaining);
      setMessage("OTP resent successfully.");
    } catch (error) {
      setMessage(cleanError(error));
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    const normalizedMobile = mobile.replace(/\D/g, "").slice(-10);
    const normalizedOtp = otp.replace(/\D/g, "").slice(0, 4);
    setMobile(normalizedMobile);
    setOtp(normalizedOtp);
    if (!/^\d{10}$/.test(normalizedMobile) || !/^\d{4}$/.test(normalizedOtp)) {
      setMessage("Enter the 4-digit OTP received for this admin account.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const response = await adminFetch(apiPath("auth/verify-otp"), {
        method: "POST",
        body: JSON.stringify({
          actorType: "ADMIN",
          actorId: normalizedMobile,
          purposeCode: ADMIN_LOGIN_PURPOSE,
          mobile: normalizedMobile,
          otp: normalizedOtp,
        }),
      });
      const body: AnyRecord = await readJson(response);
      const data = body?.data || {};
      if (!response.ok || body?.success === false || !data?.token || !data?.adminId) {
        if (body?.attemptsRemaining !== undefined) {
          const remaining = Number(body.attemptsRemaining);
          setOtpAttemptsRemaining(Number.isFinite(remaining) ? remaining : null);
        }
        throw new Error(body?.message || "Admin OTP verification failed");
      }
      const user = { userId: data.userId, adminId: data.adminId, userType: data.userType, mobile: normalizedMobile, name: data.name || "RideX Admin" };
      await AsyncStorage.multiSet([[ADMIN_AUTH_TOKEN_KEY, String(data.token)], [ADMIN_SESSION_KEY, JSON.stringify(data.session ?? null)], [ADMIN_USER_KEY, JSON.stringify(user)]]);
      setAdminId(String(data.adminId));
      setAdminName(String(data.name || "RideX Admin"));
      setOtp("");
      setOtpAttemptsRemaining(null);
      setOtpResendAfterSeconds(0);
      setScreen("dashboard");
      setPanel("dashboard");
      await loadDashboard();
    } catch (error) {
      setMessage(cleanError(error));
    } finally {
      setLoading(false);
    }
  }

  async function loadDashboard() {
    try {
      const response = await adminFetch(apiPath("admin/dashboard"));
      const body: AnyRecord = await readJson(response);
      if (response.status === 401 || response.status === 403) { await forceLogout(body?.message); return; }
      if (!response.ok || body?.success === false) throw new Error(body?.message || "Dashboard request failed");
      setDashboard(body.data || null);
    } catch (error) { setMessage(cleanError(error)); }
  }

  async function forceLogout(reason = "Session expired") {
    await AsyncStorage.multiRemove([ADMIN_AUTH_TOKEN_KEY, ADMIN_SESSION_KEY, ADMIN_USER_KEY]);
    setScreen("login"); setPanel("dashboard"); setDashboard(null); setAdminId(""); setMessage(reason);
  }

  async function logout() {
    try { await adminFetch(apiPath("auth/logout"), { method: "POST" }); } catch {}
    await forceLogout("Signed out.");
    setOtp("");
  }

  async function loadRecords(path: string, nextPanel: Panel, label: string) {
    setLoading(true); setMessage(""); setSelected(null);
    try {
      const suffix = statusFilter ? `${path}${path.includes("?") ? "&" : "?"}status=${encodeURIComponent(statusFilter)}` : path;
      const response = await adminFetch(apiPath(`admin${suffix}`));
      const body: AnyRecord = await readJson(response);
      if (response.status === 401 || response.status === 403) { await forceLogout(body?.message); return; }
      if (!response.ok || body?.success === false) throw new Error(body?.message || `${label} request failed`);
      const nextRecords = Array.isArray(body?.data) ? body.data : [];
      setRecords(nextRecords);
      if (nextPanel === "roles") {
        const nextPermissions: Record<string, string[]> = {};
        nextRecords.forEach((role: AnyRecord) => {
          const id = String(role.id || "");
          nextPermissions[id] = Array.isArray(role.permissionLinks)
            ? role.permissionLinks.map((link: AnyRecord) => String(link.permission?.id || link.permissionId || "")).filter(Boolean)
            : [];
        });
        setRolePermissions(nextPermissions);
      }
      setPanel(nextPanel);
    } catch (error) { setMessage(cleanError(error)); }
    finally { setLoading(false); }
  }

  async function openModule(nextPanel: Panel) {
    setStatusFilter("");
    const map: Record<string, { path: string; label: string } | undefined> = {
      finance: { path: "/payouts/settlements", label: "Finance / Settlements" },
      drivers: { path: "/drivers", label: "Drivers" },
      events: { path: "/events", label: "Events / Sessions" },
      customers: { path: "/customers", label: "Customers" },
      bookings: { path: "/bookings", label: "Bookings" },
      payments: { path: "/payments", label: "Payments" },
      support: { path: "/support/cases", label: "Support" },
      safety: { path: "/safety/sos", label: "Safety / SOS" },
      notifications: undefined,
      promotions: { path: "/promotions", label: "Promotions" },
      pricing: undefined,
      zones: undefined,
      admins: { path: "/admins", label: "Admin Users" },
      roles: { path: "/roles", label: "Roles" },
      audit: { path: "/audit-logs", label: "Audit Logs" },
      platform: undefined,
      settings: undefined,
      "test-data": undefined,
    };
    const target = map[nextPanel];
    if (!target) {
      if (nextPanel === "pricing" || nextPanel === "zones") { await loadPlatformData(nextPanel); return; }
      if (nextPanel === "settings") { await loadPlatformData("settings"); return; }
      if (nextPanel === "platform") { await loadPlatformData("platform"); return; }
      if (nextPanel === "test-data") { await loadTestData(); return; }
      setPanel(nextPanel);
      return;
    }
    await loadRecords(target.path, nextPanel, target.label);
  }

  async function refresh() {
    setRefreshing(true);
    if (panel === "dashboard" || screen === "dashboard") await loadDashboard();
    else {
      const map: Record<string, string | undefined> = { finance: "/payouts/settlements", drivers: "/drivers", events: "/events", customers: "/customers", bookings: "/bookings", payments: "/payments", support: "/support/cases", safety: "/safety/sos", promotions: "/promotions", admins: "/admins", roles: "/roles", audit: "/audit-logs" };
      if (map[panel]) await loadRecords(map[panel]!, panel, panel);
    }
    setRefreshing(false);
  }

  async function updateDriver(id: string, mode: "verify" | "status", value: string) {
    try {
      const path = mode === "verify" ? `admin/drivers/${encodeURIComponent(id)}/verification` : `admin/drivers/${encodeURIComponent(id)}/status`;
      const body = mode === "verify" ? { verificationStatus: value } : { status: value, ...(value === "SUSPENDED" ? { confirmation: "SUSPEND DRIVER" } : {}) };
      const response = await adminFetch(apiPath(path), { method: "PATCH", body: JSON.stringify(body) });
      const data: AnyRecord = await readJson(response);
      if (!response.ok || data?.success === false) throw new Error(data?.message || "Driver update failed");
      Alert.alert("Driver updated", data?.message || "Driver status updated.");
      await openModule("drivers");
    } catch (error) { Alert.alert("Driver update", cleanError(error)); }
  }

  async function openDriverActions(driver: AnyRecord) {
    setLoading(true);
    try {
      const response = await adminFetch(apiPath(`admin/drivers/${encodeURIComponent(String(driver.id))}`));
      const body: AnyRecord = await readJson(response);
      if (!response.ok || body?.success === false) throw new Error(body?.message || "Unable to load driver");
      const detail = body?.data || driver;
      setSelected(detail);
      const docs = Array.isArray(detail.documents) ? detail.documents : [];
      const vehicles = Array.isArray(detail.vehicles) ? detail.vehicles : [];
      const actions: any[] = [
        { text: "Approve Driver", onPress: () => updateDriver(String(detail.id), "verify", "APPROVED") },
        { text: "Under Review", onPress: () => updateDriver(String(detail.id), "verify", "UNDER_REVIEW") },
        { text: "Reject Driver", style: "destructive", onPress: () => updateDriver(String(detail.id), "verify", "REJECTED") },
        { text: "Suspend Driver", style: "destructive", onPress: () => updateDriver(String(detail.id), "status", "SUSPENDED") },
      ];
      if (docs.length) actions.push({ text: `Review KYC (${docs.length})`, onPress: () => Alert.alert("KYC Documents", docs.map((d: AnyRecord) => `${d.id} • ${d.type || d.documentType || "Document"} • ${d.status}`).join("\n"), docs.slice(0, 3).map((d: AnyRecord) => ({ text: `Approve ${d.type || "Doc"}`, onPress: () => reviewDocument(String(detail.id), String(d.id), "APPROVED") })).concat([{ text: "Close", style: "cancel" }])) });
      if (vehicles.length) actions.push({ text: `Review Vehicles (${vehicles.length})`, onPress: () => Alert.alert("Vehicles", vehicles.map((v: AnyRecord) => `${v.id} • ${v.vehicleType} • ${v.vehicleNumber || ""} • ${v.status}`).join("\n"), vehicles.slice(0, 3).map((v: AnyRecord) => ({ text: `Verify ${v.vehicleNumber || v.vehicleType || "Vehicle"}`, onPress: () => reviewVehicle(String(detail.id), String(v.id), "VERIFIED") })).concat([{ text: "Close", style: "cancel" }])) });
      actions.push({ text: "Cancel", style: "cancel" });
      Alert.alert("Driver actions", `${detail.fullName || detail.id} • ${detail.verificationStatus || ""}`, actions);
    } catch (error) { setMessage(cleanError(error)); }
    finally { setLoading(false); }
  }

  async function broadcast() {
    if (!broadcastTitle.trim() || !broadcastBody.trim()) { setMessage("Title and body are required."); return; }
    try {
      setLoading(true);
      const response = await adminFetch(apiPath("admin/notifications/broadcast"), { method: "POST", body: JSON.stringify({ audience: broadcastAudience, title: broadcastTitle.trim(), body: broadcastBody.trim() }) });
      const body: AnyRecord = await readJson(response);
      if (!response.ok || body?.success === false) throw new Error(body?.message || "Broadcast failed");
      setMessage(`Notification broadcast created for ${body?.data?.count ?? 0} users.`); setBroadcastTitle(""); setBroadcastBody("");
    } catch (error) { setMessage(cleanError(error)); }
    finally { setLoading(false); }
  }

  async function openDetail(path: string, item: AnyRecord) {
    try {
      const response = await adminFetch(apiPath(`admin${path}`));
      const body: AnyRecord = await readJson(response);
      if (!response.ok || body?.success === false) throw new Error(body?.message || "Unable to load details");
      setSelected(body?.data || item);
    } catch (error) { setMessage(cleanError(error)); setSelected(item); }
  }

  async function updateSupportCase(id: string, status: string) {
    try {
      const response = await adminFetch(apiPath(`admin/support/cases/${encodeURIComponent(id)}`), { method: "PATCH", body: JSON.stringify({ status }) });
      const body: AnyRecord = await readJson(response);
      if (!response.ok || body?.success === false) throw new Error(body?.message || "Support case update failed");
      await openModule("support");
    } catch (error) { setMessage(cleanError(error)); }
  }

  async function reviewDocument(driverId: string, documentId: string, status: string) {
    try {
      const response = await adminFetch(apiPath(`admin/drivers/${encodeURIComponent(driverId)}/documents/${encodeURIComponent(documentId)}/review`), { method: "PATCH", body: JSON.stringify({ status }) });
      const body: AnyRecord = await readJson(response);
      if (!response.ok || body?.success === false) throw new Error(body?.message || "Document review failed");
      setMessage("KYC document updated.");
      await openDetail(`/drivers/${encodeURIComponent(driverId)}`, { id: driverId });
    } catch (error) { setMessage(cleanError(error)); }
  }

  async function reviewVehicle(driverId: string, vehicleId: string, status: string) {
    try {
      const response = await adminFetch(apiPath(`admin/drivers/${encodeURIComponent(driverId)}/vehicles/${encodeURIComponent(vehicleId)}/review`), { method: "PATCH", body: JSON.stringify({ status }) });
      const body: AnyRecord = await readJson(response);
      if (!response.ok || body?.success === false) throw new Error(body?.message || "Vehicle review failed");
      setMessage("Vehicle review updated.");
      await openDetail(`/drivers/${encodeURIComponent(driverId)}`, { id: driverId });
    } catch (error) { setMessage(cleanError(error)); }
  }

  async function createEvent() {
    try {
      if (!eventForm.title.trim() || !eventForm.city.trim()) { setMessage("Event title and city are required."); return; }
      const response = await adminFetch(apiPath("admin/events"), { method: "POST", body: JSON.stringify({ title: eventForm.title.trim(), city: eventForm.city.trim(), description: eventForm.description.trim() || undefined, workingHours: { start: eventForm.workingStart, end: eventForm.workingEnd } }) });
      const body: AnyRecord = await readJson(response);
      if (!response.ok || body?.success === false) throw new Error(body?.message || "Event creation failed");
      setEventForm({ ...eventForm, id: String(body?.data?.id || body?.data?.event?.id || "") });
      setMessage("Event draft created. Add 6–10 stops, then create a session and publish.");
      await openModule("events");
    } catch (error) { setMessage(cleanError(error)); }
  }

  async function addEventStop() {
    if (!eventForm.id.trim() || !eventStopForm.name.trim()) { setMessage("Event ID and stop name are required."); return; }
    const sequence = Number(eventStopForm.sequence || 0);
    const latitude = eventStopForm.latitude.trim() ? Number(eventStopForm.latitude) : undefined;
    const longitude = eventStopForm.longitude.trim() ? Number(eventStopForm.longitude) : undefined;
    if (!Number.isInteger(sequence) || sequence < 1 || sequence > 10) { setMessage("Stop sequence must be an integer from 1 to 10."); return; }
    if ((latitude !== undefined && !Number.isFinite(latitude)) || (longitude !== undefined && !Number.isFinite(longitude))) { setMessage("Stop coordinates must be valid numbers."); return; }
    try {
      const response = await adminFetch(apiPath(`admin/events/${encodeURIComponent(eventForm.id)}/stops`), { method: "POST", body: JSON.stringify({ name: eventStopForm.name.trim(), address: eventStopForm.address.trim(), latitude, longitude, sequence }) });
      const body: AnyRecord = await readJson(response);
      if (!response.ok || body?.success === false) throw new Error(body?.message || "Event stop creation failed");
      setEventStopForm({ ...eventStopForm, name: "", address: "", latitude: "", longitude: "", sequence: String(sequence + 1) });
      setMessage("Event stop created.");
    } catch (error) { setMessage(cleanError(error)); }
  }

  async function addEventSession() {
    if (!eventForm.id.trim() || !eventSessionForm.startAt.trim() || !eventSessionForm.endAt.trim()) { setMessage("Event ID, session start and end are required."); return; }
    const capacity = Number(eventSessionForm.capacity);
    const fare = Number(eventSessionForm.fare);
    if (!Number.isInteger(capacity) || capacity < 1) { setMessage("Session capacity must be a positive whole number."); return; }
    if (!Number.isFinite(fare) || fare < 0) { setMessage("Session fare must be a valid non-negative amount."); return; }
    try {
      const response = await adminFetch(apiPath(`admin/events/${encodeURIComponent(eventForm.id)}/sessions`), { method: "POST", body: JSON.stringify({ startAt: eventSessionForm.startAt.trim(), endAt: eventSessionForm.endAt.trim(), capacity, fare }) });
      const body: AnyRecord = await readJson(response);
      if (!response.ok || body?.success === false) throw new Error(body?.message || "Event session creation failed");
      setMessage("Event session created.");
      await openModule("events");
    } catch (error) { setMessage(cleanError(error)); }
  }

  async function publishEvent() {
    if (!eventForm.id.trim()) { setMessage("Event ID is required."); return; }
    try {
      const detailResponse = await adminFetch(apiPath(`admin/events/${encodeURIComponent(eventForm.id)}`));
      const detailBody: AnyRecord = await readJson(detailResponse);
      if (!detailResponse.ok || detailBody?.success === false) throw new Error(detailBody?.message || "Unable to load event before publish");
      const detail = detailBody?.data?.event || detailBody?.data || {};
      const stops = Array.isArray(detail?.stops) ? detail.stops : Array.isArray(detail?.eventStops) ? detail.eventStops : [];
      const sessions = Array.isArray(detail?.sessions) ? detail.sessions : Array.isArray(detail?.eventSessions) ? detail.eventSessions : [];
      if (stops.length < 6 || stops.length > 10) { setMessage(`Event must contain 6–10 fixed stops before publish. Current: ${stops.length}.`); return; }
      if (!sessions.length) { setMessage("Create at least one operating session before publish."); return; }
      const response = await adminFetch(apiPath(`admin/events/${encodeURIComponent(eventForm.id)}/publish`), { method: "POST" });
      const body: AnyRecord = await readJson(response);
      if (!response.ok || body?.success === false) throw new Error(body?.message || "Event publish failed");
      setMessage("Event published successfully.");
      await openModule("events");
    } catch (error) { setMessage(cleanError(error)); }
  }

  async function createRelease() {
    try {
      if (!releaseForm.version.trim()) { setMessage("Release version is required."); return; }
      const response = await adminFetch(apiPath("admin/platform/releases"), { method: "POST", body: JSON.stringify({ version: releaseForm.version.trim(), sourceLabel: releaseForm.sourceLabel.trim() || undefined, checksum: releaseForm.checksum.trim() || undefined, notes: releaseForm.notes.trim() || undefined }) });
      const body: AnyRecord = await readJson(response);
      if (!response.ok || body?.success === false) throw new Error(body?.message || "Release creation failed");
      setReleaseForm({ ...releaseForm, releaseId: String(body?.data?.id || "") });
      setMessage(`Release created: ${body?.data?.id || ""}`);
    } catch (error) { setMessage(cleanError(error)); }
  }

  async function releaseWorkflow(action: "test-start" | "test-complete" | "approve" | "promote", confirmed = false) {
    const id = releaseForm.releaseId.trim();
    if (!id) { setMessage("Release ID is required."); return; }
    if (action === "promote" && !confirmed) {
      Alert.alert("Promote Release", "Only an APPROVED TEST release may be promoted to LIVE.", [
        { text: "Cancel", style: "cancel" },
        { text: "Promote to LIVE", style: "destructive", onPress: () => { void releaseWorkflow("promote", true); } },
      ]);
      return;
    }
    const path = `releases/${encodeURIComponent(id)}/${action}`;
    const body: AnyRecord = action === "test-complete"
      ? { testerMobile: releaseForm.testerMobile.replace(/\D/g, "").slice(-10) || undefined, passed: Number(releaseForm.passed || 0), failed: Number(releaseForm.failed || 0), errors: Number(releaseForm.errors || 0) }
      : action === "promote"
        ? { confirmation: "PROMOTE TO LIVE" }
        : {};
    try {
      const response = await adminFetch(apiPath(`admin/platform/${path}`), { method: "POST", body: JSON.stringify(body) });
      const data: AnyRecord = await readJson(response);
      if (!response.ok || data?.success === false) throw new Error(data?.message || `Release ${action} failed`);
      setMessage(`Release ${action} completed.`);
      if (action === "promote") await loadPlatformData("platform");
    } catch (error) { setMessage(cleanError(error)); }
  }

  async function createMergeJob() {
    try {
      let sourceQuery: unknown;
      let derivativeData: unknown;
      try {
        sourceQuery = mergeForm.sourceQuery.trim() ? JSON.parse(mergeForm.sourceQuery) : undefined;
        derivativeData = mergeForm.derivativeData.trim() ? JSON.parse(mergeForm.derivativeData) : undefined;
      } catch {
        setMessage("Source Query / Derivative Data must contain valid JSON.");
        return;
      }
      const body = { ...mergeForm, sourceQuery, derivativeData };
      const response = await adminFetch(apiPath("admin/platform/data-merge"), { method: "POST", body: JSON.stringify(body) });
      const data: AnyRecord = await readJson(response);
      if (!response.ok || data?.success === false) throw new Error(data?.message || "Data merge job creation failed");
      setMergeForm({ ...mergeForm, id: String(data?.data?.id || "") });
      setMessage(`Data merge job created: ${data?.data?.id || ""}`);
    } catch (error) { setMessage(cleanError(error)); }
  }

  async function reviewMergeJob() {
    if (!mergeForm.id.trim()) { setMessage("Merge job ID is required."); return; }
    try {
      const response = await adminFetch(apiPath(`admin/platform/data-merge/${encodeURIComponent(mergeForm.id)}/review`), { method: "PATCH", body: JSON.stringify({ approved: mergeForm.approved === "true" }) });
      const data: AnyRecord = await readJson(response);
      if (!response.ok || data?.success === false) throw new Error(data?.message || "Merge review failed");
      setMessage("Data merge review saved.");
    } catch (error) { setMessage(cleanError(error)); }
  }

  async function createPromotion() {
    try {
      const discountValue = Number(promotion.discountValue);
      const maxDiscount = promotion.maxDiscount.trim() ? Number(promotion.maxDiscount) : null;
      const minFare = promotion.minFare.trim() ? Number(promotion.minFare) : null;
      if (!promotion.code.trim() || !promotion.description.trim()) { setMessage("Promotion code and description are required."); return; }
      if (!Number.isFinite(discountValue) || discountValue <= 0) { setMessage("Discount value must be greater than zero."); return; }
      if (maxDiscount !== null && (!Number.isFinite(maxDiscount) || maxDiscount < 0)) { setMessage("Max discount must be a valid non-negative amount."); return; }
      if (minFare !== null && (!Number.isFinite(minFare) || minFare < 0)) { setMessage("Minimum fare must be a valid non-negative amount."); return; }
      const payload = { ...promotion, discountValue, maxDiscount, minFare };
      const response = await adminFetch(apiPath("admin/promotions"), { method: "POST", body: JSON.stringify(payload) });
      const body: AnyRecord = await readJson(response);
      if (!response.ok || body?.success === false) throw new Error(body?.message || "Promotion creation failed");
      setMessage("Promotion created successfully."); await openModule("promotions");
    } catch (error) { setMessage(cleanError(error)); }
  }

  async function createPricingRule() {
    try {
      const payload: AnyRecord = { ...pricing };
      const numeric = ["baseFare", "perKm", "perMinute", "waitingPerMinute", "weightPerKg", "multiplier", "minFare", "maxFare", "priority"] as const;
      for (const key of numeric) {
        if (String(payload[key] ?? "").trim() === "") continue;
        const number = Number(payload[key]);
        if (!Number.isFinite(number)) { setMessage(`${key} must be a valid number.`); return; }
        if (["baseFare", "perKm", "perMinute", "waitingPerMinute", "weightPerKg", "multiplier", "minFare", "maxFare"].includes(key) && number < 0) { setMessage(`${key} cannot be negative.`); return; }
        payload[key] = number;
      }
      if (payload.minFare !== undefined && payload.maxFare !== undefined && payload.minFare !== "" && payload.maxFare !== "" && Number(payload.minFare) > Number(payload.maxFare)) { setMessage("Minimum fare cannot exceed maximum fare."); return; }
      const response = await adminFetch(apiPath("admin/platform/pricing-rules"), { method: "POST", body: JSON.stringify(payload) });
      const body: AnyRecord = await readJson(response);
      if (!response.ok || body?.success === false) throw new Error(body?.message || "Pricing rule creation failed");
      setMessage("Pricing rule created."); await loadPlatformData("pricing");
    } catch (error) { setMessage(cleanError(error)); }
  }

  async function createZone() {
    try {
      const centerLat = Number(zone.centerLat);
      const centerLng = Number(zone.centerLng);
      const radiusKm = Number(zone.radiusKm);
      if (!zone.name.trim() || !zone.city.trim()) { setMessage("Zone name and city are required."); return; }
      if (!Number.isFinite(centerLat) || centerLat < -90 || centerLat > 90) { setMessage("Center latitude must be between -90 and 90."); return; }
      if (!Number.isFinite(centerLng) || centerLng < -180 || centerLng > 180) { setMessage("Center longitude must be between -180 and 180."); return; }
      if (!Number.isFinite(radiusKm) || radiusKm <= 0) { setMessage("Zone radius must be greater than zero."); return; }
      const payload = { ...zone, centerLat, centerLng, radiusKm, connectionPoint: zone.connectionPoint === "true" };
      const response = await adminFetch(apiPath("admin/platform/city-zones"), { method: "POST", body: JSON.stringify(payload) });
      const body: AnyRecord = await readJson(response);
      if (!response.ok || body?.success === false) throw new Error(body?.message || "Zone creation failed");
      setMessage("City zone created."); await loadPlatformData("zones");
    } catch (error) { setMessage(cleanError(error)); }
  }

  async function createAdmin() {
    try {
      if (confirmation !== "CREATE ADMIN") { setMessage('Type "CREATE ADMIN" in confirmation.'); return; }
      const payload = { ...adminForm, confirmation };
      const response = await adminFetch(apiPath("admin/admins"), { method: "POST", body: JSON.stringify(payload) });
      const body: AnyRecord = await readJson(response);
      if (!response.ok || body?.success === false) throw new Error(body?.message || "Admin creation failed");
      setMessage("Admin created and placed in Pending Approval."); setConfirmation(""); await openModule("admins");
    } catch (error) { setMessage(cleanError(error)); }
  }

  async function approveAdmin(id: string, action: "approve" | "reject" | "suspend") {
    const confirmationText = action === "approve" ? "APPROVE ADMIN" : action === "reject" ? "REJECT ADMIN" : "SUSPEND ADMIN";
    if (confirmation !== confirmationText) { setMessage(`Type "${confirmationText}" first.`); return; }
    try {
      const response = await adminFetch(apiPath(`admin/admins/${encodeURIComponent(id)}/${action}`), { method: "PATCH", body: JSON.stringify({ confirmation: confirmationText }) });
      const body: AnyRecord = await readJson(response);
      if (!response.ok || body?.success === false) throw new Error(body?.message || `Admin ${action} failed`);
      setConfirmation(""); await openModule("admins");
    } catch (error) { setMessage(cleanError(error)); }
  }

  async function saveRolePermissions(roleId: string) {
    const selectedPermissions = rolePermissions[roleId] || [];
    if (!selectedPermissions.length) { setMessage("Select at least one permission."); return; }
    if (confirmation !== "CHANGE PERMISSIONS") { setMessage('Type "CHANGE PERMISSIONS" first.'); return; }
    try {
      const response = await adminFetch(apiPath(`admin/roles/${encodeURIComponent(roleId)}/permissions`), { method: "POST", body: JSON.stringify({ permissionIds: selectedPermissions, confirmation }) });
      const body: AnyRecord = await readJson(response);
      if (!response.ok || body?.success === false) throw new Error(body?.message || "Permission update failed");
      setConfirmation(""); setMessage("Role permissions updated."); await openModule("roles");
    } catch (error) { setMessage(cleanError(error)); }
  }

  async function loadPlatformData(kind: "pricing" | "zones" | "platform" | "settings") {
    setLoading(true); setMessage("");
    try {
      const path = kind === "pricing" ? "admin/platform/pricing-rules" : kind === "zones" ? "admin/platform/city-zones" : kind === "settings" ? "admin/configuration/status" : "admin/platform/state";
      const response = await adminFetch(apiPath(path));
      const body: AnyRecord = await readJson(response);
      if (response.status === 401 || response.status === 403) { await forceLogout(body?.message || "Admin permission denied"); return; }
      if (!response.ok || body?.success === false) throw new Error(body?.message || `${kind} request failed`);
      if (kind === "settings") {
        const rows = Array.isArray(body?.data) ? body.data : [];
        setConfigStatus(rows);
        const next: Record<string, string> = {};
        rows.forEach((row: AnyRecord) => { next[String(row.key)] = ""; });
        setConfigValues(next);
      } else {
        setRecords(Array.isArray(body?.data) ? body.data : [body?.data || body]);
      }
      setPanel(kind);
    } catch (error) { setMessage(cleanError(error)); }
    finally { setLoading(false); }
  }

  async function updateConfig(key: string) {
    const value = configValues[key];
    if (!value?.trim()) { setMessage("Configuration value is required."); return; }
    try {
      const response = await adminFetch(apiPath(`admin/configuration/${encodeURIComponent(key)}`), { method: "PUT", body: JSON.stringify({ value }) });
      const body: AnyRecord = await readJson(response);
      if (!response.ok || body?.success === false) throw new Error(body?.message || "Configuration update failed");
      setMessage(`${key} updated securely.`);
    } catch (error) { setMessage(cleanError(error)); }
  }

  async function updateEnvironment(environment: "TEST" | "LIVE") {
    if (environment === "LIVE") { setMessage("LIVE is only entered through an APPROVED project release promotion."); return; }
    try {
      const response = await adminFetch(apiPath("admin/platform/environment"), { method: "PUT", body: JSON.stringify({ environment }) });
      const body: AnyRecord = await readJson(response);
      if (!response.ok || body?.success === false) throw new Error(body?.message || "Environment update failed");
      setMessage("TEST environment selected."); await loadPlatformData("platform");
    } catch (error) { setMessage(cleanError(error)); }
  }


  async function seedTestData() {
    if (!TEST_MODE) { setMessage("TEST Data Lab is disabled outside TEST mode."); return; }
    try {
      const response = await adminFetch(apiPath("admin/test-data/seed"), { method: "POST", body: JSON.stringify({ confirmation: "SEED TEST DATA" }) });
      const body: AnyRecord = await readJson(response);
      if (!response.ok || body?.success === false) throw new Error(body?.message || "Test seed failed");
      setMessage("Test data seeded.");
    } catch (error) { setMessage(cleanError(error)); }
  }

  async function loadTestData() {
    if (!TEST_MODE) { setMessage("TEST Data Lab is disabled outside TEST mode."); return; }
    try {
      const response = await adminFetch(apiPath("admin/test-data/records"));
      const body: AnyRecord = await readJson(response);
      if (!response.ok || body?.success === false) throw new Error(body?.message || "Test data load failed");
      setRecords(Array.isArray(body?.data) ? body.data : []); setPanel("test-data");
    } catch (error) { setMessage(cleanError(error)); }
  }

  async function deleteTestRecord() {
    if (!TEST_MODE) { setMessage("TEST Data Lab is disabled outside TEST mode."); return; }
    if (!testId.trim()) { setMessage("Test record ID is required."); return; }
    try {
      const response = await adminFetch(apiPath(`admin/test-data/${encodeURIComponent(testEntity)}/${encodeURIComponent(testId.trim())}`), { method: "DELETE" });
      const body: AnyRecord = await readJson(response);
      if (!response.ok || body?.success === false) throw new Error(body?.message || "Test record delete failed");
      setMessage("Test record deleted."); setTestId(""); await loadTestData();
    } catch (error) { setMessage(cleanError(error)); }
  }

  function goDashboard() { setPanel("dashboard"); setScreen("dashboard"); setSelected(null); setMessage(""); }

  if (screen === "login") {
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled"><Text style={styles.logoText}>RIDEX</Text><RideXMotionSurface height={54} intensity={0.42} compact muted label="SECURE ADMIN FLOW" /><View style={styles.securityBadge}><Text style={styles.securityText}>ADMIN • SECURE ACCESS</Text></View><Text style={styles.heading}>Admin Control Center</Text><Text style={styles.subheading}>Approved admin identity, OTP and backend authorization are required.</Text><View style={styles.card}><Field label="Admin Mobile Number" value={mobile} onChangeText={setMobile} placeholder="98765 43210" keyboardType="phone-pad" /><Button title="Send Admin OTP" onPress={() => void requestOtp()} disabled={loading} />{!!message && <Text style={styles.message}>{message}</Text>}</View><Text style={styles.apiText}>Backend: {apiStatus}</Text>{onBackToCustomer ? <Pressable onPress={onBackToCustomer}><Text style={styles.backLink}>← Back to Customer App</Text></Pressable> : null}</ScrollView></SafeAreaView>;
  }

  if (screen === "otp") {
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled"><Text style={styles.logoText}>RIDEX</Text><RideXMotionSurface height={54} intensity={0.42} compact muted label="OTP ADMIN FLOW" /><Text style={styles.heading}>Verify Admin OTP</Text><Text style={styles.subheading}>Code sent to +91 {mobile}.</Text><View style={styles.card}><Field label="4-Digit OTP" value={otp} onChangeText={(value) => setOtp(value.replace(/\D/g, "").slice(0, 4))} placeholder="1234" keyboardType="number-pad" /><Button title="Verify & Open Control Center" onPress={() => void verifyOtp()} disabled={loading} /><Button title={otpResendAfterSeconds > 0 ? `Resend OTP in ${otpResendAfterSeconds}s` : "Resend Admin OTP"} onPress={() => void resendAdminOtp()} secondary disabled={loading || otpResendAfterSeconds > 0} />{otpAttemptsRemaining !== null ? <Text style={styles.message}>Attempts remaining: {otpAttemptsRemaining}</Text> : null}<Button title="Change Mobile" onPress={() => setScreen("login")} secondary disabled={loading} />{!!message && <Text style={styles.message}>{message}</Text>}</View></ScrollView></SafeAreaView>;
  }

  const renderPanel = () => {
    if (panel === "dashboard") return <DashboardPanel dashboard={dashboard} onOpen={openModule} />;
    if (panel === "finance") return <SettlementPanel records={records} onRefresh={() => void openModule("finance")} filter={statusFilter} setFilter={setStatusFilter} />;
    if (panel === "live") return <LivePanel records={records} onRefresh={() => void loadLiveData(setRecords, setMessage)} realtimeConnected={realtimeConnected} realtimeEvents={realtimeEvents} />;
    if (panel === "drivers") return <ListPanel title="Driver Management / KYC / Vehicles" records={records} onRefresh={() => void openModule("drivers")} onSelect={(item) => void openDriverActions(item)} />;
    if (panel === "events") return <EventsPanel records={records} eventForm={eventForm} setEventForm={setEventForm} stopForm={eventStopForm} setStopForm={setEventStopForm} sessionForm={eventSessionForm} setSessionForm={setEventSessionForm} onCreate={() => void createEvent()} onStop={() => void addEventStop()} onSession={() => void addEventSession()} onPublish={() => void publishEvent()} onReload={() => void openModule("events")} />;
    if (panel === "customers") return <ListPanel title="Customer Management" records={records} onRefresh={() => void openModule("customers")} onSelect={(item) => void openDetail(`/customers/${encodeURIComponent(String(item.id || ""))}`, item)} />;
    if (panel === "bookings") return <ListPanel title="Booking Management / Ride Operations" records={records} onRefresh={() => void openModule("bookings")} onSelect={(item) => void openDetail(`/bookings/${encodeURIComponent(String(item.id || ""))}`, item)} filter={statusFilter} setFilter={setStatusFilter} />;
    if (panel === "payments") return <ListPanel title="Finance / Payments" records={records} onRefresh={() => void openModule("payments")} onSelect={(item) => setSelected(item)} filter={statusFilter} setFilter={setStatusFilter} />;
    if (panel === "support") return <SupportPanel records={records} onReload={() => void openModule("support")} confirmation={confirmation} setConfirmation={setConfirmation} onUpdate={(id, status) => void updateSupportCase(id, status)} />;
    if (panel === "safety") return <ListPanel title="Safety / SOS" records={records} onRefresh={() => void openModule("safety")} onSelect={(item) => setSelected(item)} />;
    if (panel === "notifications") return <BroadcastPanel audience={broadcastAudience} setAudience={setBroadcastAudience} title={broadcastTitle} setTitle={setBroadcastTitle} body={broadcastBody} setBody={setBroadcastBody} onSend={() => void broadcast()} loading={loading} />;
    if (panel === "promotions") return <PromotionPanel records={records} promotion={promotion} setPromotion={setPromotion} onCreate={() => void createPromotion()} onReload={() => void openModule("promotions")} />;
    if (panel === "pricing") return <PricingPanel records={records} pricing={pricing} setPricing={setPricing} onCreate={() => void createPricingRule()} />;
    if (panel === "zones") return <ZonePanel records={records} zone={zone} setZone={setZone} onCreate={() => void createZone()} />;
    if (panel === "admins") return <AdminUsersPanel records={records} confirmation={confirmation} setConfirmation={setConfirmation} adminForm={adminForm} setAdminForm={setAdminForm} onCreate={() => void createAdmin()} onAction={approveAdmin} />;
    if (panel === "roles") return <RolesPanel records={records} rolePermissions={rolePermissions} setRolePermissions={setRolePermissions} confirmation={confirmation} setConfirmation={setConfirmation} onSave={saveRolePermissions} />;
    if (panel === "audit") return <ListPanel title="Security / Audit Logs" records={records} onRefresh={() => void openModule("audit")} onSelect={(item) => setSelected(item)} />;
    if (panel === "settings") return <SettingsPanel status={configStatus} values={configValues} setValues={setConfigValues} onSave={updateConfig} />;
    if (panel === "platform") return <PlatformPanel records={records} onSetTest={() => void updateEnvironment("TEST")} releaseForm={releaseForm} setReleaseForm={setReleaseForm} onCreateRelease={() => void createRelease()} onReleaseAction={releaseWorkflow} mergeForm={mergeForm} setMergeForm={setMergeForm} onCreateMerge={() => void createMergeJob()} onReviewMerge={() => void reviewMergeJob()} />;
    if (panel === "test-data") return <TestDataPanel records={records} entity={testEntity} setEntity={setTestEntity} id={testId} setId={setTestId} onSeed={() => void seedTestData()} onLoad={() => void loadTestData()} onDelete={() => void deleteTestRecord()} />;
    return <ListPanel title={panel} records={records} onRefresh={() => void refresh()} onSelect={(item) => setSelected(item)} />;
  };

  return <SafeAreaView style={styles.page}><View style={styles.appHeader}><View><Text style={styles.brandSmall}>RIDEX ADMIN</Text><Text style={styles.headerName}>{adminName}</Text></View><View style={styles.headerActions}><Pressable style={styles.headerButton} onPress={() => void refresh()}><Text>↻</Text></Pressable><Pressable style={styles.headerButton} onPress={() => void logout()}><Text style={{ color: "#b4232c", fontWeight: "800" }}>Logout</Text></Pressable></View></View><View style={styles.connectionCard}><View style={[styles.dot, !realtimeConnected && styles.dotOffline]} /><View style={{ flex: 1 }}><Text style={styles.connectionTitle}>{realtimeConnected ? "Backend + Realtime Connected" : "Backend Connected"}</Text><Text style={styles.connectionSub}>{apiStatus} • Admin session active • ID {adminId || "—"} • {realtimeConnected ? "LIVE events" : "sync fallback"}</Text></View></View>{panel !== "dashboard" ? <Pressable onPress={goDashboard}><Text style={styles.backLinkTop}>← Control Center</Text></Pressable> : null}<ScrollView contentContainerStyle={styles.dashboardScroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>{renderPanel()}{selected ? <DetailPanel item={selected} onClose={() => setSelected(null)} /> : null}{!!message && <Text style={styles.message}>{message}</Text>}</ScrollView></SafeAreaView>;
}

async function loadLiveData(setRecords: (v: AnyRecord[]) => void, setMessage: (v: string) => void) {
  try {
    const [driversResponse, bookingsResponse, sosResponse] = await Promise.all([adminFetch(apiPath("admin/drivers")), adminFetch(apiPath("admin/bookings")), adminFetch(apiPath("admin/safety/sos"))]);
    const [drivers, bookings, sos] = await Promise.all([readJson(driversResponse), readJson(bookingsResponse), readJson(sosResponse)]);
    setRecords([
      ...(Array.isArray(drivers?.data) ? drivers.data.map((x: AnyRecord) => ({ _liveType: "DRIVER", ...x })) : []),
      ...(Array.isArray(bookings?.data) ? bookings.data.map((x: AnyRecord) => ({ _liveType: "BOOKING", ...x })) : []),
      ...(Array.isArray(sos?.data) ? sos.data.map((x: AnyRecord) => ({ _liveType: "SOS", ...x })) : []),
    ]);
  } catch (error) { setMessage(cleanError(error)); }
}

function EventsPanel({ records, eventForm, setEventForm, stopForm, setStopForm, sessionForm, setSessionForm, onCreate, onStop, onSession, onPublish, onReload }: { records: AnyRecord[]; eventForm: AnyRecord; setEventForm: (v: any) => void; stopForm: AnyRecord; setStopForm: (v: any) => void; sessionForm: AnyRecord; setSessionForm: (v: any) => void; onCreate: () => void; onStop: () => void; onSession: () => void; onPublish: () => void; onReload: () => void }) {
  const setE=(k:string,v:string)=>setEventForm({...eventForm,[k]:v});
  const setS=(k:string,v:string)=>setStopForm({...stopForm,[k]:v});
  const setT=(k:string,v:string)=>setSessionForm({...sessionForm,[k]:v});
  return <><RideXMotionSurface height={72} intensity={0.72} compact label="EVENT / SESSION FLOW" /><Text style={styles.sectionTitle}>Event / Sessional Ride</Text><Text style={styles.note}>Admin-created Event → fixed 6–10 stops → operating session/time → Publish. This service uses the published stop sequence rather than normal Driver route planning.</Text><Button title="Refresh Events" onPress={onReload} secondary />{records.map((item,i)=><RowCard key={String(item.id||i)} item={item} onPress={()=>setEventForm({...eventForm,id:String(item.id||""),title:String(item.title||item.name||""),city:String(item.city||""),description:String(item.description||"")})}/>) }<View style={styles.card}><Text style={styles.cardTitle}>Create Event</Text><Field label="Event ID" value={String(eventForm.id||"")} onChangeText={(v)=>setE("id",v)} placeholder="Created by backend" /><Field label="Title" value={String(eventForm.title||"")} onChangeText={(v)=>setE("title",v)} placeholder="City Festival Shuttle" /><Field label="City" value={String(eventForm.city||"")} onChangeText={(v)=>setE("city",v)} placeholder="Patna" /><Field label="Description" value={String(eventForm.description||"")} onChangeText={(v)=>setE("description",v)} multiline /><Field label="Working Start" value={String(eventForm.workingStart||"08:00")} onChangeText={(v)=>setE("workingStart",v)} /><Field label="Working End" value={String(eventForm.workingEnd||"22:00")} onChangeText={(v)=>setE("workingEnd",v)} /><Button title="Create Event Draft" onPress={onCreate} /></View><View style={styles.card}><Text style={styles.cardTitle}>Create Fixed Stop</Text><Field label="Stop Name" value={String(stopForm.name||"")} onChangeText={(v)=>setS("name",v)} /><Field label="Address" value={String(stopForm.address||"")} onChangeText={(v)=>setS("address",v)} /><Field label="Latitude" value={String(stopForm.latitude||"")} onChangeText={(v)=>setS("latitude",v)} keyboardType="numeric" /><Field label="Longitude" value={String(stopForm.longitude||"")} onChangeText={(v)=>setS("longitude",v)} keyboardType="numeric" /><Field label="Sequence 1–10" value={String(stopForm.sequence||"1")} onChangeText={(v)=>setS("sequence",v)} keyboardType="numeric" /><Button title="Add Stop" onPress={onStop} secondary /></View><View style={styles.card}><Text style={styles.cardTitle}>Create Session / Time</Text><Field label="Start ISO" value={String(sessionForm.startAt||"")} onChangeText={(v)=>setT("startAt",v)} placeholder="2026-09-20T08:00:00+05:30" /><Field label="End ISO" value={String(sessionForm.endAt||"")} onChangeText={(v)=>setT("endAt",v)} placeholder="2026-09-20T22:00:00+05:30" /><Field label="Capacity" value={String(sessionForm.capacity||"4")} onChangeText={(v)=>setT("capacity",v)} keyboardType="numeric" /><Field label="Fare" value={String(sessionForm.fare||"30")} onChangeText={(v)=>setT("fare",v)} keyboardType="numeric" /><Button title="Create Session" onPress={onSession} secondary /><Button title="Publish Event" onPress={onPublish} danger /></View></>;
}

function DashboardPanel({ dashboard, onOpen }: { dashboard: Dashboard | null; onOpen: (p: Panel) => void }) {
  return <><RideXMotionSurface height={72} intensity={0.55} compact label="COMMAND CENTER" badgeLabel="LOAD DRIFT" driftScore={dashboard ? Math.min(1, Number(dashboard.ongoing || 0) / Math.max(1, Number(dashboard.bookings || 1))) * 0.20 : 0} /><ModuleCard icon="🎟" title="Event / Sessional Rides" subtitle="Create events, 6–10 stops, sessions and publish" onPress={() => onOpen("events")} /><Text style={styles.sectionTitle}>Command Center</Text><View style={styles.grid}><StatCard label="Customers" value={dashboard?.customers} /><StatCard label="Drivers" value={dashboard?.drivers} tone="blue" /><StatCard label="Active Drivers" value={dashboard?.activeDrivers} /><StatCard label="Bookings" value={dashboard?.bookings} tone="orange" /><StatCard label="Completed" value={dashboard?.completed} tone="blue" /><StatCard label="Ongoing" value={dashboard?.ongoing} /><StatCard label="SOS Open" value={dashboard?.sos} tone="red" /><StatCard label="Pending KYC" value={dashboard?.pendingKyc} tone="orange" /><StatCard label="Pending Admins" value={dashboard?.pendingAdmins} tone="orange" /><StatCard label="Open Support" value={dashboard?.openSupport} tone="red" /></View><Text style={styles.sectionTitle}>Live Operations</Text><ModuleCard icon="◉" title="Live Operations" subtitle="Drivers, rides, requests and safety" onPress={() => onOpen("live")} /><ModuleCard icon="D" title="Drivers / Vehicles / KYC" subtitle="Driver approval, KYC, vehicle and status controls" onPress={() => onOpen("drivers")} /><ModuleCard icon="C" title="Customers" subtitle="Customer records and history" onPress={() => onOpen("customers")} /><ModuleCard icon="R" title="Bookings / Ride Operations" subtitle="Bookings, route, legs, trip state" onPress={() => onOpen("bookings")} /><ModuleCard icon="₹" title="Finance / Payments" subtitle="Payments, refunds and settlement data" onPress={() => onOpen("payments")} /><ModuleCard icon="⇄" title="Driver Settlements" subtitle="Settlement status, earnings and payout records" onPress={() => onOpen("finance")} /><ModuleCard icon="S" title="Safety / SOS" subtitle="SOS events and operational alerts" onPress={() => onOpen("safety")} /><ModuleCard icon="?" title="Support" subtitle="Support cases and case status" onPress={() => onOpen("support")} /><ModuleCard icon="N" title="Notifications" subtitle="Customer / Driver broadcast" onPress={() => onOpen("notifications")} /><Text style={styles.sectionTitle}>Business Controls</Text><ModuleCard icon="%" title="Promotions" subtitle="Coupon creation and activation" onPress={() => onOpen("promotions")} /><ModuleCard icon="P" title="Pricing" subtitle="Admin pricing rules for Ride / Parcel / Goods / Event" onPress={() => onOpen("pricing")} /><ModuleCard icon="Z" title="City Zones" subtitle="Zones and connection-point configuration" onPress={() => onOpen("zones")} /><Text style={styles.sectionTitle}>Security / Governance</Text><ModuleCard icon="A" title="Admin Users" subtitle="Create, approve, reject and suspend admins" onPress={() => onOpen("admins")} /><ModuleCard icon="R" title="Roles / Permissions" subtitle="RBAC role permission assignment" onPress={() => onOpen("roles")} /><ModuleCard icon="✓" title="Audit Logs" subtitle="Security and configuration audit" onPress={() => onOpen("audit")} /><ModuleCard icon="⚙" title="Settings / Secrets" subtitle="Super Admin secure configuration status" onPress={() => onOpen("settings")} /><ModuleCard icon="⇄" title="TEST / LIVE" subtitle="Environment and release control" onPress={() => onOpen("platform")} />{TEST_MODE ? <ModuleCard icon="T" title="TEST Data Lab" subtitle="Seed and inspect isolated TEST data" onPress={() => onOpen("test-data")} /> : null}</>;
}

function SettlementPanel({ records, onRefresh, filter, setFilter }: { records: AnyRecord[]; onRefresh: () => void; filter: string; setFilter: (v: string) => void }) {
  return <><Text style={styles.sectionTitle}>Driver Settlements / Finance</Text><Text style={styles.note}>Read-only settlement visibility. Financial payout execution remains backend-authorized and audited.</Text><Field label="Settlement status filter" value={filter || ""} onChangeText={setFilter} placeholder="PENDING / PROCESSING / SUCCESS / FAILED / ON_HOLD" /><Button title="Refresh Settlements" onPress={onRefresh} secondary />{records.length === 0 ? <Text style={styles.empty}>No settlement records returned by backend.</Text> : records.map((item, i) => <RowCard key={String(item.id || i)} item={item} />)}</>;
}

function ListPanel({ title, records, onRefresh, onSelect, filter, setFilter }: { title: string; records: AnyRecord[]; onRefresh: () => void; onSelect?: (item: AnyRecord) => void; filter?: string; setFilter?: (v: string) => void }) {
  return <><Text style={styles.sectionTitle}>{title}</Text>{setFilter ? <Field label="Status filter" value={filter || ""} onChangeText={setFilter} placeholder="e.g. COMPLETED" /> : null}<Button title="Refresh" onPress={onRefresh} secondary />{records.length === 0 ? <Text style={styles.empty}>No records returned by backend.</Text> : records.map((item, i) => <RowCard key={String(item.id || i)} item={item} onPress={() => onSelect?.(item)} />)}</>;
}

function LivePanel({ records, onRefresh, realtimeConnected, realtimeEvents }: { records: AnyRecord[]; onRefresh: () => void; realtimeConnected: boolean; realtimeEvents: RideXStreamEvent[] }) {
  const latestEventAt = realtimeEvents[0]?.createdAt || null;
  const operationalDrift = computeOperationalDriftScore(latestEventAt, 45);
  return <><RideXMotionSurface height={70} intensity={0.62} compact label={realtimeConnected ? "LIVE EVENT FLOW" : "SYNC FALLBACK"} badgeLabel="SYNC DRIFT" driftScore={operationalDrift} /><Text style={styles.sectionTitle}>Live Operations</Text><Text style={styles.note}>Customer, Driver and Admin operational events are backend-authoritative. Realtime transport is used when available, with backend refresh as deterministic fallback.</Text><View style={styles.card}><Text style={styles.cardTitle}>{realtimeConnected ? "Realtime LIVE" : "Realtime reconnecting / fallback"}</Text><Text style={styles.note}>Received events: {realtimeEvents.length}</Text><Button title="Refresh Live Data" onPress={onRefresh} secondary /></View><Text style={styles.subSection}>Recent Realtime Events</Text>{realtimeEvents.length ? realtimeEvents.slice(0, 20).map((event, i) => <View key={`${event.id || event.createdAt || i}`} style={styles.rowCard}><Text style={styles.rowTitle}>{String(event.type || "EVENT")}</Text><Text style={styles.rowSub}>{[event.bookingId, event.driverId, event.customerId, event.createdAt].filter(Boolean).join(" • ")}</Text>{event.payload ? <Text style={styles.rowBody}>{JSON.stringify(event.payload).slice(0, 220)}</Text> : null}</View>) : <Text style={styles.empty}>No realtime events received yet.</Text>}<Text style={styles.subSection}>Live Driver / Operation Records</Text>{records.map((item, i) => <RowCard key={String(item.id || i)} item={item} />)}</>;
}

function BroadcastPanel({ audience, setAudience, title, setTitle, body, setBody, onSend, loading }: { audience: string; setAudience: (v: string) => void; title: string; setTitle: (v: string) => void; body: string; setBody: (v: string) => void; onSend: () => void; loading: boolean }) {
  return <><Text style={styles.sectionTitle}>Notification Broadcast</Text><Field label="Audience" value={audience} onChangeText={setAudience} placeholder="ALL / CUSTOMERS / DRIVERS" /><Field label="Title" value={title} onChangeText={setTitle} /><Field label="Body" value={body} onChangeText={setBody} multiline /><Button title="Send Broadcast" onPress={onSend} disabled={loading} /></>;
}

function PromotionPanel({ records, promotion, setPromotion, onCreate, onReload }: { records: AnyRecord[]; promotion: AnyRecord; setPromotion: (v: any) => void; onCreate: () => void; onReload: () => void }) {
  const set = (key: string, value: string) => setPromotion({ ...promotion, [key]: value });
  return <><Text style={styles.sectionTitle}>Promotions</Text><Field label="Code" value={promotion.code} onChangeText={(v) => set("code", v)} /><Field label="Description" value={promotion.description} onChangeText={(v) => set("description", v)} /><Field label="Discount Type" value={promotion.discountType} onChangeText={(v) => set("discountType", v)} /><Field label="Discount Value" value={promotion.discountValue} onChangeText={(v) => set("discountValue", v)} keyboardType="numeric" /><Field label="Max Discount" value={promotion.maxDiscount} onChangeText={(v) => set("maxDiscount", v)} keyboardType="numeric" /><Field label="Minimum Fare" value={promotion.minFare} onChangeText={(v) => set("minFare", v)} keyboardType="numeric" /><Field label="Valid From" value={promotion.validFrom} onChangeText={(v) => set("validFrom", v)} placeholder="ISO datetime" /><Field label="Valid Until" value={promotion.validUntil} onChangeText={(v) => set("validUntil", v)} placeholder="ISO datetime" /><Field label="Ride Scope" value={promotion.rideScope} onChangeText={(v) => set("rideScope", v)} /><Button title="Create Promotion" onPress={onCreate} /><Button title="Reload Promotions" onPress={onReload} secondary />{records.map((item, i) => <RowCard key={String(item.id || i)} item={item} />)}</>;
}

function PricingPanel({ records, pricing, setPricing, onCreate }: { records: AnyRecord[]; pricing: AnyRecord; setPricing: (v: any) => void; onCreate: () => void }) {
  const set = (key: string, value: string) => setPricing({ ...pricing, [key]: value });
  return <><Text style={styles.sectionTitle}>Admin Pricing Rules</Text><Text style={styles.note}>Pricing is backend-authoritative. These fields create or review rules; customer fare calculation remains server-side.</Text><Field label="Name" value={pricing.name} onChangeText={(v) => set("name", v)} /><Field label="Service Type" value={pricing.serviceType} onChangeText={(v) => set("serviceType", v)} /><Field label="Booking Type" value={pricing.bookingType} onChangeText={(v) => set("bookingType", v)} /><Field label="Ride Type" value={pricing.rideType} onChangeText={(v) => set("rideType", v)} /><Field label="Vehicle Type" value={pricing.vehicleType} onChangeText={(v) => set("vehicleType", v)} /><Field label="Base Fare" value={pricing.baseFare} onChangeText={(v) => set("baseFare", v)} keyboardType="numeric" /><Field label="Per KM" value={pricing.perKm} onChangeText={(v) => set("perKm", v)} keyboardType="numeric" /><Field label="Per Minute" value={pricing.perMinute} onChangeText={(v) => set("perMinute", v)} keyboardType="numeric" /><Field label="Waiting / Minute" value={pricing.waitingPerMinute} onChangeText={(v) => set("waitingPerMinute", v)} keyboardType="numeric" /><Field label="Weight / KG" value={pricing.weightPerKg} onChangeText={(v) => set("weightPerKg", v)} keyboardType="numeric" /><Field label="Multiplier" value={pricing.multiplier} onChangeText={(v) => set("multiplier", v)} keyboardType="numeric" /><Field label="Minimum Fare" value={pricing.minFare} onChangeText={(v) => set("minFare", v)} keyboardType="numeric" /><Field label="Maximum Fare" value={pricing.maxFare} onChangeText={(v) => set("maxFare", v)} keyboardType="numeric" /><Field label="Priority" value={pricing.priority} onChangeText={(v) => set("priority", v)} keyboardType="numeric" /><Button title="Create Pricing Rule" onPress={onCreate} />{records.map((item, i) => <RowCard key={String(item.id || i)} item={item} />)}</>;
}

function ZonePanel({ records, zone, setZone, onCreate }: { records: AnyRecord[]; zone: AnyRecord; setZone: (v: any) => void; onCreate: () => void }) {
  const set = (key: string, value: string) => setZone({ ...zone, [key]: value });
  return <><Text style={styles.sectionTitle}>City Zones</Text><Field label="Zone Name" value={zone.name} onChangeText={(v) => set("name", v)} /><Field label="City" value={zone.city} onChangeText={(v) => set("city", v)} /><Field label="Center Latitude" value={zone.centerLat} onChangeText={(v) => set("centerLat", v)} keyboardType="numeric" /><Field label="Center Longitude" value={zone.centerLng} onChangeText={(v) => set("centerLng", v)} keyboardType="numeric" /><Field label="Radius KM" value={zone.radiusKm} onChangeText={(v) => set("radiusKm", v)} keyboardType="numeric" /><Field label="Connection Point" value={zone.connectionPoint} onChangeText={(v) => set("connectionPoint", v)} placeholder="true / false" /><Button title="Create Zone" onPress={onCreate} />{records.map((item, i) => <RowCard key={String(item.id || i)} item={item} />)}</>;
}

function AdminUsersPanel({ records, confirmation, setConfirmation, adminForm, setAdminForm, onCreate, onAction }: { records: AnyRecord[]; confirmation: string; setConfirmation: (v: string) => void; adminForm: AnyRecord; setAdminForm: (v: any) => void; onCreate: () => void; onAction: (id: string, action: "approve" | "reject" | "suspend") => void }) {
  const set = (key: string, value: string) => setAdminForm({ ...adminForm, [key]: value });
  return <><Text style={styles.sectionTitle}>Admin Users</Text><Field label="Name" value={adminForm.name} onChangeText={(v) => set("name", v)} /><Field label="Mobile" value={adminForm.mobile} onChangeText={(v) => set("mobile", v)} keyboardType="phone-pad" /><Field label="Email" value={adminForm.email} onChangeText={(v) => set("email", v)} /><Field label="Role" value={adminForm.role} onChangeText={(v) => set("role", v)} placeholder="OPERATIONS / FINANCE / SAFETY / SUPPORT / VERIFICATION_KYC" /><Field label="Working Location" value={adminForm.workingLocation} onChangeText={(v) => set("workingLocation", v)} /><Field label="Department" value={adminForm.department} onChangeText={(v) => set("department", v)} /><Field label="Operating Region" value={adminForm.operatingRegion} onChangeText={(v) => set("operatingRegion", v)} /><Field label="Work Address" value={adminForm.workAddress} onChangeText={(v) => set("workAddress", v)} /><Field label="Access Reason" value={adminForm.accessReason} onChangeText={(v) => set("accessReason", v)} multiline /><Field label="Confirmation" value={confirmation} onChangeText={setConfirmation} placeholder="CREATE ADMIN" /><Button title="Create Admin" onPress={onCreate} />{records.map((item, i) => <Pressable key={String(item.id || i)} style={styles.rowCard} onPress={() => { const id = String(item.id || ""); Alert.alert("Admin action", `${item.name || "Admin"} • ${item.approvalStatus || ""}`, [{ text: "Approve", onPress: () => onAction(id, "approve") }, { text: "Reject", style: "destructive", onPress: () => onAction(id, "reject") }, { text: "Suspend", style: "destructive", onPress: () => onAction(id, "suspend") }, { text: "Cancel", style: "cancel" }]); }}><Text style={styles.rowTitle}>{item.name || "Admin"}</Text><Text style={styles.rowSub}>{[item.role?.name, item.approvalStatus, item.user?.mobile].filter(Boolean).join(" • ")}</Text></Pressable>)}</>;
}

function RolesPanel({ records, rolePermissions, setRolePermissions, confirmation, setConfirmation, onSave }: { records: AnyRecord[]; rolePermissions: Record<string, string[]>; setRolePermissions: (v: Record<string, string[]>) => void; confirmation: string; setConfirmation: (v: string) => void; onSave: (roleId: string) => void }) {
  return <><Text style={styles.sectionTitle}>Roles / Permissions</Text>{records.map((role, i) => {
    const id = String(role.id || i);
    const links = Array.isArray(role.permissionLinks) ? role.permissionLinks : [];
    const selected = rolePermissions[id] ?? links.map((x: AnyRecord) => String(x.permission?.id || x.permissionId || "")).filter(Boolean);
    return <View key={id} style={styles.card}>
      <Text style={styles.cardTitle}>{role.name}</Text>
      <Text style={styles.note}>{role.isSystem ? "System role" : "Custom role"}</Text>
      <Text style={styles.rowBody}>{selected.join(", ") || "No permissions assigned"}</Text>
      <Button title="Use Current Permissions" onPress={() => setRolePermissions({ ...rolePermissions, [id]: selected })} secondary />
      <Field label="Permission IDs (comma separated)" value={selected.join(",")} onChangeText={(v) => setRolePermissions({ ...rolePermissions, [id]: v.split(",").map((x: string) => x.trim()).filter(Boolean) })} />
      <Field label="Confirmation" value={confirmation} onChangeText={setConfirmation} placeholder="CHANGE PERMISSIONS" />
      <Button title="Save Role Permissions" onPress={() => onSave(id)} />
    </View>;
  })}</>;
}

function SupportPanel({ records, onReload, confirmation, setConfirmation, onUpdate }: { records: AnyRecord[]; onReload: () => void; confirmation: string; setConfirmation: (v: string) => void; onUpdate: (id: string, status: string) => void }) {
  return <><Text style={styles.sectionTitle}>Support Operations</Text><Text style={styles.note}>Support cases are backend-authoritative. Status changes are permission-controlled and audited by the backend.</Text><Field label="Confirmation" value={confirmation} onChangeText={setConfirmation} placeholder="Optional" /><Button title="Refresh Support Cases" onPress={onReload} secondary />{records.map((item, i) => <Pressable key={String(item.id || i)} style={styles.rowCard} onPress={() => Alert.alert("Support case", String(item.subject || item.id || "Case"), [{ text: "Open", onPress: () => onUpdate(String(item.id), "OPEN") }, { text: "In Progress", onPress: () => onUpdate(String(item.id), "IN_PROGRESS") }, { text: "Resolved", onPress: () => onUpdate(String(item.id), "RESOLVED") }, { text: "Closed", onPress: () => onUpdate(String(item.id), "CLOSED") }, { text: "Cancel", style: "cancel" }])}><Text style={styles.rowTitle}>{item.subject || item.id}</Text><Text style={styles.rowSub}>{[item.status, item.priority, item.customer?.fullName, item.driver?.fullName].filter(Boolean).join(" • ")}</Text></Pressable>)}</>;
}

function SettingsPanel({ status, values, setValues, onSave }: { status: AnyRecord[]; values: Record<string, string>; setValues: (v: Record<string, string>) => void; onSave: (key: string) => void }) {
  if (!status.length) return <><Text style={styles.sectionTitle}>Settings / Security</Text><Text style={styles.note}>Secure configuration is available to Super Admin and explicitly authorized configuration admins. Secret values are not returned by the backend.</Text></>;
  return <><Text style={styles.sectionTitle}>Secure Configuration</Text><Text style={styles.note}>Configured secrets remain encrypted on the backend. Entering a new value replaces the stored secret.</Text>{status.map((row, i) => <View key={String(row.key || i)} style={styles.card}><Text style={styles.cardTitle}>{row.key}</Text><Text style={styles.rowSub}>{row.configured ? `Configured • ${row.updatedAt || "date unavailable"}` : "Not configured"}</Text><Field label="New value" value={values[String(row.key)] || ""} onChangeText={(v) => setValues({ ...values, [String(row.key)]: v })} placeholder="Enter secret/config value" /><Button title={`Save ${row.key}`} onPress={() => onSave(String(row.key))} /></View>)}</>;
}

function PlatformPanel({ records, onSetTest, releaseForm, setReleaseForm, onCreateRelease, onReleaseAction, mergeForm, setMergeForm, onCreateMerge, onReviewMerge }: { records: AnyRecord[]; onSetTest: () => void; releaseForm: AnyRecord; setReleaseForm: (v: any) => void; onCreateRelease: () => void; onReleaseAction: (action: "test-start" | "test-complete" | "approve" | "promote") => void; mergeForm: AnyRecord; setMergeForm: (v: any) => void; onCreateMerge: () => void; onReviewMerge: () => void }) {
  const setRelease = (key: string, value: string) => setReleaseForm({ ...releaseForm, [key]: value });
  const setMerge = (key: string, value: string) => setMergeForm({ ...mergeForm, [key]: value });
  return <><Text style={styles.sectionTitle}>TEST / LIVE Release Control</Text><Text style={styles.note}>The backend is authoritative. LIVE cannot be selected directly; a release must be tested, passed, approved and then explicitly promoted.</Text>{records.map((item, i) => <RowCard key={String(item.id || i)} item={item} />)}<Button title="Select TEST Environment" onPress={onSetTest} secondary />
    <View style={styles.card}><Text style={styles.cardTitle}>Project Release</Text><Field label="Version" value={releaseForm.version} onChangeText={(v) => setRelease("version", v)} placeholder="v7.3.0" /><Field label="Source Label" value={releaseForm.sourceLabel} onChangeText={(v) => setRelease("sourceLabel", v)} /><Field label="Checksum" value={releaseForm.checksum} onChangeText={(v) => setRelease("checksum", v)} /><Field label="Notes" value={releaseForm.notes} onChangeText={(v) => setRelease("notes", v)} multiline /><Field label="Release ID" value={releaseForm.releaseId} onChangeText={(v) => setRelease("releaseId", v)} placeholder="Filled after create" /><Button title="Create TEST Release" onPress={onCreateRelease} /><Button title="Start TEST" onPress={() => onReleaseAction("test-start")} secondary /><Field label="Tester Mobile" value={releaseForm.testerMobile} onChangeText={(v) => setRelease("testerMobile", v)} keyboardType="phone-pad" /><Field label="Passed" value={releaseForm.passed} onChangeText={(v) => setRelease("passed", v)} keyboardType="numeric" /><Field label="Failed" value={releaseForm.failed} onChangeText={(v) => setRelease("failed", v)} keyboardType="numeric" /><Field label="Errors" value={releaseForm.errors} onChangeText={(v) => setRelease("errors", v)} keyboardType="numeric" /><Button title="Complete TEST Run" onPress={() => onReleaseAction("test-complete")} secondary /><Button title="Approve Passed Release" onPress={() => onReleaseAction("approve")} secondary /><Button title="Promote Approved Release to LIVE" onPress={() => onReleaseAction("promote")} danger /></View>
    <View style={styles.card}><Text style={styles.cardTitle}>Historical / Current Data Merge</Text><Text style={styles.note}>Merge jobs are created as DRAFT and require explicit review. No data is silently overwritten by this UI.</Text><Field label="Job Name" value={mergeForm.name} onChangeText={(v) => setMerge("name", v)} /><Field label="Source Scope" value={mergeForm.sourceScope} onChangeText={(v) => setMerge("sourceScope", v)} /><Field label="Source Query JSON" value={mergeForm.sourceQuery} onChangeText={(v) => setMerge("sourceQuery", v)} placeholder='{"from":"2026-01-01"}' multiline /><Field label="Derivative Data JSON" value={mergeForm.derivativeData} onChangeText={(v) => setMerge("derivativeData", v)} placeholder='{"metric":"route_time"}' multiline /><Field label="Merge Job ID" value={mergeForm.id} onChangeText={(v) => setMerge("id", v)} /><Field label="Approved" value={mergeForm.approved} onChangeText={(v) => setMerge("approved", v)} placeholder="true / false" /><Button title="Create Merge Job" onPress={onCreateMerge} /><Button title="Review Merge Job" onPress={onReviewMerge} secondary /></View>
  </>;
}

function TestDataPanel({ records, entity, setEntity, id, setId, onSeed, onLoad, onDelete }: { records: AnyRecord[]; entity: string; setEntity: (v: string) => void; id: string; setId: (v: string) => void; onSeed: () => void; onLoad: () => void; onDelete: () => void }) {
  return <><Text style={styles.sectionTitle}>TEST Data Lab</Text><Text style={styles.note}>Only TEST-mode data endpoints are used. Backend restricts these records to isolated test records.</Text><Field label="Entity" value={entity} onChangeText={setEntity} placeholder="bookings / drivers / customers / vehicles" /><Field label="Test Record ID" value={id} onChangeText={setId} placeholder="v35-test-..." /><Button title="Seed Test Data" onPress={onSeed} /><Button title="Load Test Data" onPress={onLoad} secondary /><Button title="Delete Test Record" onPress={onDelete} danger />{records.map((item, i) => <RowCard key={String(item.id || i)} item={item} />)}</>;
}

function DetailPanel({ item, onClose }: { item: AnyRecord; onClose: () => void }) {
  return <View style={styles.detailCard}><View style={styles.detailHeader}><Text style={styles.cardTitle}>Record Details</Text><Pressable onPress={onClose}><Text style={styles.close}>×</Text></Pressable></View><Text selectable style={styles.detailText}>{JSON.stringify(item, null, 2)}</Text></View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#f4f7fb" },
  authScroll: { flexGrow: 1, justifyContent: "center", padding: 22 },
  dashboardScroll: { padding: 16, paddingBottom: 40 },
  logoText: { textAlign: "center", fontSize: 38, fontWeight: "900", letterSpacing: 4, color: "#0a9450", marginBottom: 12 },
  securityBadge: { alignSelf: "center", backgroundColor: "#eaf8f0", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginBottom: 18 },
  securityText: { color: "#08783c", fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  heading: { fontSize: 28, fontWeight: "900", color: "#111a33", textAlign: "center" },
  subheading: { fontSize: 14, lineHeight: 21, color: "#63708a", textAlign: "center", marginTop: 8, marginBottom: 18 },
  card: { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#e2e8f0" },
  cardTitle: { fontSize: 16, fontWeight: "900", color: "#13213a" },
  fieldWrap: { marginBottom: 12 },
  label: { fontSize: 12, color: "#536178", fontWeight: "800", marginBottom: 6 },
  input: { minHeight: 48, borderWidth: 1, borderColor: "#d3dbe7", borderRadius: 11, paddingHorizontal: 12, color: "#13213a", backgroundColor: "#fff" },
  multiline: { minHeight: 92, paddingTop: 12, textAlignVertical: "top" },
  button: { minHeight: 48, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "#0a9450", marginBottom: 10, paddingHorizontal: 14 },
  buttonSecondary: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#cfd8e6" },
  buttonDanger: { backgroundColor: "#c62828" },
  buttonText: { color: "#fff", fontWeight: "900", fontSize: 14 },
  buttonSecondaryText: { color: "#17304f" },
  disabled: { opacity: 0.65 },
  message: { marginTop: 12, color: "#8a2b2b", textAlign: "center", fontWeight: "700" },
  apiText: { color: "#8792a5", fontSize: 12, textAlign: "center", marginTop: 16 },
  backLink: { color: "#0a9450", fontWeight: "800", textAlign: "center", marginTop: 14 },
  backLinkTop: { color: "#0a9450", fontWeight: "800", marginHorizontal: 16, marginTop: 2 },
  appHeader: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandSmall: { fontSize: 11, fontWeight: "900", letterSpacing: 1.3, color: "#0a9450" },
  headerName: { fontSize: 22, fontWeight: "900", color: "#111a33", marginTop: 2 },
  headerActions: { flexDirection: "row", gap: 8 },
  headerButton: { minHeight: 38, paddingHorizontal: 12, borderRadius: 10, justifyContent: "center", alignItems: "center", backgroundColor: "#fff", borderWidth: 1, borderColor: "#d7deea" },
  connectionCard: { marginHorizontal: 16, marginBottom: 10, flexDirection: "row", alignItems: "center", backgroundColor: "#eaf8f0", borderRadius: 13, borderWidth: 1, borderColor: "#ccebd8", padding: 12 },
  dot: { width: 10, height: 10, borderRadius: 8, backgroundColor: "#0aa052", marginRight: 10 },
  dotOffline: { backgroundColor: "#f3a500" },
  connectionTitle: { fontWeight: "900", color: "#08783c" },
  connectionSub: { fontSize: 11, color: "#4c7a60", marginTop: 2 },
  sectionTitle: { fontSize: 19, fontWeight: "900", color: "#111a33", marginTop: 8, marginBottom: 10 },
  subSection: { fontSize: 15, fontWeight: "900", color: "#33435e", marginTop: 12, marginBottom: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginBottom: 8 },
  statCard: { width: "48.3%", backgroundColor: "#fff", borderRadius: 13, padding: 13, marginBottom: 10, borderWidth: 1, borderColor: "#dde5ef", borderLeftWidth: 4, borderLeftColor: "#0aa052" },
  blue: { borderLeftColor: "#1777df" },
  orange: { borderLeftColor: "#f3a500" },
  red: { borderLeftColor: "#ef2b2d" },
  statValue: { fontSize: 24, fontWeight: "900", color: "#111a33" },
  statLabel: { fontSize: 11, color: "#63708a", marginTop: 3 },
  moduleCard: { flexDirection: "row", alignItems: "center", padding: 14, backgroundColor: "#fff", borderRadius: 14, marginBottom: 9, borderWidth: 1, borderColor: "#e1e7ef" },
  moduleIcon: { width: 40, height: 40, borderRadius: 11, backgroundColor: "#eaf8f0", justifyContent: "center", alignItems: "center", marginRight: 12 },
  moduleIconText: { color: "#0a9450", fontSize: 17, fontWeight: "900" },
  moduleTitle: { fontSize: 15, fontWeight: "900", color: "#13213a" },
  moduleSubtitle: { fontSize: 12, color: "#65738a", marginTop: 3, lineHeight: 17 },
  chevron: { fontSize: 27, color: "#8c98aa", marginLeft: 8 },
  rowCard: { backgroundColor: "#fff", borderRadius: 13, padding: 13, marginBottom: 9, borderWidth: 1, borderColor: "#dfe6ef" },
  rowTitle: { fontSize: 15, fontWeight: "900", color: "#13213a" },
  rowSub: { fontSize: 11, color: "#63708a", marginTop: 4 },
  rowBody: { fontSize: 11, color: "#55647a", lineHeight: 17, marginTop: 7 },
  empty: { textAlign: "center", color: "#7d899c", paddingVertical: 28 },
  note: { fontSize: 12, color: "#617087", lineHeight: 18, marginBottom: 12 },
  detailCard: { backgroundColor: "#0f1828", borderRadius: 15, padding: 14, marginTop: 12 },
  detailHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 9 },
  close: { color: "#fff", fontSize: 26, fontWeight: "600" },
  detailText: { color: "#e9eef7", fontSize: 11, lineHeight: 16 },
});
