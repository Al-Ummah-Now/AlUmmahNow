"use client";
import React, { useEffect, useState, memo } from "react";
import dynamic from "next/dynamic";
import Header from "@/components/Header/index";
import HeaderRtl from "@/components/Header/rtl/index";
import { usePathname } from "next/navigation";
import { Profile } from "@/interfaces";
import { fetchProfile } from "@/lib/api/profiles-client";
import { useAuth } from "../AuthProvider/authContext";
import { ActiveChannelProvider } from "@/contexts/ActiveChannelContext";
import { useChannels } from "@/hooks/useChannels";

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
    const rtl = path.indexOf('/ar') > -1;

    // Fetch user channels for the ActiveChannelProvider
    const { channels } = useChannels({
        channelId: profile?.id,
        userId: auth?.user?.id,
        autoFetch: !!profile?.id && !!auth?.user?.id
    });

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
        <ActiveChannelProvider userChannels={channels} userId={auth?.user?.id}>
            <div style={{ direction: rtl ? "rtl" : "ltr" }}>
                {rtl
                    ? <HeaderRtl profile={profile} toggleCollapse={toggleCollapse} channels={channels} />
                    : <Header profile={profile} toggleCollapse={toggleCollapse} channels={channels} />}
                <div className="flex flex-1">
                    {/* Left Navigation */}
                    {path.indexOf('/ar') > -1
                        ? <LeftNavigationRtl isCollapsed={isCollapsed} withOverlay={true} onCollapse={() => setIsCollapsed(true)} />
                        : <LeftNavigation isCollapsed={isCollapsed} withOverlay={true} onCollapse={() => setIsCollapsed(true)} />}
                </div>
            </div>
        </ActiveChannelProvider>
    );
});

Navigation.displayName = 'Navigation';

export default Navigation;
