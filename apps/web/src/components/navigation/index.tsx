"use client";
// Prototype only: the redesigned shell replaces the previous header and drawer.
import React, { memo } from "react";
import { AppShell } from "@/components/ThemeDemo/AppShell";

const Navigation: React.FC = memo(() => <AppShell />);
Navigation.displayName = "Navigation";
export default Navigation;
