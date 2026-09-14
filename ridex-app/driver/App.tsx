import React, { useEffect, useRef, useState } from "react";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import QRCode from "react-native-qrcode-svg";

import {
  Modal,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const API = (
  process.env.EXPO_PUBLIC_API_URL ||
  "http://localhost:4000/api/v1"
).replace(/\/+$/, "");

const DEFAULT_DRIVER_ID = process.env.EXPO_PUBLIC_DRIVER_ID || "";
const DRIVER_AUTH_TOKEN_KEY = "ridex_driver_auth_token_v1";
const DRIVER_SESSION_KEY = "ridex_driver_session_v1";
const RIDEX_TEST_MODE = String(process.env.EXPO_PUBLIC_RIDEX_TEST_MODE ?? "false").toLowerCase() === "true";

async function ridexFetch(input: RequestInfo | URL, init?: RequestInit) {
  const token = await AsyncStorage.getItem(DRIVER_AUTH_TOKEN_KEY);
  const headers = new Headers(init?.headers ?? {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

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
};

export default function App() {
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

  const [lastRequestCheck, setLastRequestCheck] =
    useState<string | null>(null);

  // Automatic new-booking popup.
  const [incomingRequest, setIncomingRequest] =
    useState<DriverRequest | null>(null);
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

  // =====================================================
  // UI NAVIGATION / AUTH
  // =====================================================

  type Screen =
    | "welcome" | "login" | "otp" | "home" | "serviceMode"
    | "request" | "accepted" | "arrived" | "trip" | "completed"
    | "history" | "earnings" | "profile" | "kyc" | "safety"
    | "sos" | "notifications" | "messages";

  const [screen, setScreen] = useState<Screen>("welcome");
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [driverId, setDriverId] = useState(DEFAULT_DRIVER_ID);
  const [driverVehicles, setDriverVehicles] = useState<any[]>([]);

  const DRIVER_HERO = require("./assets/driver-hero.png");
  const DRIVER_AVATAR = require("./assets/driver-avatar.png");
  const DRIVER_VEHICLE = require("./assets/driver-rickshaw.png");

  function goHome() {
    setIncomingRequest(null);
    setScreen("home");
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
    } catch {
      setOtp("");
      setScreen("otp");
      setAuthMessage("Test mode: use OTP 1234");
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

      const driver =
        data.data;
      setDriverVehicles(Array.isArray(driver?.vehicles) ? driver.vehicles : []);

      setOnline(
        driver?.driverStatus ===
          "ONLINE"
      );

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
    longitude: number
  ) {
    try {
      const response =
        await ridexFetch(
          `${API}/driver/${driverId}/location`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              latitude,
              longitude,
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

      const recordedAt =
        data.data?.recordedAt ||
        new Date().toISOString();

      setLastGpsUpdate(
        recordedAt
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
          recordedAt,
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
              pin:
                tripPin.trim(),
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
                longitude
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
  const pickup = currentLeg?.pickupAddress || booking?.pickupAddress || "Boring Road, Patna";
  const drop = currentLeg?.dropAddress || booking?.dropAddress || "Patna Junction";
  const vehicleLabel = booking?.goodsVehicleType === "PICKUP_TRUCK" ? "Pickup Truck" : "E-Rickshaw";

  const UI = {
    Header: ({back=false, help=true}:{back?:boolean;help?:boolean}) => (
      <View style={styles.header}>
        <Pressable style={styles.headerCircle} onPress={back ? goHome : () => {}}>
          <Text style={styles.headerCircleText}>{back ? "‹" : "☰"}</Text>
        </Pressable>
        <View style={styles.brandBlock}>
          <Text style={styles.logo}>Ride<Text style={styles.logoRed}>X</Text></Text>
          <Text style={styles.logoTag}>Your Ride, Your Way</Text>
        </View>
        {help ? (
          <Pressable style={styles.helpPill} onPress={() => setScreen("messages")}>
            <Text style={styles.helpIcon}>◉</Text><Text style={styles.helpText}>Help</Text>
          </Pressable>
        ) : <View style={{width:44}} />}
      </View>
    ),

    TopProfile: () => (
      <View style={styles.topProfile}>
        <Image source={DRIVER_AVATAR} style={styles.driverAvatar} />
        <View style={{flex:1,marginLeft:10}}>
          <View style={styles.onlinePill}><Text style={styles.onlineDot}>●</Text><Text style={styles.onlinePillText}>{online ? "Online" : "Offline"}</Text></View>
        </View>
        <Pressable style={styles.bellBtn} onPress={() => setScreen("notifications")}>
          <Text style={styles.bell}>♧</Text><View style={styles.notificationDot}/>
        </Pressable>
      </View>
    ),

    BottomNav: ({active}:{active:"home"|"rides"|"earnings"|"messages"|"profile"}) => {
      const items = [
        ["home","⌂","Home"],["rides","▣","Rides"],["earnings","▥","Earnings"],
        ["messages","▤","Messages"],["profile","♙","Profile"]
      ] as const;
      return (
        <View style={styles.bottomNav}>
          {items.map(([key,icon,label])=>(
            <Pressable key={key} style={[styles.navItem,active===key&&styles.navItemActive]}
              onPress={()=>setScreen(key as Screen)}>
              <Text style={[styles.navIcon,active===key&&styles.navIconActive]}>{icon}</Text>
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
    return (
      <View style={styles.map}>
        <View style={styles.water}/>
        <View style={[styles.road,styles.roadA]}/><View style={[styles.road,styles.roadB]}/><View style={[styles.road,styles.roadC]}/>
        <Text style={styles.ganga}>Ganga River</Text><Text style={styles.mapPatna}>Patna</Text>
        <View style={styles.route}><View style={styles.route1}/><View style={styles.route2}/><View style={styles.route3}/></View>
        <View style={[styles.mapMarker,styles.pickMarker]}><Text style={styles.markerWhite}>●</Text></View>
        <View style={[styles.mapMarker,styles.dropMarker]}><Text style={styles.markerWhite}>●</Text></View>
        <View style={styles.pickLabel}><Text style={styles.pickLabelGreen}>Pickup</Text><Text style={styles.mapLabelText}>{pickup}</Text></View>
        <View style={styles.dropLabel}><Text style={styles.pickLabelRed}>Drop</Text><Text style={styles.mapLabelText}>{drop}</Text></View>
        <Image source={DRIVER_VEHICLE} style={styles.mapVehicle}/>
        <View style={styles.mapActions}><Pressable style={styles.mapAction}><Text>⌖</Text></Pressable><Pressable style={styles.mapAction}><Text>➤</Text></Pressable></View>
      </View>
    );
  }

  function StatusBanner({title,sub,green=true}:{title:string;sub:string;green?:boolean}) {
    return <View style={[styles.statusBanner,green?styles.bannerGreen:styles.bannerRed]}>
      <View style={styles.statusIcon}><Text style={styles.statusIconText}>{green?"✓":"!"}</Text></View>
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
    return <View style={styles.benefitRow}><View style={styles.benefitIcon}><Text style={styles.benefitIconText}>{icon}</Text></View><Text style={styles.benefitText}>{title}</Text></View>;
  }

  function LoginScreen() {
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled">
      <UI.Header back/>
      <Image source={DRIVER_HERO} resizeMode="cover" style={styles.authHeroImage}/>
      <View style={styles.driverBadgeCenter}><Text style={styles.driverBadgeText}>Driver App</Text></View>
      <Text style={styles.authTitle}>Login as Driver</Text>
      <Text style={styles.authSub}>Enter your mobile number to continue</Text>
      <View style={styles.authCard}>
        <View style={styles.phoneBox}><Text style={styles.country}>+91</Text><View style={styles.vDivider}/><TextInput style={styles.phoneInput} placeholder="Enter your mobile number" placeholderTextColor="#9AA4B5" keyboardType="phone-pad" maxLength={10} value={mobile} onChangeText={setMobile}/></View>
        <Primary title={authLoading?"Sending...":"Send OTP"} onPress={sendOtp} disabled={authLoading}/>
        <Text style={styles.orLine}>Or continue with</Text>
        <Outline title="Continue with Google" onPress={()=>setScreen("home")}/>
        <View style={styles.authValueCard}><View style={{flex:1}}><FeatureRow icon="₹" title="Earn More"/><FeatureRow icon="◷" title="Flexible Hours"/><FeatureRow icon="✓" title="Safe & Secure"/></View><Image source={DRIVER_VEHICLE} style={styles.authVehicleImage}/></View>
        <Text style={styles.bottomScript}>Driver Bano{"\n"}Apni Pehchaan Banao</Text>
        <Text style={styles.authMessage}>{authMessage}</Text>
      </View>
    </ScrollView></SafeAreaView>;
  }

  function OtpScreen() {
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled">
      <UI.Header back/>
      <Image source={DRIVER_HERO} resizeMode="cover" style={styles.authHeroImage}/>
      <View style={styles.driverBadgeCenter}><Text style={styles.driverBadgeText}>Driver App</Text></View>
      <Text style={styles.authTitle}>Verify OTP</Text>
      <Text style={styles.authSub}>We have sent a 6-digit OTP to</Text>
      <Text style={styles.phoneDisplay}>+91 {mobile}</Text>
      <View style={styles.otpRow}>{[0,1,2,3].map(i=><TextInput key={i} value={otp[i]||""} style={styles.otpCell} maxLength={1} keyboardType="number-pad" onChangeText={v=>{const next=otp.split("");next[i]=(v||"").slice(-1);setOtp(next.join("").replace(/\D/g,"").slice(0,4))}}/>)}</View>
      <Text style={styles.resend}>Resend OTP in <Text style={styles.greenText}>00:25</Text></Text>
      <Primary title={authLoading?"Verifying...":"Verify & Continue"} onPress={verifyOtp} disabled={authLoading}/>
      <Text style={styles.bottomScript}>Saath Chalenge{"\n"}Behtar Shehar Banayenge</Text>
      <Text style={styles.authMessage}>{authMessage || (RIDEX_TEST_MODE ? "Test OTP: 1234" : "Enter the OTP sent to your mobile")}</Text>
    </ScrollView></SafeAreaView>;
  }

  function HomeScreen() {
    return <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={{padding:16,paddingBottom:100}} showsVerticalScrollIndicator={false}>
        <UI.TopProfile/>
        <View style={styles.homeBrandLine}><View><Text style={styles.hello}>Hello, Ravi Kumar</Text><Text style={styles.helloSub}>Drive Safe, Earn More!</Text></View><Pressable onPress={toggleOnline} style={[styles.onlineToggle,online&&styles.onlineToggleOn]}><Text style={styles.onlineToggleText}>{online?"Online":"Offline"}</Text><View style={styles.toggleKnob}/></Pressable></View>
        <View style={styles.summaryRow}><View style={styles.todayEarn}><Text style={styles.todayLabel}>Today's Earnings</Text><Text style={styles.todayValue}>₹580.00</Text><Text style={styles.moreArrow}>›</Text></View><Metric title="Today's Rides" value="8"/><Metric title="Online Time" value="5h 20m"/></View>
        <View style={styles.featureStrip}>
          {[
            ["▣","Ride History","history","#FDEDEE"],["▣","Wallet","support","#EFE8FF"],["▥","Earnings","earnings","#FFF1D9"],["◉","Support","messages","#E7F8EF"]
          ].map(x=><Pressable key={x[1]} style={styles.featureItem} onPress={()=>x[2]==="history"?setScreen("history"):x[2]==="earnings"?setScreen("earnings"):setScreen("messages")}><View style={[styles.featureCircle,{backgroundColor:x[3]}]}><Text>{x[0]}</Text></View><Text style={styles.featureLabel}>{x[1]}</Text></Pressable>)}
        </View>
        <View style={styles.promo}><View style={{flex:1}}><Text style={styles.promoTitle}>More Rides{"\n"}More Earnings</Text><Text style={styles.promoSub}>Keep your app online to get more ride requests.</Text></View><Image source={DRIVER_VEHICLE} style={styles.promoVehicle}/></View>
        <View style={styles.activity}><View style={styles.activityHeader}><Text style={styles.sectionTitle}>Today's Activity</Text><Pressable onPress={()=>setScreen("history")}><Text style={styles.link}>View All ›</Text></Pressable></View>
        {[
          ["8:15 PM","Completed Ride","Boring Road → Patna Junction","₹70.00",true],
          ["7:32 PM","Completed Ride","Kankarbagh → Boring Road","₹60.00",true],
          ["6:20 PM","Completed Ride","Patna Zoo → Bailey Road","₹50.00",true],
          ["5:10 PM","Cancelled Ride","Danapur → Boring Road","₹0.00",false],
        ].map(r=><View key={r[0] as string} style={styles.activityRow}><Text style={styles.activityTime}>{r[0]}</Text><View style={[styles.activityDot,{backgroundColor:r[4]?"#0AA35A":COLORS.red}]}/><View style={{flex:1}}><Text style={styles.activityTitle}>{r[1]}</Text><Text style={styles.activitySub}>{r[2]}</Text></View><Text style={styles.activityFare}>{r[3]}</Text></View>)}
        </View>
        <Pressable style={styles.serviceShortcut} onPress={()=>setScreen("serviceMode")}><Text style={styles.shortLabel}>Today's Service Mode</Text><Text style={styles.shortValue}>{serviceMode}</Text><Text style={styles.link}>Edit ›</Text></Pressable>
      </ScrollView><UI.BottomNav active="home"/>
    </SafeAreaView>;
  }

  function ServiceModeScreen() {
    const hasRickshaw = driverVehicles.some((v:any) => v?.vehicleType === "E_RICKSHAW" && ["ACTIVE","VERIFIED"].includes(String(v?.status)));
    const hasPickup = driverVehicles.some((v:any) => v?.vehicleType === "PICKUP_TRUCK" && v?.goodsEligible !== false && ["ACTIVE","VERIFIED"].includes(String(v?.status)));
    const modes = [
      ...(hasRickshaw ? [["PASSENGER","Passenger + Parcel","Passenger rides and eligible Parcel delivery","🚕","#EAF8F1",["Full / Shared / Connection rides","Parcel delivery","E-Rickshaw only"]]] : []),
      ...(hasPickup ? [["GOODS","Goods Availability","Battery Pickup Truck • Goods only","🛻","#F1ECFF",["Goods only","Duration booking","No passenger / parcel"]]] : []),
      ...(hasRickshaw && hasPickup ? [["BOTH","Both Services","Receive Passenger/Parcel + Goods requests","▱","#FFF5E4",["Use both eligible vehicles","Flexible work options","More requests"]]] : [])
    ] as const;
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={{padding:16,paddingBottom:100}}>
      <UI.Header back/><Text style={styles.pageTitle}>Service Mode</Text><Text style={styles.pageSub}>Choose the type of rides you want to receive</Text>
      <View style={styles.infoGreen}><Text style={styles.infoIcon}>⚙</Text><Text style={styles.infoText}>You can change your service mode anytime.</Text></View>
      {modes.map(m=><Pressable key={m[0]} style={[styles.modeCard,{backgroundColor:m[4]},serviceMode===m[0]&&styles.modeSelected]} onPress={()=>changeServiceMode(m[0])}><View style={styles.modeVehicleBox}><Text style={styles.modeEmoji}>{m[3]}</Text></View><View style={{flex:1}}><Text style={styles.modeTitle}>{m[1]}</Text><Text style={styles.modeSub}>{m[2]}</Text>{m[5].map(x=><Text key={x} style={styles.checkLine}>✓ {x}</Text>)}</View><Text style={styles.radio}>{serviceMode===m[0]?"◉":"○"}</Text></Pressable>)}
<View style={styles.infoGreen}><Text style={styles.infoText}>Parcel service follows Passenger E-Rickshaw eligibility. Goods is available only to the Battery Pickup Truck.</Text></View>      <Primary title="Save & Continue" onPress={goHome}/>
    </ScrollView></SafeAreaView>;
  }

  function RequestScreen() {
    const req=activeRequest;
    if(!req) return <HomeScreen/>;
    const reqFare=money(getRequestLeg(req)?.estimatedFare ?? req.booking?.estimatedFare ?? 70);
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={{padding:16,paddingBottom:30}}>
      <View style={styles.requestHead}><UI.Header help={false}/><Text style={styles.requestTitle}>New Ride Request</Text><Text style={styles.requestSub}>A new ride request is nearby!</Text><View style={styles.timer}><Text style={styles.timerNum}>25</Text><Text style={styles.timerText}>seconds</Text></View></View>
      <MapCard/>
      <View style={styles.requestCard}>
        <View style={styles.threeMetrics}><Metric title="Distance" value={`${distance.toFixed(1)} km`}/><Metric title="Estimated Fare" value={`₹${reqFare}`} accent/><Metric title="Pickup Time" value={`${eta} min`}/></View>
        <View style={styles.customerCard}><View style={styles.customerAvatar}><Text>AK</Text></View><View style={{flex:1}}><Text style={styles.customerName}>{customerName}</Text><Text style={styles.customerRating}>★ 4.8 (120 rides)</Text></View><Pressable style={styles.actionCircle}><Text>☎</Text></Pressable><Pressable style={styles.actionCircleBlue}><Text>▤</Text></Pressable></View>
        <View style={styles.locationGrid}><View><Text style={styles.locationGreen}>● Pickup Location</Text><Text style={styles.locationText}>{pickup}</Text><Text style={styles.locationSub}>Near ICICI Bank</Text></View><View><Text style={styles.locationRed}>● Drop Location</Text><Text style={styles.locationText}>{drop}</Text><Text style={styles.locationSub}>Platform No. 1</Text></View></View>
        <View style={styles.note}><Text style={styles.requestNoteTitle}>{req.booking?.bookingType==="GOODS"?"Goods":"Note from Passenger"}</Text><Text style={styles.noteText}>{req.booking?.bookingType==="GOODS"?`${req.booking?.goodsType||"Parcel"} • ${req.booking?.goodsWeightKg??50} kg • ${vehicleLabel}`:"I will be waiting near the main gate."}</Text></View>
        <View style={styles.acceptRow}><Pressable style={styles.decline} onPress={()=>{rejectRide(req.id);setIncomingRequest(null);goHome()}}><Text style={styles.declineText}>× Decline</Text></Pressable><Pressable style={styles.accept} onPress={()=>acceptRide(req)}><Text style={styles.acceptText}>✓ Accept Ride</Text></Pressable></View>
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
        <View style={styles.customerCard}><Image source={DRIVER_AVATAR} style={styles.customerPhoto}/><View style={{flex:1}}><Text style={styles.customerName}>{customerName}</Text><Text style={styles.customerRating}>★ 4.8 (120 rides)</Text><Text style={styles.customerSub}>1 Passenger</Text></View><Pressable style={styles.actionCircle}><Text>☎</Text></Pressable><Pressable style={styles.actionCircleBlue}><Text>▤</Text></Pressable></View>
        <View style={styles.locationGrid}><View><Text style={styles.locationGreen}>● Pickup Location</Text><Text style={styles.locationText}>{pickup}</Text><Text style={styles.locationSub}>Near ICICI Bank</Text></View><View><Text style={styles.locationRed}>● Drop Location</Text><Text style={styles.locationText}>{drop}</Text><Text style={styles.locationSub}>Platform No. 1</Text></View></View>
        <View style={styles.fareRow}><Metric title="Estimated Fare" value={`₹${fare}`} accent/><Metric title="Payment" value="Cash"/></View>
        {kind==="arrived" ? <View style={styles.pinCard}><Text style={styles.pinTitle}>🔐 Ride Verification</Text><Text style={styles.pinSub}>Choose OTP or QR before starting the ride.</Text><View style={{flexDirection:"row",gap:8,marginTop:10}}><Pressable style={[styles.actionCircleBlue,verificationMethod==="OTP"&&styles.modeSelected]} onPress={()=>void prepareVerification("OTP")}><Text>OTP</Text></Pressable><Pressable style={[styles.actionCircleBlue,verificationMethod==="QR"&&styles.modeSelected]} onPress={()=>void prepareVerification("QR")}><Text>QR</Text></Pressable></View>{verificationMethod==="OTP"?<TextInput value={tripPin} onChangeText={v=>setTripPin(v.replace(/\D/g,"").slice(0,4))} style={styles.pinInput} keyboardType="number-pad" maxLength={4} placeholder="OTP" placeholderTextColor="#9CA5B3"/>:qrPayload?<View style={{alignItems:"center",padding:12}}><QRCode value={qrPayload} size={190}/><Text style={styles.pinSub}>Expires {verificationExpiresAt ? new Date(verificationExpiresAt).toLocaleTimeString() : "soon"}</Text></View>:<Text style={styles.pinSub}>Tap QR to generate.</Text>}</View>:null}
        {kind==="trip" ? <View style={styles.tripDetails}><Text style={styles.sectionTitle}>Trip Details</Text><Text style={styles.detailLine}>🟢 {pickup}<Text style={styles.detailTime}>08:15 PM</Text></Text><Text style={styles.detailLine}>🔴 {drop}<Text style={styles.detailTime}>08:25 PM (ETA)</Text></Text></View>:null}
        {kind==="accepted" ? <Primary title="Start Navigation" onPress={()=>{}}/> : kind==="arrived" ? <><Primary title="Start Trip" onPress={startRide} disabled={!canStart||loading}/><Outline title="Passenger Not Matching?" onPress={()=>setScreen("safety")}/></> : <><Pressable style={styles.endTrip} onPress={completeRide} disabled={!canComplete||loading}><Text style={styles.endTripText}>Ⅱ End Trip</Text></Pressable><Outline title="Contact Support" onPress={()=>setScreen("messages")}/></>}
      </View>
    </ScrollView></SafeAreaView>;
  }

  function CompletedScreen() {
    const earning=lastCompletion?.driverEarning??70;
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={{padding:16,paddingBottom:30}}>
      <UI.Header back/><StatusBanner title="Trip Completed!" sub="Great job! You have successfully completed the ride."/>
      <View style={styles.earnedHero}><Text style={styles.earnedLabel}>Total Fare Earned</Text><Text style={styles.earnedValue}>₹{money(earning)}</Text><Text style={styles.cashPill}>$ Cash Payment</Text></View>
      <View style={styles.rideCard}><View style={styles.customerCard}><Image source={DRIVER_AVATAR} style={styles.customerPhoto}/><View style={{flex:1}}><Text style={styles.customerName}>{customerName}</Text><Text style={styles.customerRating}>★ 4.8 (120 rides)</Text><Text style={styles.customerSub}>1 Passenger</Text></View><Text style={styles.sectionTitle}>Trip Rating</Text></View><View style={styles.locationStack}><Text>🟢 {pickup}</Text><Text>🔴 {drop}</Text><Text>🛣 {distance.toFixed(1)} km   ◷ 13 min</Text></View></View>
      <View style={styles.keepUp}><Text style={styles.keepUpTitle}>🏆 Keep it up!</Text><Text style={styles.keepUpSub}>You are making cities move better. 🛺💚</Text></View>
      <View style={styles.rateCard}><Text style={styles.sectionTitle}>How was your passenger?</Text><Text style={styles.stars}>☆ ☆ ☆ ☆ ☆</Text><Text style={styles.rateHint}>Tap to rate (Optional)</Text></View>
      <Primary title="Go Online for Next Ride" onPress={()=>{setLastCompletion(null);goHome()}}/><Outline title="Back to Home" onPress={goHome}/>
    </ScrollView></SafeAreaView>;
  }

  function HistoryScreen() {
    const rows=[["12 Sep 2025, 08:15 PM","Boring Road, Patna","Patna Junction","₹70.00","Completed"],["12 Sep 2025, 07:32 PM","Kankarbagh, Patna","Boring Road","₹60.00","Completed"],["12 Sep 2025, 06:20 PM","Patna Zoo","Bailey Road","₹50.00","Completed"],["12 Sep 2025, 05:10 PM","Danapur","Boring Road","₹0.00","Cancelled"],["12 Sep 2025, 04:18 PM","Rajendra Nagar","Patna Junction","₹65.00","Completed"]];
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={{padding:16,paddingBottom:100}}><UI.TopProfile/><Text style={styles.pageTitle}>Ride History</Text><Text style={styles.pageSub}>Your completed, cancelled and all rides</Text><View style={styles.filterRow}>{["All Rides","Completed","Cancelled","Earnings"].map((x,i)=><Pressable key={x} style={[styles.filterPill,i===0&&styles.filterActive]}><Text style={[styles.filterText,i===0&&styles.filterActiveText]}>{x}</Text></Pressable>)}</View>{rows.map(r=><View key={r[0]} style={styles.historyCard}><View style={styles.historyTop}><Text style={styles.historyDate}>{r[0]}</Text><Text style={[styles.historyStatus,r[4]==="Cancelled"?styles.statusCancelled:styles.statusCompleted]}>{r[4]}</Text></View><Text style={styles.historyRoute}>🟢 {r[1]}</Text><Text style={styles.historyRoute}>🔴 {r[2]}</Text><View style={styles.historyBottom}><Text style={styles.historyFare}>{r[3]}</Text><Text style={styles.historyChevron}>›</Text></View></View>)}</ScrollView><UI.BottomNav active="rides"/></SafeAreaView>;
  }

  function EarningsScreen() {
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={{padding:16,paddingBottom:100}}><UI.TopProfile/><Text style={styles.pageTitle}>Earnings</Text><Text style={styles.pageSub}>Track your income and payouts</Text><View style={styles.filterRow}>{["Today","This Week","This Month","Custom"].map((x,i)=><Pressable key={x} style={[styles.filterPill,i===0&&styles.filterActive]}><Text style={[styles.filterText,i===0&&styles.filterActiveText]}>{x}</Text></Pressable>)}</View><View style={styles.earningsHero}><Text style={styles.earningsLabel}>Today's Earnings</Text><Text style={styles.earningsValue}>₹580.00</Text><View style={styles.earnStats}><Text>₹72.50{"\n"}Avg. per Ride</Text><Text>5h 20m{"\n"}Online Time</Text><Text>128.4 km{"\n"}Total Distance</Text></View></View><View style={styles.fourCards}><Metric title="Total Earnings" value="₹12,480"/><Metric title="Wallet Balance" value="₹2,340"/><Metric title="Next Payout" value="₹4,200"/><Metric title="Total Rides" value="186"/></View><Text style={styles.sectionTitle}>Earnings Breakdown</Text>{[["12 Sep 2025","8 Rides","₹580.00"],["11 Sep 2025","6 Rides","₹420.00"],["10 Sep 2025","7 Rides","₹510.00"],["09 Sep 2025","5 Rides","₹360.00"],["08 Sep 2025","8 Rides","₹600.00"]].map(r=><View key={r[0]} style={styles.breakRow}><Text>▣ {r[0]}</Text><Text>{r[1]}</Text><Text style={styles.breakFare}>{r[2]} ›</Text></View>)}<Primary title="View Payout History" onPress={()=>{}}/></ScrollView><UI.BottomNav active="earnings"/></SafeAreaView>;
  }

  function ProfileScreen() {
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={{padding:16,paddingBottom:100}}><UI.Header back/><Text style={styles.pageTitle}>Driver Profile</Text><Text style={styles.pageSub}>Manage your profile, documents and settings</Text><View style={styles.profileCard}><Image source={DRIVER_AVATAR} style={styles.profilePhoto}/><View style={{flex:1}}><Text style={styles.profileName}>Ravi Kumar</Text><Text style={styles.profileMeta}>+91 9122160691</Text><Text style={styles.profileRating}>★ 4.8 (320 rides)</Text><Text style={styles.profileMeta}>Member since Sep 2025</Text></View><View style={styles.profileOnline}><Text style={styles.profileOnlineText}>{online?"✓ Online":"○ Offline"}</Text></View></View><View style={styles.profileStats}><Metric title="320" value="Total Rides"/><Metric title="4.8" value="Rating"/><Metric title="6 Months" value="With RideX"/></View>{[["▣","KYC Documents","Aadhaar, PAN, Driving License, etc.",()=>setScreen("kyc")],["🚕","Vehicle Details","E-Rickshaw / Vehicle info",()=>setScreen("kyc")],["⚙","Service Mode","Passenger / Parcel / Goods / Both",()=>setScreen("serviceMode")],["▦","Bank & Payout Details","Manage your bank account",()=>{}],["⚙","App Settings","Notifications, Language, etc.",()=>{}],["◉","Help & Support","Get help anytime",()=>setScreen("messages")]].map(x=><Pressable key={x[1] as string} style={styles.profileRow} onPress={x[3] as any}><Text style={styles.profileRowIcon}>{x[0] as string}</Text><View style={{flex:1}}><Text style={styles.profileRowTitle}>{x[1] as string}</Text><Text style={styles.profileRowSub}>{x[2] as string}</Text></View><Text style={styles.historyChevron}>›</Text></Pressable>)}<Pressable style={styles.logout} onPress={async()=>{try{await ridexFetch(`${API}/auth/logout`,{method:"POST"});}catch{} await AsyncStorage.multiRemove([DRIVER_AUTH_TOKEN_KEY,DRIVER_SESSION_KEY]); setDriverId(""); setScreen("login");}}><Text style={styles.logoutText}>⇱ Logout</Text><Text style={styles.logoutText}>›</Text></Pressable></ScrollView><UI.BottomNav active="profile"/></SafeAreaView>;
  }

  function KycScreen() {
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={{padding:16,paddingBottom:30}}><UI.Header back/><Text style={styles.pageTitle}>KYC & Vehicle Details</Text><Text style={styles.pageSub}>Complete your verification to start receiving rides</Text><View style={styles.sectionBar}><Text style={styles.sectionTitle}>KYC Documents</Text><Text style={styles.verified}>✓ Verified</Text></View>{[["Aadhaar Card","ID Proof"],["PAN Card","Tax Identification"],["Driving License","Driving Authorization"],["Selfie / Live Photo","For identity verification"]].map(x=><View key={x[0]} style={styles.docRow}><View style={styles.docIcon}>▣</View><View style={{flex:1}}><Text style={styles.docTitle}>{x[0]} <Text style={styles.verified}>✓ Verified</Text></Text><Text style={styles.docSub}>{x[1]}</Text></View><View style={styles.docThumb}><Text>▤</Text></View></View>)}<View style={styles.sectionBar}><Text style={styles.sectionTitle}>Vehicle Details</Text><Text style={styles.verified}>✓ Verified</Text></View>{[["Vehicle Type","E-Rickshaw (Passenger)"],["Vehicle Number","BR01ER1234"],["RC (Registration Certificate)","Vehicle registration proof"],["Insurance","Valid insurance document"],["Permit (if required)","Commercial permit / fitness"]].map(x=><View key={x[0]} style={styles.docRow}><View style={styles.docIcon}>▣</View><View style={{flex:1}}><Text style={styles.docTitle}>{x[0]}</Text><Text style={styles.docSub}>{x[1]}</Text></View><Text style={styles.editTag}>Edit</Text></View>)}<Primary title="Update Details" onPress={()=>{}}/></ScrollView></SafeAreaView>;
  }

  function SafetyScreen() {
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={{padding:16,paddingBottom:100}}><UI.Header back/><Text style={styles.pageTitle}>Safety & Support</Text><Text style={styles.pageSub}>Your safety is our priority</Text><View style={styles.safetyHero}><View style={{flex:1}}><Text style={styles.safetyTitle}>Drive Safe, Stay Secure</Text><Text style={styles.safetySub}>We are always here for you</Text></View><Text style={styles.safetyPerson}>👨🏻</Text></View><View style={styles.safetyTiles}><Pressable style={styles.safetyTileRed} onPress={()=>setScreen("sos")}><Text style={styles.safetyCircle}>SOS</Text><Text style={styles.safetyTileTitle}>Emergency SOS</Text><Text style={styles.tileSub}>Get help instantly</Text></Pressable><Pressable style={styles.safetyTileGreen} onPress={()=>setScreen("messages")}><Text style={styles.safetyCircle}>☎</Text><Text style={styles.safetyTileTitle}>Call Support</Text><Text style={styles.tileSub}>Talk to our team</Text></Pressable><Pressable style={styles.safetyTileBlue} onPress={()=>setScreen("messages")}><Text style={styles.safetyCircle}>▤</Text><Text style={styles.safetyTileTitle}>Live Chat</Text><Text style={styles.tileSub}>Chat with support</Text></Pressable></View>{["Share Live Location","Emergency Contacts","Safety Tips","Report an Issue","Help Center","App Guidelines"].map(x=><Pressable key={x} style={styles.safetyRow} onPress={()=>setScreen("messages")}><View style={styles.safetyRowIcon}><Text>✓</Text></View><View style={{flex:1}}><Text style={styles.profileRowTitle}>{x}</Text><Text style={styles.profileRowSub}>Tap to manage or view details</Text></View><Text>›</Text></Pressable>)}<View style={styles.safetyFooter}><Text style={styles.safetyFooterTitle}>✓ You are not alone</Text><Text style={styles.safetyFooterSub}>Our team is available 24/7 to support you</Text></View></ScrollView><UI.BottomNav active="home"/></SafeAreaView>;
  }

  function SosScreen() {
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.authScroll}><UI.Header back/><Text style={styles.pageTitle}>Emergency SOS</Text><Text style={styles.pageSub}>We are getting you help</Text><Pressable style={styles.sosBig} onPress={()=>setMessage("Emergency alert sent")}><Text style={styles.sosPhone}>☎</Text><Text style={styles.sosBigText}>SOS</Text></Pressable><Text style={styles.sosAlert}>Emergency Alert Sent</Text><Text style={styles.sosHelp}>Help is on the way</Text><View style={styles.sosPanel}><Text>🚨 Your live location has been shared with</Text><Text>✓ RideX Support Team</Text><Text>✓ Your Emergency Contacts</Text><Text>✓ Local Police (112)</Text></View><View style={styles.locationBox}><Text style={styles.sectionTitle}>Your Current Location</Text><Text>{pickup}</Text><Outline title="View on Map" onPress={goHome}/></View><Pressable style={styles.cancelSos} onPress={()=>setScreen("safety")}><Text style={styles.cancelSosText}>■ Cancel SOS</Text></Pressable><View style={styles.infoBlue}><Text style={styles.infoBlueTitle}>ⓘ Important</Text><Text>Use SOS only in genuine emergency situations.</Text></View></ScrollView></SafeAreaView>;
  }

  function NotificationsScreen() {
    const notes=[["New Ride Request","Pickup: Boring Road, Patna","2 min ago","green"],["Ride Completed","You earned ₹70.00","15 min ago","green"],["Payout Processed","₹1,250.00 has been credited to your bank","1 hour ago","purple"],["You Received a Rating","Passenger rated you 5 ★","2 hours ago","yellow"],["Important Update","New incentive scheme is live!","5 hours ago","blue"],["Account Alert","Please upload your vehicle insurance","1 day ago","red"],["Message from Support","Your query has been resolved.","1 day ago","green"],["Special Offer","Earn up to ₹500 extra this weekend!","2 days ago","purple"]];
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={{padding:16,paddingBottom:100}}><UI.TopProfile/><Text style={styles.pageTitle}>Notifications</Text><Text style={styles.pageSub}>Stay updated with your rides, earnings and more</Text><View style={styles.filterRow}>{["All","Rides","Earnings","Account","Offers"].map((x,i)=><Pressable key={x} style={[styles.filterPill,i===0&&styles.filterActive]}><Text style={[styles.filterText,i===0&&styles.filterActiveText]}>{x}</Text></Pressable>)}</View>{notes.map(n=><Pressable key={n[0]} style={styles.notificationRow}><View style={styles.noteIcon}><Text>●</Text></View><View style={{flex:1}}><Text style={styles.noteTitle}>{n[0]}</Text><Text style={styles.noteSub}>{n[1]}</Text></View><Text style={styles.noteTime}>{n[2]}</Text><Text>›</Text></Pressable>)}</ScrollView><UI.BottomNav active="messages"/></SafeAreaView>;
  }

  function MessagesScreen() {
    const msgs=[["Priya Sharma","I am near the main gate","08:14 PM","2"],["Rahul Verma","Thanks for the ride! 👍","Yesterday","1"],["RideX Support","Your query has been resolved....","Yesterday",""],["RideX Updates","New Incentive Scheme is Live!","2 Sep",""],["Neha Singh","Where are you?","1 Sep",""],["Amit Kumar","Please come to the back side","31 Aug",""]];
    return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={{padding:16,paddingBottom:100}}><UI.TopProfile/><Text style={styles.pageTitle}>Messages & Support</Text><Text style={styles.pageSub}>Chat with riders and get help from our support team</Text><View style={styles.filterRow}>{["Chats","Support","FAQ"].map((x,i)=><Pressable key={x} style={[styles.filterPill,i===0&&styles.filterActive]}><Text style={[styles.filterText,i===0&&styles.filterActiveText]}>{x}</Text></Pressable>)}</View>{msgs.map(m=><Pressable key={m[0]} style={styles.messageRow}><View style={styles.messageAvatar}><Text>{m[0]==="Priya Sharma"?"PS":m[0]==="Rahul Verma"?"RV":"●"}</Text></View><View style={{flex:1}}><Text style={styles.messageName}>{m[0]}</Text><Text style={styles.messagePreview}>{m[1]}</Text></View><View><Text style={styles.messageTime}>{m[2]}</Text>{m[3]?<Text style={styles.unread}>{m[3]}</Text>:null}</View><Text>›</Text></Pressable>)}<View style={styles.supportBox}><Text style={styles.supportTitle}>Need Help?</Text><Text style={styles.supportSub}>Our support team is available 24/7 to help you with any issue.</Text><Primary title="Chat with Support" onPress={()=>{}}/></View><View style={styles.supportActions}><Outline title="Call Support" onPress={()=>{}}/><Outline title="Raise a Ticket" onPress={()=>{}}/></View></ScrollView><UI.BottomNav active="messages"/></SafeAreaView>;
  }

  return (
    <>
      {incomingRequest && screen !== "request" ? <Modal transparent visible animationType="slide" onRequestClose={()=>setIncomingRequest(null)}><View style={styles.modalOverlay}><View style={styles.quickModal}><Text style={styles.quickTitle}>New Ride Request</Text><Text style={styles.quickSub}>A new ride request is nearby!</Text><View style={styles.acceptRow}><Pressable style={styles.decline} onPress={()=>setIncomingRequest(null)}><Text style={styles.declineText}>Later</Text></Pressable><Pressable style={styles.accept} onPress={()=>setScreen("request")}><Text style={styles.acceptText}>View Request</Text></Pressable></View></View></View></Modal> : null}
      {screen==="welcome"&&<WelcomeScreen/>}
      {screen==="login"&&<LoginScreen/>}
      {screen==="otp"&&<OtpScreen/>}
      {screen==="home"&&<HomeScreen/>}
      {screen==="serviceMode"&&<ServiceModeScreen/>}
      {screen==="request"&&<RequestScreen/>}
      {screen==="accepted"&&<ActiveRide kind="accepted"/>}
      {screen==="arrived"&&<ActiveRide kind="arrived"/>}
      {screen==="trip"&&<ActiveRide kind="trip"/>}
      {screen==="completed"&&<CompletedScreen/>}
      {screen==="history"&&<HistoryScreen/>}
      {screen==="earnings"&&<EarningsScreen/>}
      {screen==="profile"&&<ProfileScreen/>}
      {screen==="kyc"&&<KycScreen/>}
      {screen==="safety"&&<SafetyScreen/>}
      {screen==="sos"&&<SosScreen/>}
      {screen==="notifications"&&<NotificationsScreen/>}
      {screen==="messages"&&<MessagesScreen/>}
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
  authMessage:{textAlign:"center",color:COLORS.red,marginTop:8},otpRow:{flexDirection:"row",justifyContent:"space-between",marginVertical:20},otpCell:{width:45,height:56,borderWidth:1.5,borderColor:"#D5DDE7",borderRadius:12,textAlign:"center",fontSize:24,fontWeight:"800"},resend:{textAlign:"center",color:COLORS.muted,marginBottom:6},greenText:{color:COLORS.green,fontWeight:"900"},
  topProfile:{flexDirection:"row",alignItems:"center",paddingVertical:5},driverAvatar:{width:58,height:58,borderRadius:29,borderWidth:2,borderColor:"#fff"},onlinePill:{alignSelf:"flex-start",flexDirection:"row",alignItems:"center",backgroundColor:COLORS.green,borderRadius:15,paddingHorizontal:10,paddingVertical:4},onlineDot:{fontSize:10,color:"#fff"},onlinePillText:{fontSize:12,color:"#fff",fontWeight:"800",marginLeft:4},bellBtn:{width:46,height:46,borderRadius:23,borderWidth:1,borderColor:COLORS.border,alignItems:"center",justifyContent:"center",position:"relative"},bell:{fontSize:24},notificationDot:{width:8,height:8,borderRadius:4,backgroundColor:COLORS.red,position:"absolute",top:7,right:8},
  homeBrandLine:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginVertical:10},hello:{fontSize:27,fontWeight:"900"},helloSub:{fontSize:16,color:COLORS.muted,marginTop:3},onlineToggle:{width:128,height:48,borderRadius:24,backgroundColor:"#DDE4EC",flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingHorizontal:8},onlineToggleOn:{backgroundColor:COLORS.green},onlineToggleText:{color:"#fff",fontWeight:"900"},toggleKnob:{width:34,height:34,borderRadius:17,backgroundColor:"#fff"},
  summaryRow:{flexDirection:"row",gap:8},todayEarn:{flex:1.4,minHeight:92,backgroundColor:COLORS.softGreen,borderRadius:16,padding:14,position:"relative"},todayLabel:{fontSize:12,color:"#35546F"},todayValue:{fontSize:28,fontWeight:"900",marginTop:7},moreArrow:{position:"absolute",right:12,top:34,fontSize:30},metric:{flex:1,minHeight:92,borderRadius:16,backgroundColor:"#F2F4F8",padding:10,alignItems:"center",justifyContent:"center"},metricAccent:{backgroundColor:COLORS.softGreen},metricValue:{fontSize:18,fontWeight:"900"},metricTitle:{fontSize:11,color:COLORS.muted,textAlign:"center",marginTop:4},
  featureStrip:{flexDirection:"row",justifyContent:"space-between",marginVertical:16},featureItem:{width:"24%",alignItems:"center"},featureCircle:{width:48,height:48,borderRadius:24,alignItems:"center",justifyContent:"center"},featureLabel:{fontSize:11,fontWeight:"800",textAlign:"center",marginTop:5},
  promo:{flexDirection:"row",alignItems:"center",backgroundColor:"#F3F7FD",borderRadius:18,padding:16,marginBottom:14},promoTitle:{fontSize:26,fontWeight:"900"},promoSub:{fontSize:13,color:COLORS.muted,lineHeight:18,marginTop:5},promoVehicle:{width:150,height:125,resizeMode:"contain"},
  activity:{borderWidth:1,borderColor:COLORS.border,borderRadius:18,padding:13},activityHeader:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},sectionTitle:{fontSize:19,fontWeight:"900"},link:{color:"#123AA6",fontWeight:"800"},activityRow:{flexDirection:"row",alignItems:"center",gap:8,paddingVertical:10,borderTopWidth:1,borderTopColor:"#EEF1F5"},activityTime:{width:57,fontSize:11,color:COLORS.muted},activityDot:{width:10,height:10,borderRadius:5},activityTitle:{fontSize:13,fontWeight:"800"},activitySub:{fontSize:11,color:COLORS.muted,marginTop:2},activityFare:{fontWeight:"900"},
  serviceShortcut:{borderWidth:1,borderColor:COLORS.border,borderRadius:15,padding:13,marginTop:13},shortLabel:{fontSize:12,color:COLORS.muted},shortValue:{fontSize:19,fontWeight:"900",marginVertical:3},
  pageTitle:{fontSize:31,fontWeight:"900",marginTop:14},pageSub:{fontSize:16,color:"#4E6484",marginTop:4,marginBottom:12},infoGreen:{backgroundColor:COLORS.softGreen,borderRadius:14,padding:14,flexDirection:"row",alignItems:"center",marginBottom:8},infoIcon:{fontSize:21,color:COLORS.green},infoText:{fontSize:14,color:COLORS.greenDark,fontWeight:"700",marginLeft:8},
  modeCard:{borderWidth:1,borderColor:"#DDE5EE",borderRadius:18,padding:13,marginVertical:7,flexDirection:"row",alignItems:"center",minHeight:150},modeSelected:{borderWidth:2,borderColor:COLORS.green},modeVehicleBox:{width:96,height:94,borderRadius:14,backgroundColor:"rgba(255,255,255,.75)",alignItems:"center",justifyContent:"center",marginRight:10},modeEmoji:{fontSize:60},modeTitle:{fontSize:19,fontWeight:"900"},modeSub:{fontSize:13,color:"#405C7F",marginVertical:5},checkLine:{color:"#0B8B4D",fontSize:12,marginTop:3,fontWeight:"700"},radio:{fontSize:28,color:COLORS.greenDark},
  requestHead:{backgroundColor:COLORS.green,marginHorizontal:-16,paddingHorizontal:16,paddingBottom:16,position:"relative"},requestTitle:{color:"#fff",fontSize:28,fontWeight:"900",marginTop:12},requestSub:{color:"#E1F8EA",fontSize:15,marginTop:4},timer:{position:"absolute",right:18,top:118,width:76,height:76,borderRadius:38,borderWidth:4,borderColor:"#C6F0D3",backgroundColor:"#fff",alignItems:"center",justifyContent:"center"},timerNum:{fontSize:22,fontWeight:"900"},timerText:{fontSize:11,color:COLORS.muted},
  map:{height:300,borderRadius:20,overflow:"hidden",backgroundColor:"#E7EEE9",marginVertical:12,borderWidth:1,borderColor:"#D6DFE8",position:"relative"},water:{position:"absolute",right:-40,top:-20,width:245,height:120,borderRadius:80,backgroundColor:"#CFEFFF"},road:{position:"absolute",height:6,backgroundColor:"#fff",borderRadius:3,opacity:.9},roadA:{width:360,left:-30,top:144,transform:[{rotate:"12deg"}]},roadB:{width:320,left:10,top:93,transform:[{rotate:"-22deg"}]},roadC:{width:280,left:90,top:215,transform:[{rotate:"-7deg"}]},ganga:{position:"absolute",right:18,top:18,color:"#006BD1",fontWeight:"900"},mapPatna:{position:"absolute",left:145,top:128,fontSize:22,fontWeight:"900"},route:{position:"absolute",left:62,top:96,width:250,height:145},route1:{position:"absolute",width:135,height:6,backgroundColor:"#2F80ED",borderRadius:4,top:18,transform:[{rotate:"20deg"}]},route2:{position:"absolute",width:105,height:6,backgroundColor:"#2F80ED",borderRadius:4,left:104,top:52,transform:[{rotate:"-15deg"}]},route3:{position:"absolute",width:95,height:6,backgroundColor:"#2F80ED",borderRadius:4,left:165,top:96,transform:[{rotate:"18deg"}]},mapMarker:{position:"absolute",width:32,height:32,borderRadius:16,alignItems:"center",justifyContent:"center"},pickMarker:{left:52,top:78,backgroundColor:COLORS.green},dropMarker:{right:57,bottom:48,backgroundColor:COLORS.red},markerWhite:{color:"#fff"},pickLabel:{position:"absolute",left:82,top:55,backgroundColor:"#fff",borderRadius:12,padding:9,elevation:2},dropLabel:{position:"absolute",right:12,bottom:68,backgroundColor:"#fff",borderRadius:12,padding:9,elevation:2},pickLabelGreen:{color:COLORS.greenDark,fontWeight:"900",fontSize:11},pickLabelRed:{color:COLORS.red,fontWeight:"900",fontSize:11},mapLabelText:{fontWeight:"800",fontSize:12,marginTop:3,maxWidth:150},mapVehicle:{position:"absolute",left:"49%",top:"50%",width:48,height:68,resizeMode:"contain"},mapActions:{position:"absolute",right:10,top:103,gap:7},mapAction:{width:44,height:44,borderRadius:22,backgroundColor:"#fff",alignItems:"center",justifyContent:"center",elevation:2},
  statusBanner:{borderRadius:16,padding:13,flexDirection:"row",alignItems:"center",marginVertical:7},bannerGreen:{backgroundColor:COLORS.softGreen},bannerRed:{backgroundColor:COLORS.softRed},statusIcon:{width:50,height:50,borderRadius:25,backgroundColor:COLORS.green,alignItems:"center",justifyContent:"center",marginRight:12},statusIconText:{color:"#fff",fontSize:25,fontWeight:"900"},statusTitle:{fontSize:23,fontWeight:"900"},statusSub:{fontSize:14,color:"#4C6380",marginTop:3},
  requestCard:{backgroundColor:"#fff"},threeMetrics:{flexDirection:"row",gap:8},customerCard:{flexDirection:"row",alignItems:"center",gap:9,paddingVertical:10,borderTopWidth:1,borderTopColor:"#EEF2F6",marginTop:7},customerAvatar:{width:56,height:56,borderRadius:28,backgroundColor:"#EEF2F7",alignItems:"center",justifyContent:"center"},customerPhoto:{width:58,height:58,borderRadius:29},customerName:{fontSize:19,fontWeight:"900"},customerRating:{color:"#D89600",fontWeight:"900",marginTop:3},customerSub:{color:COLORS.muted,marginTop:3},actionCircle:{width:46,height:46,borderRadius:23,backgroundColor:"#E7F8EF",alignItems:"center",justifyContent:"center"},actionCircleBlue:{width:46,height:46,borderRadius:23,backgroundColor:"#E7F0FF",alignItems:"center",justifyContent:"center"},locationGrid:{flexDirection:"row",justifyContent:"space-between",gap:10,borderTopWidth:1,borderTopColor:"#EEF2F6",paddingVertical:11},locationGreen:{color:COLORS.greenDark,fontWeight:"900",fontSize:11},locationRed:{color:COLORS.red,fontWeight:"900",fontSize:11},locationText:{fontWeight:"800",marginTop:3,maxWidth:150},locationSub:{fontSize:11,color:COLORS.muted,marginTop:2},note:{backgroundColor:"#F5F8FB",borderRadius:13,padding:12},requestNoteTitle:{fontWeight:"900"},noteText:{color:"#385775",marginTop:4,lineHeight:18},acceptRow:{flexDirection:"row",gap:10,marginTop:13},decline:{flex:1,backgroundColor:"#FFE7E6",borderRadius:15,paddingVertical:15,alignItems:"center"},declineText:{color:COLORS.red,fontWeight:"900",fontSize:17},accept:{flex:1,backgroundColor:COLORS.green,borderRadius:15,paddingVertical:15,alignItems:"center"},acceptText:{color:"#fff",fontWeight:"900",fontSize:17},
  rideCard:{borderWidth:1,borderColor:COLORS.border,borderRadius:18,padding:12},fareRow:{flexDirection:"row",gap:8,borderTopWidth:1,borderTopColor:"#EEF2F6",paddingTop:8},pinCard:{backgroundColor:COLORS.softGreen,borderRadius:15,padding:12,flexDirection:"row",alignItems:"center",gap:9,marginTop:10},pinCircle:{width:42,height:42,borderRadius:21,backgroundColor:COLORS.green,alignItems:"center",justifyContent:"center"},pinTitle:{fontSize:13,fontWeight:"900"},pinSub:{fontSize:11,color:COLORS.muted,marginTop:4},pinInput:{width:80,height:50,borderWidth:1.5,borderColor:COLORS.green,borderRadius:12,textAlign:"center",fontSize:20,fontWeight:"900",backgroundColor:"#fff"},tripDetails:{borderWidth:1,borderColor:COLORS.border,borderRadius:14,padding:12,marginTop:10},detailLine:{paddingVertical:7,fontWeight:"700"},detailTime:{color:COLORS.muted,position:"absolute",right:0},endTrip:{backgroundColor:"#FFE6E7",borderRadius:15,minHeight:55,alignItems:"center",justifyContent:"center",marginTop:10},endTripText:{color:COLORS.red,fontSize:19,fontWeight:"900"},
  earnedHero:{backgroundColor:COLORS.softGreen,borderRadius:17,padding:18,marginVertical:11},earnedLabel:{color:COLORS.greenDark,fontWeight:"800"},earnedValue:{fontSize:38,fontWeight:"900",color:COLORS.greenDark,marginTop:4},cashPill:{alignSelf:"flex-end",marginTop:-26,color:COLORS.greenDark,fontWeight:"800"},locationStack:{gap:10,paddingTop:8},keepUp:{backgroundColor:COLORS.softGreen,borderRadius:15,padding:14,marginTop:11},keepUpTitle:{fontSize:18,fontWeight:"900",color:COLORS.greenDark},keepUpSub:{color:COLORS.muted,marginTop:3},rateCard:{borderWidth:1,borderColor:COLORS.border,borderRadius:15,padding:13,alignItems:"center",marginVertical:11},stars:{fontSize:34,color:"#F2A300",marginTop:8},rateHint:{color:COLORS.muted},
  filterRow:{flexDirection:"row",gap:6,marginVertical:10},filterPill:{flex:1,backgroundColor:"#F2F4F8",paddingVertical:9,borderRadius:10,alignItems:"center"},filterActive:{backgroundColor:COLORS.green},filterText:{fontSize:11,fontWeight:"800"},filterActiveText:{color:"#fff"},historyCard:{borderWidth:1,borderColor:COLORS.border,borderRadius:16,padding:13,marginVertical:5},historyTop:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},historyDate:{fontSize:12,color:"#3E5775",fontWeight:"800"},historyStatus:{paddingHorizontal:9,paddingVertical:4,borderRadius:10,fontSize:10,fontWeight:"900"},statusCompleted:{backgroundColor:"#E5F7EC",color:COLORS.greenDark},statusCancelled:{backgroundColor:"#FFE7E7",color:COLORS.red},historyRoute:{fontSize:15,fontWeight:"800",marginTop:8},historyBottom:{flexDirection:"row",justifyContent:"space-between",marginTop:9},historyFare:{fontSize:21,fontWeight:"900"},historyChevron:{fontSize:26},
  earningsHero:{backgroundColor:"#059C4C",borderRadius:17,padding:17},earningsLabel:{color:"#DDF8E8"},earningsValue:{color:"#fff",fontSize:40,fontWeight:"900",marginTop:2},earnStats:{flexDirection:"row",justifyContent:"space-between",borderTopWidth:1,borderTopColor:"rgba(255,255,255,.35)",paddingTop:10,marginTop:10,color:"#fff"},fourCards:{flexDirection:"row",gap:6,marginVertical:12},breakRow:{flexDirection:"row",justifyContent:"space-between",borderWidth:1,borderColor:COLORS.border,borderRadius:12,padding:12,marginTop:6},breakFare:{fontWeight:"900"},
  profileCard:{flexDirection:"row",alignItems:"center",borderWidth:1,borderColor:COLORS.border,borderRadius:18,padding:13,marginTop:12},profilePhoto:{width:88,height:88,borderRadius:44,marginRight:12},profileName:{fontSize:21,fontWeight:"900"},profileMeta:{color:"#4B607E",marginTop:3},profileRating:{color:"#D08B00",fontWeight:"900",marginTop:4},profileOnline:{backgroundColor:COLORS.green,borderRadius:10,paddingHorizontal:9,paddingVertical:6},profileOnlineText:{color:"#fff",fontWeight:"900",fontSize:11},profileStats:{flexDirection:"row",gap:7,marginVertical:10},profileRow:{flexDirection:"row",alignItems:"center",paddingVertical:13,borderTopWidth:1,borderTopColor:"#EEF1F5",paddingHorizontal:7},profileRowIcon:{width:38,fontSize:20},profileRowTitle:{fontSize:15,fontWeight:"800"},profileRowSub:{fontSize:12,color:COLORS.muted,marginTop:2},logout:{flexDirection:"row",justifyContent:"space-between",backgroundColor:"#FFE7E7",borderRadius:13,padding:14,marginTop:10},logoutText:{color:COLORS.red,fontWeight:"900"},
  sectionBar:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",backgroundColor:COLORS.softGreen,borderRadius:12,padding:12,marginTop:10},verified:{color:COLORS.greenDark,fontWeight:"900"},docRow:{flexDirection:"row",alignItems:"center",padding:12,borderBottomWidth:1,borderBottomColor:"#EEF1F5"},docIcon:{width:40,height:40,borderRadius:12,backgroundColor:"#EEF2F6",alignItems:"center",justifyContent:"center"},docTitle:{fontSize:14,fontWeight:"800"},docSub:{fontSize:11,color:COLORS.muted,marginTop:3},docThumb:{width:46,height:38,borderRadius:8,backgroundColor:"#EEF2F6",alignItems:"center",justifyContent:"center"},editTag:{borderWidth:1,borderColor:COLORS.border,borderRadius:9,paddingHorizontal:10,paddingVertical:7,color:COLORS.muted,fontWeight:"800"},
  safetyHero:{backgroundColor:"#FFECEE",borderRadius:16,padding:14,flexDirection:"row",alignItems:"center"},safetyTitle:{fontSize:20,fontWeight:"900"},safetySub:{color:COLORS.muted,marginTop:3},safetyPerson:{fontSize:76},safetyTiles:{flexDirection:"row",gap:7,marginVertical:10},safetyTileRed:{flex:1,backgroundColor:"#FFE4E5",borderRadius:14,padding:10,alignItems:"center"},safetyTileGreen:{flex:1,backgroundColor:"#E4F8EE",borderRadius:14,padding:10,alignItems:"center"},safetyTileBlue:{flex:1,backgroundColor:"#E6F0FF",borderRadius:14,padding:10,alignItems:"center"},safetyCircle:{width:50,height:50,borderRadius:25,backgroundColor:"#fff",textAlign:"center",paddingTop:15,fontWeight:"900"},safetyTileTitle:{fontWeight:"900",marginTop:5,textAlign:"center",fontSize:12},tileSub:{fontSize:10,color:COLORS.muted,textAlign:"center",marginTop:2},safetyRow:{flexDirection:"row",alignItems:"center",padding:12,borderWidth:1,borderColor:COLORS.border,borderRadius:13,marginVertical:4},safetyRowIcon:{width:40,height:40,borderRadius:20,backgroundColor:"#EFF8F2",alignItems:"center",justifyContent:"center"},safetyFooter:{backgroundColor:COLORS.softGreen,borderRadius:13,padding:13,marginTop:8},safetyFooterTitle:{fontWeight:"900",color:COLORS.greenDark},safetyFooterSub:{fontSize:12,color:COLORS.muted,marginTop:3},
  sosBig:{alignSelf:"center",width:220,height:220,borderRadius:110,backgroundColor:COLORS.red,borderWidth:16,borderColor:"#FFE0E2",alignItems:"center",justifyContent:"center",marginTop:35},sosPhone:{color:"#fff",fontSize:50},sosBigText:{color:"#fff",fontSize:31,fontWeight:"900"},sosAlert:{fontSize:20,color:COLORS.red,fontWeight:"900",textAlign:"center",marginTop:14},sosHelp:{textAlign:"center",color:COLORS.muted,marginTop:4},sosPanel:{backgroundColor:"#FFEAEA",borderRadius:14,padding:15,marginTop:16,gap:8},locationBox:{borderWidth:1,borderColor:COLORS.border,borderRadius:14,padding:13,marginTop:12},cancelSos:{backgroundColor:"#FFCACC",borderRadius:14,padding:15,marginTop:10,alignItems:"center"},cancelSosText:{color:COLORS.red,fontWeight:"900"},infoBlue:{backgroundColor:"#E8F1FF",borderRadius:14,padding:14,marginTop:10},infoBlueTitle:{color:"#1C4B99",fontWeight:"900",marginBottom:3},
  notificationRow:{flexDirection:"row",alignItems:"center",padding:11,borderWidth:1,borderColor:COLORS.border,borderRadius:13,marginVertical:4,gap:8},noteIcon:{width:44,height:44,borderRadius:22,backgroundColor:COLORS.softGreen,alignItems:"center",justifyContent:"center"},noteTitle:{fontSize:13,fontWeight:"900"},noteSub:{fontSize:11,color:COLORS.muted,marginTop:3},noteTime:{fontSize:10,color:COLORS.muted},
  messageRow:{flexDirection:"row",alignItems:"center",paddingVertical:12,borderBottomWidth:1,borderBottomColor:"#EEF1F5",gap:8},messageAvatar:{width:46,height:46,borderRadius:23,backgroundColor:"#EEF2F6",alignItems:"center",justifyContent:"center"},messageName:{fontSize:14,fontWeight:"900"},messagePreview:{fontSize:12,color:COLORS.muted,marginTop:2},messageTime:{fontSize:10,color:COLORS.muted},unread:{backgroundColor:COLORS.green,color:"#fff",width:20,height:20,borderRadius:10,textAlign:"center",paddingTop:2,fontWeight:"900",alignSelf:"flex-end"},supportBox:{backgroundColor:"#E8F8EF",borderRadius:16,padding:14,marginTop:10},supportTitle:{fontSize:19,fontWeight:"900"},supportSub:{color:COLORS.muted,fontSize:12,marginVertical:5},supportActions:{flexDirection:"row",gap:8},
  modalOverlay:{flex:1,backgroundColor:"rgba(0,0,0,.48)",justifyContent:"flex-end"},quickModal:{backgroundColor:"#fff",borderTopLeftRadius:22,borderTopRightRadius:22,padding:20},quickTitle:{fontSize:23,fontWeight:"900"},quickSub:{color:COLORS.muted,marginTop:4}
});
