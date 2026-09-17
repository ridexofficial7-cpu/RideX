import React, { useState } from "react";
import { View } from "react-native";
import CustomerApp from "./customer/App";
import DriverApp from "./driver/App";
import AdminApp from "./admin/App";
import { DEFAULT_ROLE, type AppRole } from "./navigation/routes";

/**
 * Unified RideX entry flow:
 * 1) Customer login is the default login screen.
 * 2) The Driver Login action appears directly below the customer login action.
 * 3) Driver login opens only after the user explicitly selects it.
 */
export default function App() {
  const [role, setRole] = useState<AppRole>(DEFAULT_ROLE);

  if (role === "DRIVER") {
    return <View style={{ flex: 1 }}><DriverApp startAt="login" onBackToCustomer={() => setRole("CUSTOMER")} /></View>;
  }

  if (role === "ADMIN") {
    return <View style={{ flex: 1 }}><AdminApp onBackToCustomer={() => setRole("CUSTOMER")} /></View>;
  }

  return <View style={{ flex: 1 }}><CustomerApp onBeDriver={() => setRole("DRIVER")} onAdminLogin={() => setRole("ADMIN")} /></View>;
}
