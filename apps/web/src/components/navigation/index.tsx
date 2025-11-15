"use client";
import React, { useEffect, useState } from "react";
import Header from "@/components/Header/index";
import LeftNavigation from "@/components/LeftNavigation/index";
import HeaderRtl from "@/components/Header/rtl/index";
import LeftNavigationRtl from "@/components/LeftNavigation/rtl/index";
import AccountNavigation from "@/components/accountNavigation";
import AccountNavigationRtl from "@/components/accountNavigation/rtl";
import { usePathname } from "next/navigation";
import { Profile } from "@/interfaces";
import { fetchProfile } from "@/lib/api/profiles-client";
import { useAuth } from "../AuthProvider/authContext";
import { ActiveChannelProvider } from "@/contexts/ActiveChannelContext";
import { useChannels } from "@/hooks/useChannels";

const Navigation: React.FC = () => {
    const [isCollapsed, setIsCollapsed] = useState(true);
    const [isAccountCollapsed, setIsAccountCollapsed] = useState(true);
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

    const toggleAccountCollapse = () => {
        setIsAccountCollapsed(!isAccountCollapsed);
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
                    ? <HeaderRtl profile={profile} toggleCollapse={toggleCollapse} toggleAccountCollapse={toggleAccountCollapse} channels={channels} />
                    : <Header profile={profile} toggleCollapse={toggleCollapse} toggleAccountCollapse={toggleAccountCollapse} channels={channels} />}
                <div className="flex flex-1">
                    {/* Left Navigation */}
                    {path.indexOf('/ar') > -1
                        ? <LeftNavigationRtl isCollapsed={isCollapsed} withOverlay={true} onCollapse={() => setIsCollapsed(true)} />
                        : <LeftNavigation isCollapsed={isCollapsed} withOverlay={true} onCollapse={() => setIsCollapsed(true)} />}

                    {/* Account Navigation */}
                    {path.indexOf('/ar') > -1
                        ? <AccountNavigationRtl profile={profile} user={auth.user} isVisible={!isAccountCollapsed} onClose={() => setIsAccountCollapsed(true)} />
                        : <AccountNavigation profile={profile} user={auth.user} isVisible={!isAccountCollapsed} onClose={() => setIsAccountCollapsed(true)} />}

                </div>
            </div>
        </ActiveChannelProvider>
    );
};

export default Navigation;
