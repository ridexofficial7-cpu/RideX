import React, { useCallback, useState } from "react";
import { View } from "react-native";

import CustomerApp from "./customer/App";
import DriverApp from "./driver/App";
import AdminApp from "./admin/App";
import { DEFAULT_ROLE, type AppRole } from "./navigation/routes";

/**
 * RideX Unified App Entry
 *
 * Role model:
 * - CUSTOMER: default application entry.
 * - DRIVER: explicitly entered from the Customer app; Driver starts at Welcome
 *   so existing drivers can log in while new drivers can enter registration.
 * - ADMIN: explicitly entered through the existing Admin entry action.
 *
 * Authentication/session ownership remains inside each role application.
 * This root component owns only the active application role and role switching.
 */
export default function App() {
  const [role, setRole] = useState<AppRole>(DEFAULT_ROLE);

  const openCustomer = useCallback(() => {
    setRole("CUSTOMER");
  }, []);

  const openDriver = useCallback(() => {
    setRole("DRIVER");
  }, []);

  const openAdmin = useCallback(() => {
    setRole("ADMIN");
  }, []);

  switch (role) {
    case "CUSTOMER":
      return (
        <View style={{ flex: 1 }}>
          <CustomerApp
            onBeDriver={openDriver}
            onAdminLogin={openAdmin}
          />
        </View>
      );

    case "DRIVER":
      return (
        <View style={{ flex: 1 }}>
          <DriverApp
            startAt="welcome"
            onBackToCustomer={openCustomer}
          />
        </View>
      );

    case "ADMIN":
      return (
        <View style={{ flex: 1 }}>
          <AdminApp onBackToCustomer={openCustomer} />
        </View>
      );

    default:
      // Defensive runtime fallback. CUSTOMER remains the safe default entry.
      return (
        <View style={{ flex: 1 }}>
          <CustomerApp
            onBeDriver={openDriver}
            onAdminLogin={openAdmin}
          />
        </View>
      );
  }
}
