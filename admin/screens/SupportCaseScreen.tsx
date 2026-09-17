import React, { useEffect, useState } from "react";
import { Alert, Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";
import { AdminFetch, Badge, EmptyView, ErrorView, Field, LoadingView, ScreenHeader, styles, statusLabel } from "./common";

export default function SupportCaseScreen({api,adminFetch,onBack}:{api:string;adminFetch:AdminFetch;onBack:()=>void}) {
  const [rows,setRows]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [status,setStatus]=useState("");
  const [selected,setSelected]=useState<any|null>(null);
  const [busy,setBusy]=useState(false);

  async function load(){
    setLoading(true);setError("");
    try{
      const r=await adminFetch(`${api}/admin/support/cases${status?`?status=${encodeURIComponent(status)}`:""}`);
      const b=await r.json().catch(()=>({}));
      if(!r.ok||b?.success===false) throw new Error(b?.message||"Unable to load support cases");
      setRows(Array.isArray(b?.data)?b.data:[]);
    }catch(e){setError(e instanceof Error?e.message:"Unable to load support cases")}
    finally{setLoading(false)}
  }
  useEffect(()=>{void load()},[status]);

  async function updateCase(next:string){
    if(!selected) return;
    setBusy(true);
    try{
      const r=await adminFetch(`${api}/admin/support/cases/${encodeURIComponent(selected.id)}`,{
        method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:next})
      });
      const b=await r.json().catch(()=>({}));
      if(!r.ok||b?.success===false) throw new Error(b?.message||"Support update failed");
      setSelected(b.data); await load();
    }catch(e){Alert.alert("Support",e instanceof Error?e.message:"Request failed")}
    finally{setBusy(false)}
  }

  if(loading) return <SafeAreaView style={styles.page}><ScreenHeader title="Support Cases" onBack={onBack}/><LoadingView/></SafeAreaView>;
  if(error) return <SafeAreaView style={styles.page}><ScreenHeader title="Support Cases" onBack={onBack}/><ErrorView message={error} onRetry={()=>void load()}/></SafeAreaView>;

  if(selected) return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.scroll}>
    <ScreenHeader title="Support Case" subtitle={selected.id} onBack={()=>setSelected(null)}/>
    <View style={styles.card}>
      <View style={styles.row}><View style={{flex:1}}><Text style={styles.title}>{selected.subject || "Support Case"}</Text><Text style={styles.subtitle}>{selected.message || "No initial message"}</Text></View><Badge value={selected.status}/></View>
      <Field label="Priority" value={statusLabel(selected.priority)}/>
      <Field label="Customer" value={selected.customer?.fullName || selected.customerId}/>
      <Field label="Driver" value={selected.driver?.fullName || selected.driverId}/>
      <Field label="Booking" value={selected.booking?.id || selected.bookingId}/>
    </View>
    <Text style={styles.section}>Latest Messages</Text>
    {(selected.messages||[]).map((m:any,i:number)=><View style={styles.card} key={m.id||i}><Field label="Created" value={m.createdAt}/><Text style={styles.subtitle}>{m.message || m.body || "—"}</Text></View>)}
    <Text style={styles.section}>Case Status</Text>
    <View style={styles.row}>
      {["OPEN","IN_PROGRESS","RESOLVED","CLOSED"].map(v=><Pressable key={v} disabled={busy} style={[styles.secondary,{flex:1},selected.status===v&&{backgroundColor:"#eaf8f0",borderColor:"#0aa052"}]} onPress={()=>void updateCase(v)}><Text style={styles.secondaryText}>{v}</Text></Pressable>)}
    </View>
  </ScrollView></SafeAreaView>;

  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.scroll}>
    <ScreenHeader title="Support Cases" subtitle={`${rows.length} backend cases`} onBack={onBack}/>
    <View style={styles.row}>
      {["","OPEN","IN_PROGRESS","RESOLVED","CLOSED"].map(v=><Pressable key={v} onPress={()=>setStatus(v)} style={[styles.secondary,{marginBottom:8},status===v&&{backgroundColor:"#eaf8f0",borderColor:"#0aa052"}]}><Text style={styles.secondaryText}>{v||"ALL"}</Text></Pressable>)}
    </View>
    {!rows.length?<EmptyView label="support cases"/>:rows.map((c:any)=><Pressable key={c.id} style={styles.card} onPress={()=>setSelected(c)}>
      <View style={styles.row}><View style={{flex:1}}><Text style={styles.title}>{c.subject || "Support Case"}</Text><Text style={styles.subtitle}>{c.id}</Text></View><Badge value={c.status}/></View>
      <Field label="Customer" value={c.customer?.fullName || c.customerId}/>
      <Field label="Priority" value={statusLabel(c.priority)}/>
      <Field label="Updated" value={c.updatedAt}/>
    </Pressable>)}
  </ScrollView></SafeAreaView>;
}
