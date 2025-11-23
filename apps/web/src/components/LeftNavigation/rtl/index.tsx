"use client";
import React from "react";
import IcoButton from "@/components/iconButton";
import Link from 'next/link';
import { usePathname } from "next/navigation";
import { useActiveChannel } from "@/contexts/ActiveChannelContext";

interface NavItems {
    label: string;
    icon: string;
    href: string;
    onClick?: () => void;
}

interface LeftNavigationWithOverlayProps {
    isCollapsed: boolean;
    onCollapse?: () => void;
    withOverlay?: boolean; // Optional prop to enable overlay mode
}

const LeftNavigationWithOverlayRTL: React.FC<LeftNavigationWithOverlayProps> = ({
    isCollapsed,
    onCollapse,
    withOverlay = false, // Default to no overlay
}) => {
    const pathname = usePathname();
    const locale = pathname?.startsWith('/ar') ? 'ar' : 'en';
    const { activeChannel } = useActiveChannel();

    const allNavItems: NavItems[] = [
        { label: "الرئيسية", icon: "fa-house", href: `/${locale}/` }, // Home
        { label: "الشائع", icon: "fa-magnifying-glass", href: `/${locale}/search` }, // Trending
        { label: "رفع فيديو", icon: "fa-upload", href: `/${locale}/upload` }, // Upload
        { label: "الاشتراكات", icon: "fa-tv", href: "#" }, // Subscriptions
        { label: "المكتبة", icon: "fa-bookmark", href: "#" }, // Library
    ];

    // Filter out Upload if user has no active channel
    const navItems = activeChannel
        ? allNavItems
        : allNavItems.filter(item => item.label !== "رفع فيديو");

    return (
        <>
            {/* Overlay */}
            {withOverlay && !isCollapsed && (
                <div
                    className="fixed inset-0 bg-black opacity-50 z-40"
                    onClick={onCollapse}
                ></div>
            )}

            {/* Navigation */}
            <nav
                className={`${withOverlay? "fixed top-0 bg-transparent z-50 h-screen " : "bg-white dark:bg-gray-900 p-4 md:absolute"} 
                    ${isCollapsed ? "w-0 hidden" : "w-48"} 
                    transition-all duration-300`}
                style={{ direction: "rtl" }} // Set RTL direction
            >
                {/* Show the bars button only in overlay mode */}
                {withOverlay && (
                    <div className="flex items-center space-x-reverse space-x-4 pr-2 h-15">
                        <IcoButton
                            style="fa-bars"
                            size="text-lg"
                            color="text-[#ffa037] bg-transparent"
                        />
                    </div>
                )}
                <ul className="bg-white dark:bg-gray-900 h-screen">
                    {navItems.map((item, index) => (
                        <li
                            key={index}
                            className="hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer"
                        >
                            <Link
                                href={item.href}
                                className={`flex items-center space-x-2 p-2 `}
                                onClick={item.onClick}
                            >
                                <IcoButton
                                    style={item.icon}
                                    size="text-lg"
                                    color="text-black dark:text-white bg-transparent cursor-pointer"
                                />
                                <span
                                    className={`${isCollapsed ? "hidden" : "block"
                                        } text-black dark:text-white text-sm md:text-base`}
                                >
                                    {item.label}
                                </span>
                            </Link>
                        </li>
                    ))}
                </ul>
            </nav>
        </>
    );
};

export default LeftNavigationWithOverlayRTL;