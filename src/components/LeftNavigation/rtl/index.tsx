"use client";
import React, { useEffect } from "react";
import IcoButton from "@/components/iconButton";
import { darkModeStore } from "@/lib/darkMode";
import { redirect, useSearchParams, usePathname } from "next/navigation";
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
    const [darkmode, setDarkmode] = React.useState(darkModeStore.get());
    const path = usePathname();
    const params = useSearchParams().toString();

    const handleClick = () => {
        const dark = !darkmode;
        darkModeStore.set(dark);
    };

    const navItems: NavItems[] = [
        { label: "الرئيسية", icon: "fa-house", href: "/rtl/" }, // Home
        { label: "الشائع", icon: "fa-magnifying-glass", href: "/rtl/search" }, // Trending
        { label: "الاشتراكات", icon: "fa-tv", href: "#" }, // Subscriptions
        { label: "المكتبة", icon: "fa-bookmark", href: "#" }, // Library
        {
            label: "الوضع الداكن",
            icon: `${darkmode ? "fa-sun" : "fa-moon"}`,
            href: "#",
            onClick: handleClick, // Dark Mode
        },
        {
            label: "English",
            icon: "fa-align-left",
            href: `${path.replace("/rtl", "")}?${params}`,
        },
    ];

    useEffect(() => {
        return darkModeStore.subscribe(setDarkmode);
    }, []);

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
                        ? "fixed bg-white dark:bg-gray-800 p-4 rounded-sm z-50 h-screen"
                        : "bg-white dark:bg-gray-800 p-4 rounded-sm md:absolute"
                    } ${isCollapsed ? "md:w-22 w-0 hidden" : "md:w-56"
                    } transition-all duration-300`}
                style={{ direction: "rtl" }} // Set RTL direction
            >
                {/* Show the bars button only in overlay mode */}
                {withOverlay && (
                    <div className="flex items-center space-x-reverse space-x-4 mb-4 mt-4 pr-4">
                        <IcoButton
                            style="fa-bars"
                            color="text-black dark:text-white bg-gray-200 dark:bg-gray-700"
                            onClick={onCollapse}
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
                                className={`flex items-center space-x-reverse space-x-2 py-2 pr-2`}
                                onClick={item.onClick}
                            >
                                <IcoButton
                                    style={item.icon}
                                    color="text-black dark:text-white bg-gray-200 dark:bg-gray-700 cursor-pointer"
                                />
                                <span
                                    className={`${isCollapsed ? "hidden" : "block"
                                        } text-black dark:text-white text-sm md:text-base pr-2`}
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