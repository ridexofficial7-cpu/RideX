import React from "react";
import { ActivityIndicator, Alert, Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

export type AdminFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function readJson<T = any>(response: Response): Promise<T> {
  return response.json().catch(() => ({} as T));
}

export function money(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? `₹${n.toFixed(2)}` : "₹0.00";
}

export function statusLabel(value: unknown): string {
  return String(value ?? "—").replaceAll("_", " ");
}

export function ScreenHeader({title, subtitle, onBack}:{title:string;subtitle?:string;onBack:()=>void}) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.iconBtn} accessibilityRole="button">
        <Image source={require("../assets/icons/back.png")} style={styles.iconImage}/>
      </Pressable>
      <View style={{flex:1}}>
        <Text style={styles.headerTitle}>{title}</Text>
        {!!subtitle && <Text style={styles.headerSub}>{subtitle}</Text>}
      </View>
    </View>
  );
}

export function LoadingView() {
  return <View style={styles.center}><ActivityIndicator size="large" color="#0aa052"/><Text style={styles.muted}>Loading from RideX backend…</Text></View>;
}

export function ErrorView({message,onRetry}:{message:string;onRetry:()=>void}) {
  return (
    <View style={styles.center}>
      <Text style={styles.error}>{message}</Text>
      <Pressable style={styles.primary} onPress={onRetry}><Text style={styles.primaryText}>Retry</Text></Pressable>
    </View>
  );
}

export function EmptyView({label}:{label:string}) {
  return <View style={styles.empty}><Text style={styles.emptyTitle}>No {label}</Text><Text style={styles.muted}>Backend returned no records.</Text></View>;
}

export function Field({label,value}:{label:string;value:unknown}) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><Text style={styles.fieldValue}>{value == null || value === "" ? "—" : String(value)}</Text></View>;
}

export function Badge({value}:{value:unknown}) {
  return <View style={styles.badge}><Text style={styles.badgeText}>{statusLabel(value)}</Text></View>;
}

export const styles=StyleSheet.create({
  page:{flex:1,backgroundColor:"#f4f7fb"},
  scroll:{padding:16,paddingBottom:40},
  header:{flexDirection:"row",alignItems:"center",gap:10,marginBottom:14},
  iconBtn:{width:40,height:40,borderRadius:12,backgroundColor:"#fff",alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:"#e1e7ef"},
  iconImage:{width:21,height:21,resizeMode:"contain"},
  headerTitle:{fontSize:22,fontWeight:"900",color:"#111a33"},
  headerSub:{fontSize:12,color:"#6f7b90",marginTop:3},
  row:{flexDirection:"row",alignItems:"center",gap:10},
  card:{backgroundColor:"#fff",borderRadius:16,borderWidth:1,borderColor:"#e2e8f0",padding:15,marginBottom:10},
  title:{fontSize:15,fontWeight:"900",color:"#111a33"},
  subtitle:{fontSize:12,color:"#63708a",marginTop:4,lineHeight:18},
  field:{marginTop:8},
  fieldLabel:{fontSize:11,color:"#7b8798",fontWeight:"800",textTransform:"uppercase"},
  fieldValue:{fontSize:13,color:"#17233c",fontWeight:"700",marginTop:2},
  badge:{alignSelf:"flex-start",backgroundColor:"#eaf8f0",paddingHorizontal:9,paddingVertical:5,borderRadius:20},
  badgeText:{fontSize:10,color:"#08783c",fontWeight:"900"},
  primary:{backgroundColor:"#0aa052",minHeight:44,borderRadius:11,alignItems:"center",justifyContent:"center",paddingHorizontal:14},
  primaryText:{color:"#fff",fontWeight:"900"},
  secondary:{backgroundColor:"#fff",minHeight:42,borderRadius:11,alignItems:"center",justifyContent:"center",paddingHorizontal:12,borderWidth:1,borderColor:"#d5deea"},
  secondaryText:{color:"#23324d",fontWeight:"800"},
  danger:{backgroundColor:"#fff1f2",minHeight:42,borderRadius:11,alignItems:"center",justifyContent:"center",paddingHorizontal:12,borderWidth:1,borderColor:"#fecdd3"},
  dangerText:{color:"#b4232c",fontWeight:"900"},
  input:{backgroundColor:"#fff",borderWidth:1,borderColor:"#d5deea",borderRadius:11,height:46,paddingHorizontal:12,color:"#14203a",marginBottom:10},
  muted:{fontSize:12,color:"#758096",marginTop:8,textAlign:"center"},
  error:{fontSize:13,color:"#b4232c",textAlign:"center",marginBottom:10},
  center:{flex:1,alignItems:"center",justifyContent:"center",padding:24},
  empty:{padding:28,alignItems:"center",backgroundColor:"#fff",borderRadius:16,borderWidth:1,borderColor:"#e2e8f0"},
  emptyTitle:{fontSize:16,fontWeight:"900",color:"#23324d"},
  divider:{height:1,backgroundColor:"#edf1f5",marginVertical:11},
  section:{fontSize:17,fontWeight:"900",color:"#111a33",marginBottom:10,marginTop:4},
});
