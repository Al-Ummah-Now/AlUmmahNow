"use client";
import React, { useEffect } from "react";
import IcoButton from "@/components/iconButton";
import Link from 'next/link'

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
    const navItems: NavItems[] = [
        { label: "الرئيسية", icon: "fa-house", href: "/ar/" }, // Home
        { label: "الشائع", icon: "fa-magnifying-glass", href: "/ar/search" }, // Trending
        { label: "الاشتراكات", icon: "fa-tv", href: "#" }, // Subscriptions
        { label: "المكتبة", icon: "fa-bookmark", href: "#" }, // Library
    ];

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
                className={`${withOverlay
                    ? "fixed top-0 bg-white dark:bg-gray-900 px-4 pb-4 pt-2.5 z-50 h-screen"
                    : "bg-white dark:bg-gray-900 p-4 md:absolute"
                    } ${isCollapsed ? "md:w-22 w-0 hidden" : "md:w-56"
                    } transition-all duration-300`}
                style={{ direction: "rtl" }} // Set RTL direction
            >
                {/* Show the bars button only in overlay mode */}
                {withOverlay && (
                    <div className="flex items-center space-x-reverse space-x-4 mb-4 pr-4">
                        <IcoButton
                            style="fa-bars"
                            size="text-lg"
                            color="text-[#ffa037] bg-transparent"
                        />
                    </div>
                )}
                <ul>
                    {navItems.map((item, index) => (
                        <li
                            key={index}
                            className="rounded-sm hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer"
                        >
                            <Link
                                href={item.href}
                                className={`flex items-center space-x-2 p-2 pr-4`}
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