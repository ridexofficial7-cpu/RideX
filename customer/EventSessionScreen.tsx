import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { getRideXApiUrl, createRideXFetch } from "../shared/api/client";
import { RIDEX_EVENT_API, localEventPreview, normalizeEventDefinition, type EventSession, type EventStop, type RideXEventDefinition } from "../shared/events/contracts";
import RideXMotionSurface, { computeRouteDriftScore } from "../shared/ui/RideXMotionSurface";
import { CUSTOMER_ASSETS } from "../shared/assets";

type EventDraft = {
  eventId: string;
  eventTitle: string;
  sessionId: string;
  sessionStartAt: string;
  sessionEndAt: string;
  startStopId: string;
  startStopName: string;
  endStopId: string;
  endStopName: string;
  fare: number;
};

type Props = {
  customerId: string;
  api?: string;
  authTokenKey?: string;
  onBack: () => void;
  onPrepared: (draft: EventDraft) => void;
};

const PREVIEW = String(process.env.EXPO_PUBLIC_RIDEX_EVENT_PREVIEW ?? "false").toLowerCase() === "true";

function haversineKm(a?: EventStop, b?: EventStop) {
  if (!a || !b || !Number.isFinite(Number(a.latitude)) || !Number.isFinite(Number(a.longitude)) || !Number.isFinite(Number(b.latitude)) || !Number.isFinite(Number(b.longitude))) return 0;
  const lat1 = Number(a.latitude) * Math.PI / 180;
  const lat2 = Number(b.latitude) * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLng = (Number(b.longitude) - Number(a.longitude)) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function fmtDate(value: string) {
  if (!value) return "Time to be announced";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", hour12: true });
}

export default function EventSessionScreen({ customerId, api, authTokenKey = "ridex_customer_auth_token_v1", onBack, onPrepared }: Props) {
  const base = getRideXApiUrl(api);
  const [events, setEvents] = useState<RideXEventDefinition[]>([]);
  const [eventLoading, setEventLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [startStopId, setStartStopId] = useState("");
  const [endStopId, setEndStopId] = useState("");

  const fetcher = useMemo(() => createRideXFetch({ apiUrl: base, tokenKey: authTokenKey }), [base, authTokenKey]);
  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? events[0];
  const selectedSession = selectedEvent?.sessions.find((session) => session.id === selectedSessionId) ?? selectedEvent?.sessions[0];
  const startStop = selectedEvent?.stops.find((stop) => stop.id === startStopId);
  const endStop = selectedEvent?.stops.find((stop) => stop.id === endStopId);

  useEffect(() => {
    let alive = true;
    (async () => {
      setEventLoading(true);
      setMessage("");
      try {
        const response = await fetcher(RIDEX_EVENT_API.published, { method: "GET" });
        const body: any = await response.json().catch(() => ({}));
        if (!response.ok || body?.success === false) throw new Error(body?.message || `Event service unavailable (${response.status})`);
        const raw = Array.isArray(body?.data) ? body.data : Array.isArray(body?.data?.events) ? body.data.events : [];
        const next: RideXEventDefinition[] = raw
          .map((event: Parameters<typeof normalizeEventDefinition>[0]) => normalizeEventDefinition(event))
          .filter((event: RideXEventDefinition) => event.id && event.stops.length >= 6 && event.stops.length <= 10);
        if (alive) setEvents(next);
      } catch (error) {
        if (alive && PREVIEW) {
          setEvents(localEventPreview());
          setMessage("Preview mode: showing the Event / Sessional Ride UI contract. Live booking stays backend-authoritative.");
        } else if (alive) {
          setEvents([]);
          setMessage("No published Event / Sessional Ride is available yet. The mobile flow is ready for the Event backend.");
        }
      } finally {
        if (alive) setEventLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [fetcher]);

  useEffect(() => {
    if (!selectedEventId && selectedEvent) setSelectedEventId(selectedEvent.id);
  }, [selectedEventId, selectedEvent]);

  useEffect(() => {
    if (selectedEvent && selectedSession?.id && !selectedSessionId) setSelectedSessionId(selectedSession.id);
  }, [selectedEvent, selectedSession, selectedSessionId]);

  const orderedStops = selectedEvent?.stops ?? [];
  const startIndex = orderedStops.findIndex((stop) => stop.id === startStopId);
  const endIndex = orderedStops.findIndex((stop) => stop.id === endStopId);
  const validRange = startIndex >= 0 && endIndex > startIndex;

  const routeDistanceKm = useMemo(() => {
    if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) return 0;
    let total = 0;
    for (let i = startIndex; i < endIndex; i++) total += haversineKm(orderedStops[i], orderedStops[i + 1]);
    return total;
  }, [orderedStops, startIndex, endIndex]);

  const directDistanceKm = haversineKm(startStop, endStop);
  const driftScore = directDistanceKm > 0 ? Math.min(1, Math.max(0, (routeDistanceKm / directDistanceKm - 1) / 1.25)) : 0;
  const routeCoordinates = orderedStops.map((stop) => ({ latitude: Number(stop.latitude), longitude: Number(stop.longitude) })).filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));

  function prepareBooking() {
    if (!customerId) {
      Alert.alert("Login required", "Please login before booking an Event / Sessional Ride.");
      return;
    }
    if (!selectedEvent || !selectedSession || !startStop || !endStop || !validRange) {
      setMessage("Choose an event session, a starting stop and a later ending stop.");
      return;
    }
    const fare = Number(selectedSession.fare ?? 0);
    if (!Number.isFinite(fare) || fare < 0) {
      setMessage("This event session has no valid fare configured yet.");
      return;
    }
    onPrepared({
      eventId: selectedEvent.id,
      eventTitle: selectedEvent.title,
      sessionId: selectedSession.id,
      sessionStartAt: selectedSession.startAt,
      sessionEndAt: selectedSession.endAt,
      startStopId: startStop.id,
      startStopName: startStop.name,
      endStopId: endStop.id,
      endStopName: endStop.name,
      fare,
    });
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable style={styles.back} onPress={onBack}><Text style={styles.backText}>‹</Text></Pressable>
          <View style={{ flex: 1 }}><Text style={styles.kicker}>RIDEX EVENT / SESSIONAL</Text><Text style={styles.title}>Choose your event ride</Text></View>
          <View style={styles.ticket}><Text style={styles.ticketText}>TICKET</Text></View>
        </View>

        <RideXMotionSurface height={150} intensity={1.15} driftScore={driftScore} label="PUBLISHED ROUTE" badgeLabel="ROUTE ALIGN" />

        {message ? <View style={styles.notice}><Text style={styles.noticeText}>{message}</Text></View> : null}

        {eventLoading ? (
          <View style={styles.center}><ActivityIndicator size="large" /><Text style={styles.muted}>Loading published event sessions…</Text></View>
        ) : events.length === 0 ? (
          <View style={styles.empty}><Text style={styles.emptyIconText}>◷</Text><Text style={styles.emptyTitle}>No published events</Text><Text style={styles.muted}>Admin-created events and sessions will appear here once the Event backend is live.</Text></View>
        ) : (
          <>
            <Text style={styles.section}>1. Event</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontal}>
              {events.map((event) => (
                <Pressable key={event.id} style={[styles.eventCard, event.id === selectedEvent?.id && styles.selectedCard]} onPress={() => { setSelectedEventId(event.id); setSelectedSessionId(""); setStartStopId(""); setEndStopId(""); }}>
                  <View style={styles.eventBadge}><Text style={styles.eventBadgeText}>EVENT</Text></View>
                  <Text style={styles.eventTitle}>{event.title}</Text>
                  <Text style={styles.eventCity}>{event.city || "RideX city session"}</Text>
                  <Text style={styles.eventDesc} numberOfLines={3}>{event.description || "Admin-published route with fixed stops and operating sessions."}</Text>
                  <Text style={styles.stopCount}>{event.stops.length} stops • {event.sessions.length} sessions</Text>
                </Pressable>
              ))}
            </ScrollView>

            {selectedEvent ? <>
              <Text style={styles.section}>2. Session / operating time</Text>
              <View style={styles.card}>
                {(selectedEvent.sessions.length ? selectedEvent.sessions : []).map((session) => (
                  <Pressable key={session.id} style={[styles.sessionRow, session.id === selectedSession?.id && styles.sessionSelected]} onPress={() => setSelectedSessionId(session.id)}>
                    <View style={styles.sessionDot}><Text style={styles.sessionDotText}>◷</Text></View>
                    <View style={{ flex: 1 }}><Text style={styles.sessionTitle}>{fmtDate(session.startAt)} → {fmtDate(session.endAt)}</Text><Text style={styles.sessionMeta}>{session.status || "AVAILABLE"}{session.capacity != null ? ` • Capacity ${session.capacity}` : ""}</Text></View>
                    <Text style={styles.sessionFare}>₹{Number(session.fare ?? 0).toFixed(0)}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.section}>3. Starting stop</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontal}>
                {selectedEvent.stops.map((stop) => (
                  <Pressable key={stop.id} style={[styles.stopChip, stop.id === startStopId && styles.stopStart]} onPress={() => { const index = selectedEvent.stops.findIndex((x) => x.id === stop.id); setStartStopId(stop.id); if (endIndex <= index) setEndStopId(""); }}>
                    <Text style={styles.stopNumber}>{stop.sequence}</Text><View style={{ flex: 1 }}><Text style={styles.stopName}>{stop.name}</Text><Text style={styles.stopAddress} numberOfLines={1}>{stop.address}</Text></View>
                  </Pressable>
                ))}
              </ScrollView>

              <Text style={styles.section}>4. Ending stop</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontal}>
                {selectedEvent.stops.map((stop) => {
                  const index = selectedEvent.stops.findIndex((x) => x.id === stop.id);
                  const disabled = startIndex >= 0 && index <= startIndex;
                  return <Pressable key={stop.id} disabled={disabled} style={[styles.stopChip, stop.id === endStopId && styles.stopEnd, disabled && styles.disabled]} onPress={() => setEndStopId(stop.id)}><Text style={styles.stopNumber}>{stop.sequence}</Text><View style={{ flex: 1 }}><Text style={styles.stopName}>{stop.name}</Text><Text style={styles.stopAddress} numberOfLines={1}>{stop.address}</Text></View></Pressable>;
                })}
              </ScrollView>

              {routeCoordinates.length >= 2 ? <View style={styles.mapWrap}>
                <MapView style={StyleSheet.absoluteFill} provider={PROVIDER_GOOGLE} initialRegion={{ latitude: routeCoordinates[0].latitude, longitude: routeCoordinates[0].longitude, latitudeDelta: 0.06, longitudeDelta: 0.06 }}>
                  <Polyline coordinates={routeCoordinates} strokeWidth={5} strokeColor="#0AA35A" />
                  {selectedEvent.stops.map((stop) => Number.isFinite(Number(stop.latitude)) && Number.isFinite(Number(stop.longitude)) ? <Marker key={stop.id} coordinate={{ latitude: Number(stop.latitude), longitude: Number(stop.longitude) }} title={`${stop.sequence}. ${stop.name}`} pinColor={stop.id === startStopId ? "#0AA35A" : stop.id === endStopId ? "#E83C4F" : "#55708A"} /> : null)}
                </MapView>
              </View> : null}

              <View style={styles.mathCard}>
                <View style={{ flex: 1 }}><Text style={styles.mathTitle}>Mathematical route drift optimization</Text><Text style={styles.mathSub}>Deterministic route-shape check: {routeDistanceKm ? `${routeDistanceKm.toFixed(2)} km` : "select stops"} on the published stop sequence.</Text></View>
                <View style={styles.driftCircle}><Text style={styles.driftValue}>{Math.round((1 - driftScore) * 100)}%</Text><Text style={styles.driftLabel}>ALIGN</Text></View>
              </View>

              <View style={styles.reviewCard}>
                <Text style={styles.reviewTitle}>Event booking summary</Text>
                <Text style={styles.reviewLine}><Text style={styles.bold}>Event:</Text> {selectedEvent.title}</Text>
                <Text style={styles.reviewLine}><Text style={styles.bold}>Session:</Text> {selectedSession ? fmtDate(selectedSession.startAt) : "—"}</Text>
                <Text style={styles.reviewLine}><Text style={styles.bold}>From:</Text> {startStop?.name || "Select start stop"}</Text>
                <Text style={styles.reviewLine}><Text style={styles.bold}>To:</Text> {endStop?.name || "Select end stop"}</Text>
                <Text style={styles.reviewLine}><Text style={styles.bold}>Fare:</Text> ₹{Number(selectedSession?.fare ?? 0).toFixed(2)}</Text>
              </View>

              <Pressable style={[styles.book, !validRange && styles.bookDisabled]} onPress={prepareBooking} disabled={!validRange}>
                <Text style={styles.bookText}>Continue to Payment & Confirm</Text><Text style={styles.bookArrow}>→</Text>
              </Pressable>
              <Text style={styles.footerNote}>Event rides use the Admin-published stop sequence. They do not enter the normal Driver route-planning flow.</Text>
            </> : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:{flex:1,backgroundColor:"#F5F8FB"},
  content:{padding:18,paddingBottom:40},
  header:{flexDirection:"row",alignItems:"center",gap:12,marginBottom:12},
  back:{width:44,height:44,borderRadius:22,backgroundColor:"#fff",alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:"#D9E2EA"},
  backText:{fontSize:31,color:"#14243D",marginTop:-4},
  kicker:{fontSize:10,fontWeight:"900",letterSpacing:1.4,color:"#0AA35A"},
  title:{fontSize:23,fontWeight:"900",color:"#11213A",marginTop:2},
  ticket:{paddingHorizontal:10,paddingVertical:7,borderRadius:12,backgroundColor:"#10253A"},
  ticketText:{fontSize:10,fontWeight:"900",color:"#fff"},
  notice:{marginTop:12,padding:12,borderRadius:14,backgroundColor:"#FFF7E8",borderWidth:1,borderColor:"#F5D89C"},
  noticeText:{fontSize:12,lineHeight:18,color:"#7A5B15"},
  center:{alignItems:"center",justifyContent:"center",paddingVertical:70,gap:10},
  muted:{fontSize:13,lineHeight:19,color:"#6C7890"},
  empty:{alignItems:"center",padding:36,borderRadius:20,backgroundColor:"#fff",borderWidth:1,borderColor:"#E0E7EF",marginTop:14},
  emptyIconText:{fontSize:42,lineHeight:48,textAlign:"center",color:"#0AA35A",marginBottom:10},
  emptyTitle:{fontSize:20,fontWeight:"900",color:"#13213A",marginBottom:8},
  section:{fontSize:17,fontWeight:"900",color:"#14243D",marginTop:20,marginBottom:9},
  horizontal:{gap:10},
  eventCard:{width:270,minHeight:170,padding:16,borderRadius:20,backgroundColor:"#fff",borderWidth:1,borderColor:"#E0E7EF"},
  selectedCard:{borderColor:"#0AA35A",borderWidth:2,shadowColor:"#0AA35A",shadowOpacity:0.12,shadowRadius:14,elevation:2},
  eventBadge:{alignSelf:"flex-start",backgroundColor:"#EAF8F1",paddingHorizontal:9,paddingVertical:5,borderRadius:10,marginBottom:10},
  eventBadgeText:{fontSize:9,fontWeight:"900",color:"#087B45",letterSpacing:1},
  eventTitle:{fontSize:18,fontWeight:"900",color:"#14243D"},
  eventCity:{fontSize:12,fontWeight:"800",color:"#0AA35A",marginTop:3},
  eventDesc:{fontSize:12,lineHeight:18,color:"#66758C",marginTop:9},
  stopCount:{fontSize:11,fontWeight:"800",color:"#4C5E78",marginTop:10},
  card:{backgroundColor:"#fff",borderRadius:18,padding:12,borderWidth:1,borderColor:"#E0E7EF"},
  sessionRow:{flexDirection:"row",alignItems:"center",gap:10,padding:13,borderRadius:14},
  sessionSelected:{backgroundColor:"#EEF9F4",borderWidth:1,borderColor:"#BDE7D0"},
  sessionDot:{width:36,height:36,borderRadius:18,backgroundColor:"#EAF0F5",alignItems:"center",justifyContent:"center"},
  sessionDotText:{fontSize:18,color:"#31455D"},
  sessionTitle:{fontSize:12,fontWeight:"900",color:"#14243D",lineHeight:18},
  sessionMeta:{fontSize:11,color:"#6C7890",marginTop:2},
  sessionFare:{fontSize:16,fontWeight:"900",color:"#0AA35A"},
  stopChip:{flexDirection:"row",alignItems:"center",width:235,minHeight:66,padding:10,borderRadius:16,backgroundColor:"#fff",borderWidth:1,borderColor:"#DEE6EE",gap:10},
  stopStart:{borderColor:"#0AA35A",backgroundColor:"#EEF9F4"},
  stopEnd:{borderColor:"#E83C4F",backgroundColor:"#FFF2F4"},
  stopNumber:{width:29,height:29,borderRadius:15,backgroundColor:"#E8EFF4",textAlign:"center",textAlignVertical:"center",fontWeight:"900",color:"#1F3651",paddingTop:5},
  stopName:{fontSize:13,fontWeight:"900",color:"#14243D"},
  stopAddress:{fontSize:10,color:"#718097",marginTop:2},
  disabled:{opacity:0.35},
  mapWrap:{height:220,borderRadius:22,overflow:"hidden",marginTop:16,borderWidth:1,borderColor:"#DDE6EE"},
  mathCard:{marginTop:14,padding:14,borderRadius:18,backgroundColor:"#101F33",flexDirection:"row",alignItems:"center",gap:12},
  mathTitle:{fontSize:14,fontWeight:"900",color:"#fff"},
  mathSub:{fontSize:11,lineHeight:17,color:"#B9C8D9",marginTop:4},
  driftCircle:{width:60,height:60,borderRadius:30,borderWidth:2,borderColor:"#5BE6BD",alignItems:"center",justifyContent:"center"},
  driftValue:{fontSize:16,fontWeight:"900",color:"#fff"},
  driftLabel:{fontSize:7,fontWeight:"900",color:"#7FE8C5",letterSpacing:1},
  reviewCard:{marginTop:14,padding:15,borderRadius:18,backgroundColor:"#fff",borderWidth:1,borderColor:"#E0E7EF"},
  reviewTitle:{fontSize:16,fontWeight:"900",color:"#14243D",marginBottom:7},
  reviewLine:{fontSize:12,lineHeight:20,color:"#52627A"},
  bold:{fontWeight:"900",color:"#14243D"},
  book:{marginTop:14,minHeight:56,borderRadius:18,backgroundColor:"#E83C4F",alignItems:"center",justifyContent:"center",flexDirection:"row",position:"relative"},
  bookDisabled:{opacity:0.45},
  bookText:{fontSize:16,fontWeight:"900",color:"#fff"},
  bookArrow:{position:"absolute",right:15,fontSize:23,fontWeight:"900",color:"#fff"},
  footerNote:{fontSize:11,lineHeight:17,color:"#69768A",textAlign:"center",marginTop:10},
});
