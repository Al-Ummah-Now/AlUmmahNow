"use client";
import React from "react";
import IcoButton from "./iconButton";

const navItems = [
    { label: "Home", icon: "fa-house", href: "/" },
    { label: "Trending", icon: "fa-magnifying-glass", href: "#" },
    { label: "Subscriptions", icon: "fa-tv", href: "#" },
    { label: "Library", icon: "fa-bookmark", href: "#" },
];

const LeftNavigation: React.FC<{ isCollapsed: boolean }> = ({ isCollapsed }) => {
    return (
        <nav
            className={`bg-ummah-bg p-4 rounded-sm ${isCollapsed ? "md:w-22 w-0 hidden md:block" : "md:w-56"} transition-all duration-300`}
        >
            <ul>
                {navItems.map((item, index) => (
                    <li key={index}>
                        <a
                            href={item.href}
                            className={`flex items-center space-x-2 hover:bg-ummah-400 rounded-sm py-2 pl-2 ${isCollapsed ? "" : ""}`}
                        >
                            <IcoButton style={item.icon} color="text-ummah-bg bg-ummah-text" />
                            <span
                                className={`${isCollapsed ? "hidden" : "block"
                                    } text-ummah-text text-sm md:text-base`}
                            >
                                {item.label}
                            </span>
                        </a>
                    </li>
                ))}
            </ul>
        </nav>
    );
};

export default LeftNavigation;