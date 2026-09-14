import "./admin-panel-style.css";

import React, {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  CarFront,
  CheckCircle2,
  ClipboardList,
  Clock3,
  CreditCard,
  FileText,
  Gauge,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  LockKeyhole,
  MapPin,
  Menu,
  MessageSquare,
  Percent,
  Plus,
  RefreshCw,
  Settings,
  ShieldAlert,
  Truck,
  UserCog,
  Users,
  WalletCards,
  X,
} from "lucide-react";

type Screen =
  | "dashboard"
  | "liveOperations"
  | "quickRide"
  | "drivers"
  | "bookings"
  | "customers"
  | "safety"
  | "admins"
  | "roles"
  | "audit"
  | "quickLocations"
  | "setup"
  | "payments"
  | "reports"
  | "pricing"
  | "settings"
  | "support"
  | "notifications"
  | "vehicles"
  | "promotions"
  | "platform";

type ApiResponse<T> = {
  success?: boolean;
  message?: string;
  data?: T;
  error?: string;
  [key: string]: unknown;
};

type TestDataSummary = Record<string, number>;
type TestDataRecords = {
  customers: any[];
  drivers: any[];
  vehicles: any[];
  bookings: any[];
  locations: any[];
  coupons: any[];
  supportCases: any[];
  notifications: any[];
};

type DashboardData = {
  customers: number;
  drivers: number;
  activeDrivers: number;
  bookings: number;
  completed: number;
  ongoing: number;
  cancelled: number;
  sos: number;
  vehicles: number;
  pendingKyc: number;
  pendingAdmins: number;
  openSupport: number;
};

type DriverLocation = {
  id?: string;
  latitude?: number;
  longitude?: number;
  isOnline?: boolean;
  recordedAt?: string;
};

type Vehicle = {
  id?: string;
  vehicleType?: string;
  vehicleNumber?: string;
  capacity?: number;
  goodsEligible?: boolean;
  status?: string;
};

type Driver = {
  id: string;
  userId?: string;
  fullName?: string;
  verificationStatus?: string;
  driverStatus?: string;
  dailyServiceMode?: string;
  rating?: number;
  totalRides?: number;
  createdAt?: string;
  updatedAt?: string;
  vehicles?: Vehicle[];
  location?: DriverLocation | null;
};

type Customer = {
  id: string;
  userId?: string;
  createdAt?: string;
  updatedAt?: string;
  user?: {
    id?: string;
    mobile?: string;
    email?: string | null;
    userType?: string;
    status?: string;
  };
  bookings?: Booking[];
  ratings?: unknown[];
  supportCases?: unknown[];
  sosEvents?: unknown[];
};

type BookingLeg = {
  id: string;
  bookingId?: string;
  legNumber?: number;
  status?: string;
  pickupAddress?: string | null;
  dropAddress?: string | null;
  pickupLatitude?: number | null;
  pickupLongitude?: number | null;
  dropLatitude?: number | null;
  dropLongitude?: number | null;
  assignedDriverId?: string | null;
  vehicleId?: string | null;
  fare?: number | null;
  distanceKm?: number | null;
  durationMinutes?: number | null;
  tripId?: string | null;
  tripPin?: string | null;
  createdAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  connectionPointLabel?: string | null;
  [key: string]: unknown;
};

type Booking = {
  id: string;
  status?: string;
  rideType?: string;
  serviceType?: string;
  pickupAddress?: string | null;
  dropAddress?: string | null;
  pickupLatitude?: number | null;
  pickupLongitude?: number | null;
  dropLatitude?: number | null;
  dropLongitude?: number | null;
  estimatedFare?: number | null;
  finalFare?: number | null;
  totalFare?: number | null;
  customerId?: string;
  assignedDriverId?: string | null;
  vehicleId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  scheduledAt?: string | null;
  customer?: {
    id?: string;
    userId?: string;
  } | null;
  assignedDriver?: Driver | null;
  vehicle?: Vehicle | null;
  legs?: BookingLeg[];
  rideRequests?: unknown[];
  payment?: unknown;
  ratings?: unknown[];
  [key: string]: unknown;
};

type SosEvent = {
  id: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  bookingId?: string | null;
  incident?: {
    id?: string;
    status?: string;
    severity?: string;
    [key: string]: unknown;
  } | null;
  booking?: {
    id?: string;
    status?: string;
    pickupAddress?: string;
    dropAddress?: string;
  } | null;
  [key: string]: unknown;
};

type AdminUser = {
  id: string;
  userId?: string;
  name?: string;
  roleId?: string;
  approvalStatus?: string;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  suspendedAt?: string | null;
  createdAt?: string;
  role?: Role;
  user?: {
    id?: string;
    userType?: string;
    mobile?: string;
    email?: string | null;
    status?: string;
  };
};

type Permission = {
  id: string;
  module: string;
  action: string;
  [key: string]: unknown;
};

type Role = {
  id: string;
  name: string;
  isSystem?: boolean;
  admins?: Array<{
    id: string;
    name?: string;
    approvalStatus?: string;
  }>;
  permissionLinks?: Array<{
    permission: Permission;
  }>;
  [key: string]: unknown;
};

type AuditLog = {
  id: string;
  action?: string;
  module?: string;
  entityType?: string | null;
  entityId?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  createdAt?: string;
  admin?: {
    id?: string;
    name?: string;
    role?: {
      name?: string;
    };
  } | null;
};

type QuickLocation = {
  id: string;
  name?: string;
  category?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  isActive?: boolean;
  [key: string]: unknown;
};

type ToastType = "success" | "error" | "info";

type ToastState = {
  type: ToastType;
  message: string;
};


const RIDEX_ADMIN_THEME = `
  :root {
    --bg: #f4f7fb;
    --surface: #ffffff;
    --surface-soft: #f8fafc;
    --border: #e4eaf2;
    --border-strong: #cfd8e6;
    --text: #111a33;
    --muted: #63708a;
    --primary: #08a64f;
    --primary-dark: #07863f;
    --primary-soft: #e9f9f0;
    --success: #0a9f4b;
    --success-soft: #e9f9f0;
    --warning: #f3a500;
    --warning-soft: #fff7df;
    --danger: #ef2b2d;
    --danger-soft: #fff0f1;
    --info: #1777df;
    --info-soft: #eef6ff;
    --radius: 14px;
    --radius-sm: 10px;
    --shadow-sm: 0 3px 14px rgba(14, 29, 58, 0.06);
    --shadow: 0 14px 36px rgba(14, 29, 58, 0.09);
  }

  body {
    background:
      radial-gradient(circle at 0 0, rgba(10, 159, 75, 0.045), transparent 25rem),
      #f4f7fb;
  }

  .login-shell {
    min-height: 100vh;
    padding: 18px;
    background: linear-gradient(135deg, #0d1728 0%, #12233e 48%, #eef4f8 48%, #f8fbfd 100%);
  }

  .login-card {
    width: min(1180px, 100%);
    min-height: 680px;
    padding: 0;
    border: 1px solid rgba(255,255,255,.8);
    border-radius: 18px;
    background: #fff;
    overflow: hidden;
    display: grid;
    grid-template-columns: 1.1fr .9fr;
    box-shadow: 0 28px 80px rgba(2, 12, 30, .22);
  }

  .login-card::before {
    content: "";
    grid-column: 1;
    grid-row: 1 / -1;
    background:
      linear-gradient(180deg, rgba(7,17,32,.5), rgba(7,17,32,.85)),
      radial-gradient(circle at 55% 28%, rgba(255,255,255,.18), transparent 16rem),
      linear-gradient(145deg, #0e1a2f, #0b1323);
  }

  .login-card > .brand-block,
  .login-card > .login-heading,
  .login-card > .login-form,
  .login-card > .login-note {
    grid-column: 2;
  }

  .login-card > .brand-block {
    grid-row: 1;
    align-self: start;
    padding: 38px 42px 0;
    justify-self: stretch;
  }

  .login-card > .brand-block::before {
    content: "Ride";
    color: #111827;
    font-size: 42px;
    font-weight: 950;
    letter-spacing: -0.07em;
  }

  .login-card > .brand-block::after {
    content: "X";
    margin-left: -7px;
    color: #ef2b2d;
    font-size: 42px;
    font-weight: 950;
    font-style: italic;
    letter-spacing: -0.07em;
  }

  .login-card > .brand-block .brand-mark,
  .login-card > .brand-block > div:last-child {
    display: none;
  }

  .login-heading {
    margin: 38px 42px 20px;
  }

  .login-heading h2 {
    font-size: 31px;
    color: #0f1830;
  }

  .login-heading p:not(.eyebrow) {
    color: #5d6b83;
  }

  .eyebrow {
    color: var(--primary);
  }

  .login-form {
    margin: 0 42px;
    gap: 14px;
  }

  .button.primary {
    color: #fff;
    background: linear-gradient(135deg, #0caf55, #078d43);
    box-shadow: 0 9px 18px rgba(8, 166, 79, .18);
  }

  .button.primary:hover:not(:disabled) {
    box-shadow: 0 12px 24px rgba(8, 166, 79, .26);
  }

  .login-note {
    margin: 20px 42px 42px;
    border-color: #cfeede;
    background: #f1fbf5;
  }

  .sidebar {
    width: 208px;
    flex-basis: 208px;
    padding: 16px 10px;
    background:
      radial-gradient(circle at 10% 0, rgba(31, 87, 142, .20), transparent 16rem),
      linear-gradient(180deg, #091528 0%, #07101d 100%);
  }

  .sidebar-brand {
    padding: 4px 10px 18px;
    border-bottom: 1px solid rgba(255,255,255,.06);
    margin-bottom: 10px;
  }

  .sidebar-brand .brand-mark {
    width: auto;
    height: auto;
    flex-basis: auto;
    padding: 0;
    background: transparent;
    box-shadow: none;
    border-radius: 0;
    color: #fff;
    font-size: 27px;
    letter-spacing: -0.08em;
  }

  .sidebar-brand .brand-mark::after {
    content: "X";
    color: #ef2b2d;
    margin-left: -2px;
    font-style: italic;
  }

  .sidebar-brand strong {
    font-size: 14px;
  }

  .sidebar-brand span {
    color: #91a0bc;
    font-size: 10px;
  }

  .nav-list {
    gap: 3px;
  }

  .nav-item {
    min-height: 37px;
    border-radius: 9px;
    padding: 8px 10px;
    color: #a8b5ca;
    font-size: 11px;
  }

  .nav-item.active {
    background: linear-gradient(90deg, rgba(8,166,79,.95), rgba(8,166,79,.78));
    border-color: rgba(255,255,255,.04);
    box-shadow: none;
  }

  .nav-item:hover {
    background: rgba(255,255,255,.06);
  }

  .main-shell { background: #f7f9fc; }

  .topbar {
    min-height: 64px;
    padding: 10px 22px;
    background: rgba(255,255,255,.97);
  }

  .content {
    padding: 20px 22px 28px;
  }

  .page { width: min(100%, 1500px); }

  .section-header { margin-bottom: 16px; }
  .section-header h2 { font-size: clamp(24px, 2.5vw, 31px); }
  .section-header p { font-size: 12px; }

  .metrics-grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 14px;
  }

  .metric-card {
    padding: 13px;
    gap: 10px;
    border-radius: 12px;
  }

  .metric-icon {
    width: 38px;
    height: 38px;
    flex-basis: 38px;
    border-radius: 10px;
    font-size: 17px;
    background: var(--primary-soft);
  }

  .metric-icon-success { background: #e8f8ef; }
  .metric-icon-info { background: #eaf3ff; }
  .metric-icon-warning { background: #fff2d7; }
  .metric-icon-danger { background: #ffe8e9; }
  .metric-icon-neutral { background: #edf1f7; }

  .metric-content span { font-size: 10px; }
  .metric-content strong { font-size: 19px; }

  .panel {
    padding: 16px;
    border-radius: 12px;
    box-shadow: 0 3px 13px rgba(14, 29, 58, .055);
  }

  .panel-header { margin-bottom: 12px; }
  .panel-header h3 { font-size: 14px; }
  .panel-header p { margin: 4px 0 0; color: var(--muted); font-size: 11px; }

  .button.secondary:hover:not(:disabled) {
    color: var(--primary-dark);
    border-color: #bfe7cf;
    background: #effaf4;
  }

  .table-wrapper { border-radius: 10px; }
  th { background: #f4f7fb; }
  .table-link { color: #0e74d6; }

  .status.success { background: #e8f8ef; color: #078d43; border-color: #c8efd8; }
  .status.warning { background: #fff6df; color: #a56600; border-color: #f5dd9a; }
  .status.danger { background: #ffe8e9; color: #dc2528; border-color: #ffc8ca; }
  .info-box { margin-top: 14px; padding: 13px; border: 1px solid #d8e8f7; border-radius: 10px; background: #f6fbff; color: #46556f; }
  .info-box p { margin: 5px 0 0; font-size: 12px; line-height: 1.55; }


  @media (max-width: 1100px) {
    .metrics-grid { grid-template-columns: repeat(3, minmax(0,1fr)); }
    .login-card { grid-template-columns: 1fr; }
    .login-card::before { display: none; }
    .login-card > .brand-block,
    .login-card > .login-heading,
    .login-card > .login-form,
    .login-card > .login-note { grid-column: 1; }
  }

  @media (max-width: 820px) {
    .sidebar {
      position: fixed;
      left: 0;
      top: 0;
      transform: translateX(-102%);
      transition: transform .2s ease;
    }
    .sidebar.mobile-open { transform: translateX(0); }
    .collapse-button { display: none; }
    .metrics-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
    .content { padding: 14px; }
    .topbar { padding: 10px 14px; }
    .breadcrumb { display: none; }
  }

  @media (max-width: 520px) {
    .metrics-grid { grid-template-columns: 1fr; }
    .login-shell { padding: 10px; }
    .login-card { min-height: 0; }
    .login-card > .brand-block { padding: 26px 22px 0; }
    .login-heading { margin: 28px 22px 16px; }
    .login-form { margin: 0 22px; }
    .login-note { margin: 18px 22px 24px; }
  }
`;

const DEFAULT_API_BASE = (
  (import.meta as any)?.env?.VITE_RIDEX_API_URL ||
  "http://localhost:4000/api/v1"
).replace(/\/+$/, "");

/**
 * RideX integration contract:
 * Admin, Driver and Customer are backend-connected applications.
 * Configure VITE_RIDEX_API_URL for local/staging/production without changing
 * this file. Optional integrations remain placeholders and do not block UI.
 */
const RIDEX_OPTIONAL_CONFIG = {
  mapsUrl: (import.meta as any)?.env?.VITE_RIDEX_MAPS_URL || "",
  paymentsUrl: (import.meta as any)?.env?.VITE_RIDEX_PAYMENTS_URL || "",
  notificationsUrl: (import.meta as any)?.env?.VITE_RIDEX_NOTIFICATIONS_URL || "",
};

const ADMIN_ID_STORAGE_KEY = "ridex_admin_user_id";
const ADMIN_AUTH_TOKEN_STORAGE_KEY = "ridex_admin_auth_token_v1";
const RIDEX_TEST_MODE = String((import.meta as any)?.env?.VITE_RIDEX_TEST_MODE ?? "false").toLowerCase() === "true";
const RIDEX_TEST_ADMIN_USER_ID = String((import.meta as any)?.env?.VITE_RIDEX_TEST_ADMIN_USER_ID ?? "").trim();
const RIDEX_ALLOW_MOCK_DATA = String((import.meta as any)?.env?.VITE_RIDEX_ALLOW_MOCK_DATA ?? "false").toLowerCase() === "true";

const TEST_DASHBOARD: DashboardData = {
  customers: 1248,
  drivers: 128,
  activeDrivers: 36,
  bookings: 486,
  completed: 330,
  ongoing: 18,
  cancelled: 58,
  sos: 2,
  vehicles: 132,
  pendingKyc: 7,
  pendingAdmins: 1,
  openSupport: 6,
};

const TEST_DRIVERS: Driver[] = [
  { id: "driver-test-001", fullName: "Test Passenger Driver", verificationStatus: "APPROVED", driverStatus: "ONLINE", dailyServiceMode: "BOTH", rating: 4.8, totalRides: 128, location: { latitude: 25.5392, longitude: 87.5717, isOnline: true, recordedAt: new Date().toISOString() }, vehicles: [{ id: "veh-test-001", vehicleType: "E_RICKSHAW", vehicleNumber: "BR00TEST01", capacity: 4, goodsEligible: false, status: "ACTIVE" }] },
  { id: "driver-test-002", fullName: "Test Goods Driver", verificationStatus: "APPROVED", driverStatus: "ONLINE", dailyServiceMode: "GOODS", rating: 4.7, totalRides: 92, location: { latitude: 25.5411, longitude: 87.5742, isOnline: true, recordedAt: new Date().toISOString() }, vehicles: [{ id: "veh-test-002", vehicleType: "PICKUP_TRUCK", vehicleNumber: "BR00TEST02", capacity: 1000, goodsEligible: true, status: "ACTIVE" }] },
  { id: "driver-test-003", fullName: "Pending KYC Driver", verificationStatus: "PENDING", driverStatus: "OFFLINE", dailyServiceMode: "PASSENGER", rating: 0, totalRides: 0, vehicles: [] },
];

const TEST_BOOKINGS: Booking[] = [
  { id: "booking-test-001", status: "IN_PROGRESS", rideType: "FULL_RIDE", serviceType: "PASSENGER", pickupAddress: "Katihar Town", dropAddress: "Railway Station", pickupLatitude: 25.5392, pickupLongitude: 87.5717, dropLatitude: 25.548, dropLongitude: 87.579, estimatedFare: 86, finalFare: null, customerId: "customer-test-001", assignedDriverId: "driver-test-001", vehicleId: "veh-test-001", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), assignedDriver: TEST_DRIVERS[0], vehicle: TEST_DRIVERS[0].vehicles?.[0], legs: [] },
  { id: "booking-test-002", status: "DRIVER_ARRIVED", rideType: "SHARED_RIDE", serviceType: "PASSENGER", pickupAddress: "Katihar Market", dropAddress: "College Road", estimatedFare: 40, customerId: "customer-test-002", assignedDriverId: "driver-test-001", vehicleId: "veh-test-001", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), assignedDriver: TEST_DRIVERS[0], vehicle: TEST_DRIVERS[0].vehicles?.[0], legs: [] },
  { id: "booking-test-003", status: "MATCHING", bookingType: "GOODS", rideType: "FULL_RIDE", serviceType: "GOODS", pickupAddress: "Katihar Warehouse", dropAddress: "Purnia Road", estimatedFare: 200, customerId: "customer-test-003", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), legs: [] },
];

const ICONS: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  dashboard: LayoutDashboard, map: MapPin, list: ListChecks, users: Users, driver: CarFront, vehicle: Truck,
  payment: CreditCard, chart: BarChart3, plus: Plus, promo: Percent, support: LifeBuoy, safety: ShieldAlert,
  notifications: Bell, admin: UserCog, roles: LockKeyhole, audit: ClipboardList, settings: Settings, setup: Gauge,
  refresh: RefreshCw, close: X, alert: AlertTriangle, activity: Activity, check: CheckCircle2, wallet: WalletCards,
  file: FileText, clock: Clock3, message: MessageSquare, menu: Menu
};

function AppIcon({ name, size = 18 }: { name: string; size?: number }) {
  const Icon = ICONS[name] ?? Activity;
  return <Icon size={size} strokeWidth={1.9} aria-hidden="true" />;
}

const NAV_ITEMS: Array<{
  id: Screen;
  label: string;
  icon: string;
}> = [
  { id: "dashboard", label: "Dashboard", icon: "⌗" },
  { id: "liveOperations", label: "Live Operations", icon: "map" },
  { id: "quickRide", label: "Quick Ride Create", icon: "plus" },
  { id: "bookings", label: "Rides", icon: "≡" },
  { id: "customers", label: "Users / Customers", icon: "◉" },
  { id: "drivers", label: "Drivers", icon: "◇" },
  { id: "vehicles", label: "Vehicles / E-Rickshaws", icon: "△" },
  { id: "payments", label: "Payments", icon: "▣" },
  { id: "reports", label: "Reports & Analytics", icon: "chart" },
  { id: "pricing", label: "Pricing & Commission", icon: "percent" },
  { id: "quickLocations", label: "Quick Locations", icon: "⌖" },
  { id: "promotions", label: "Promotions", icon: "%" },
  { id: "support", label: "Support & Disputes", icon: "◌" },
  { id: "safety", label: "Safety / SOS", icon: "!" },
  { id: "notifications", label: "Notifications", icon: "•" },
  { id: "admins", label: "Admin Users", icon: "◈" },
  { id: "roles", label: "Roles & Permissions", icon: "◇" },
  { id: "audit", label: "Audit Logs", icon: "☷" },
  { id: "settings", label: "Settings", icon: "○" },
  { id: "setup", label: "Test Setup", icon: "✦" },
  { id: "platform", label: "Test / Live Control", icon: "activity" },
];

const VERIFICATION_STATUSES = [
  "PENDING",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
];

const DRIVER_STATUSES = [
  "OFFLINE",
  "ONLINE",
  "ON_TRIP",
  "SUSPENDED",
];

const ADMIN_ROLES = [
  "SUPER_ADMIN",
  "OPERATIONS",
  "FINANCE",
  "SAFETY",
  "SUPPORT",
  "VERIFICATION_KYC",
];

function getStoredAdminId() {
  try {
    return (
      localStorage.getItem(ADMIN_ID_STORAGE_KEY) ?? ""
    );
  } catch {
    return "";
  }
}

function saveStoredAdminId(value: string) {
  try {
    if (value.trim()) {
      localStorage.setItem(
        ADMIN_ID_STORAGE_KEY,
        value.trim()
      );
    } else {
      localStorage.removeItem(ADMIN_ID_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures.
  }
}


function getStoredAdminToken() {
  try { return localStorage.getItem(ADMIN_AUTH_TOKEN_STORAGE_KEY) ?? ""; } catch { return ""; }
}

function saveStoredAdminToken(value: string) {
  try {
    if (value.trim()) localStorage.setItem(ADMIN_AUTH_TOKEN_STORAGE_KEY, value.trim());
    else localStorage.removeItem(ADMIN_AUTH_TOKEN_STORAGE_KEY);
  } catch {}
}

function formatNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number)
    ? number.toLocaleString("en-IN")
    : "0";
}

function formatMoney(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return "₹0";
  return `₹${number.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value: unknown) {
  if (!value) return "—";

  const date = new Date(String(value));

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function shortId(value: unknown, length = 14) {
  const text = String(value ?? "");
  if (!text) return "—";
  if (text.length <= length) return text;
  return `${text.slice(0, length)}…`;
}

function displayValue(value: unknown) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "—";
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[object]";
    }
  }

  return String(value);
}

function humanize(value: unknown) {
  return String(value ?? "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusClass(value: unknown) {
  const text = String(value ?? "")
    .toLowerCase()
    .replaceAll("_", "-");

  if (
    [
      "approved",
      "completed",
      "online",
      "active",
      "in-progress",
      "driver-assigned",
    ].includes(text)
  ) {
    return "status success";
  }

  if (
    [
      "pending",
      "matching",
      "driver-arriving",
      "driver-arrived",
      "under-review",
      "open",
      "at-risk",
    ].includes(text)
  ) {
    return "status warning";
  }

  if (
    [
      "rejected",
      "cancelled",
      "suspended",
      "failed",
      "closed",
    ].includes(text)
  ) {
    return "status danger";
  }

  return "status neutral";
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value)
    ? (value as T[])
    : [];
}

async function readResponse<T>(
  response: Response
): Promise<ApiResponse<T>> {
  let json: ApiResponse<T> | null = null;

  try {
    json = (await response.json()) as ApiResponse<T>;
  } catch {
    json = null;
  }

  if (!response.ok) {
    throw new Error(
      String(
        json?.message ??
          json?.error ??
          `Request failed (${response.status})`
      )
    );
  }

  return (
    json ?? {
      success: true,
      data: undefined,
    }
  );
}


function Panel({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`.trim()}>
      {(title || subtitle || actions) ? (
        <div className="panel-header">
          <div>
            {title ? <h3>{title}</h3> : null}
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {actions ? <div className="section-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function StatusBadge({ value }: { value: unknown }) {
  return <Badge value={value} />;
}

function ConfirmationModal({
  title,
  description,
  expectedText,
  value,
  setValue,
  onCancel,
  onConfirm,
  loading,
}: {
  title: string;
  description: string;
  expectedText: string;
  value: string;
  setValue: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  loading?: boolean;
}) {
  const matches =
    value.trim().toUpperCase() ===
    expectedText.toUpperCase();

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="modal-header">
          <div>
            <p className="eyebrow">High-risk confirmation</p>
            <h3>{title}</h3>
          </div>
          <button
            className="icon-button"
            onClick={onCancel}
            type="button"
            disabled={loading}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          <p>{description}</p>

          <label className="field-label">
            Type exactly:
          </label>

          <div className="confirmation-token">
            {expectedText}
          </div>

          <input
            className="text-input"
            value={value}
            onChange={(event) =>
              setValue(event.target.value)
            }
            placeholder={expectedText}
            autoFocus
          />
        </div>

        <div className="modal-actions">
          <button
            className="button secondary"
            onClick={onCancel}
            type="button"
            disabled={loading}
          >
            Cancel
          </button>

          <button
            className="button danger-button"
            onClick={onConfirm}
            type="button"
            disabled={!matches || loading}
          >
            {loading ? "Processing…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Drawer({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="drawer-backdrop">
      <aside className="drawer">
        <div className="drawer-header">
          <div>
            <p className="eyebrow">Details</p>
            <h2>{title}</h2>
          </div>

          <button
            className="icon-button"
            onClick={onClose}
            type="button"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="drawer-content">
          {children}
        </div>
      </aside>
    </div>
  );
}

function JsonBlock({
  value,
}: {
  value: unknown;
}) {
  let text = "—";

  try {
    text = JSON.stringify(
      value,
      null,
      2
    );
  } catch {
    text = String(value ?? "—");
  }

  return (
    <pre className="json-block">
      {text}
    </pre>
  );
}

function EmptyState({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">∅</div>
      <h3>{title}</h3>
      <p>{message}</p>
    </div>
  );
}

function LoadingState({
  message = "Loading…",
}: {
  message?: string;
}) {
  return (
    <div className="loading-state">
      <div className="spinner" />
      <span>{message}</span>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error-state">
      <div className="error-icon">!</div>
      <div>
        <strong>Could not load data</strong>
        <p>{message}</p>
      </div>

      {onRetry ? (
        <button
          className="button secondary small"
          onClick={onRetry}
          type="button"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  onRefresh,
  right,
  actions,
}: {
  title: string;
  subtitle?: string;
  onRefresh?: () => void;
  right?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="section-header">
      <div>
        <h2>{title}</h2>
        {subtitle ? (
          <p>{subtitle}</p>
        ) : null}
      </div>

      <div className="section-actions">
        {onRefresh ? (
          <button
            className="button secondary"
            onClick={onRefresh}
            type="button"
          >
            ↻ Refresh
          </button>
        ) : null}

        {right}
        {actions}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
  onClick,
  tone = "primary",
}: {
  label: string;
  value: number | string;
  icon: string;
  onClick?: () => void;
  tone?: "primary" | "success" | "info" | "warning" | "danger" | "neutral";
}) {
  return (
    <button
      type="button"
      className={`metric-card ${
        onClick ? "clickable" : ""
      }`}
      onClick={onClick}
      disabled={!onClick}
    >
      <div className={`metric-icon metric-icon-${tone}`}><AppIcon name={icon} size={20} /></div>
      <div className="metric-content">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </button>
  );
}

function Badge({
  value,
}: {
  value: unknown;
}) {
  return (
    <span className={statusClass(value)}>
      {humanize(value)}
    </span>
  );
}

function PaginationInfo({
  count,
}: {
  count: number;
}) {
  return (
    <div className="table-meta">
      Showing {formatNumber(count)} record
      {count === 1 ? "" : "s"}
    </div>
  );
}

function mockApiResponse<T>(path: string, options?: RequestInit): ApiResponse<T> {
  const method = String(options?.method ?? "GET").toUpperCase();
  const success = <R,>(data: R): ApiResponse<R> => ({ success: true, data });
  if (method !== "GET") return { success: true, message: "TEST MODE: simulated backend action completed." } as ApiResponse<T>;
  if (path === "/admin/dashboard") return success(TEST_DASHBOARD) as ApiResponse<T>;
  if (path.startsWith("/admin/drivers/")) return success(TEST_DRIVERS[0]) as ApiResponse<T>;
  if (path.startsWith("/admin/bookings/")) return success(TEST_BOOKINGS[0]) as ApiResponse<T>;
  if (path.startsWith("/admin/customers/")) return success({ id: "customer-test-001", user: { id: "user-test-001", mobile: "9999999999", status: "ACTIVE", userType: "CUSTOMER" }, bookings: TEST_BOOKINGS } as Customer) as ApiResponse<T>;
  if (path === "/admin/drivers" || path.startsWith("/admin/drivers?")) return success(TEST_DRIVERS) as ApiResponse<T>;
  if (path === "/admin/bookings" || path.startsWith("/admin/bookings?")) return success(TEST_BOOKINGS) as ApiResponse<T>;
  if (path === "/admin/customers") return success([{ id: "customer-test-001", user: { id: "user-test-001", mobile: "9999999999", status: "ACTIVE", userType: "CUSTOMER" }, bookings: TEST_BOOKINGS } as Customer]) as ApiResponse<T>;
  if (path === "/admin/safety/sos") return success([]) as ApiResponse<T>;
  if (path === "/admin/admins") return success([]) as ApiResponse<T>;
  if (path === "/admin/roles") return success([{ id: "role-super-admin", name: "SUPER_ADMIN", isSystem: true, permissionLinks: [] } as Role, { id: "role-ops", name: "OPERATIONS", isSystem: true, permissionLinks: [] } as Role]) as ApiResponse<T>;
  if (path === "/admin/permissions") return success([]) as ApiResponse<T>;
  if (path === "/admin/audit-logs") return success([]) as ApiResponse<T>;
  if (path === "/admin/quick-locations") return success([{ id: "ql-001", name: "Katihar Railway Station", category: "STATION", address: "Katihar, Bihar", latitude: 25.5392, longitude: 87.5717, isActive: true } as QuickLocation]) as ApiResponse<T>;
  return { success: true, data: [] as T };
}

function App() {
  const [
    currentScreen,
    setCurrentScreen,
  ] = useState<Screen>("dashboard");

  const [
    apiBaseUrl,
    setApiBaseUrl,
  ] = useState(DEFAULT_API_BASE);

  const [
    adminUserId,
    setAdminUserId,
  ] = useState(getStoredAdminId() || RIDEX_TEST_ADMIN_USER_ID);

  const [
    connected,
    setConnected,
  ] = useState(Boolean(getStoredAdminToken() || (RIDEX_TEST_MODE && RIDEX_ALLOW_MOCK_DATA && (getStoredAdminId() || RIDEX_TEST_ADMIN_USER_ID))));

  const [
    toast,
    setToast,
  ] = useState<ToastState | null>(null);

  const [adminMobile, setAdminMobile] = useState("");
  const [adminOtp, setAdminOtp] = useState("");
  const [adminAuthLoading, setAdminAuthLoading] = useState(false);
  const [integrationValues, setIntegrationValues] = useState<Record<string, string>>({});
  const [integrationStatus, setIntegrationStatus] = useState<Record<string, { configured: boolean; updatedAt: string | null }>>({});
  const [integrationLoading, setIntegrationLoading] = useState(false);
  const [paymentRows, setPaymentRows] = useState<any[]>([]);
  const [promotionRows, setPromotionRows] = useState<any[]>([]);
  const [supportRows, setSupportRows] = useState<any[]>([]);
  const [notificationAudience, setNotificationAudience] = useState("ALL");
  const [notificationTitle, setNotificationTitle] = useState("");
  const [notificationBody, setNotificationBody] = useState("");
  const [operationLoading, setOperationLoading] = useState(false);


  const [
    selectedDriver,
    setSelectedDriver,
  ] = useState<Driver | null>(null);

  const [
    selectedCustomer,
    setSelectedCustomer,
  ] = useState<Customer | null>(null);

  const [
    selectedBooking,
    setSelectedBooking,
  ] = useState<Booking | null>(null);

  const [
    confirmation,
    setConfirmation,
  ] = useState<{
    expectedText: string;
    title: string;
    description: string;
    action: () => Promise<void>;
  } | null>(null);

  const [
    confirmationValue,
    setConfirmationValue,
  ] = useState("");

  const [
    confirmationLoading,
    setConfirmationLoading,
  ] = useState(false);

  const [
    globalLoading,
    setGlobalLoading,
  ] = useState(false);

  const [
    compactSidebar,
    setCompactSidebar,
  ] = useState(false);

  const [
    mobileNavOpen,
    setMobileNavOpen,
  ] = useState(false);

  const [
    dashboard,
    setDashboard,
  ] = useState<DashboardData | null>(null);

  // Optional providers are intentionally non-blocking.
  void RIDEX_OPTIONAL_CONFIG;

  const [
    dashboardLoading,
    setDashboardLoading,
  ] = useState(false);

  const [
    dashboardError,
    setDashboardError,
  ] = useState("");

  const [
    drivers,
    setDrivers,
  ] = useState<Driver[]>([]);

  const [
    driversLoading,
    setDriversLoading,
  ] = useState(false);

  const [
    driversError,
    setDriversError,
  ] = useState("");

  const [
    driverVerificationFilter,
    setDriverVerificationFilter,
  ] = useState("");

  const [
    driverStatusFilter,
    setDriverStatusFilter,
  ] = useState("");

  const [
    bookings,
    setBookings,
  ] = useState<Booking[]>([]);

  const [
    bookingsLoading,
    setBookingsLoading,
  ] = useState(false);

  const [
    bookingsError,
    setBookingsError,
  ] = useState("");

  const [
    bookingStatusFilter,
    setBookingStatusFilter,
  ] = useState("");

  const [
    customers,
    setCustomers,
  ] = useState<Customer[]>([]);

  const [
    customersLoading,
    setCustomersLoading,
  ] = useState(false);

  const [
    customersError,
    setCustomersError,
  ] = useState("");

  const [
    sosEvents,
    setSosEvents,
  ] = useState<SosEvent[]>([]);

  const [
    safetyLoading,
    setSafetyLoading,
  ] = useState(false);

  const [
    safetyError,
    setSafetyError,
  ] = useState("");

  const [
    adminUsers,
    setAdminUsers,
  ] = useState<AdminUser[]>([]);

  const [
    adminsLoading,
    setAdminsLoading,
  ] = useState(false);

  const [
    adminsError,
    setAdminsError,
  ] = useState("");

  const [
    roles,
    setRoles,
  ] = useState<Role[]>([]);

  const [
    permissions,
    setPermissions,
  ] = useState<Permission[]>([]);

  const [
    rolesLoading,
    setRolesLoading,
  ] = useState(false);

  const [
    rolesError,
    setRolesError,
  ] = useState("");

  const [
    auditLogs,
    setAuditLogs,
  ] = useState<AuditLog[]>([]);

  const [
    auditLoading,
    setAuditLoading,
  ] = useState(false);

  const [
    auditError,
    setAuditError,
  ] = useState("");

  const [
    auditModuleFilter,
    setAuditModuleFilter,
  ] = useState("");

  const [
    auditEntityFilter,
    setAuditEntityFilter,
  ] = useState("");

  const [
    auditEntityIdFilter,
    setAuditEntityIdFilter,
  ] = useState("");

  const [
    quickLocations,
    setQuickLocations,
  ] = useState<QuickLocation[]>([]);

  const [
    quickLocationsLoading,
    setQuickLocationsLoading,
  ] = useState(false);

  const [
    quickLocationsError,
    setQuickLocationsError,
  ] = useState("");

  const [
    selectedRoleId,
    setSelectedRoleId,
  ] = useState("");

  const [
    selectedPermissionIds,
    setSelectedPermissionIds,
  ] = useState<string[]>([]);

  const [
    newAdminForm,
    setNewAdminForm,
  ] = useState({
    name: "",
    mobile: "",
    email: "",
    role: "OPERATIONS",
  });

  const [
    createAdminLoading,
    setCreateAdminLoading,
  ] = useState(false);

  const [
    setupLoading,
    setSetupLoading,
  ] = useState(false);

  const [
    testDataSummary,
    setTestDataSummary,
  ] = useState<TestDataSummary | null>(null);

  const [
    testDataRecords,
    setTestDataRecords,
  ] = useState<TestDataRecords | null>(null);

  const [testDataLoading, setTestDataLoading] = useState(false);
  const [platformState, setPlatformState] = useState<any | null>(null);
  const [platformLoading, setPlatformLoading] = useState(false);
  const [testerMobile, setTesterMobile] = useState("");
  const [testerLabel, setTesterLabel] = useState("");
  const [releaseVersion, setReleaseVersion] = useState("5.6.0");
  const [releaseLabel, setReleaseLabel] = useState("RideX 5.5 release");
  const [pricingRules, setPricingRules] = useState<any[]>([]);
  const [pricingDraft, setPricingDraft] = useState({name:"",serviceType:"PASSENGER",bookingType:"RIDE",rideType:"FULL_RIDE",vehicleType:"E_RICKSHAW",baseFare:"0",perKm:"0",perMinute:"0",minFare:"0",maxFare:"0",multiplier:"1",priority:"0"});

  const [
    serverMessage,
    setServerMessage,
  ] = useState("");

  const effectiveApiBase = useMemo(
    () =>
      apiBaseUrl
        .trim()
        .replace(/\/+$/, ""),
    [apiBaseUrl]
  );

  const authHeaders = useMemo(() => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = getStoredAdminToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (RIDEX_TEST_MODE && adminUserId.trim()) headers["x-admin-user-id"] = adminUserId.trim();
    return headers;
  }, [adminUserId]);

  const showToast = useCallback(
    (
      type: ToastType,
      message: string
    ) => {
      setToast({
        type,
        message,
      });

      window.setTimeout(() => {
        setToast(null);
      }, 4500);
    },
    []
  );

  const apiRequest = useCallback(
    async <T,>(
      path: string,
      options?: RequestInit
    ) => {
      try {
        const response = await fetch(
          `${effectiveApiBase}${path}`,
          {
            ...options,
            headers: {
              ...authHeaders,
              ...(options?.headers ?? {}),
            },
          }
        );
        return await readResponse<T>(response);
      } catch (error) {
        if (path.startsWith("/admin/test-data")) throw error;
        if (!RIDEX_TEST_MODE || !RIDEX_ALLOW_MOCK_DATA) throw error;
        return mockApiResponse<T>(path, options);
      }
    },
    [effectiveApiBase, authHeaders]
  );

  const loadPlatformState = useCallback(async () => {
    setPlatformLoading(true);
    try {
      const response = await apiRequest<any>("/admin/platform/state");
      setPlatformState(response);
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to load platform state");
    } finally { setPlatformLoading(false); }
  }, [apiRequest, showToast]);

  const approveTester = useCallback(async () => {
    if (!/^\d{10}$/.test(testerMobile.replace(/\D/g, ""))) { showToast("error", "Enter a valid 10-digit mobile"); return; }
    try {
      await apiRequest("/admin/platform/testers", { method: "POST", body: JSON.stringify({ mobile: testerMobile, label: testerLabel }) });
      setTesterMobile(""); setTesterLabel(""); await loadPlatformState(); showToast("success", "TEST mobile approved");
    } catch (error) { showToast("error", error instanceof Error ? error.message : "Unable to approve tester"); }
  }, [apiRequest, testerMobile, testerLabel, loadPlatformState, showToast]);

  const createRelease = useCallback(async () => {
    try {
      await apiRequest("/admin/platform/releases", { method: "POST", body: JSON.stringify({ version: releaseVersion, sourceLabel: releaseLabel }) });
      await loadPlatformState(); showToast("success", "Release created in TEST");
    } catch (error) { showToast("error", error instanceof Error ? error.message : "Unable to create release"); }
  }, [apiRequest, releaseVersion, releaseLabel, loadPlatformState, showToast]);

  const promoteRelease = useCallback(async (id: string) => {
    if (!window.confirm("Promote this APPROVED release to LIVE?")) return;
    try {
      await apiRequest(`/admin/platform/releases/${id}/promote`, { method: "POST", body: JSON.stringify({ confirmation: "PROMOTE TO LIVE" }) });
      await loadPlatformState(); showToast("success", "Approved release promoted to LIVE");
    } catch (error) { showToast("error", error instanceof Error ? error.message : "Unable to promote release"); }
  }, [apiRequest, loadPlatformState, showToast]);

  const renderPlatform = () => {
    const control = platformState?.control;
    const releases = Array.isArray(platformState?.releases) ? platformState.releases : [];
    const testers = Array.isArray(platformState?.testers) ? platformState.testers : [];
    return (
      <div>
        <PageTitle title="Test / Live Control" subtitle="Super Admin only: verify in TEST, then deliberately promote an approved version to LIVE." />
        <div className="content-grid two">
          <Panel title="Environment" subtitle="TEST data never becomes production data">
            <div className="metric-card"><strong>{control?.activeEnvironment || "TEST"}</strong><span>Active control state</span></div>
            <div className="info-box" style={{marginTop:12}}><strong>Runtime</strong><p>{platformState?.runtimeEnvironment || "Unknown"} · Current version {control?.currentVersion || "5.6.0"}</p></div>
            <div style={{display:"flex",gap:8,marginTop:12}}>
              <button className="button secondary" onClick={() => apiRequest("/admin/platform/environment", {method:"PUT",body:JSON.stringify({environment:"TEST"})}).then(loadPlatformState)}>TEST</button>
              <span className="status warning">LIVE only through an APPROVED release below</span>
            </div>
          </Panel>
          <Panel title="Approved Testers" subtitle="Super Admin approved mobile numbers">
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:8}}>
              <input className="text-input" value={testerMobile} onChange={e=>setTesterMobile(e.target.value)} placeholder="10-digit mobile" />
              <input className="text-input" value={testerLabel} onChange={e=>setTesterLabel(e.target.value)} placeholder="Tester label" />
              <button className="button primary" onClick={()=>void approveTester()}>Approve</button>
            </div>
            <div style={{marginTop:12}}>{testers.map((t:any)=><div key={t.id} className="table-row"><span>{t.mobile}</span><span>{t.label || "TESTER"}</span><span>{t.active ? "ACTIVE" : "REVOKED"}</span></div>)}</div>
          </Panel>
        </div>
        <Panel title="Project Releases" subtitle="TEST → prove → approve → LIVE">
          <div style={{display:"grid",gridTemplateColumns:"160px 1fr auto",gap:8,marginBottom:12}}>
            <input className="text-input" value={releaseVersion} onChange={e=>setReleaseVersion(e.target.value)} placeholder="5.6.0" />
            <input className="text-input" value={releaseLabel} onChange={e=>setReleaseLabel(e.target.value)} placeholder="Source/version label" />
            <button className="button primary" onClick={()=>void createRelease()}>Create TEST Release</button>
          </div>
          {releases.map((r:any)=><div key={r.id} className="table-row"><span><strong>{r.version}</strong> · {r.environment}</span><span>{r.status}</span><span>{r.status === "APPROVED" ? <button className="button primary small" onClick={()=>void promoteRelease(r.id)}>LIVE</button> : null}</span></div>)}
        </Panel>
        <div className="info-box"><strong>Deployment safety</strong><p>Only APPROVED releases can be promoted. All environment/deployment/tester actions are audited by the backend.</p></div>
      </div>
    );
  };

  const loadIntegrationStatus = useCallback(async () => {
    setIntegrationLoading(true);
    try {
      const response = await apiRequest<Array<{ key: string; configured: boolean; updatedAt: string | null }>>("/admin/configuration/status");
      const next: Record<string, { configured: boolean; updatedAt: string | null }> = {};
      (response.data ?? []).forEach((item) => { next[item.key] = { configured: Boolean(item.configured), updatedAt: item.updatedAt ?? null }; });
      setIntegrationStatus(next);
    } catch (error) { showToast("error", error instanceof Error ? error.message : "Unable to load integration status"); }
    finally { setIntegrationLoading(false); }
  }, [apiRequest]);

  const saveIntegrationValue = useCallback(async (key: string) => {
    const value = String(integrationValues[key] ?? "").trim();
    if (!value) { showToast("error", `${key} value is required`); return; }
    try {
      await apiRequest(`/admin/configuration/${encodeURIComponent(key)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value }) });
      setIntegrationValues((current) => ({ ...current, [key]: "" }));
      showToast("success", `${key} updated securely`);
      void loadIntegrationStatus();
    } catch (error) { showToast("error", error instanceof Error ? error.message : `Unable to update ${key}`); }
  }, [apiRequest, integrationValues, loadIntegrationStatus]);

  const loadOperationsData = useCallback(async () => {
    setOperationLoading(true);
    try {
      const [payments, promotions, support] = await Promise.all([
        apiRequest<any[]>("/admin/payments"),
        apiRequest<any[]>("/admin/promotions"),
        apiRequest<any[]>("/admin/support/cases"),
      ]);
      setPaymentRows(Array.isArray(payments.data) ? payments.data : []);
      setPromotionRows(Array.isArray(promotions.data) ? promotions.data : []);
      setSupportRows(Array.isArray(support.data) ? support.data : []);
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to load operations data");
    } finally {
      setOperationLoading(false);
    }
  }, [apiRequest, showToast]);

  const createPromotion = useCallback(async () => {
    const code = window.prompt("Promotion code (e.g. WELCOME50)");
    if (!code) return;
    const value = Number(window.prompt("Discount value"));
    if (!Number.isFinite(value) || value <= 0) return showToast("error", "Enter a valid discount value");
    const from = new Date();
    const until = new Date(from.getTime() + 30 * 86400000);
    try {
      await apiRequest("/admin/promotions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, discountType: "FIXED", discountValue: value, validFrom: from.toISOString(), validUntil: until.toISOString(), rideScope: "ALL" }) });
      showToast("success", "Promotion created");
      await loadOperationsData();
    } catch (error) { showToast("error", error instanceof Error ? error.message : "Unable to create promotion"); }
  }, [apiRequest, loadOperationsData, showToast]);

  const sendBroadcast = useCallback(async () => {
    if (!notificationTitle.trim() || !notificationBody.trim()) return showToast("error", "Title and message are required");
    try {
      await apiRequest("/admin/notifications/broadcast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audience: notificationAudience, title: notificationTitle.trim(), body: notificationBody.trim() }) });
      showToast("success", "Notification broadcast sent");
      setNotificationTitle(""); setNotificationBody("");
    } catch (error) { showToast("error", error instanceof Error ? error.message : "Unable to send notification"); }
  }, [apiRequest, notificationAudience, notificationTitle, notificationBody, showToast]);

  const loadTestData = useCallback(async () => {
    if (!RIDEX_TEST_MODE) return;
    setTestDataLoading(true);
    try {
      const [summary, records] = await Promise.all([
        apiRequest<TestDataSummary>("/admin/test-data/summary"),
        apiRequest<TestDataRecords>("/admin/test-data/records"),
      ]);
      setTestDataSummary(summary.data ?? null);
      setTestDataRecords(records.data ?? null);
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to load test data");
    } finally {
      setTestDataLoading(false);
    }
  }, [apiRequest, showToast]);

  const seedAllTestData = useCallback(async () => {
    const confirmationText = window.prompt('Type: SEED RIDEX V3.5 TEST DATA');
    if (confirmationText !== "SEED RIDEX V3.5 TEST DATA") return;
    setTestDataLoading(true);
    try {
      await apiRequest("/admin/test-data/seed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: "SEED RIDEX V3.5 TEST DATA" }) });
      showToast("success", "RideX v3.5 comprehensive test data seeded");
      await loadTestData();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to seed test data");
    } finally {
      setTestDataLoading(false);
    }
  }, [apiRequest, loadTestData, showToast]);

  const deleteAllTestData = useCallback(async () => {
    const confirmationText = window.prompt('Type: DELETE RIDEX V3.5 TEST DATA');
    if (confirmationText !== "DELETE RIDEX V3.5 TEST DATA") return;
    setTestDataLoading(true);
    try {
      await apiRequest("/admin/test-data", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: "DELETE RIDEX V3.5 TEST DATA" }) });
      showToast("success", "RideX v3.5 test data deleted");
      await loadTestData();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to delete test data");
    } finally {
      setTestDataLoading(false);
    }
  }, [apiRequest, loadTestData, showToast]);

  const loadDashboard =
    useCallback(async () => {
      setDashboardLoading(true);
      setDashboardError("");

      try {
        const response =
          await apiRequest<DashboardData>(
            "/admin/dashboard"
          );

        setDashboard(
          response.data ?? null
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        setDashboardError(message);
      } finally {
        setDashboardLoading(false);
      }
    }, [apiRequest]);

  const loadDrivers = useCallback(
    async () => {
      setDriversLoading(true);
      setDriversError("");

      try {
        const query = new URLSearchParams();

        if (
          driverVerificationFilter
            .trim()
        ) {
          query.set(
            "verificationStatus",
            driverVerificationFilter
          );
        }

        if (driverStatusFilter.trim()) {
          query.set(
            "driverStatus",
            driverStatusFilter
          );
        }

        const suffix = query.toString()
          ? `?${query.toString()}`
          : "";

        const response =
          await apiRequest<Driver[]>(
            `/admin/drivers${suffix}`
          );

        setDrivers(
          safeArray<Driver>(
            response.data
          )
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        setDriversError(message);
      } finally {
        setDriversLoading(false);
      }
    },
    [
      apiRequest,
      driverVerificationFilter,
      driverStatusFilter,
    ]
  );

  const loadBookings =
    useCallback(async () => {
      setBookingsLoading(true);
      setBookingsError("");

      try {
        const query = new URLSearchParams();

        if (bookingStatusFilter.trim()) {
          query.set(
            "status",
            bookingStatusFilter
          );
        }

        const suffix = query.toString()
          ? `?${query.toString()}`
          : "";

        const response =
          await apiRequest<Booking[]>(
            `/admin/bookings${suffix}`
          );

        setBookings(
          safeArray<Booking>(
            response.data
          )
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        setBookingsError(message);
      } finally {
        setBookingsLoading(false);
      }
    }, [
      apiRequest,
      bookingStatusFilter,
    ]);

  const loadCustomers =
    useCallback(async () => {
      setCustomersLoading(true);
      setCustomersError("");

      try {
        const response =
          await apiRequest<Customer[]>(
            "/admin/customers"
          );

        setCustomers(
          safeArray<Customer>(
            response.data
          )
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        setCustomersError(message);
      } finally {
        setCustomersLoading(false);
      }
    }, [apiRequest]);

  const loadSafety = useCallback(
    async () => {
      setSafetyLoading(true);
      setSafetyError("");

      try {
        const response =
          await apiRequest<SosEvent[]>(
            "/admin/safety/sos"
          );

        setSosEvents(
          safeArray<SosEvent>(
            response.data
          )
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        setSafetyError(message);
      } finally {
        setSafetyLoading(false);
      }
    },
    [apiRequest]
  );

  const loadAdmins = useCallback(
    async () => {
      setAdminsLoading(true);
      setAdminsError("");

      try {
        const response =
          await apiRequest<AdminUser[]>(
            "/admin/admins"
          );

        setAdminUsers(
          safeArray<AdminUser>(
            response.data
          )
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        setAdminsError(message);
      } finally {
        setAdminsLoading(false);
      }
    },
    [apiRequest]
  );

  const loadRoles =
    useCallback(async () => {
      setRolesLoading(true);
      setRolesError("");

      try {
        const [rolesResponse, permissionsResponse] =
          await Promise.all([
            apiRequest<Role[]>(
              "/admin/roles"
            ),
            apiRequest<Permission[]>(
              "/admin/permissions"
            ),
          ]);

        const nextRoles =
          safeArray<Role>(
            rolesResponse.data
          );

        const nextPermissions =
          safeArray<Permission>(
            permissionsResponse.data
          );

        setRoles(nextRoles);
        setPermissions(
          nextPermissions
        );

        if (
          nextRoles.length > 0 &&
          !nextRoles.some(
            (role) =>
              role.id ===
              selectedRoleId
          )
        ) {
          setSelectedRoleId(
            nextRoles[0].id
          );
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        setRolesError(message);
      } finally {
        setRolesLoading(false);
      }
    }, [
      apiRequest,
      selectedRoleId,
    ]);

  const loadAuditLogs =
    useCallback(async () => {
      setAuditLoading(true);
      setAuditError("");

      try {
        const query = new URLSearchParams();

        if (auditModuleFilter.trim()) {
          query.set(
            "module",
            auditModuleFilter.trim()
          );
        }

        if (auditEntityFilter.trim()) {
          query.set(
            "entityType",
            auditEntityFilter.trim()
          );
        }

        if (
          auditEntityIdFilter.trim()
        ) {
          query.set(
            "entityId",
            auditEntityIdFilter.trim()
          );
        }

        const suffix = query.toString()
          ? `?${query.toString()}`
          : "";

        const response =
          await apiRequest<AuditLog[]>(
            `/admin/audit-logs${suffix}`
          );

        setAuditLogs(
          safeArray<AuditLog>(
            response.data
          )
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        setAuditError(message);
      } finally {
        setAuditLoading(false);
      }
    }, [
      apiRequest,
      auditModuleFilter,
      auditEntityFilter,
      auditEntityIdFilter,
    ]);

  const loadQuickLocations =
    useCallback(async () => {
      setQuickLocationsLoading(true);
      setQuickLocationsError("");

      try {
        const response =
          await apiRequest<
            QuickLocation[]
          >(
            "/admin/quick-locations"
          );

        setQuickLocations(
          safeArray<QuickLocation>(
            response.data
          )
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        setQuickLocationsError(message);
      } finally {
        setQuickLocationsLoading(
          false
        );
      }
    }, [apiRequest]);

  const loadDriverDetails =
    useCallback(
      async (
        driverId: string
      ) => {
        try {
          const response =
            await apiRequest<Driver>(
              `/admin/drivers/${encodeURIComponent(
                driverId
              )}`
            );

          setSelectedDriver(
            response.data ?? null
          );
        } catch (error) {
          showToast(
            "error",
            error instanceof Error
              ? error.message
              : String(error)
          );
        }
      },
      [apiRequest, showToast]
    );

  const loadBookingDetails =
    useCallback(
      async (
        bookingId: string
      ) => {
        try {
          const response =
            await apiRequest<Booking>(
              `/admin/bookings/${encodeURIComponent(
                bookingId
              )}`
            );

          setSelectedBooking(
            response.data ?? null
          );
        } catch (error) {
          showToast(
            "error",
            error instanceof Error
              ? error.message
              : String(error)
          );
        }
      },
      [apiRequest, showToast]
    );

  const loadCustomerDetails =
    useCallback(
      async (
        customerId: string
      ) => {
        try {
          const response =
            await apiRequest<Customer>(
              `/admin/customers/${encodeURIComponent(
                customerId
              )}`
            );

          setSelectedCustomer(
            response.data ?? null
          );
        } catch (error) {
          showToast(
            "error",
            error instanceof Error
              ? error.message
              : String(error)
          );
        }
      },
      [apiRequest, showToast]
    );

  const runInitialLoad =
    useCallback(async () => {
      setGlobalLoading(true);

      try {
        await Promise.all([
          loadDashboard(),
          loadDrivers(),
          loadBookings(),
          loadCustomers(),
          loadSafety(),
          loadAdmins(),
          loadRoles(),
          loadAuditLogs(),
          loadQuickLocations(),
        ]);
      } finally {
        setGlobalLoading(false);
      }
    }, [
      loadDashboard,
      loadDrivers,
      loadBookings,
      loadCustomers,
      loadSafety,
      loadAdmins,
      loadRoles,
      loadAuditLogs,
      loadQuickLocations,
    ]);

  useEffect(() => {
    if (!connected) return;

    void runInitialLoad();
  }, [connected, runInitialLoad]);

  useEffect(() => {
    if (!connected) return;

    const refreshLiveData = () => {
      void loadDashboard();
      if (
        currentScreen === "liveOperations" ||
        currentScreen === "bookings" ||
        currentScreen === "drivers" ||
        currentScreen === "safety"
      ) {
        void loadBookings();
        void loadDrivers();
        void loadSafety();
      }
    };

    const timer = window.setInterval(refreshLiveData, 5000);
    return () => window.clearInterval(timer);
  }, [
    connected,
    currentScreen,
    loadDashboard,
    loadBookings,
    loadDrivers,
    loadSafety,
  ]);

  useEffect(() => {
    if (connected && currentScreen === "settings") void loadIntegrationStatus();
  }, [connected, currentScreen, loadIntegrationStatus]);

  useEffect(() => {
    if (connected && currentScreen === "setup" && RIDEX_TEST_MODE) void loadTestData();
    if (connected && currentScreen === "platform") void loadPlatformState();
  }, [connected, currentScreen, loadTestData, loadPlatformState]);

  useEffect(() => {
    if (connected && ["payments", "promotions", "support"].includes(currentScreen)) void loadOperationsData();
  }, [connected, currentScreen, loadOperationsData]);

  useEffect(() => {
    const selectedRole =
      roles.find(
        (role) =>
          role.id === selectedRoleId
      );

    setSelectedPermissionIds(
      safeArray<{
        permission: Permission;
      }>(
        selectedRole?.permissionLinks
      )
        .map(
          (link) => link.permission?.id
        )
        .filter(Boolean) as string[]
    );
  }, [roles, selectedRoleId]);

  const navigate = (
    screen: Screen
  ) => {
    setCurrentScreen(screen);
    setMobileNavOpen(false);
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const sendAdminOtp = async () => {
    const mobile = adminMobile.replace(/\D/g, "").slice(-10);
    if (!/^\d{10}$/.test(mobile)) { showToast("error", "Enter a valid 10-digit admin mobile number."); return; }
    setAdminAuthLoading(true);
    try {
      const response = await fetch(`${effectiveApiBase}/auth/send-otp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mobile, userType: "ADMIN" }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) throw new Error(data.message || "Unable to send admin OTP");
      showToast("success", RIDEX_TEST_MODE ? "OTP sent. Test OTP: 1234" : "OTP sent successfully.");
    } catch (error) { showToast("error", error instanceof Error ? error.message : "Unable to send admin OTP"); }
    finally { setAdminAuthLoading(false); }
  };

  const verifyAdminOtp = async () => {
    const mobile = adminMobile.replace(/\D/g, "").slice(-10);
    if (!/^\d{10}$/.test(mobile) || adminOtp.length !== 4) { showToast("error", "Enter admin mobile and 4-digit OTP."); return; }
    setAdminAuthLoading(true);
    try {
      const response = await fetch(`${effectiveApiBase}/auth/verify-otp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mobile, otp: adminOtp, userType: "ADMIN" }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) throw new Error(data.message || "Invalid admin OTP");
      const token = String(data.data?.token || "").trim();
      const userId = String(data.data?.userId || "").trim();
      if (!token || !userId) throw new Error("Admin session was not returned by backend");
      saveStoredAdminToken(token); saveStoredAdminId(userId); setAdminUserId(userId); setConnected(true); setAdminOtp("");
      showToast("success", "Admin session established.");
    } catch (error) { showToast("error", error instanceof Error ? error.message : "Admin login failed"); }
    finally { setAdminAuthLoading(false); }
  };

  const handleConnect = (
    event: FormEvent
  ) => {
    event.preventDefault();

    const trimmedId =
      adminUserId.trim();

    if (!trimmedId) {
      showToast(
        "error",
        "Admin User ID required."
      );
      return;
    }

    if (!effectiveApiBase) {
      showToast(
        "error",
        "API Base URL required."
      );
      return;
    }

    saveStoredAdminId(trimmedId);
    setConnected(true);

    showToast(
      "success",
      "Admin identity saved. Loading dashboard…"
    );
  };

  const handleDisconnect = () => {
    saveStoredAdminId("");
    saveStoredAdminToken("");
    setAdminUserId("");
    setConnected(false);
    setDashboard(null);
    setSelectedDriver(null);
    setSelectedBooking(null);
    setSelectedCustomer(null);
    showToast(
      "info",
      "Admin session disconnected."
    );
  };

  const requestConfirmation = (
    title: string,
    description: string,
    expectedText: string,
    action: () => Promise<void>
  ) => {
    setConfirmation({
      title,
      description,
      expectedText,
      action,
    });
    setConfirmationValue("");
  };

  const executeConfirmation =
    async () => {
      if (!confirmation) return;

      if (
        confirmationValue
          .trim()
          .toUpperCase() !==
        confirmation.expectedText
          .toUpperCase()
      ) {
        showToast(
          "error",
          `Please type "${confirmation.expectedText}".`
        );
        return;
      }

      setConfirmationLoading(true);

      try {
        await confirmation.action();

        setConfirmation(null);
        setConfirmationValue("");
      } catch (error) {
        showToast(
          "error",
          error instanceof Error
            ? error.message
            : String(error)
        );
      } finally {
        setConfirmationLoading(false);
      }
    };

  const updateDriverVerification =
    async (
      driver: Driver,
      verificationStatus: string
    ) => {
      try {
        const response =
          await apiRequest<Driver>(
            `/admin/drivers/${encodeURIComponent(
              driver.id
            )}/verification`,
            {
              method: "PATCH",
              body: JSON.stringify({
                verificationStatus,
              }),
            }
          );

        showToast(
          "success",
          response.message ??
            "Driver verification updated."
        );

        await loadDrivers();

        if (
          selectedDriver?.id ===
          driver.id
        ) {
          setSelectedDriver(
            response.data ?? null
          );
        }

        await loadDashboard();
      } catch (error) {
        showToast(
          "error",
          error instanceof Error
            ? error.message
            : String(error)
        );
      }
    };

  const updateDriverStatus =
    async (
      driver: Driver,
      status: string
    ) => {
      const perform = async () => {
        const response =
          await apiRequest<Driver>(
            `/admin/drivers/${encodeURIComponent(
              driver.id
            )}/status`,
            {
              method: "PATCH",
              body: JSON.stringify({
                status,
                ...(status === "SUSPENDED"
                  ? {
                      confirmation:
                        "SUSPEND DRIVER",
                    }
                  : {}),
              }),
            }
          );

        showToast(
          "success",
          response.message ??
            "Driver status updated."
        );

        await loadDrivers();
        await loadDashboard();

        if (
          selectedDriver?.id ===
          driver.id
        ) {
          setSelectedDriver(
            response.data ?? null
          );
        }
      };

      if (status === "SUSPENDED") {
        requestConfirmation(
          "Suspend Driver",
          `This will suspend ${driver.fullName ?? driver.id}.`,
          "SUSPEND DRIVER",
          perform
        );
        return;
      }

      try {
        await perform();
      } catch (error) {
        showToast(
          "error",
          error instanceof Error
            ? error.message
            : String(error)
        );
      }
    };

  const createAdmin = async (
    event: FormEvent
  ) => {
    event.preventDefault();

    if (
      !newAdminForm.name.trim() ||
      !newAdminForm.mobile.trim() ||
      !newAdminForm.role.trim()
    ) {
      showToast(
        "error",
        "Name, mobile and role are required."
      );
      return;
    }

    const perform = async () => {
      setCreateAdminLoading(true);

      try {
        const response =
          await apiRequest<AdminUser>(
            "/admin/admins",
            {
              method: "POST",
              body: JSON.stringify({
                name:
                  newAdminForm.name.trim(),
                mobile:
                  newAdminForm.mobile.trim(),
                email:
                  newAdminForm.email.trim() ||
                  null,
                role:
                  newAdminForm.role
                    .trim()
                    .toUpperCase(),
                confirmation:
                  "CREATE ADMIN",
              }),
            }
          );

        showToast(
          "success",
          response.message ??
            "Admin created."
        );

        setNewAdminForm({
          name: "",
          mobile: "",
          email: "",
          role: "OPERATIONS",
        });

        await loadAdmins();
        await loadDashboard();
      } finally {
        setCreateAdminLoading(false);
      }
    };

    requestConfirmation(
      "Create Admin User",
      `Create "${newAdminForm.name}" with role ${newAdminForm.role}? The new admin will be placed in Pending Approval.`,
      "CREATE ADMIN",
      perform
    );
  };

  const approveAdmin = (
    admin: AdminUser
  ) => {
    const perform = async () => {
      const response =
        await apiRequest<AdminUser>(
          `/admin/admins/${encodeURIComponent(
            admin.id
          )}/approve`,
          {
            method: "PATCH",
            body: JSON.stringify({
              confirmation:
                "APPROVE ADMIN",
            }),
          }
        );

      showToast(
        "success",
        response.message ??
          "Admin approved."
      );

      await loadAdmins();
      await loadDashboard();
    };

    requestConfirmation(
      "Approve Admin Access",
      `Approve admin "${admin.name ?? admin.id}"? Only a Super Admin can perform this action.`,
      "APPROVE ADMIN",
      perform
    );
  };

  const rejectAdmin = (
    admin: AdminUser
  ) => {
    const perform = async () => {
      const response =
        await apiRequest<AdminUser>(
          `/admin/admins/${encodeURIComponent(
            admin.id
          )}/reject`,
          {
            method: "PATCH",
            body: JSON.stringify({
              confirmation:
                "REJECT ADMIN",
            }),
          }
        );

      showToast(
        "success",
        response.message ??
          "Admin rejected."
      );

      await loadAdmins();
      await loadDashboard();
    };

    requestConfirmation(
      "Reject Admin Access",
      `Reject admin "${admin.name ?? admin.id}"?`,
      "REJECT ADMIN",
      perform
    );
  };

  const suspendAdmin = (
    admin: AdminUser
  ) => {
    const perform = async () => {
      const response =
        await apiRequest<AdminUser>(
          `/admin/admins/${encodeURIComponent(
            admin.id
          )}/suspend`,
          {
            method: "PATCH",
            body: JSON.stringify({
              confirmation:
                "SUSPEND ADMIN",
            }),
          }
        );

      showToast(
        "success",
        response.message ??
          "Admin suspended."
      );

      await loadAdmins();
    };

    requestConfirmation(
      "Suspend Admin",
      `Suspend "${admin.name ?? admin.id}"?`,
      "SUSPEND ADMIN",
      perform
    );
  };

  const reactivateAdmin =
    async (
      admin: AdminUser
    ) => {
      try {
        const response =
          await apiRequest<AdminUser>(
            `/admin/admins/${encodeURIComponent(
              admin.id
            )}/reactivate`,
            {
              method: "PATCH",
              body: JSON.stringify({}),
            }
          );

        showToast(
          "success",
          response.message ??
            "Admin reactivated."
        );

        await loadAdmins();
      } catch (error) {
        showToast(
          "error",
          error instanceof Error
            ? error.message
            : String(error)
        );
      }
    };

  const saveRolePermissions =
    async () => {
      if (!selectedRoleId) {
        showToast(
          "error",
          "Select a role first."
        );
        return;
      }

      if (
        selectedPermissionIds.length ===
        0
      ) {
        showToast(
          "error",
          "Select at least one permission."
        );
        return;
      }

      const perform = async () => {
        const response =
          await apiRequest<Role>(
            `/admin/roles/${encodeURIComponent(
              selectedRoleId
            )}/permissions`,
            {
              method: "POST",
              body: JSON.stringify({
                permissionIds:
                  selectedPermissionIds,
                confirmation:
                  "CHANGE PERMISSIONS",
              }),
            }
          );

        showToast(
          "success",
          response.message ??
            "Role permissions updated."
        );

        await loadRoles();
      };

      const role = roles.find(
        (item) =>
          item.id === selectedRoleId
      );

      requestConfirmation(
        "Change Role Permissions",
        `Update permissions for role "${role?.name ?? selectedRoleId}"? This replaces the role's current permission set.`,
        "CHANGE PERMISSIONS",
        perform
      );
    };

  const setupTestPickup =
    () => {
      const perform = async () => {
        setSetupLoading(true);

        try {
          const response =
            await apiRequest(
              "/admin/setup-test-pickup",
              {
                method: "POST",
                body: JSON.stringify({
                  confirmation:
                    "SETUP TEST PICKUP",
                }),
              }
            );

          setServerMessage(
            response.message ??
              "Pickup Truck test driver setup successfully."
          );

          showToast(
            "success",
            response.message ??
              "Pickup Truck test driver setup successfully."
          );

          await loadDashboard();
          await loadDrivers();
        } finally {
          setSetupLoading(false);
        }
      };

      requestConfirmation(
        "Setup Test Pickup Driver",
        "This creates/updates the predefined Pickup Truck test driver, vehicle and online test location.",
        "SETUP TEST PICKUP",
        perform
      );
    };

  const getSelectedRole =
    roles.find(
      (role) =>
        role.id === selectedRoleId
    );

  const permissionGroups =
    useMemo(() => {
      const grouped: Record<
        string,
        Permission[]
      > = {};

      for (const permission of permissions) {
        const module =
          permission.module || "other";

        grouped[module] ??= [];
        grouped[module].push(
          permission
        );
      }

      return Object.entries(grouped)
        .sort(([a], [b]) =>
          a.localeCompare(b)
        )
        .map(
          ([module, items]) => ({
            module,
            items: items.sort(
              (a, b) =>
                a.action.localeCompare(
                  b.action
                )
            ),
          })
        );
    }, [permissions]);

  const togglePermission = (
    permissionId: string
  ) => {
    setSelectedPermissionIds(
      (current) =>
        current.includes(permissionId)
          ? current.filter(
              (id) =>
                id !== permissionId
            )
          : [
              ...current,
              permissionId,
            ]
    );
  };

  const refreshCurrentScreen =
    () => {
      switch (currentScreen) {
        case "dashboard":
          void loadDashboard();
          break;
        case "drivers":
          void loadDrivers();
          break;
        case "bookings":
          void loadBookings();
          break;
        case "customers":
          void loadCustomers();
          break;
        case "safety":
          void loadSafety();
          break;
        case "admins":
          void loadAdmins();
          break;
        case "roles":
          void loadRoles();
          break;
        case "audit":
          void loadAuditLogs();
          break;
        case "quickLocations":
          void loadQuickLocations();
          break;
        case "setup":
          void loadDashboard();
          break;
      }
    };

  const renderDashboard =
    () => {
      return (
        <div className="page">
          <SectionHeader
            title="Dashboard"
            subtitle="RideX operational overview"
            onRefresh={
              loadDashboard
            }
          />

          {dashboardLoading ? (
            <LoadingState message="Loading dashboard…" />
          ) : dashboardError ? (
            <ErrorState
              message={dashboardError}
              onRetry={loadDashboard}
            />
          ) : dashboard ? (
            <>
              <div className="metrics-grid">
                <MetricCard
                  label="Customers"
                  value={formatNumber(
                    dashboard.customers
                  )}
                  icon="👥"
                  onClick={() =>
                    navigate(
                      "customers"
                    )
                  }
                />

                <MetricCard
                  label="Drivers"
                  value={formatNumber(
                    dashboard.drivers
                  )}
                  icon="🚗"
                  onClick={() =>
                    navigate(
                      "drivers"
                    )
                  }
                />

                <MetricCard
                  label="Online Drivers"
                  value={formatNumber(
                    dashboard.activeDrivers
                  )}
                  icon="🟢"
                  onClick={() =>
                    navigate(
                      "drivers"
                    )
                  }
                />

                <MetricCard
                  label="All Bookings"
                  value={formatNumber(
                    dashboard.bookings
                  )}
                  icon="🧾"
                  onClick={() =>
                    navigate(
                      "bookings"
                    )
                  }
                />

                <MetricCard
                  label="Completed"
                  value={formatNumber(
                    dashboard.completed
                  )}
                  icon="✅"
                  onClick={() =>
                    navigate(
                      "bookings"
                    )
                  }
                />

                <MetricCard
                  label="Ongoing"
                  value={formatNumber(
                    dashboard.ongoing
                  )}
                  icon="🛣️"
                  onClick={() =>
                    navigate(
                      "bookings"
                    )
                  }
                />

                <MetricCard
                  label="Cancelled"
                  value={formatNumber(
                    dashboard.cancelled
                  )}
                  icon="✖"
                  onClick={() =>
                    navigate(
                      "bookings"
                    )
                  }
                />

                <MetricCard
                  label="Open SOS"
                  value={formatNumber(
                    dashboard.sos
                  )}
                  icon="🆘"
                  onClick={() =>
                    navigate(
                      "safety"
                    )
                  }
                />

                <MetricCard
                  label="Vehicles"
                  value={formatNumber(
                    dashboard.vehicles
                  )}
                  icon="🚙"
                  onClick={() =>
                    navigate(
                      "drivers"
                    )
                  }
                />

                <MetricCard
                  label="Pending KYC"
                  value={formatNumber(
                    dashboard.pendingKyc
                  )}
                  icon="📄"
                  onClick={() =>
                    navigate(
                      "drivers"
                    )
                  }
                />

                <MetricCard
                  label="Pending Admins"
                  value={formatNumber(
                    dashboard.pendingAdmins
                  )}
                  icon="🔐"
                  onClick={() =>
                    navigate(
                      "admins"
                    )
                  }
                />

                <MetricCard
                  label="Open Support"
                  value={formatNumber(
                    dashboard.openSupport
                  )}
                  icon="🎧"
                />
              </div>

              <div className="content-grid two">
                <div className="panel">
                  <div className="panel-header">
                    <div>
                      <p className="eyebrow">
                        Operations
                      </p>
                      <h3>
                        Live platform summary
                      </h3>
                    </div>
                  </div>

                  <div className="summary-list">
                    <div>
                      <span>
                        Online driver ratio
                      </span>
                      <strong>
                        {dashboard.drivers
                          ? `${Math.round(
                              (dashboard.activeDrivers /
                                dashboard.drivers) *
                                100
                            )}%`
                          : "0%"}
                      </strong>
                    </div>

                    <div>
                      <span>
                        Completion ratio
                      </span>
                      <strong>
                        {dashboard.bookings
                          ? `${Math.round(
                              (dashboard.completed /
                                dashboard.bookings) *
                                100
                            )}%`
                          : "0%"}
                      </strong>
                    </div>

                    <div>
                      <span>
                        Pending KYC / drivers
                      </span>
                      <strong>
                        {formatNumber(
                          dashboard.pendingKyc
                        )}
                      </strong>
                    </div>

                    <div>
                      <span>
                        Pending admin approvals
                      </span>
                      <strong>
                        {formatNumber(
                          dashboard.pendingAdmins
                        )}
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="panel">
                  <div className="panel-header">
                    <div>
                      <p className="eyebrow">
                        Quick actions
                      </p>
                      <h3>
                        Operations shortcuts
                      </h3>
                    </div>
                  </div>

                  <div className="quick-actions">
                    <button
                      className="button primary"
                      type="button"
                      onClick={() =>
                        navigate("drivers")
                      }
                    >
                      Review Drivers
                    </button>

                    <button
                      className="button secondary"
                      type="button"
                      onClick={() =>
                        navigate("bookings")
                      }
                    >
                      Open Bookings
                    </button>

                    <button
                      className="button secondary"
                      type="button"
                      onClick={() =>
                        navigate("safety")
                      }
                    >
                      Review SOS
                    </button>

                    <button
                      className="button secondary"
                      type="button"
                      onClick={() =>
                        navigate("admins")
                      }
                    >
                      Manage Admins
                    </button>

                    <button
                      className="button secondary"
                      type="button"
                      onClick={() =>
                        navigate("setup")
                      }
                    >
                      Test Pickup Setup
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <EmptyState
              title="No dashboard data"
              message="Connect a valid approved admin user and refresh."
            />
          )}
        </div>
      );
    };

  const renderDrivers =
    () => {
      return (
        <div className="page">
          <SectionHeader
            title="Drivers"
            subtitle="Driver list, KYC verification and operational status"
            onRefresh={
              loadDrivers
            }
            right={
              <div className="inline-filters">
                <select
                  className="select-input"
                  value={
                    driverVerificationFilter
                  }
                  onChange={(event) =>
                    setDriverVerificationFilter(
                      event.target.value
                    )
                  }
                >
                  <option value="">
                    All verification
                  </option>

                  {VERIFICATION_STATUSES.map(
                    (status) => (
                      <option
                        key={status}
                        value={status}
                      >
                        {humanize(status)}
                      </option>
                    )
                  )}
                </select>

                <select
                  className="select-input"
                  value={
                    driverStatusFilter
                  }
                  onChange={(event) =>
                    setDriverStatusFilter(
                      event.target.value
                    )
                  }
                >
                  <option value="">
                    All driver status
                  </option>

                  {DRIVER_STATUSES.map(
                    (status) => (
                      <option
                        key={status}
                        value={status}
                      >
                        {humanize(status)}
                      </option>
                    )
                  )}
                </select>

                <button
                  className="button primary"
                  type="button"
                  onClick={loadDrivers}
                >
                  Apply
                </button>
              </div>
            }
          />

          {driversLoading ? (
            <LoadingState message="Loading drivers…" />
          ) : driversError ? (
            <ErrorState
              message={driversError}
              onRetry={loadDrivers}
            />
          ) : drivers.length === 0 ? (
            <EmptyState
              title="No drivers found"
              message="No driver matches the current filters."
            />
          ) : (
            <div className="panel">
              <div className="table-topbar">
                <PaginationInfo
                  count={drivers.length}
                />
              </div>

              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Driver</th>
                      <th>Verification</th>
                      <th>Status</th>
                      <th>Mode</th>
                      <th>Rating</th>
                      <th>Vehicles</th>
                      <th>Location</th>
                      <th>Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {drivers.map(
                      (driver) => (
                        <tr
                          key={driver.id}
                        >
                          <td>
                            <button
                              type="button"
                              className="table-link"
                              onClick={() =>
                                void loadDriverDetails(
                                  driver.id
                                )
                              }
                            >
                              {driver.fullName ??
                                "Unnamed driver"}
                            </button>

                            <span className="cell-sub">
                              {shortId(
                                driver.id
                              )}
                            </span>
                          </td>

                          <td>
                            <select
                              className="table-select"
                              value={
                                driver.verificationStatus ??
                                "PENDING"
                              }
                              onChange={(event) =>
                                void updateDriverVerification(
                                  driver,
                                  event.target
                                    .value
                                )
                              }
                            >
                              {VERIFICATION_STATUSES.map(
                                (
                                  status
                                ) => (
                                  <option
                                    key={
                                      status
                                    }
                                    value={
                                      status
                                    }
                                  >
                                    {humanize(
                                      status
                                    )}
                                  </option>
                                )
                              )}
                            </select>
                          </td>

                          <td>
                            <Badge
                              value={
                                driver.driverStatus
                              }
                            />
                          </td>

                          <td>
                            {humanize(
                              driver.dailyServiceMode
                            )}
                          </td>

                          <td>
                            ⭐{" "}
                            {Number(
                              driver.rating ??
                                0
                            ).toFixed(1)}
                          </td>

                          <td>
                            {formatNumber(
                              driver
                                .vehicles
                                ?.length ??
                                0
                            )}
                          </td>

                          <td>
                            {driver.location ? (
                              <span className="cell-sub">
                                {Number(
                                  driver
                                    .location
                                    .latitude ??
                                    0
                                ).toFixed(
                                  4
                                )}
                                ,{" "}
                                {Number(
                                  driver
                                    .location
                                    .longitude ??
                                    0
                                ).toFixed(
                                  4
                                )}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>

                          <td>
                            <div className="row-actions">
                              <button
                                className="button small secondary"
                                type="button"
                                onClick={() =>
                                  void loadDriverDetails(
                                    driver.id
                                  )
                                }
                              >
                                View
                              </button>

                              <select
                                className="table-select action-select"
                                value={
                                  driver.driverStatus ??
                                  "OFFLINE"
                                }
                                onChange={(
                                  event
                                ) =>
                                  void updateDriverStatus(
                                    driver,
                                    event
                                      .target
                                      .value
                                  )
                                }
                              >
                                {DRIVER_STATUSES.map(
                                  (
                                    status
                                  ) => (
                                    <option
                                      key={
                                        status
                                      }
                                      value={
                                        status
                                      }
                                    >
                                      {humanize(
                                        status
                                      )}
                                    </option>
                                  )
                                )}
                              </select>
                            </div>
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      );
    };

  const renderDriverDrawer =
    () => {
      if (!selectedDriver) {
        return null;
      }

      const driver =
        selectedDriver;

      return (
        <Drawer
          title={
            driver.fullName ??
            "Driver Details"
          }
          onClose={() =>
            setSelectedDriver(
              null
            )
          }
        >
          <div className="detail-grid">
            <div>
              <span>ID</span>
              <strong>
                {driver.id}
              </strong>
            </div>

            <div>
              <span>User ID</span>
              <strong>
                {driver.userId ??
                  "—"}
              </strong>
            </div>

            <div>
              <span>Verification</span>
              <Badge
                value={
                  driver.verificationStatus
                }
              />
            </div>

            <div>
              <span>Status</span>
              <Badge
                value={
                  driver.driverStatus
                }
              />
            </div>

            <div>
              <span>Service mode</span>
              <strong>
                {humanize(
                  driver.dailyServiceMode
                )}
              </strong>
            </div>

            <div>
              <span>Rating</span>
              <strong>
                ⭐{" "}
                {Number(
                  driver.rating ?? 0
                ).toFixed(1)}
              </strong>
            </div>

            <div>
              <span>Total rides</span>
              <strong>
                {formatNumber(
                  driver.totalRides
                )}
              </strong>
            </div>

            <div>
              <span>Created</span>
              <strong>
                {formatDate(
                  driver.createdAt
                )}
              </strong>
            </div>
          </div>

          <div className="drawer-section">
            <h3>Verification</h3>

            <div className="stack">
              {VERIFICATION_STATUSES.map(
                (status) => (
                  <button
                    key={status}
                    className={`button ${
                      driver.verificationStatus ===
                      status
                        ? "primary"
                        : "secondary"
                    }`}
                    type="button"
                    onClick={() =>
                      void updateDriverVerification(
                        driver,
                        status
                      )
                    }
                  >
                    {humanize(status)}
                  </button>
                )
              )}
            </div>
          </div>

          <div className="drawer-section">
            <h3>Driver status</h3>

            <div className="stack">
              {DRIVER_STATUSES.map(
                (status) => (
                  <button
                    key={status}
                    className={`button ${
                      driver.driverStatus ===
                      status
                        ? "primary"
                        : "secondary"
                    }`}
                    type="button"
                    onClick={() =>
                      void updateDriverStatus(
                        driver,
                        status
                      )
                    }
                  >
                    {humanize(status)}
                  </button>
                )
              )}
            </div>
          </div>

          <div className="drawer-section">
            <h3>Location</h3>

            {driver.location ? (
              <div className="detail-grid">
                <div>
                  <span>Latitude</span>
                  <strong>
                    {displayValue(
                      driver
                        .location
                        .latitude
                    )}
                  </strong>
                </div>

                <div>
                  <span>Longitude</span>
                  <strong>
                    {displayValue(
                      driver
                        .location
                        .longitude
                    )}
                  </strong>
                </div>

                <div>
                  <span>Online</span>
                  <strong>
                    {driver.location
                      .isOnline
                      ? "Yes"
                      : "No"}
                  </strong>
                </div>

                <div>
                  <span>Recorded</span>
                  <strong>
                    {formatDate(
                      driver
                        .location
                        .recordedAt
                    )}
                  </strong>
                </div>
              </div>
            ) : (
              <EmptyState
                title="No location"
                message="No driver location record is currently available."
              />
            )}
          </div>

          <div className="drawer-section">
            <h3>Vehicles</h3>

            {driver.vehicles &&
            driver.vehicles.length > 0 ? (
              <div className="mini-list">
                {driver.vehicles.map(
                  (vehicle) => (
                    <div
                      className="mini-card"
                      key={
                        vehicle.id ??
                        `${vehicle.vehicleNumber}`
                      }
                    >
                      <strong>
                        {humanize(
                          vehicle.vehicleType
                        )}
                      </strong>
                      <span>
                        {vehicle.vehicleNumber ??
                          "—"}
                      </span>
                      <span>
                        Capacity:{" "}
                        {displayValue(
                          vehicle.capacity
                        )}
                      </span>
                      <Badge
                        value={
                          vehicle.status
                        }
                      />
                    </div>
                  )
                )}
              </div>
            ) : (
              <EmptyState
                title="No vehicles"
                message="No vehicle is attached to this driver."
              />
            )}
          </div>
        </Drawer>
      );
    };

  const renderBookings =
    () => {
      return (
        <div className="page">
          <SectionHeader
            title="Bookings"
            subtitle="Booking-level operations with Connection Ride leg visibility"
            onRefresh={
              loadBookings
            }
            right={
              <div className="inline-filters">
                <input
                  className="text-input compact"
                  value={
                    bookingStatusFilter
                  }
                  onChange={(event) =>
                    setBookingStatusFilter(
                      event.target.value
                    )
                  }
                  placeholder="Status e.g. COMPLETED"
                />

                <button
                  className="button primary"
                  type="button"
                  onClick={loadBookings}
                >
                  Apply
                </button>
              </div>
            }
          />

          {bookingsLoading ? (
            <LoadingState message="Loading bookings…" />
          ) : bookingsError ? (
            <ErrorState
              message={bookingsError}
              onRetry={loadBookings}
            />
          ) : bookings.length === 0 ? (
            <EmptyState
              title="No bookings"
              message="No bookings match the current filter."
            />
          ) : (
            <div className="panel">
              <div className="table-topbar">
                <PaginationInfo
                  count={bookings.length}
                />
              </div>

              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Booking</th>
                      <th>Status</th>
                      <th>Type</th>
                      <th>Customer</th>
                      <th>Driver</th>
                      <th>Fare</th>
                      <th>Legs</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {bookings.map(
                      (booking) => (
                        <tr
                          key={booking.id}
                        >
                          <td>
                            <button
                              className="table-link"
                              type="button"
                              onClick={() =>
                                void loadBookingDetails(
                                  booking.id
                                )
                              }
                            >
                              {shortId(
                                booking.id,
                                18
                              )}
                            </button>

                            <span className="cell-sub">
                              {booking
                                .pickupAddress ??
                                "—"}{" "}
                              →{" "}
                              {booking
                                .dropAddress ??
                                "—"}
                            </span>
                          </td>

                          <td>
                            <Badge
                              value={
                                booking.status
                              }
                            />
                          </td>

                          <td>
                            <span className="tag">
                              {humanize(
                                booking.rideType
                              )}
                            </span>
                            <span className="tag">
                              {humanize(
                                booking.serviceType
                              )}
                            </span>
                          </td>

                          <td>
                            {booking
                              .customer
                              ?.id
                              ? shortId(
                                  booking
                                    .customer
                                    .id
                                )
                              : shortId(
                                  booking.customerId
                                )}
                          </td>

                          <td>
                            {booking
                              .assignedDriver
                              ?.fullName ??
                              shortId(
                                booking.assignedDriverId
                              )}
                          </td>

                          <td>
                            {formatMoney(
                              booking.finalFare ??
                                booking.totalFare ??
                                booking.estimatedFare
                            )}
                          </td>

                          <td>
                            {booking.legs
                              ?.length ??
                              0}

                            {booking.legs &&
                            booking.legs.length >
                              1 ? (
                              <span className="cell-sub">
                                Connection
                              </span>
                            ) : null}
                          </td>

                          <td>
                            {formatDate(
                              booking.createdAt
                            )}
                          </td>

                          <td>
                            <button
                              className="button small secondary"
                              type="button"
                              onClick={() =>
                                void loadBookingDetails(
                                  booking.id
                                )
                              }
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      );
    };

  const renderBookingDrawer =
    () => {
      if (!selectedBooking) {
        return null;
      }

      const booking =
        selectedBooking;

      return (
        <Drawer
          title={`Booking ${shortId(
            booking.id,
            22
          )}`}
          onClose={() =>
            setSelectedBooking(
              null
            )
          }
        >
          <div className="detail-grid">
            <div>
              <span>Status</span>
              <Badge
                value={
                  booking.status
                }
              />
            </div>

            <div>
              <span>Ride type</span>
              <strong>
                {humanize(
                  booking.rideType
                )}
              </strong>
            </div>

            <div>
              <span>Service type</span>
              <strong>
                {humanize(
                  booking.serviceType
                )}
              </strong>
            </div>

            <div>
              <span>Customer</span>
              <strong>
                {booking.customer
                  ?.id ??
                  booking.customerId ??
                  "—"}
              </strong>
            </div>

            <div>
              <span>Assigned driver</span>
              <strong>
                {booking
                  .assignedDriver
                  ?.fullName ??
                  booking.assignedDriverId ??
                  "—"}
              </strong>
            </div>

            <div>
              <span>Vehicle</span>
              <strong>
                {booking.vehicle
                  ?.vehicleNumber ??
                  booking.vehicleId ??
                  "—"}
              </strong>
            </div>

            <div>
              <span>Estimated fare</span>
              <strong>
                {formatMoney(
                  booking.estimatedFare
                )}
              </strong>
            </div>

            <div>
              <span>Final fare</span>
              <strong>
                {formatMoney(
                  booking.finalFare ??
                    booking.totalFare
                )}
              </strong>
            </div>
          </div>

          <div className="drawer-section">
            <h3>Full journey</h3>

            <div className="journey-card">
              <div>
                <span>Pickup</span>
                <strong>
                  {booking.pickupAddress ??
                    "—"}
                </strong>
              </div>

              <div className="journey-arrow">
                ↓
              </div>

              <div>
                <span>Drop</span>
                <strong>
                  {booking.dropAddress ??
                    "—"}
                </strong>
              </div>
            </div>
          </div>

          <div className="drawer-section">
            <div className="drawer-section-title">
              <h3>
                Legs (
                {booking.legs
                  ?.length ?? 0}
                )
              </h3>

              {booking.legs &&
              booking.legs.length >
                1 ? (
                <span className="tag emphasis">
                  CONNECTION RIDE
                </span>
              ) : null}
            </div>

            {booking.legs &&
            booking.legs.length > 0 ? (
              <div className="leg-list">
                {booking.legs
                  .slice()
                  .sort(
                    (a, b) =>
                      Number(
                        a.legNumber ??
                          0
                      ) -
                      Number(
                        b.legNumber ??
                          0
                      )
                  )
                  .map(
                    (leg, index) => (
                      <div
                        className="leg-card"
                        key={
                          leg.id
                        }
                      >
                        <div className="leg-header">
                          <div>
                            <span className="leg-number">
                              LEG{" "}
                              {leg.legNumber ??
                                index +
                                  1}
                            </span>

                            <h4>
                              {leg.pickupAddress ??
                                "Pickup"}{" "}
                              →{" "}
                              {leg.dropAddress ??
                                "Drop"}
                            </h4>
                          </div>

                          <Badge
                            value={
                              leg.status
                            }
                          />
                        </div>

                        <div className="detail-grid compact-grid">
                          <div>
                            <span>
                              Driver
                            </span>
                            <strong>
                              {leg.assignedDriverId ??
                                "Not assigned"}
                            </strong>
                          </div>

                          <div>
                            <span>
                              Vehicle
                            </span>
                            <strong>
                              {leg.vehicleId ??
                                "Not assigned"}
                            </strong>
                          </div>

                          <div>
                            <span>
                              Fare
                            </span>
                            <strong>
                              {formatMoney(
                                leg.fare
                              )}
                            </strong>
                          </div>

                          <div>
                            <span>
                              Distance
                            </span>
                            <strong>
                              {leg.distanceKm !=
                              null
                                ? `${Number(
                                    leg.distanceKm
                                  ).toFixed(
                                    2
                                  )} km`
                                : "—"}
                            </strong>
                          </div>

                          <div>
                            <span>
                              Duration
                            </span>
                            <strong>
                              {leg.durationMinutes !=
                              null
                                ? `${Number(
                                    leg.durationMinutes
                                  ).toFixed(
                                    0
                                  )} min`
                                : "—"}
                            </strong>
                          </div>

                          <div>
                            <span>
                              Trip
                            </span>
                            <strong>
                              {leg.tripId ??
                                "Not started"}
                            </strong>
                          </div>
                        </div>
                      </div>
                    )
                  )}
              </div>
            ) : (
              <EmptyState
                title="No legs"
                message="This booking has no BookingLeg records."
              />
            )}
          </div>

          <div className="drawer-section">
            <h3>
              Ride requests
            </h3>

            <JsonBlock
              value={
                booking.rideRequests ??
                []
              }
            />
          </div>

          <div className="drawer-section">
            <h3>Payment</h3>

            <JsonBlock
              value={
                booking.payment ??
                null
              }
            />
          </div>

          <div className="drawer-section">
            <h3>Ratings</h3>

            <JsonBlock
              value={
                booking.ratings ?? []
              }
            />
          </div>
        </Drawer>
      );
    };

  const renderCustomers =
    () => {
      return (
        <div className="page">
          <SectionHeader
            title="Customers"
            subtitle="Customer profiles and recent account activity"
            onRefresh={
              loadCustomers
            }
          />

          {customersLoading ? (
            <LoadingState message="Loading customers…" />
          ) : customersError ? (
            <ErrorState
              message={customersError}
              onRetry={loadCustomers}
            />
          ) : customers.length === 0 ? (
            <EmptyState
              title="No customers"
              message="No customer records were returned."
            />
          ) : (
            <div className="panel">
              <div className="table-topbar">
                <PaginationInfo
                  count={customers.length}
                />
              </div>

              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Mobile</th>
                      <th>Email</th>
                      <th>User Status</th>
                      <th>Bookings</th>
                      <th>Ratings</th>
                      <th>SOS</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {customers.map(
                      (customer) => (
                        <tr
                          key={
                            customer.id
                          }
                        >
                          <td>
                            <button
                              className="table-link"
                              type="button"
                              onClick={() =>
                                void loadCustomerDetails(
                                  customer.id
                                )
                              }
                            >
                              {shortId(
                                customer.id,
                                18
                              )}
                            </button>
                          </td>

                          <td>
                            {customer
                              .user
                              ?.mobile ??
                              "—"}
                          </td>

                          <td>
                            {customer
                              .user
                              ?.email ??
                              "—"}
                          </td>

                          <td>
                            <Badge
                              value={
                                customer
                                  .user
                                  ?.status
                              }
                            />
                          </td>

                          <td>
                            {formatNumber(
                              customer
                                .bookings
                                ?.length ??
                                0
                            )}
                          </td>

                          <td>
                            {formatNumber(
                              customer
                                .ratings
                                ?.length ??
                                0
                            )}
                          </td>

                          <td>
                            {formatNumber(
                              customer
                                .sosEvents
                                ?.length ??
                                0
                            )}
                          </td>

                          <td>
                            {formatDate(
                              customer.createdAt
                            )}
                          </td>

                          <td>
                            <button
                              className="button small secondary"
                              type="button"
                              onClick={() =>
                                void loadCustomerDetails(
                                  customer.id
                                )
                              }
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      );
    };

  const renderCustomerDrawer =
    () => {
      if (!selectedCustomer) {
        return null;
      }

      const customer =
        selectedCustomer;

      return (
        <Drawer
          title="Customer Details"
          onClose={() =>
            setSelectedCustomer(
              null
            )
          }
        >
          <div className="detail-grid">
            <div>
              <span>Customer ID</span>
              <strong>
                {customer.id}
              </strong>
            </div>

            <div>
              <span>User ID</span>
              <strong>
                {customer.userId ??
                  customer.user
                    ?.id ??
                  "—"}
              </strong>
            </div>

            <div>
              <span>Mobile</span>
              <strong>
                {customer.user
                  ?.mobile ??
                  "—"}
              </strong>
            </div>

            <div>
              <span>Email</span>
              <strong>
                {customer.user
                  ?.email ??
                  "—"}
              </strong>
            </div>

            <div>
              <span>Status</span>
              <Badge
                value={
                  customer.user
                    ?.status
                }
              />
            </div>

            <div>
              <span>Created</span>
              <strong>
                {formatDate(
                  customer.createdAt
                )}
              </strong>
            </div>
          </div>

          <div className="drawer-section">
            <h3>
              Recent Bookings
            </h3>

            {customer.bookings &&
            customer.bookings.length >
              0 ? (
              <div className="mini-list">
                {customer.bookings.map(
                  (booking) => (
                    <button
                      key={
                        booking.id
                      }
                      type="button"
                      className="mini-card clickable-card"
                      onClick={() => {
                        setSelectedCustomer(
                          null
                        );
                        void loadBookingDetails(
                          booking.id
                        );
                      }}
                    >
                      <strong>
                        {shortId(
                          booking.id,
                          20
                        )}
                      </strong>

                      <span>
                        {booking
                          .pickupAddress ??
                          "—"}{" "}
                        →{" "}
                        {booking
                          .dropAddress ??
                          "—"}
                      </span>

                      <Badge
                        value={
                          booking.status
                        }
                      />
                    </button>
                  )
                )}
              </div>
            ) : (
              <EmptyState
                title="No recent bookings"
                message="No booking records are attached to this customer."
              />
            )}
          </div>

          <div className="drawer-section">
            <h3>Ratings</h3>
            <JsonBlock
              value={
                customer.ratings ??
                []
              }
            />
          </div>

          <div className="drawer-section">
            <h3>Support Cases</h3>
            <JsonBlock
              value={
                customer.supportCases ??
                []
              }
            />
          </div>

          <div className="drawer-section">
            <h3>SOS Events</h3>
            <JsonBlock
              value={
                customer.sosEvents ??
                []
              }
            />
          </div>
        </Drawer>
      );
    };

  const renderSafety =
    () => {
      return (
        <div className="page">
          <SectionHeader
            title="Safety / SOS"
            subtitle="Open and historical SOS events available to admin"
            onRefresh={
              loadSafety
            }
          />

          {safetyLoading ? (
            <LoadingState message="Loading SOS events…" />
          ) : safetyError ? (
            <ErrorState
              message={safetyError}
              onRetry={loadSafety}
            />
          ) : sosEvents.length === 0 ? (
            <EmptyState
              title="No SOS events"
              message="No SOS events were returned by the admin API."
            />
          ) : (
            <div className="panel">
              <div className="table-topbar">
                <PaginationInfo
                  count={sosEvents.length}
                />
              </div>

              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Status</th>
                      <th>Booking</th>
                      <th>Incident</th>
                      <th>Route</th>
                      <th>Created</th>
                    </tr>
                  </thead>

                  <tbody>
                    {sosEvents.map(
                      (event) => (
                        <tr
                          key={event.id}
                        >
                          <td>
                            <strong>
                              {shortId(
                                event.id,
                                20
                              )}
                            </strong>
                          </td>

                          <td>
                            <Badge
                              value={
                                event.status
                              }
                            />
                          </td>

                          <td>
                            {event.booking
                              ?.id ??
                              event.bookingId ??
                              "—"}
                          </td>

                          <td>
                            <div className="cell-stack">
                              <Badge
                                value={
                                  event
                                    .incident
                                    ?.status
                                }
                              />

                              <span className="cell-sub">
                                {humanize(
                                  event
                                    .incident
                                    ?.severity
                                )}
                              </span>
                            </div>
                          </td>

                          <td>
                            <span className="cell-sub">
                              {event.booking
                                ?.pickupAddress ??
                                "—"}
                            </span>

                            <span className="cell-sub">
                              ↓{" "}
                              {event.booking
                                ?.dropAddress ??
                                "—"}
                            </span>
                          </td>

                          <td>
                            {formatDate(
                              event.createdAt
                            )}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      );
    };

  const renderAdmins =
    () => {
      return (
        <div className="page">
          <SectionHeader
            title="Admin Users"
            subtitle="Admin accounts, approval, suspension and creation"
            onRefresh={
              loadAdmins
            }
          />

          <div className="content-grid two">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">
                    Create
                  </p>
                  <h3>
                    New Admin
                  </h3>
                </div>
              </div>

              <form
                className="form-grid"
                onSubmit={createAdmin}
              >
                <label>
                  <span className="field-label">
                    Name
                  </span>

                  <input
                    className="text-input"
                    value={
                      newAdminForm.name
                    }
                    onChange={(
                      event
                    ) =>
                      setNewAdminForm(
                        (
                          current
                        ) => ({
                          ...current,
                          name:
                            event
                              .target
                              .value,
                        })
                      )
                    }
                    placeholder="Admin name"
                  />
                </label>

                <label>
                  <span className="field-label">
                    Mobile
                  </span>

                  <input
                    className="text-input"
                    value={
                      newAdminForm.mobile
                    }
                    onChange={(
                      event
                    ) =>
                      setNewAdminForm(
                        (
                          current
                        ) => ({
                          ...current,
                          mobile:
                            event
                              .target
                              .value,
                        })
                      )
                    }
                    placeholder="10-digit mobile"
                  />
                </label>

                <label>
                  <span className="field-label">
                    Email
                  </span>

                  <input
                    className="text-input"
                    value={
                      newAdminForm.email
                    }
                    onChange={(
                      event
                    ) =>
                      setNewAdminForm(
                        (
                          current
                        ) => ({
                          ...current,
                          email:
                            event
                              .target
                              .value,
                        })
                      )
                    }
                    placeholder="Optional email"
                  />
                </label>

                <label>
                  <span className="field-label">
                    Role
                  </span>

                  <select
                    className="select-input"
                    value={
                      newAdminForm.role
                    }
                    onChange={(
                      event
                    ) =>
                      setNewAdminForm(
                        (
                          current
                        ) => ({
                          ...current,
                          role:
                            event
                              .target
                              .value,
                        })
                      )
                    }
                  >
                    {ADMIN_ROLES.map(
                      (role) => (
                        <option
                          key={role}
                          value={role}
                        >
                          {humanize(
                            role
                          )}
                        </option>
                      )
                    )}
                  </select>
                </label>

                <button
                  className="button primary"
                  type="submit"
                  disabled={
                    createAdminLoading
                  }
                >
                  {createAdminLoading
                    ? "Creating…"
                    : "Create Admin"}
                </button>
              </form>
            </div>

            <div className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">
                    Current admin
                  </p>
                  <h3>
                    Access Context
                  </h3>
                </div>
              </div>

              <div className="summary-list">
                <div>
                  <span>
                    Admin User ID
                  </span>

                  <strong>
                    {adminUserId ||
                      "—"}
                  </strong>
                </div>

                <div>
                  <span>
                    API Base
                  </span>

                  <strong className="wrap">
                    {effectiveApiBase}
                  </strong>
                </div>

                <div>
                  <span>
                    Admin records
                  </span>

                  <strong>
                    {formatNumber(
                      adminUsers.length
                    )}
                  </strong>
                </div>

                <div>
                  <span>
                    Pending approvals
                  </span>

                  <strong>
                    {formatNumber(
                      adminUsers.filter(
                        (admin) =>
                          admin.approvalStatus ===
                          "PENDING"
                      ).length
                    )}
                  </strong>
                </div>
              </div>
            </div>
          </div>

          {adminsLoading ? (
            <LoadingState message="Loading admin users…" />
          ) : adminsError ? (
            <ErrorState
              message={adminsError}
              onRetry={loadAdmins}
            />
          ) : adminUsers.length === 0 ? (
            <EmptyState
              title="No admin users"
              message="No admin accounts were returned."
            />
          ) : (
            <div className="panel">
              <div className="table-topbar">
                <PaginationInfo
                  count={
                    adminUsers.length
                  }
                />
              </div>

              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Mobile</th>
                      <th>Role</th>
                      <th>Approval</th>
                      <th>User Status</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {adminUsers.map(
                      (admin) => (
                        <tr
                          key={
                            admin.id
                          }
                        >
                          <td>
                            <strong>
                              {admin.name ??
                                "—"}
                            </strong>

                            <span className="cell-sub">
                              {shortId(
                                admin.id,
                                18
                              )}
                            </span>
                          </td>

                          <td>
                            {admin.user
                              ?.mobile ??
                              "—"}
                          </td>

                          <td>
                            <span className="tag">
                              {humanize(
                                admin
                                  .role
                                  ?.name
                              )}
                            </span>
                          </td>

                          <td>
                            <Badge
                              value={
                                admin.approvalStatus
                              }
                            />
                          </td>

                          <td>
                            <Badge
                              value={
                                admin.user
                                  ?.status
                              }
                            />
                          </td>

                          <td>
                            {formatDate(
                              admin.createdAt
                            )}
                          </td>

                          <td>
                            <div className="row-actions wrap-actions">
                              {admin.approvalStatus ===
                              "PENDING" ? (
                                <>
                                  <button
                                    className="button small primary"
                                    type="button"
                                    onClick={() =>
                                      approveAdmin(
                                        admin
                                      )
                                    }
                                  >
                                    Approve
                                  </button>

                                  <button
                                    className="button small danger-outline"
                                    type="button"
                                    onClick={() =>
                                      rejectAdmin(
                                        admin
                                      )
                                    }
                                  >
                                    Reject
                                  </button>
                                </>
                              ) : null}

                              {admin.approvalStatus ===
                              "APPROVED" ? (
                                <button
                                  className="button small danger-outline"
                                  type="button"
                                  onClick={() =>
                                    suspendAdmin(
                                      admin
                                    )
                                  }
                                  disabled={
                                    admin.id ===
                                    adminUserId
                                  }
                                >
                                  Suspend
                                </button>
                              ) : null}

                              {admin.approvalStatus ===
                              "SUSPENDED" ? (
                                <button
                                  className="button small secondary"
                                  type="button"
                                  onClick={() =>
                                    void reactivateAdmin(
                                      admin
                                    )
                                  }
                                >
                                  Reactivate
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      );
    };

  const renderRoles =
    () => {
      return (
        <div className="page">
          <SectionHeader
            title="Roles & Permissions"
            subtitle="Inspect roles and replace role permission assignments"
            onRefresh={
              loadRoles
            }
          />

          {rolesLoading ? (
            <LoadingState message="Loading roles and permissions…" />
          ) : rolesError ? (
            <ErrorState
              message={rolesError}
              onRetry={loadRoles}
            />
          ) : (
            <div className="content-grid two">
              <div className="panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">
                      Roles
                    </p>
                    <h3>
                      Select role
                    </h3>
                  </div>
                </div>

                {roles.length ===
                0 ? (
                  <EmptyState
                    title="No roles"
                    message="No roles are configured."
                  />
                ) : (
                  <div className="role-list">
                    {roles.map(
                      (role) => {
                        const count =
                          role
                            .permissionLinks
                            ?.length ??
                          0;

                        return (
                          <button
                            key={
                              role.id
                            }
                            type="button"
                            className={`role-card ${
                              selectedRoleId ===
                              role.id
                                ? "selected"
                                : ""
                            }`}
                            onClick={() =>
                              setSelectedRoleId(
                                role.id
                              )
                            }
                          >
                            <div>
                              <strong>
                                {humanize(
                                  role.name
                                )}
                              </strong>

                              <span>
                                {count} permission
                                {count ===
                                1
                                  ? ""
                                  : "s"}
                              </span>
                            </div>

                            <div className="role-meta">
                              {role.isSystem ? (
                                <span className="tag">
                                  SYSTEM
                                </span>
                              ) : null}

                              <span>
                                {role
                                  .admins
                                  ?.length ??
                                  0}{" "}
                                admin
                                {(
                                  role
                                    .admins
                                    ?.length ??
                                  0
                                ) === 1
                                  ? ""
                                  : "s"}
                              </span>
                            </div>
                          </button>
                        );
                      }
                    )}
                  </div>
                )}
              </div>

              <div className="panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">
                      Permission assignment
                    </p>
                    <h3>
                      {getSelectedRole
                        ? humanize(
                            getSelectedRole.name
                          )
                        : "Select a role"}
                    </h3>
                  </div>

                  <span className="tag emphasis">
                    {
                      selectedPermissionIds.length
                    }{" "}
                    selected
                  </span>
                </div>

                {!selectedRoleId ? (
                  <EmptyState
                    title="Select a role"
                    message="Choose a role from the left panel."
                  />
                ) : permissionGroups.length ===
                  0 ? (
                  <EmptyState
                    title="No permissions"
                    message="No permissions are configured."
                  />
                ) : (
                  <>
                    <div className="permission-groups">
                      {permissionGroups.map(
                        ({
                          module,
                          items,
                        }) => (
                          <div
                            className="permission-group"
                            key={
                              module
                            }
                          >
                            <div className="permission-group-header">
                              <h4>
                                {humanize(
                                  module
                                )}
                              </h4>

                              <span>
                                {
                                  items.length
                                }
                              </span>
                            </div>

                            <div className="permission-grid">
                              {items.map(
                                (
                                  permission
                                ) => (
                                  <label
                                    key={
                                      permission.id
                                    }
                                    className="permission-card"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selectedPermissionIds.includes(
                                        permission.id
                                      )}
                                      onChange={() =>
                                        togglePermission(
                                          permission.id
                                        )
                                      }
                                    />

                                    <span>
                                      <strong>
                                        {humanize(
                                          permission.action
                                        )}
                                      </strong>

                                      <small>
                                        {
                                          permission.module
                                        }
                                        :
                                        {
                                          permission.action
                                        }
                                      </small>
                                    </span>
                                  </label>
                                )
                              )}
                            </div>
                          </div>
                        )
                      )}
                    </div>

                    <div className="panel-footer-actions">
                      <button
                        className="button primary"
                        type="button"
                        onClick={() =>
                          void saveRolePermissions()
                        }
                        disabled={
                          selectedPermissionIds.length ===
                          0
                        }
                      >
                        Save Permissions
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      );
    };

  const renderAudit =
    () => {
      return (
        <div className="page">
          <SectionHeader
            title="Audit Logs"
            subtitle="Administrative changes and security-sensitive actions"
            onRefresh={
              loadAuditLogs
            }
            right={
              <div className="inline-filters audit-filters">
                <input
                  className="text-input compact"
                  value={
                    auditModuleFilter
                  }
                  onChange={(event) =>
                    setAuditModuleFilter(
                      event.target.value
                    )
                  }
                  placeholder="Module"
                />

                <input
                  className="text-input compact"
                  value={
                    auditEntityFilter
                  }
                  onChange={(event) =>
                    setAuditEntityFilter(
                      event.target.value
                    )
                  }
                  placeholder="Entity type"
                />

                <input
                  className="text-input compact"
                  value={
                    auditEntityIdFilter
                  }
                  onChange={(event) =>
                    setAuditEntityIdFilter(
                      event.target.value
                    )
                  }
                  placeholder="Entity ID"
                />

                <button
                  className="button primary"
                  type="button"
                  onClick={
                    loadAuditLogs
                  }
                >
                  Filter
                </button>
              </div>
            }
          />

          {auditLoading ? (
            <LoadingState message="Loading audit logs…" />
          ) : auditError ? (
            <ErrorState
              message={auditError}
              onRetry={loadAuditLogs}
            />
          ) : auditLogs.length === 0 ? (
            <EmptyState
              title="No audit logs"
              message="No audit entries match the selected filters."
            />
          ) : (
            <div className="panel">
              <div className="table-topbar">
                <PaginationInfo
                  count={
                    auditLogs.length
                  }
                />
              </div>

              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Admin</th>
                      <th>Role</th>
                      <th>Action</th>
                      <th>Module</th>
                      <th>Entity</th>
                      <th>ID</th>
                      <th>Before / After</th>
                    </tr>
                  </thead>

                  <tbody>
                    {auditLogs.map(
                      (log) => (
                        <tr
                          key={
                            log.id
                          }
                        >
                          <td>
                            {formatDate(
                              log.createdAt
                            )}
                          </td>

                          <td>
                            {log.admin
                              ?.name ??
                              "—"}
                          </td>

                          <td>
                            {humanize(
                              log.admin
                                ?.role
                                ?.name
                            )}
                          </td>

                          <td>
                            <span className="tag emphasis">
                              {humanize(
                                log.action
                              )}
                            </span>
                          </td>

                          <td>
                            {humanize(
                              log.module
                            )}
                          </td>

                          <td>
                            {log.entityType ??
                              "—"}
                          </td>

                          <td>
                            {shortId(
                              log.entityId,
                              18
                            )}
                          </td>

                          <td>
                            <details className="audit-details">
                              <summary>
                                View data
                              </summary>

                              <div className="audit-data">
                                <div>
                                  <span>
                                    Before
                                  </span>
                                  <JsonBlock
                                    value={
                                      log.beforeData
                                    }
                                  />
                                </div>

                                <div>
                                  <span>
                                    After
                                  </span>
                                  <JsonBlock
                                    value={
                                      log.afterData
                                    }
                                  />
                                </div>
                              </div>
                            </details>
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      );
    };

  const renderQuickLocations =
    () => {
      return (
        <div className="page">
          <SectionHeader
            title="Quick Locations"
            subtitle="Admin-accessible quick location catalog"
            onRefresh={
              loadQuickLocations
            }
          />

          {quickLocationsLoading ? (
            <LoadingState message="Loading quick locations…" />
          ) : quickLocationsError ? (
            <ErrorState
              message={
                quickLocationsError
              }
              onRetry={
                loadQuickLocations
              }
            />
          ) : quickLocations.length ===
            0 ? (
            <EmptyState
              title="No quick locations"
              message="No quick location records were returned."
            />
          ) : (
            <div className="location-grid">
              {quickLocations.map(
                (location) => (
                  <div
                    className="location-card"
                    key={
                      location.id
                    }
                  >
                    <div className="location-card-header">
                      <div>
                        <p className="eyebrow">
                          {
                            location.category
                          }
                        </p>
                        <h3>
                          {location.name ??
                            "Unnamed location"}
                        </h3>
                      </div>

                      <Badge
                        value={
                          location.isActive
                            ? "ACTIVE"
                            : "INACTIVE"
                        }
                      />
                    </div>

                    <p>
                      {location.address ??
                        "No address"}
                    </p>

                    <div className="detail-grid compact-grid">
                      <div>
                        <span>
                          Latitude
                        </span>
                        <strong>
                          {displayValue(
                            location.latitude
                          )}
                        </strong>
                      </div>

                      <div>
                        <span>
                          Longitude
                        </span>
                        <strong>
                          {displayValue(
                            location.longitude
                          )}
                        </strong>
                      </div>

                      <div>
                        <span>ID</span>
                        <strong>
                          {shortId(
                            location.id
                          )}
                        </strong>
                      </div>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      );
    };

  const renderSetup = () => {
    return (
      <div className="page">
        <SectionHeader
          title="Test Data Lab"
          subtitle="Complete RideX v3.5 test-mode dataset — seed, inspect, edit and delete"
          onRefresh={() => void loadTestData()}
        />

        {!RIDEX_TEST_MODE ? (
          <div className="panel warning-panel"><strong>TEST MODE DISABLED</strong><p>Set RIDEX_TEST_MODE=true in the backend environment to use the test dataset.</p></div>
        ) : (
          <>
            <div className="content-grid two">
              <div className="panel setup-panel">
                <p className="eyebrow">CONTROLLED FIXTURE</p>
                <h2>RideX v3.5 full test dataset</h2>
                <p>Creates customers, drivers, vehicles, bookings, trips, payments, refunds, earnings, settlements, ratings, support, SOS, notifications, coupons, quick locations, configuration and RBAC fixtures with deterministic v3.5 test IDs.</p>
                <div className="button-row">
                  <button className="button primary large" type="button" onClick={() => void seedAllTestData()} disabled={testDataLoading}>{testDataLoading ? "Working…" : "Seed / Reset All Test Data"}</button>
                  <button className="button danger-button large" type="button" onClick={() => void deleteAllTestData()} disabled={testDataLoading}>Delete All Test Data</button>
                </div>
              </div>

              <div className="panel">
                <div className="panel-header"><div><p className="eyebrow">DATASET</p><h3>Fixture summary</h3></div></div>
                <div className="metric-grid">
                  {Object.entries(testDataSummary ?? {}).map(([key, value]) => <MetricCard key={key} label={humanize(key)} value={formatNumber(value)} icon="database" />)}
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-header"><div><p className="eyebrow">ADMIN CRUD</p><h3>Editable test records</h3></div></div>
              <p>Use the existing Customer, Driver, Vehicle, Rides, Promotions and Support screens for normal operations. This lab also confirms that only IDs beginning with <code>v35-test-</code> can be edited or deleted through the test-data API.</p>
              <div className="table-wrapper">
                <table><thead><tr><th>Entity</th><th>Records</th><th>Examples</th><th>Controls</th></tr></thead><tbody>
                  {testDataRecords ? Object.entries(testDataRecords).map(([key, rows]) => { const records = rows as any[]; return <tr key={key}><td>{humanize(key)}</td><td>{records.length}</td><td>{records.slice(0, 3).map((r) => shortId(r.id ?? "", 18)).join(", ") || "—"}</td><td><button className="button secondary small" type="button" onClick={() => { const target = records[0]; if (!target?.id) return; const field = key === "customers" ? "fullName" : key === "drivers" ? "fullName" : key === "vehicles" ? "vehicleNumber" : key === "bookings" ? "status" : key === "locations" ? "name" : key === "coupons" ? "description" : key === "supportCases" ? "status" : "title"; const value = window.prompt(`New ${field}`, String(target[field] ?? "")); if (value === null) return; const entity = key === "locations" ? "quick-locations" : key === "supportCases" ? "support" : key; void apiRequest(`/admin/test-data/${entity}/${target.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: value }) }).then(() => { showToast("success", `${humanize(key)} record updated`); return loadTestData(); }).catch((error) => showToast("error", error instanceof Error ? error.message : "Update failed")); }}>Edit first</button>{target?.id ? <button className="button danger-button small" type="button" onClick={() => { if (!window.confirm(`Delete test ${key} record ${target.id}?`)) return; const entity = key === "locations" ? "quick-locations" : key === "supportCases" ? "support" : key; void apiRequest(`/admin/test-data/${entity}/${target.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" } }).then(() => { showToast("success", `${humanize(key)} record deleted`); return loadTestData(); }).catch((error) => showToast("error", error instanceof Error ? error.message : "Delete failed")); }}>Delete first</button> : null}</td></tr>; }) : <tr><td colSpan={4}>Load the test dataset to inspect records.</td></tr>}
                </tbody></table>
              </div>
            </div>

            <div className="panel warning-panel"><strong>Test-only safety boundary</strong><p>All fixture IDs use the <code>v35-test-</code> prefix and seed/reset endpoints are hard-disabled when RIDEX_TEST_MODE is not true.</p></div>
          </>
        )}
      </div>
    );
  };

  const renderLiveOperations =
    () => (
      <div className="page">
        <SectionHeader
          title="Live Rides / Live Operations"
          subtitle="Track current rides, driver availability and operational exceptions in real time"
          actions={<span className="api-pill"><span className="online-dot" /> All Systems Operational</span>}
        />

        <div className="metrics-grid">
          <MetricCard label="Active Rides" value={18} icon="🚕" tone="success" />
          <MetricCard label="Online Drivers" value={36} icon="🚗" tone="info" />
          <MetricCard label="Total Drivers" value={128} icon="👥" tone="neutral" />
          <MetricCard label="Waiting for Driver" value={6} icon="⏳" tone="warning" />
          <MetricCard label="Average ETA" value="4.8 min" icon="🕒" tone="info" />
          <MetricCard label="Cancelled Today" value={34} icon="✕" tone="danger" />
        </div>

        <div className="content-grid two">
          <Panel title="Active Rides" subtitle="Current marketplace activity">
            <div className="stack-list">
              {[
                ["#RX25841", "Rahul Verma", "Boring Road → Patna Junction", "On Trip", "12 min"],
                ["#RX25840", "Priya Singh", "Kankarbagh → Bailey Road", "Driver Arrived", "2 min"],
                ["#RX25839", "Amit Kumar", "Danapur → Boring Road", "Picking Up", "5 min"],
                ["#RX25838", "Sneha Verma", "Rajendra Nagar → AIIMS Patna", "On Trip", "10 min"],
              ].map(([id, rider, route, status, eta]) => (
                <div className="list-row" key={id}>
                  <div><strong>{rider}</strong><span>{id} • {route}</span></div>
                  <div className="row-right"><StatusBadge value={status} /><span>{eta}</span></div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Operations Map" subtitle="UI shell ready for live map/GPS integration">
            <div className="map-placeholder">
              <div className="map-grid" />
              <div className="map-badge">18 Active Rides</div>
              <div className="map-marker m1">🚗</div><div className="map-marker m2">🛺</div><div className="map-marker m3">🚕</div><div className="map-marker m4">🚗</div>
            </div>
          </Panel>
        </div>
      </div>
    );

  const renderQuickRide = () => (
    <div className="page">
      <SectionHeader title="Quick Ride Create" subtitle="Admin-created/manual booking for operations and support">
      </SectionHeader>
      <div className="content-grid two">
        <Panel title="Ride Details" subtitle="TEST MODE — backend endpoint can be wired later without changing this UI">
          <div className="detail-grid">
            <label><span className="field-label">Customer ID</span><input className="text-input" placeholder="Customer ID" defaultValue="customer-test-001" /></label>
            <label><span className="field-label">Booking Mode</span><select className="select-input" defaultValue="RIDE"><option>RIDE</option><option>GOODS</option></select></label>
            <label><span className="field-label">Pickup</span><input className="text-input" placeholder="Pickup location" defaultValue="Katihar Town" /></label>
            <label><span className="field-label">Drop</span><input className="text-input" placeholder="Drop location" defaultValue="Katihar Railway Station" /></label>
            <label><span className="field-label">Ride Type</span><select className="select-input" defaultValue="FULL_RIDE"><option>FULL_RIDE</option><option>SHARED_RIDE</option><option>CONNECTION_RIDE</option></select></label>
            <label><span className="field-label">Estimated Fare (₹)</span><input className="text-input" type="number" defaultValue={80} /></label>
          </div>
          <button className="button primary" type="button" onClick={() => showToast("success", RIDEX_TEST_MODE ? "TEST MODE: Quick Ride simulated successfully." : "Quick Ride request prepared.")}><AppIcon name="plus" size={15} /> Create Ride</button>
        </Panel>
        <Panel title="Driver / Vehicle" subtitle="Optional assignment; matching remains backend-controlled">
          <div className="detail-grid">
            <label><span className="field-label">Driver</span><select className="select-input" defaultValue="auto"><option value="auto">Auto Match</option><option value="driver-test-001">Test Passenger Driver</option><option value="driver-test-002">Test Goods Driver</option></select></label>
            <label><span className="field-label">Vehicle</span><select className="select-input" defaultValue="auto"><option value="auto">Auto Select</option><option>E_RICKSHAW</option><option>PICKUP_TRUCK</option></select></label>
          </div>
          <div className="info-box"><strong>Compatibility rule</strong><p>Passenger → E-Rickshaw only. Parcel → Passenger E-Rickshaw only. Goods → Battery Pickup Truck only.</p></div>
        </Panel>
      </div>
    </div>
  );

  const loadPricingRules = useCallback(async () => {
    try { const r = await apiRequest<any[]>("/admin/platform/pricing-rules"); setPricingRules(Array.isArray(r.data)?r.data:[]); } catch(e) { showToast("error", e instanceof Error ? e.message : "Unable to load pricing rules"); }
  }, [apiRequest, showToast]);

  const savePricingRule = useCallback(async () => {
    if (!pricingDraft.name.trim()) return showToast("error","Rule name is required");
    try { await apiRequest("/admin/platform/pricing-rules",{method:"POST",body:JSON.stringify({...pricingDraft,baseFare:Number(pricingDraft.baseFare),perKm:Number(pricingDraft.perKm),perMinute:Number(pricingDraft.perMinute),minFare:Number(pricingDraft.minFare),maxFare:Number(pricingDraft.maxFare),multiplier:Number(pricingDraft.multiplier),priority:Number(pricingDraft.priority),active:true})}); setPricingDraft({...pricingDraft,name:""}); await loadPricingRules(); showToast("success","Pricing rule created"); } catch(e) { showToast("error",e instanceof Error?e.message:"Unable to save pricing rule"); }
  }, [apiRequest, loadPricingRules, pricingDraft, showToast]);

  const updatePricingRule = useCallback(async (rule: any) => {
    const baseFare = window.prompt("Base fare", String(rule.baseFare ?? 0));
    if (baseFare === null) return;
    const perKm = window.prompt("Per km", String(rule.perKm ?? 0));
    if (perKm === null) return;
    const perMinute = window.prompt("Per minute", String(rule.perMinute ?? 0));
    if (perMinute === null) return;
    const minFare = window.prompt("Minimum fare", String(rule.minFare ?? 0));
    if (minFare === null) return;
    const maxFare = window.prompt("Maximum fare", String(rule.maxFare ?? 0));
    if (maxFare === null) return;
    try { await apiRequest(`/admin/platform/pricing-rules/${rule.id}`, {method:"PATCH", body:JSON.stringify({baseFare:Number(baseFare),perKm:Number(perKm),perMinute:Number(perMinute),minFare:Number(minFare),maxFare:Number(maxFare)})}); await loadPricingRules(); showToast("success","Pricing rule updated"); } catch(e) { showToast("error",e instanceof Error?e.message:"Unable to update pricing rule"); }
  }, [apiRequest, loadPricingRules, showToast]);

  const renderPricing = () => {
    const rows = [
      ["Full Ride", "₹80 first 1.2 km", "₹2 / 200 m", "25%"],
      ["Shared Ride", "₹20 / passenger", "max 4", "25%"],
      ["Connection Ride", "₹10 first km", "₹20 / additional km / passenger", "25%"],
      ["Goods — E-Rickshaw", "₹200 first km", "₹50 / additional km", "25%"],
      ["Goods — Pickup Truck", "₹500 first km", "₹100 / additional km", "25%"],
    ];
    return (
      <div className="page">
        <SectionHeader title="Pricing & Commission" subtitle="RideX master fare rules and operational configuration">
        </SectionHeader>
        <div className="metrics-grid">
          <MetricCard label="Passenger Services" value="3" icon="driver" tone="success" />
          <MetricCard label="Goods Services" value="2" icon="vehicle" tone="warning" />
          <MetricCard label="Commission" value="25%" icon="percent" tone="info" />
          <MetricCard label="Surge" value="1.0x" icon="chart" tone="danger" />
        </div>
        <Panel title="Create / Manage Smart Pricing Rule" subtitle="Super Admin: rules stay within configured minimum/maximum boundaries">
          <div className="detail-grid">
            {Object.entries(pricingDraft).map(([key,val]) => <label key={key}><span className="field-label">{key}</span><input className="text-input" value={String(val)} onChange={e=>setPricingDraft(d=>({...d,[key]:e.target.value}))} /></label>)}
          </div>
          <div style={{display:"flex",gap:8,marginTop:12}}><button className="button primary" onClick={()=>void savePricingRule()}>Create Rule</button><button className="button secondary" onClick={()=>void loadPricingRules()}>Refresh Rules</button></div>
        </Panel>
        <Panel title="Configured Pricing Rules" subtitle={`${pricingRules.length} rule(s) loaded from backend`}>
          <div className="table-wrapper"><table><thead><tr><th>Name</th><th>Service</th><th>Vehicle</th><th>Base</th><th>Per Km</th><th>Per Minute</th><th>Min/Max</th><th>Multiplier</th><th>Priority</th><th>Action</th></tr></thead><tbody>{pricingRules.map((r:any)=><tr key={r.id}><td>{r.name}</td><td>{r.serviceType||r.bookingType||"ALL"}</td><td>{r.vehicleType||"ALL"}</td><td>₹{r.baseFare??0}</td><td>₹{r.perKm??0}</td><td>₹{r.perMinute??0}</td><td>₹{r.minFare??0} / ₹{r.maxFare??0}</td><td>{r.multiplier}x</td><td>{r.priority}</td><td><button className="button secondary small" onClick={()=>void updatePricingRule(r)}>Edit</button></td></tr>)}</tbody></table></div>
        </Panel>
      </div>
    );
  };

  const renderPayments = () => (
    <div className="page">
      <SectionHeader title="Payments & Settlement" subtitle="Live payment records from the RideX backend" onRefresh={() => void loadOperationsData()} />
      <Panel title="Payments" subtitle={operationLoading ? "Refreshing…" : `${paymentRows.length} records`}>
        <div className="table-wrapper"><table><thead><tr><th>Payment</th><th>Booking</th><th>Customer</th><th>Method</th><th>Amount</th><th>Status</th><th>Created</th></tr></thead><tbody>{paymentRows.map((row) => <tr key={row.id}><td>{row.id}</td><td>{row.bookingId}</td><td>{row.customer?.user?.mobile || row.customerId}</td><td>{row.method}</td><td>₹{Number(row.amount || 0).toFixed(2)}</td><td><StatusBadge value={row.status}/></td><td>{formatDate(row.createdAt)}</td></tr>)}{paymentRows.length===0?<tr><td colSpan={7}>No payments found.</td></tr>:null}</tbody></table></div>
      </Panel>
    </div>
  );

  const renderPromotions = () => (
    <div className="page">
      <SectionHeader title="Promotions" subtitle="Live coupons and campaign controls" onRefresh={() => void loadOperationsData()} actions={<button className="button primary" type="button" onClick={() => void createPromotion()}><Plus size={15}/> Create Promotion</button>} />
      <div className="content-grid two">{promotionRows.map((row) => <Panel key={row.id} title={row.code} subtitle={row.description || "Promotion"}><StatusBadge value={row.isActive ? "Active" : "Inactive"}/><div className="detail-grid"><div><span className="field-label">Discount</span><strong>{row.discountType === "PERCENTAGE" ? `${row.discountValue}%` : `₹${row.discountValue}`}</strong></div><div><span className="field-label">Usage</span><strong>{row.usageCount ?? 0}</strong></div></div><button className="button secondary small" type="button" onClick={() => void apiRequest(`/admin/promotions/${row.id}`, {method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({isActive:!row.isActive})}).then(()=>loadOperationsData())}> {row.isActive ? "Deactivate" : "Activate"}</button></Panel>)}{promotionRows.length===0?<Panel title="No promotions"><p>No live promotions found.</p></Panel>:null}</div>
    </div>
  );

  const renderSupport = () => (
    <div className="page">
      <SectionHeader title="Support & Disputes" subtitle="Live support cases from customers and drivers" onRefresh={() => void loadOperationsData()} />
      <Panel title="Open Cases">
        <div className="table-wrapper"><table><thead><tr><th>Case</th><th>Requester</th><th>Priority</th><th>Status</th><th>Updated</th><th>Action</th></tr></thead><tbody>{supportRows.map((row) => <tr key={row.id}><td>{row.id}</td><td>{row.customer?.fullName || row.driver?.fullName || "Unknown"}</td><td><StatusBadge value={row.priority}/></td><td><StatusBadge value={row.status}/></td><td>{formatDate(row.updatedAt)}</td><td><button className="button secondary small" type="button" onClick={() => void apiRequest(`/admin/support/cases/${row.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status: row.status === "RESOLVED" ? "OPEN" : "RESOLVED"})}).then(()=>loadOperationsData())}>{row.status === "RESOLVED" ? "Reopen" : "Resolve"}</button></td></tr>)}{supportRows.length===0?<tr><td colSpan={6}>No support cases found.</td></tr>:null}</tbody></table></div>
      </Panel>
    </div>
  );

  const renderNotifications = () => (
    <div className="page">
      <SectionHeader title="Notifications" subtitle="Send in-app operational messages to active customers and drivers" />
      <Panel title="Broadcast Notification">
        <div className="detail-grid"><label><span className="field-label">Audience</span><select className="select-input" value={notificationAudience} onChange={(e)=>setNotificationAudience(e.target.value)}><option value="ALL">All active users</option><option value="CUSTOMERS">Customers</option><option value="DRIVERS">Drivers</option></select></label><label><span className="field-label">Title</span><input className="text-input" value={notificationTitle} onChange={(e)=>setNotificationTitle(e.target.value)} placeholder="Notification title" /></label><label style={{gridColumn:'1 / -1'}}><span className="field-label">Message</span><textarea className="text-input" rows={5} value={notificationBody} onChange={(e)=>setNotificationBody(e.target.value)} placeholder="Write your message..." /></label></div>
        <button className="button primary" type="button" onClick={() => void sendBroadcast()}>Send Notification</button>
      </Panel>
    </div>
  );

  const renderSettings =
    () => {
      const groups = [
        { title: "OTP / SMS", keys: ["OTP_PROVIDER_URL", "OTP_PROVIDER_API_KEY", "OTP_PROVIDER_USERNAME", "OTP_PROVIDER_PASSWORD", "OTP_PROVIDER_SENDER_ID"] },
        { title: "Routing / Maps", keys: ["ROUTING_URL", "GOOGLE_MAPS_API_KEY"] },
        { title: "Payments", keys: ["PAYMENT_PROVIDER_URL", "PAYMENT_PROVIDER_API_KEY", "PAYMENT_PROVIDER_USERNAME", "PAYMENT_PROVIDER_PASSWORD"] },
      ];
      return (
        <div className="page">
          <SectionHeader title="System Settings / Integrations" subtitle="Configure online providers without editing application source code" />
          <div className="info-box"><strong>Security</strong><p>Provider secrets are encrypted before database storage. Google Maps mobile keys still need to be supplied at Expo/EAS build time; an already-built mobile app cannot safely replace its native map key at runtime.</p></div>
          <div className="content-grid two">
            {groups.map((group) => (
              <Panel key={group.title} title={group.title} subtitle="Super Admin only">
                {group.keys.map((key) => (
                  <div key={key} style={{marginBottom:14}}>
                    <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center"}}>
                      <span className="field-label">{key}</span>
                      <span className={`status ${integrationStatus[key]?.configured ? "success" : "warning"}`}>{integrationStatus[key]?.configured ? "Configured" : "Not configured"}</span>
                    </div>
                    <div style={{display:"flex",gap:8,marginTop:6}}>
                      <input className="text-input" type={key.includes("PASSWORD") || key.includes("API_KEY") ? "password" : "text"} value={integrationValues[key] ?? ""} onChange={(event) => setIntegrationValues((current) => ({...current, [key]: event.target.value}))} placeholder={integrationStatus[key]?.configured ? "Enter new value to replace" : "Enter value"} />
                      <button className="button primary" type="button" onClick={() => void saveIntegrationValue(key)}>Save</button>
                    </div>
                  </div>
                ))}
              </Panel>
            ))}
          </div>
          <button className="button secondary" type="button" onClick={() => void loadIntegrationStatus()} disabled={integrationLoading}>{integrationLoading ? "Refreshing…" : "Refresh integration status"}</button>
        </div>
      );
    };

  const renderCurrentScreen =
    () => {
      switch (currentScreen) {
        case "liveOperations":
          return renderLiveOperations();
        case "quickRide":
          return renderQuickRide();
        case "payments":
          return renderPayments();
        case "reports":
          return renderReports();
        case "pricing":
          return renderPricing();
        case "vehicles":
          return renderVehicles();
        case "promotions":
          return renderPromotions();
        case "support":
          return renderSupport();
        case "notifications":
          return renderNotifications();
        case "settings":
          return renderSettings();
        case "dashboard":
          return renderDashboard();

        case "drivers":
          return renderDrivers();

        case "bookings":
          return renderBookings();

        case "customers":
          return renderCustomers();

        case "safety":
          return renderSafety();

        case "admins":
          return renderAdmins();

        case "roles":
          return renderRoles();

        case "audit":
          return renderAudit();

        case "quickLocations":
          return renderQuickLocations();

        case "setup":
          return renderSetup();
        case "platform":
          return renderPlatform();

        default:
          return renderDashboard();
      }
    };

  if (!connected) {
    return (
      <>
        <style>{RIDEX_ADMIN_THEME}</style>
        <div className="login-shell">
          <div className="login-card">
            <div className="brand-block">
              <div className="brand-mark">
                R
              </div>

              <div>
                <h1>
                  RideX Admin
                </h1>
                <p>
                  Operations Control Panel
                </p>
              </div>
            </div>

            <div className="login-heading">
              <p className="eyebrow">
                {RIDEX_TEST_MODE ? "TEST / MVP ADMIN ACCESS" : "PRODUCTION ADMIN ACCESS"}
              </p>

              <h2>
                Connect to RideX
              </h2>

              <p>
                {RIDEX_TEST_MODE ? "Connect with the approved test Admin User ID." : "Verify the approved admin mobile with OTP to establish a secure session."}
              </p>
            </div>

            <form
              className="login-form"
              onSubmit={
                handleConnect
              }
            >
              <label>
                <span className="field-label">
                  Backend API Base URL
                </span>

                <input
                  className="text-input"
                  value={apiBaseUrl}
                  onChange={(event) =>
                    setApiBaseUrl(
                      event.target
                        .value
                    )
                  }
                  placeholder="http://localhost:4000/api/v1"
                />
              </label>

              {RIDEX_TEST_MODE && RIDEX_ALLOW_MOCK_DATA ? (
                <>
                  <label>
                    <span className="field-label">Admin User ID</span>
                    <input className="text-input" value={adminUserId} onChange={(event) => setAdminUserId(event.target.value)} placeholder="Approved Admin User ID" autoFocus />
                  </label>
                  <button className="button primary large" type="submit">Connect to Admin Panel</button>
                </>
              ) : (
                <>
                  <label><span className="field-label">Admin Mobile</span><input className="text-input" value={adminMobile} onChange={(event) => setAdminMobile(event.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" placeholder="10-digit admin mobile" autoFocus /></label>
                  <label><span className="field-label">OTP</span><input className="text-input" value={adminOtp} onChange={(event) => setAdminOtp(event.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="4-digit OTP" /></label>
                  <div style={{display:"flex",gap:10}}>
                    <button className="button secondary large" type="button" onClick={() => void sendAdminOtp()} disabled={adminAuthLoading}>Send OTP</button>
                    <button className="button primary large" type="button" onClick={() => void verifyAdminOtp()} disabled={adminAuthLoading}>Verify & Connect</button>
                  </div>
                </>
              )}
            </form>

            <div className="login-note">
              <strong>{RIDEX_TEST_MODE && RIDEX_ALLOW_MOCK_DATA ? "Test authentication" : "Session authentication"}</strong>
              <span>{RIDEX_TEST_MODE && RIDEX_ALLOW_MOCK_DATA ? "Mock mode is explicitly enabled for local UI-only testing." : "Backend-issued bearer session authentication is required; no Admin User ID header is used."}</span>
            </div>
          </div>
        </div>

        {toast ? (
          <div
            className={`toast ${toast.type}`}
          >
            {toast.message}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      <style>{RIDEX_ADMIN_THEME}</style>
      <div
      className={`admin-shell ${
        compactSidebar
          ? "sidebar-collapsed"
          : ""
      }`}
    >
      <aside
        className={`sidebar ${
          mobileNavOpen
            ? "mobile-open"
            : ""
        }`}
      >
        <div className="sidebar-brand">
          <div className="brand-mark">
            R
          </div>

          {!compactSidebar ? (
            <div>
              <strong>
                RideX
              </strong>
              <span>
                Admin Control
              </span>
            </div>
          ) : null}
        </div>

        <nav className="nav-list">
          {NAV_ITEMS.map(
            (item) => (
              <button
                key={item.id}
                className={`nav-item ${
                  currentScreen ===
                  item.id
                    ? "active"
                    : ""
                }`}
                type="button"
                onClick={() =>
                  navigate(
                    item.id
                  )
                }
                title={
                  compactSidebar
                    ? item.label
                    : undefined
                }
              >
                <span className="nav-icon">
                  <AppIcon name={item.icon} size={17} />
                </span>

                {!compactSidebar ? (
                  <span>
                    {item.label}
                  </span>
                ) : null}
              </button>
            )
          )}
        </nav>

        <div className="sidebar-footer">
          {!compactSidebar ? (
            <div className="admin-mini">
              <span className="online-dot" />
              <div>
                <strong>
                  Connected
                </strong>
                <span>
                  {shortId(
                    adminUserId,
                    22
                  )}
                </span>
              </div>
            </div>
          ) : null}

          <button
            className="nav-item"
            type="button"
            onClick={
              handleDisconnect
            }
            title="Disconnect"
          >
            <span className="nav-icon"><AppIcon name="close" size={17} /></span>

            {!compactSidebar ? (
              <span>
                Disconnect
              </span>
            ) : null}
          </button>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="icon-button menu-button"
              onClick={() =>
                setMobileNavOpen(
                  (current) =>
                    !current
                )
              }
              aria-label="Toggle menu"
            >
              ☰
            </button>

            <button
              type="button"
              className="icon-button collapse-button"
              onClick={() =>
                setCompactSidebar(
                  (current) =>
                    !current
                )
              }
              aria-label="Collapse sidebar"
            >
              {compactSidebar
                ? "→"
                : "←"}
            </button>

            <div className="breadcrumb">
              <span>
                RideX
              </span>

              <span>
                /
              </span>

              <strong>
                {NAV_ITEMS.find(
                  (item) =>
                    item.id ===
                    currentScreen
                )?.label ??
                  "Dashboard"}
              </strong>
            </div>
          </div>

          <div className="topbar-right">
            {globalLoading ? (
              <span className="topbar-loading">
                Syncing…
              </span>
            ) : null}

            <button
              className="button secondary small"
              type="button"
              onClick={
                refreshCurrentScreen
              }
            >
              ↻
            </button>

            <div className="api-pill">
              <span className="online-dot" />
              {RIDEX_TEST_MODE && RIDEX_ALLOW_MOCK_DATA ? "MOCK MODE" : "API Connected"}
            </div>
          </div>
        </header>

        <main className="content">
          {renderCurrentScreen()}
        </main>
      </div>

      {selectedDriver
        ? renderDriverDrawer()
        : null}

      {selectedBooking
        ? renderBookingDrawer()
        : null}

      {selectedCustomer
        ? renderCustomerDrawer()
        : null}

      {confirmation ? (
        <ConfirmationModal
          title={
            confirmation.title
          }
          description={
            confirmation.description
          }
          expectedText={
            confirmation.expectedText
          }
          value={
            confirmationValue
          }
          setValue={
            setConfirmationValue
          }
          onCancel={() => {
            if (
              !confirmationLoading
            ) {
              setConfirmation(
                null
              );
              setConfirmationValue(
                ""
              );
            }
          }}
          onConfirm={
            executeConfirmation
          }
          loading={
            confirmationLoading
          }
        />
      ) : null}

        {toast ? (
          <div
            className={`toast ${toast.type}`}
          >
            <strong>
              {toast.type ===
              "success"
                ? "Success"
                : toast.type ===
                    "error"
                ? "Error"
                : "Info"}
            </strong>

            <span>
              {toast.message}
            </span>
          </div>
        ) : null}
      </div>
    </>
  );
}

export default App;