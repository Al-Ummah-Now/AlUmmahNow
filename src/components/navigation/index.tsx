"use client";
import React, { useState } from "react";
import Header from "@/components/Header/index";
import LeftNavigation from "@/components/LeftNavigation/index";
import HeaderRtl from "@/components/Header/rtl/index";
import LeftNavigationRtl from "@/components/LeftNavigation/rtl/index";
import AccountNavigation from "@/components/accountNavigation";
import AccountNavigationRtl from "@/components/accountNavigation/rtl";
import { redirect, useSearchParams, usePathname } from "next/navigation";
import { AuthSubject } from "@/interfaces";

const Navigation: React.FC<{ user: AuthSubject | false }> = ({ user }) => {
    const [isCollapsed, setIsCollapsed] = useState(true);
    const [isAccountCollapsed, setIsAccountCollapsed] = useState(true);
    const path = usePathname();
    const rtl = path.indexOf('/rtl') > -1;

    const toggleCollapse = () => {
        setIsCollapsed(!isCollapsed);
    };

    const toggleAccountCollapse = () => {
        setIsAccountCollapsed(!isAccountCollapsed);
    };

    return (
        <>
            <div style={{ direction: rtl ? "rtl" : "ltr" }}>
                {rtl
                    ? <HeaderRtl toggleCollapse={toggleCollapse} toggleAccountCollapse={toggleAccountCollapse} />
                    : <Header toggleCollapse={toggleCollapse} toggleAccountCollapse={toggleAccountCollapse} />}
                <div className="flex flex-1">
                    {/* Left Navigation */}
                    {path.indexOf('/rtl') > -1
                        ? <LeftNavigationRtl isCollapsed={isCollapsed} withOverlay={true} onCollapse={() => setIsCollapsed(true)} />
                        : <LeftNavigation isCollapsed={isCollapsed} withOverlay={true} onCollapse={() => setIsCollapsed(true)} />}

                    {/* Account Navigation */}
                    {path.indexOf('/rtl') > -1
                        ? <AccountNavigationRtl user={user} isVisible={!isAccountCollapsed} onClose={() => setIsAccountCollapsed(true)} />
                        : <AccountNavigation user={user} isVisible={!isAccountCollapsed} onClose={() => setIsAccountCollapsed(true)} />}

                </div>
            </div>
        </>
    );
};

export default Navigation;
