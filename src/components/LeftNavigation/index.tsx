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

const LeftNavigationWithOverlay: React.FC<LeftNavigationWithOverlayProps> = ({
    isCollapsed,
    onCollapse,
    withOverlay = false, // Default to no overlay
}) => {
    const navItems: NavItems[] = [
        { label: "Home", icon: "fa-house", href: "/en/" },
        { label: "Trending", icon: "fa-magnifying-glass", href: "/en/search" },
        { label: "Subscriptions", icon: "fa-tv", href: "#" },
        { label: "Library", icon: "fa-bookmark", href: "#" },
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
                className={`transition-all duration-300 ease-in-out ${withOverlay
                    ? "fixed top-0 bg-white dark:bg-gray-900  z-50 h-screen"
                    : "bg-white dark:bg-gray-900 p-4 md:absolute"
                    } ${isCollapsed ? "md:w-22 w-0 hidden" : "md:w-56"} `}
            >
                {/* Show the bars button only in overlay mode */}
                {withOverlay && (
                    <div className="flex items-center space-x-4 mb-4  pl-2 h-15 bg-[#093041]">
                        <IcoButton
                            style="fa-bars"
                            size="text-lg"
                            color="text-[#ffa037]  bg-transparent"
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
                                className={`flex items-center space-x-2 py-2 pl-2`}
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

export default LeftNavigationWithOverlay;