import React, { useEffect, useState } from "react";
import { Image, Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";
import { AdminFetch, Badge, EmptyView, ErrorView, Field, LoadingView, ScreenHeader, styles, statusLabel } from "./common";

export default function DriverManagementScreen({api, adminFetch, onBack, onOpenKyc}:{api:string;adminFetch:AdminFetch; onBack:()=>void; onOpenKyc:(driver:any)=>void}) {
  const [rows,setRows]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [filter,setFilter]=useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const response=await adminFetch(`${api}/admin/drivers${filter ? `?driverStatus=${encodeURIComponent(filter)}`:""}`);
      const body=await response.json().catch(()=>({}));
      if(!response.ok || body?.success===false) throw new Error(body?.message || "Unable to load drivers");
      setRows(Array.isArray(body?.data)?body.data:[]);
    } catch(e) { setError(e instanceof Error?e.message:"Unable to load drivers"); }
    finally { setLoading(false); }
  }

  useEffect(()=>{void load()},[filter]);

  if(loading) return <SafeAreaView style={styles.page}><ScreenHeader title="Driver Management" onBack={onBack}/><LoadingView/></SafeAreaView>;
  if(error) return <SafeAreaView style={styles.page}><ScreenHeader title="Driver Management" onBack={onBack}/><ErrorView message={error} onRetry={()=>void load()}/></SafeAreaView>;

  return <SafeAreaView style={styles.page}>
    <ScrollView contentContainerStyle={styles.scroll}>
      <ScreenHeader title="Driver Management" subtitle={`${rows.length} records from backend`} onBack={onBack}/>
      <View style={styles.row}>
        {["","ONLINE","OFFLINE","SUSPENDED"].map(v=><Pressable key={v} onPress={()=>setFilter(v)} style={[styles.secondary,{flex:1},filter===v && {backgroundColor:"#eaf8f0",borderColor:"#0aa052"}]}><Text style={styles.secondaryText}>{v||"ALL"}</Text></Pressable>)}
      </View>
      <View style={{height:10}}/>
      {!rows.length ? <EmptyView label="drivers"/> : rows.map((d)=><View style={styles.card} key={d.id}>
        <View style={styles.row}>
          <Image source={require("../assets/icons/drivers.png")} style={{width:34,height:34}}/>
          <View style={{flex:1}}>
            <Text style={styles.title}>{d.fullName || d.user?.name || "Driver"}</Text>
            <Text style={styles.subtitle}>{d.id}</Text>
          </View>
          <Badge value={d.driverStatus || d.verificationStatus}/>
        </View>
        <View style={styles.divider}/>
        <Field label="Vehicle" value={d.vehicles?.[0]?.vehicleType || "—"}/>
        <Field label="Verification" value={statusLabel(d.verificationStatus)}/>
        <Field label="GPS" value={d.location ? `${d.location.latitude}, ${d.location.longitude}` : "No location"}/>
        <View style={[styles.row,{marginTop:12}]}>
          <Pressable style={[styles.primary,{flex:1}]} onPress={()=>onOpenKyc(d)}><Text style={styles.primaryText}>Open KYC / Details</Text></Pressable>
        </View>
      </View>)}
    </ScrollView>
  </SafeAreaView>;
}
