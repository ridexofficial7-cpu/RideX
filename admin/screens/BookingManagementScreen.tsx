import React, { useEffect, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";
import { AdminFetch, Badge, EmptyView, ErrorView, Field, LoadingView, ScreenHeader, styles, money, statusLabel } from "./common";

export default function BookingManagementScreen({api,adminFetch,onBack}:{api:string;adminFetch:AdminFetch;onBack:()=>void}) {
  const [rows,setRows]=useState<any[]>([]);
  const [selected,setSelected]=useState<any|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [status,setStatus]=useState("");

  async function load() {
    setLoading(true);setError("");
    try{
      const r=await adminFetch(`${api}/admin/bookings${status?`?status=${encodeURIComponent(status)}`:""}`);
      const b=await r.json().catch(()=>({}));
      if(!r.ok||b?.success===false) throw new Error(b?.message||"Unable to load bookings");
      setRows(Array.isArray(b?.data)?b.data:[]);
    }catch(e){setError(e instanceof Error?e.message:"Unable to load bookings")}
    finally{setLoading(false)}
  }
  useEffect(()=>{void load()},[status]);

  if(loading) return <SafeAreaView style={styles.page}><ScreenHeader title="Booking Management" onBack={onBack}/><LoadingView/></SafeAreaView>;
  if(error) return <SafeAreaView style={styles.page}><ScreenHeader title="Booking Management" onBack={onBack}/><ErrorView message={error} onRetry={()=>void load()}/></SafeAreaView>;

  if(selected) return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.scroll}>
    <ScreenHeader title="Booking Detail" subtitle={selected.id} onBack={()=>setSelected(null)}/>
    <View style={styles.card}>
      <View style={styles.row}><Text style={styles.title}>Booking</Text><Badge value={selected.status}/></View>
      <Field label="Booking Type" value={selected.bookingType || selected.rideType}/>
      <Field label="Customer" value={selected.customer?.fullName || selected.customerId}/>
      <Field label="Driver" value={selected.assignedDriver?.fullName || selected.assignedDriverId}/>
      <Field label="Vehicle" value={selected.vehicle?.vehicleType || selected.vehicleId}/>
      <Field label="Estimated Fare" value={money(selected.estimatedFare)}/>
      <Field label="Final Fare" value={money(selected.finalFare)}/>
      <Field label="Pickup" value={selected.pickupAddress}/>
      <Field label="Drop" value={selected.dropAddress}/>
    </View>
    <Text style={styles.section}>Booking Legs</Text>
    {(selected.legs||[]).map((leg:any,index:number)=><View style={styles.card} key={leg.id||index}>
      <View style={styles.row}><Text style={styles.title}>Leg {leg.sequence ?? index+1}</Text><Badge value={leg.status}/></View>
      <Field label="Driver" value={leg.driverId}/>
      <Field label="Trip" value={leg.tripId}/>
    </View>)}
  </ScrollView></SafeAreaView>;

  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.scroll}>
    <ScreenHeader title="Booking Management" subtitle={`${rows.length} backend records`} onBack={onBack}/>
    <View style={styles.row}>
      {["","PENDING","ACCEPTED","IN_PROGRESS","COMPLETED","CANCELLED"].map(v=><Pressable key={v} onPress={()=>setStatus(v)} style={[styles.secondary,{marginBottom:8},status===v&&{backgroundColor:"#eaf8f0",borderColor:"#0aa052"}]}><Text style={styles.secondaryText}>{v||"ALL"}</Text></Pressable>)}
    </View>
    {!rows.length?<EmptyView label="bookings"/>:rows.map((b:any)=><Pressable key={b.id} style={styles.card} onPress={()=>setSelected(b)}>
      <View style={styles.row}><View style={{flex:1}}><Text style={styles.title}>{b.id}</Text><Text style={styles.subtitle}>{b.pickupAddress || "Pickup"} → {b.dropAddress || "Drop"}</Text></View><Badge value={b.status}/></View>
      <Field label="Customer" value={b.customer?.fullName || b.customerId}/>
      <Field label="Driver" value={b.assignedDriver?.fullName || b.assignedDriverId}/>
      <Field label="Fare" value={money(b.finalFare ?? b.estimatedFare)}/>
    </Pressable>)}
  </ScrollView></SafeAreaView>;
}
