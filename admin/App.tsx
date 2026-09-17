import type { AdminScreen } from "../navigation/routes";
import React, { useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createRideXFetch, getRideXApiUrl } from "../shared/api/client";
import { ADMIN_MOBILE_ASSETS } from "../shared/assets";
import DriverManagementScreen from "./screens/DriverManagementScreen";
import KycDetailScreen from "./screens/KycDetailScreen";
import BookingManagementScreen from "./screens/BookingManagementScreen";
import PaymentManagementScreen from "./screens/PaymentManagementScreen";
import SupportCaseScreen from "./screens/SupportCaseScreen";

import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const API = getRideXApiUrl();

const ADMIN_AUTH_TOKEN_KEY = "ridex_admin_auth_token_v1";
const ADMIN_SESSION_KEY = "ridex_admin_session_v1";
const ADMIN_USER_KEY = "ridex_admin_user_v1";
const TEST_MODE = String(process.env.EXPO_PUBLIC_RIDEX_TEST_MODE ?? "false").toLowerCase() === "true";


type Screen = AdminScreen;

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

type AuthResponse = {
  success?: boolean;
  message?: string;
  data?: {
    token?: string;
    session?: unknown;
    userId?: string;
    userType?: string;
    adminId?: string | null;
  };
};

type ApiResponse<T> = {
  success?: boolean;
  message?: string;
  data?: T;
};

const adminFetch = createRideXFetch({ tokenKey: ADMIN_AUTH_TOKEN_KEY, apiUrl: API });

function StatCard({ label, value, tone = "green" }: { label: string; value: number | undefined; tone?: "green" | "blue" | "orange" | "red" }) {
  return (
    <View style={[styles.statCard, tone === "blue" && styles.blueCard, tone === "orange" && styles.orangeCard, tone === "red" && styles.redCard]}>
      <Text style={styles.statValue}>{value ?? 0}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ActionCard({ icon, title, subtitle, onPress }: { icon: keyof typeof ADMIN_MOBILE_ASSETS.icons; title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable style={styles.actionCard} onPress={onPress}>
      <View style={styles.actionIcon}><Image source={ADMIN_MOBILE_ASSETS.icons[icon]} resizeMode="contain" style={styles.actionIconImage} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionSubtitle}>{subtitle}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

export default function AdminApp({ onBackToCustomer }: { onBackToCustomer?: () => void } = {}) {
  const [screen, setScreen] = useState<Screen>("login");
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [adminName, setAdminName] = useState("RideX Admin");
  const [selectedDriver, setSelectedDriver] = useState<any | null>(null);

  const apiStatus = useMemo(() => API.replace(/^https?:\/\//, ""), []);

  useEffect(() => {
    void restoreAdminSession();
  }, []);

  async function restoreAdminSession() {
    const [token, storedUser] = await Promise.all([
      AsyncStorage.getItem(ADMIN_AUTH_TOKEN_KEY),
      AsyncStorage.getItem(ADMIN_USER_KEY),
    ]);
    if (!token) return;
    if (storedUser) {
      try {
        const parsed = JSON.parse(storedUser);
        setAdminName(parsed?.name || "RideX Admin");
      } catch {}
    }
    setScreen("dashboard");
    await loadDashboard();
  }

  async function requestOtp() {
    const normalized = mobile.replace(/\D/g, "").slice(-10);
    setMobile(normalized);
    setMessage("");
    if (!/^\d{10}$/.test(normalized)) {
      setMessage("Enter a valid 10-digit admin mobile number.");
      return;
    }
    setLoading(true);
    try {
      const response = await adminFetch(`${API}/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: normalized, userType: "ADMIN" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.success === false) {
        throw new Error(body?.message || "Unable to send admin OTP");
      }
      setScreen("otp");
      setMessage(TEST_MODE ? "TEST MODE: use OTP 1234." : "OTP sent to your approved admin mobile.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Backend not reachable.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    const normalizedMobile = mobile.replace(/\D/g, "").slice(-10);
    const normalizedOtp = otp.trim();
    if (!/^\d{10}$/.test(normalizedMobile) || !/^\d{4}$/.test(normalizedOtp)) {
      setMessage("Enter the 4-digit OTP received for this admin account.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const response = await adminFetch(`${API}/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: normalizedMobile, otp: normalizedOtp, userType: "ADMIN" }),
      });
      const body = (await response.json().catch(() => ({}))) as AuthResponse;
      if (!response.ok || body?.success === false || !body?.data?.token || !body?.data?.adminId) {
        throw new Error(body?.message || "Admin OTP verification failed");
      }
      await AsyncStorage.multiSet([
        [ADMIN_AUTH_TOKEN_KEY, String(body.data.token)],
        [ADMIN_SESSION_KEY, JSON.stringify(body.data.session ?? null)],
        [ADMIN_USER_KEY, JSON.stringify({ userId: body.data.userId, adminId: body.data.adminId, userType: body.data.userType, mobile: normalizedMobile })],
      ]);
      setScreen("dashboard");
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to verify OTP.");
    } finally {
      setLoading(false);
    }
  }

  async function loadDashboard() {
    setMessage("");
    try {
      const response = await adminFetch(`${API}/admin/dashboard`);
      const body = (await response.json().catch(() => ({}))) as ApiResponse<Dashboard>;
      if (!response.ok || body?.success === false) {
        throw new Error(body?.message || `Dashboard request failed (${response.status})`);
      }
      setDashboard(body.data || null);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unable to load dashboard";
      setMessage(text);
    }
  }

  async function refreshDashboard() {
    setRefreshing(true);
    await loadDashboard();
    setRefreshing(false);
  }

  async function loadSection(path: string, label: string) {
    try {
      const response = await adminFetch(`${API}${path}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.success === false) throw new Error(body?.message || `${label} request failed`);
      const count = Array.isArray(body?.data) ? body.data.length : undefined;
      Alert.alert(label, count !== undefined ? `${count} records loaded from backend.` : "Backend response received successfully.");
    } catch (error) {
      Alert.alert(label, error instanceof Error ? error.message : "Backend request failed.");
    }
  }

  async function logout() {
    try { await adminFetch(`${API}/auth/logout`, { method: "POST" }); } catch {}
    await AsyncStorage.multiRemove([ADMIN_AUTH_TOKEN_KEY, ADMIN_SESSION_KEY, ADMIN_USER_KEY]);
    setDashboard(null);
    setOtp("");
    setScreen("login");
    setMessage("Signed out.");
  }

  if (screen === "drivers") {
    return <DriverManagementScreen
      api={API}
      adminFetch={adminFetch}
      onBack={() => setScreen("dashboard")}
      onOpenKyc={(driver) => {
        setScreen("kyc");
        setSelectedDriver(driver);
      }}
    />;
  }

  if (screen === "kyc") {
    return <KycDetailScreen
      api={API}
      adminFetch={adminFetch}
      driver={selectedDriver}
      onBack={() => setScreen("drivers")}
    />;
  }

  if (screen === "bookings") {
    return <BookingManagementScreen api={API} adminFetch={adminFetch} onBack={() => setScreen("dashboard")} />;
  }

  if (screen === "payments") {
    return <PaymentManagementScreen api={API} adminFetch={adminFetch} onBack={() => setScreen("dashboard")} />;
  }

  if (screen === "support") {
    return <SupportCaseScreen api={API} adminFetch={adminFetch} onBack={() => setScreen("dashboard")} />;
  }

  if (screen === "login") {
    return (
      <SafeAreaView style={styles.page}>
        <ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled">
          <Image source={ADMIN_MOBILE_ASSETS.logo} resizeMode="contain" style={styles.logo} />
          <View style={styles.securityBadge}><Text style={styles.securityText}>ADMIN • SECURE ACCESS</Text></View>
          <Text style={styles.heading}>Admin App Login</Text>
          <Text style={styles.subheading}>Use the approved RideX admin mobile number.</Text>
          <View style={styles.card}>
            <Text style={styles.label}>Admin Mobile Number</Text>
            <View style={styles.phoneBox}>
              <Text style={styles.country}>+91</Text>
              <View style={styles.divider} />
              <TextInput
                style={styles.input}
                placeholder="98765 43210"
                keyboardType="phone-pad"
                maxLength={10}
                value={mobile}
                onChangeText={setMobile}
                placeholderTextColor="#8b96a8"
              />
            </View>
            <Pressable style={styles.primaryButton} onPress={requestOtp} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Send Admin OTP</Text>}
            </Pressable>
            {!!message && <Text style={styles.message}>{message}</Text>}
          </View>
          <Text style={styles.apiText}>Backend: {apiStatus}</Text>
          {onBackToCustomer ? <Pressable onPress={onBackToCustomer}><Text style={styles.backLink}>← Back to Customer App</Text></Pressable> : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === "otp") {
    return (
      <SafeAreaView style={styles.page}>
        <ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled">
          <Image source={ADMIN_MOBILE_ASSETS.logo} resizeMode="contain" style={styles.logo} />
          <Text style={styles.heading}>Verify Admin OTP</Text>
          <Text style={styles.subheading}>Code sent to +91 {mobile}.</Text>
          <View style={styles.card}>
            <Text style={styles.label}>4-Digit OTP</Text>
            <TextInput
              style={styles.otpInput}
              keyboardType="number-pad"
              maxLength={4}
              value={otp}
              onChangeText={setOtp}
              placeholder="1234"
              placeholderTextColor="#8b96a8"
              textAlign="center"
            />
            <Pressable style={styles.primaryButton} onPress={verifyOtp} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Verify & Open Admin</Text>}
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => setScreen("login")} disabled={loading}>
              <Text style={styles.secondaryText}>Change Mobile</Text>
            </Pressable>
            {!!message && <Text style={styles.message}>{message}</Text>}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView
        contentContainerStyle={styles.dashboardScroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshDashboard} />}
      >
        <View style={styles.topBar}>
          <View>
            <Text style={styles.brandSmall}>RIDEX ADMIN</Text>
            <Text style={styles.welcome}>Hello, {adminName}</Text>
          </View>
          <Pressable style={styles.logoutButton} onPress={logout}><Text style={styles.logoutText}>Logout</Text></Pressable>
        </View>

        <View style={styles.connectionCard}>
          <View style={styles.dot} />
          <View style={{ flex: 1 }}>
            <Text style={styles.connectionTitle}>Backend Connected</Text>
            <Text style={styles.connectionSub}>{apiStatus} • Bearer session active</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Platform Overview</Text>
        <View style={styles.grid}>
          <StatCard label="Customers" value={dashboard?.customers} />
          <StatCard label="Drivers" value={dashboard?.drivers} tone="blue" />
          <StatCard label="Active Drivers" value={dashboard?.activeDrivers} tone="green" />
          <StatCard label="Bookings" value={dashboard?.bookings} tone="orange" />
          <StatCard label="Completed" value={dashboard?.completed} tone="blue" />
          <StatCard label="Ongoing" value={dashboard?.ongoing} tone="green" />
          <StatCard label="SOS Open" value={dashboard?.sos} tone="red" />
          <StatCard label="Pending KYC" value={dashboard?.pendingKyc} tone="orange" />
        </View>

        <Text style={styles.sectionTitle}>Admin Operations</Text>
        <ActionCard icon="drivers" title="Driver Management" subtitle="Review drivers, vehicles, GPS and status" onPress={() => setScreen("drivers")} />
        <ActionCard icon="bookings" title="Booking Management" subtitle="Inspect bookings, drivers, vehicles and trip legs" onPress={() => setScreen("bookings")} />
        <ActionCard icon="payments" title="Payment Management" subtitle="Review payment records and refunds" onPress={() => setScreen("payments")} />
        <ActionCard icon="kyc" title="KYC Review" subtitle="Open driver documents and review verification" onPress={() => setScreen("drivers")} />
        <ActionCard icon="support" title="Support Cases" subtitle="Open cases and update case status" onPress={() => setScreen("support")} />
        <ActionCard icon="refresh" title="Safety / SOS" subtitle="Load current safety events" onPress={() => loadSection("/admin/safety/sos", "Safety / SOS")} />
        <ActionCard icon="search" title="Notifications" subtitle="Admin broadcast notification endpoint" onPress={() => Alert.alert("Notifications", "Backend supports POST /admin/notifications/broadcast.")} />

        {!!message && <Text style={styles.message}>{message}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#f4f7fb" },
  authScroll: { flexGrow: 1, justifyContent: "center", padding: 22 },
  dashboardScroll: { padding: 18, paddingBottom: 40 },
  logo: { width: 190, height: 64, alignSelf: "center", marginBottom: 14 },
  securityBadge: { alignSelf: "center", backgroundColor: "#eaf8f0", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginBottom: 20 },
  securityText: { color: "#08783c", fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  heading: { fontSize: 30, fontWeight: "800", color: "#111a33", textAlign: "center" },
  subheading: { fontSize: 15, lineHeight: 22, color: "#63708a", textAlign: "center", marginTop: 8, marginBottom: 20 },
  card: { backgroundColor: "#fff", borderRadius: 18, padding: 18, borderWidth: 1, borderColor: "#e4eaf2", shadowColor: "#182338", shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  label: { fontSize: 13, color: "#55627a", fontWeight: "700", marginBottom: 8 },
  phoneBox: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#d2dbe7", borderRadius: 12, height: 56, paddingHorizontal: 14 },
  country: { fontSize: 16, fontWeight: "700", color: "#111a33" },
  divider: { width: 1, height: 24, backgroundColor: "#d2dbe7", marginHorizontal: 12 },
  input: { flex: 1, fontSize: 17, color: "#111a33" },
  primaryButton: { marginTop: 14, minHeight: 52, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#0aa052" },
  primaryText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  secondaryButton: { marginTop: 10, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: "#d1dae7", alignItems: "center", justifyContent: "center" },
  secondaryText: { color: "#23324d", fontSize: 15, fontWeight: "700" },
  message: { color: "#8a2b2b", fontSize: 13, lineHeight: 19, marginTop: 12, textAlign: "center" },
  apiText: { color: "#8590a5", fontSize: 12, textAlign: "center", marginTop: 18 },
  backLink: { textAlign: "center", color: "#0a9450", fontWeight: "700", marginTop: 18 },
  otpInput: { height: 64, borderWidth: 1, borderColor: "#d2dbe7", borderRadius: 12, fontSize: 28, fontWeight: "800", letterSpacing: 10, color: "#111a33" },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  brandSmall: { fontSize: 12, fontWeight: "900", color: "#0a9450", letterSpacing: 1 },
  welcome: { marginTop: 3, fontSize: 24, fontWeight: "800", color: "#111a33" },
  logoutButton: { borderWidth: 1, borderColor: "#ccd6e4", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: "#fff" },
  logoutText: { color: "#b4232c", fontWeight: "800" },
  connectionCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#eaf8f0", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#ccebd8", marginBottom: 18 },
  dot: { width: 11, height: 11, borderRadius: 8, backgroundColor: "#0aa052", marginRight: 10 },
  connectionTitle: { color: "#08783c", fontWeight: "800" },
  connectionSub: { color: "#4c7a60", fontSize: 12, marginTop: 3 },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: "#111a33", marginBottom: 10, marginTop: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginBottom: 18 },
  statCard: { width: "48.3%", backgroundColor: "#fff", borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#dce7e0", borderLeftWidth: 4, borderLeftColor: "#0aa052" },
  blueCard: { borderLeftColor: "#1777df" },
  orangeCard: { borderLeftColor: "#f3a500" },
  redCard: { borderLeftColor: "#ef2b2d" },
  statValue: { fontSize: 25, fontWeight: "900", color: "#111a33" },
  statLabel: { fontSize: 12, color: "#63708a", marginTop: 3 },
  actionCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#e4eaf2" },
  actionIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: "#eaf8f0", alignItems: "center", justifyContent: "center", marginRight: 12 },
  actionIconText: { fontSize: 21, color: "#0a9450" },
  actionIconImage: { width: 23, height: 23 },
  actionTitle: { fontSize: 15, fontWeight: "800", color: "#111a33" },
  actionSubtitle: { fontSize: 12, color: "#63708a", marginTop: 3 },
  chevron: { fontSize: 26, color: "#8490a3", marginLeft: 8 },
});
