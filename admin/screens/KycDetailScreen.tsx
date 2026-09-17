import React, { useState } from "react";
import { Alert, Image, Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";
import { AdminFetch, Badge, Field, LoadingView, ScreenHeader, styles, statusLabel } from "./common";

export default function KycDetailScreen({api,adminFetch,driver,onBack}:{api:string;adminFetch:AdminFetch;driver:any;onBack:()=>void}) {
  const [busy,setBusy]=useState(false);
  const [selected,setSelected]=useState(driver);
  const docs=Array.isArray(selected?.documents)?selected.documents:[];

  async function refresh() {
    try {
      const r=await adminFetch(`${api}/admin/drivers/${encodeURIComponent(selected.id)}`);
      const b=await r.json().catch(()=>({}));
      if(!r.ok||b?.success===false) throw new Error(b?.message||"Unable to refresh driver");
      setSelected(b.data);
    } catch(e) { Alert.alert("KYC",e instanceof Error?e.message:"Unable to refresh"); }
  }

  async function review(doc:any,status:"APPROVED"|"REJECTED"|"UNDER_REVIEW") {
    if(status==="REJECTED") {
      const reason="Rejected from Admin Mobile";
      await updateDoc(doc,status,reason);
    } else await updateDoc(doc,status);
  }

  async function updateDoc(doc:any,status:string,rejectionReason?:string) {
    setBusy(true);
    try {
      const r=await adminFetch(`${api}/admin/drivers/${encodeURIComponent(selected.id)}/documents/${encodeURIComponent(doc.id)}/review`,{
        method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({status,rejectionReason})
      });
      const b=await r.json().catch(()=>({}));
      if(!r.ok||b?.success===false) throw new Error(b?.message||"KYC review failed");
      await refresh();
    } catch(e){ Alert.alert("KYC Review",e instanceof Error?e.message:"Request failed"); }
    finally{setBusy(false)}
  }

  async function updateDriverVerification(status:string) {
    setBusy(true);
    try{
      const r=await adminFetch(`${api}/admin/drivers/${encodeURIComponent(selected.id)}/verification`,{
        method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({verificationStatus:status})
      });
      const b=await r.json().catch(()=>({}));
      if(!r.ok||b?.success===false) throw new Error(b?.message||"Verification update failed");
      await refresh();
    }catch(e){Alert.alert("Driver Verification",e instanceof Error?e.message:"Request failed")}
    finally{setBusy(false)}
  }

  return <SafeAreaView style={styles.page}>
    <ScrollView contentContainerStyle={styles.scroll}>
      <ScreenHeader title="KYC / Driver Detail" subtitle={selected?.id} onBack={onBack}/>
      <View style={styles.card}>
        <View style={styles.row}>
          <Image source={require("../assets/icons/kyc.png")} style={{width:38,height:38}}/>
          <View style={{flex:1}}>
            <Text style={styles.title}>{selected?.fullName || "Driver"}</Text>
            <Text style={styles.subtitle}>{selected?.user?.mobile || "Mobile not available"}</Text>
          </View>
          <Badge value={selected?.verificationStatus}/>
        </View>
        <Field label="Driver Status" value={statusLabel(selected?.driverStatus)}/>
        <Field label="Service Mode" value={selected?.serviceMode || selected?.serviceModeName}/>
        <Field label="Vehicle Count" value={selected?.vehicles?.length ?? 0}/>
        <Field label="Location" value={selected?.location ? `${selected.location.latitude}, ${selected.location.longitude}` : "No location"}/>
      </View>

      <Text style={styles.section}>Verification</Text>
      <View style={styles.row}>
        <Pressable style={[styles.primary,{flex:1}]} disabled={busy} onPress={()=>void updateDriverVerification("APPROVED")}><Text style={styles.primaryText}>Approve</Text></Pressable>
        <Pressable style={[styles.danger,{flex:1}]} disabled={busy} onPress={()=>void updateDriverVerification("REJECTED")}><Text style={styles.dangerText}>Reject</Text></Pressable>
        <Pressable style={[styles.secondary,{flex:1}]} disabled={busy} onPress={()=>void updateDriverVerification("UNDER_REVIEW")}><Text style={styles.secondaryText}>Review</Text></Pressable>
      </View>

      <Text style={styles.section}>Documents</Text>
      {!docs.length ? <View style={styles.card}><Text style={styles.subtitle}>No documents attached.</Text></View> : docs.map((doc:any)=><View style={styles.card} key={doc.id}>
        <View style={styles.row}>
          <View style={{flex:1}}><Text style={styles.title}>{doc.documentType || doc.type || "Document"}</Text><Text style={styles.subtitle}>{doc.fileName || doc.id}</Text></View>
          <Badge value={doc.status}/>
        </View>
        <Field label="Rejection reason" value={doc.rejectionReason}/>
        <View style={[styles.row,{marginTop:12}]}>
          <Pressable style={[styles.secondary,{flex:1}]} disabled={busy} onPress={()=>void review(doc,"UNDER_REVIEW")}><Text style={styles.secondaryText}>Review</Text></Pressable>
          <Pressable style={[styles.primary,{flex:1}]} disabled={busy} onPress={()=>void review(doc,"APPROVED")}><Text style={styles.primaryText}>Approve</Text></Pressable>
          <Pressable style={[styles.danger,{flex:1}]} disabled={busy} onPress={()=>void review(doc,"REJECTED")}><Text style={styles.dangerText}>Reject</Text></Pressable>
        </View>
      </View>)}
      {busy?<LoadingView/>:null}
    </ScrollView>
  </SafeAreaView>;
}
