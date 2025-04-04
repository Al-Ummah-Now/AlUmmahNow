"use client";
import React, { useEffect } from "react";
import IcoButton from "@/components/iconButton";
import { darkModeStore } from "@/components/darkMode";

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

    const handleClick = () => {
        const dark = !darkmode;
        darkModeStore.set(dark);
    };

    const navItems: NavItems[] = [
        { label: "Home", icon: "fa-house", href: "/" },
        { label: "Trending", icon: "fa-magnifying-glass", href: "/search" },
        { label: "Subscriptions", icon: "fa-tv", href: "#" },
        { label: "Library", icon: "fa-bookmark", href: "#" },
        {
            label: "Dark Mode",
            icon: `${darkmode ? "fa-sun" : "fa-moon"}`,
            href: "#",
            onClick: handleClick,
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
                className={`${withOverlay ? "fixed bg-white p-4 rounded-sm z-50 h-screen" : "bg-white p-4 rounded-sm md:absolute"} ${isCollapsed ? "md:w-22 w-0 hidden" : "md:w-56"
                    } transition-all duration-300`}
                style={{ direction: "rtl" }} // Set RTL direction
            >
                {/* Show the bars button only in overlay mode */}
                {withOverlay && (
                    <div className="flex items-center space-x-reverse space-x-4 mb-4 mt-4 pr-2">
                        <IcoButton
                            style="fa-bars"
                            color="text-white bg-black"
                            onClick={onCollapse}
                        />
                    </div>
                )}
                <ul>
                    {navItems.map((item, index) => (
                        <li key={index} className="rounded-sm hover:bg-gray-200 cursor-pointer">
                            <a
                                href={item.href}
                                className={`flex items-center space-x-reverse space-x-2 rounded-sm py-2 pr-2`}
                                onClick={item.onClick}
                            >
                                <IcoButton
                                    style={item.icon}
                                    color="text-white bg-black cursor-pointer"
                                />
                                <span
                                    className={`${isCollapsed ? "hidden" : "block"
                                        } text-black text-sm md:text-base`}
                                >
                                    {item.label}
                                </span>
                            </a>
                        </li>
                    ))}
                </ul>
            </nav>
        </>
    );
};

export default LeftNavigationWithOverlayRTL;