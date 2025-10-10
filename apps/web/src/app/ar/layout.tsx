import React from "react";
import ProfileGuard from "@/components/ProfileGuard";

export default function ArabicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProfileGuard locale="ar">
      {children}
    </ProfileGuard>
  );
}