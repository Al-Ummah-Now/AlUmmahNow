"use client";
import React, { useEffect, useState, memo } from "react";
import dynamic from "next/dynamic";
import Header from "@/components/Header/index";
import HeaderRtl from "@/components/Header/rtl/index";
import { usePathname } from "next/navigation";
import { Profile } from "@/interfaces";
import { fetchProfile } from "@/lib/api/profiles-client";
import { useAuth } from "../AuthProvider/authContext";

// Lazy load navigation components for better FID
const LeftNavigation = dynamic(() => import("@/components/LeftNavigation/index"), {
  ssr: true,
  loading: () => null,
});
const LeftNavigationRtl = dynamic(() => import("@/components/LeftNavigation/rtl/index"), {
  ssr: true,
  loading: () => null,
});

const Navigation: React.FC = memo(() => {
    const [isCollapsed, setIsCollapsed] = useState(true);
    const [profile, setProfile] = React.useState<Profile | null>(null);
    const auth = useAuth();
    const path = usePathname();
    // Locale prefix only: a later segment containing "/ar" must not flip the layout
    const rtl = path === '/ar' || path.startsWith('/ar/');

    const toggleCollapse = () => {
        setIsCollapsed(!isCollapsed);
    };

    useEffect(() => {
        if (auth?.user) {
            fetchProfile(auth.user, setProfile);
        } else {
            setProfile(null);
        }
    }, [auth]);

    return (
        <div style={{ direction: rtl ? "rtl" : "ltr" }}>
            {rtl
                ? <HeaderRtl profile={profile} toggleCollapse={toggleCollapse} isNavOpen={!isCollapsed} />
                : <Header profile={profile} toggleCollapse={toggleCollapse} isNavOpen={!isCollapsed} />}
            <div className="flex flex-1">
                {/* Left Navigation */}
                {rtl
                    ? <LeftNavigationRtl isCollapsed={isCollapsed} withOverlay={true} onCollapse={() => setIsCollapsed(true)} />
                    : <LeftNavigation isCollapsed={isCollapsed} withOverlay={true} onCollapse={() => setIsCollapsed(true)} />}
            </div>
        </div>
    );
});

Navigation.displayName = 'Navigation';

export default Navigation;
