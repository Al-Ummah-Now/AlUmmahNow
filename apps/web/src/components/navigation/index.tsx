"use client";
// The shared header, rail and tab bar, as the root layout places them.
import React from "react";
import { AppShell } from "@/components/ThemeDemo/AppShell";
import { useOptionalAuth } from "@/components/AuthProvider/authContext";

/**
 * A plain function, never `memo()` (#1058): the server layout places this component, and after a
 * Server Action or router.refresh() its type can arrive as a lazy reference. React keeps the mounted
 * tree only when that reference resolves to the component it holds; for a memo() component it holds
 * the inner function, so every such update threw the whole header away (focus, typed search, the open
 * menu). The key is the signed-in account, so another person signing in still starts a clean header;
 * switching who you act as (personal or a channel) keeps it.
 */
export default function Navigation() {
  const { user } = useOptionalAuth();
  return <AppShell key={user?.id ?? "signed-out"} />;
}
