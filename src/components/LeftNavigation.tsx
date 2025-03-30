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

const LeftNavigation: React.FC<{ isCollapsed: boolean }> = ({ isCollapsed }) => {
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
        { label: "Dark Mode", icon: `${darkmode ? "fa-sun" : "fa-moon"}` , href: "#", onClick: handleClick},
    ];
  
    useEffect(() => {
      return darkModeStore.subscribe(setDarkmode);
    }, []);

    return (
        <nav
            className={`bg-ummah-bg p-4 rounded-sm md:absolute ${isCollapsed ? "md:w-22 w-0 hidden" : "md:w-56"} transition-all duration-300`}
        >
            <ul>
                {navItems.map((item, index) => (
                    <li key={index}>
                        <a
                            href={item.href}
                            className={`flex items-center space-x-2 hover:bg-ummah-400 rounded-sm py-2 pl-2 ${isCollapsed ? "" : ""}`}
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
    );
};

export default LeftNavigation;