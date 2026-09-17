import React, { useEffect, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";
import { AdminFetch, Badge, EmptyView, ErrorView, Field, LoadingView, ScreenHeader, styles, money, statusLabel } from "./common";

export default function PaymentManagementScreen({api,adminFetch,onBack}:{api:string;adminFetch:AdminFetch;onBack:()=>void}) {
  const [rows,setRows]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [status,setStatus]=useState("");
  const [selected,setSelected]=useState<any|null>(null);

  async function load(){
    setLoading(true);setError("");
    try{
      const r=await adminFetch(`${api}/admin/payments${status?`?status=${encodeURIComponent(status)}`:""}`);
      const b=await r.json().catch(()=>({}));
      if(!r.ok||b?.success===false) throw new Error(b?.message||"Unable to load payments");
      setRows(Array.isArray(b?.data)?b.data:[]);
    }catch(e){setError(e instanceof Error?e.message:"Unable to load payments")}
    finally{setLoading(false)}
  }
  useEffect(()=>{void load()},[status]);

  if(loading) return <SafeAreaView style={styles.page}><ScreenHeader title="Payments" onBack={onBack}/><LoadingView/></SafeAreaView>;
  if(error) return <SafeAreaView style={styles.page}><ScreenHeader title="Payments" onBack={onBack}/><ErrorView message={error} onRetry={()=>void load()}/></SafeAreaView>;

  if(selected) return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.scroll}>
    <ScreenHeader title="Payment Detail" subtitle={selected.id} onBack={()=>setSelected(null)}/>
    <View style={styles.card}>
      <View style={styles.row}><Text style={styles.title}>Payment</Text><Badge value={selected.status}/></View>
      <Field label="Amount" value={money(selected.amount)}/>
      <Field label="Method" value={selected.method}/>
      <Field label="Transaction" value={selected.transactionId}/>
      <Field label="Booking" value={selected.booking?.id || selected.bookingId}/>
      <Field label="Customer" value={selected.customer?.user?.mobile || selected.customerId}/>
      <Field label="Created" value={selected.createdAt}/>
    </View>
    <Text style={styles.section}>Refunds</Text>
    {(selected.refunds||[]).length ? (selected.refunds||[]).map((r:any)=><View style={styles.card} key={r.id}><Field label="Refund" value={r.id}/><Field label="Status" value={statusLabel(r.status)}/><Field label="Amount" value={money(r.amount)}/></View>) : <View style={styles.card}><Text style={styles.subtitle}>No refund records.</Text></View>}
  </ScrollView></SafeAreaView>;

  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.scroll}>
    <ScreenHeader title="Payment Management" subtitle={`${rows.length} backend records`} onBack={onBack}/>
    <View style={styles.row}>
      {["","PAID","PENDING","FAILED","REFUNDED"].map(v=><Pressable key={v} onPress={()=>setStatus(v)} style={[styles.secondary,{marginBottom:8},status===v&&{backgroundColor:"#eaf8f0",borderColor:"#0aa052"}]}><Text style={styles.secondaryText}>{v||"ALL"}</Text></Pressable>)}
    </View>
    {!rows.length?<EmptyView label="payments"/>:rows.map((p:any)=><Pressable key={p.id} style={styles.card} onPress={()=>setSelected(p)}>
      <View style={styles.row}><View style={{flex:1}}><Text style={styles.title}>{money(p.amount)}</Text><Text style={styles.subtitle}>{p.method || "Payment"} • {p.booking?.id || p.bookingId || "No booking"}</Text></View><Badge value={p.status}/></View>
      <Field label="Customer" value={p.customer?.user?.mobile || p.customerId}/>
      <Field label="Created" value={p.createdAt}/>
    </Pressable>)}
  </ScrollView></SafeAreaView>;
}
