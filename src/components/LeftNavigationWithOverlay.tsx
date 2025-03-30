"use client";
import React, { useEffect } from "react";
import IcoButton from "./iconButton";
import { darkModeStore } from "./darkMode";

interface NavItems {
    label: string;
    icon: string;
    href: string;
    onClick?: () => void;
}

const LeftNavigationWithOverlay: React.FC<{ isCollapsed: boolean; onCollapse: () => void }> = ({ isCollapsed, onCollapse }) => {
    const [darkmode, setDarkmode] = React.useState(darkModeStore.get());

    const handleClick = () => {
        const dark = !darkmode;
        darkModeStore.set(dark);
    };

    const navItems: NavItems[] = [
        { label: "Home", icon: "fa-house", href: "/" },
        { label: "Trending", icon: "fa-magnifying-glass", href: "#" },
        { label: "Subscriptions", icon: "fa-tv", href: "#" },
        { label: "Library", icon: "fa-bookmark", href: "#" },
        { label: "Dark Mode", icon: `${darkmode ? "fa-sun" : "fa-moon"}`, href: "#", onClick: handleClick },
    ];

    useEffect(() => {
        return darkModeStore.subscribe(setDarkmode);
    }, []);

    return (
        <>
            {/* Overlay */}
            {!isCollapsed && (
                <div
                    className="fixed inset-0 bg-black opacity-50 z-40"
                    onClick={onCollapse}
                ></div>
            )}

            {/* Navigation */}
            <nav
                className={`fixed bg-ummah-bg p-4 rounded-sm md:absolute z-50 h-screen ${isCollapsed ? "md:w-22 w-0 hidden" : "md:w-56"} transition-all duration-300`}
            >
                <div className="flex items-center space-x-4 mb-4 mt-4 pl-2">
                    <IcoButton style="fa-bars" color='text-ummah-bg bg-ummah-text' onClick={onCollapse}>
                    </IcoButton>
                </div>
                <ul>
                    {navItems.map((item, index) => (
                        <li key={index}>
                            <a
                                href={item.href}
                                className={`flex items-center space-x-2 hover:bg-ummah-400 rounded-sm py-2 pl-2`}
                            >
                                <IcoButton style={item.icon} color="text-ummah-bg bg-ummah-text" onClick={item.onClick} />
                                <span className={`${isCollapsed ? "hidden" : "block"} text-ummah-text text-sm md:text-base`} >
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

export default LeftNavigationWithOverlay;