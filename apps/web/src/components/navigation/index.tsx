"use client";
// Prototype only: the redesigned shell replaces the previous header and drawer.
import React, { memo, useEffect } from "react";
import { AppShell } from "@/components/ThemeDemo/AppShell";

const Navigation: React.FC = memo(function NavigationProbe() {
  useEffect(() => { console.log(`HDR ${Date.now()} app mount Navigation ${location.pathname}`); return () => console.log(`HDR ${Date.now()} app unmount Navigation ${location.pathname}`); }, []);
  return <AppShell />;
});
Navigation.displayName = "Navigation";
export default Navigation;
