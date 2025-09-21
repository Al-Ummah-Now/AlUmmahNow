"use client";
import React, { useEffect, useState } from "react";
import Header from "@/components/Header/index";
import LeftNavigation from "@/components/LeftNavigation/index";
import HeaderRtl from "@/components/Header/rtl/index";
import LeftNavigationRtl from "@/components/LeftNavigation/rtl/index";
import AccountNavigation from "@/components/accountNavigation";
import AccountNavigationRtl from "@/components/accountNavigation/rtl";
import { redirect, useSearchParams, usePathname } from "next/navigation";
import { AuthSubject, Profile } from "@/interfaces";
import { fetchProfile } from "@/lib/clients/profiles";
import { useAuth } from "../AuthProvider/authContext";

const Navigation: React.FC = () => {
    const [isCollapsed, setIsCollapsed] = useState(true);
    const [isAccountCollapsed, setIsAccountCollapsed] = useState(true);
    const [profile, setProfile] = React.useState<Profile | null>(null);
    const auth = useAuth();
    const path = usePathname();
    const rtl = path.indexOf('/ar') > -1;

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
        <>
            <div style={{ direction: rtl ? "rtl" : "ltr" }}>
                {rtl
                    ? <HeaderRtl profile={profile} toggleCollapse={toggleCollapse} toggleAccountCollapse={toggleAccountCollapse} />
                    : <Header profile={profile} toggleCollapse={toggleCollapse} toggleAccountCollapse={toggleAccountCollapse} />}
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
        </>
    );
};

export default Navigation;
