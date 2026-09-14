import React, { useState } from "react";
import { Image, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import CustomerApp from "./customer/App";
import DriverApp from "./driver/App";

export default function App() {
  const [role, setRole] = useState<"selector" | "CUSTOMER" | "DRIVER">("selector");
  if (role === "CUSTOMER") return <CustomerApp onBeDriver={() => setRole("DRIVER")} />;
  if (role === "DRIVER") return <DriverApp />;
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.brand}>RideX</Text>
        <Text style={styles.title}>Choose your access</Text>
        <Text style={styles.subtitle}>One app. Customer and Driver experiences. Same RideX backend.</Text>
        <Pressable style={styles.primary} onPress={() => setRole("CUSTOMER")}> <Text style={styles.primaryText}>Customer Login</Text></Pressable>
        <Pressable style={styles.secondary} onPress={() => setRole("DRIVER")}> <Text style={styles.secondaryText}>Driver Login</Text></Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f6f8fb" },
  container: { flex: 1, justifyContent: "center", padding: 28 },
  brand: { fontSize: 42, fontWeight: "900", textAlign: "center", marginBottom: 12 },
  title: { fontSize: 26, fontWeight: "800", textAlign: "center", marginBottom: 8 },
  subtitle: { fontSize: 15, lineHeight: 22, textAlign: "center", color: "#586174", marginBottom: 28 },
  primary: { backgroundColor: "#111827", borderRadius: 16, paddingVertical: 16, marginBottom: 12 },
  primaryText: { color: "#fff", textAlign: "center", fontSize: 17, fontWeight: "800" },
  secondary: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#d7dce5", borderRadius: 16, paddingVertical: 16 },
  secondaryText: { color: "#111827", textAlign: "center", fontSize: 17, fontWeight: "800" },
});
