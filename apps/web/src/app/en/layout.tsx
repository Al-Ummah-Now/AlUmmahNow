import React from "react";
import ProfileGuard from "@/components/ProfileGuard";

export default function EnglishLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProfileGuard locale="en">
      {children}
    </ProfileGuard>
  );
}