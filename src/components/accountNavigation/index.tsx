"use client";
import React, { useEffect } from "react";
import { darkModeStore } from "@/lib/darkMode";
import { redirect, useSearchParams, usePathname } from "next/navigation";
import IcoButton from "@/components/iconButton";
import Image from 'next/image';
import Link from "next/link";

interface AccountNavigationProps {
    isVisible: boolean;
    onClose: () => void;
}

const AccountNavigation: React.FC<AccountNavigationProps> = ({
    isVisible,
    onClose,
}) => {
    const [darkmode, setDarkmode] = React.useState(darkModeStore.get());
    let path = usePathname();
    let params = useSearchParams()?.toString();

    const handleClick = () => {
        const dark = !darkmode;
        darkModeStore.set(dark);
    };

    const newPath = `/rtl${path}`;
    const newParams = params ? `?${params}` : "";
    const newUrl = `${newPath}${newParams}`;

    useEffect(() => {
        return darkModeStore.subscribe(setDarkmode);
    }, []);

    const accountItems = [
        { label: "Profile", icon: "fa-user", href: "/profile" },
        {
            label: "Dark Mode",
            icon: `${darkmode ? "fa-sun" : "fa-moon"}`,
            href: "#",
            onClick: handleClick,
        },
        {
            label: "العربية",
            icon: "fa-align-right",
            href: newUrl,
        },
        { label: "Settings", icon: "fa-cog", href: "/settings" },
        { label: "Logout", icon: "fa-sign-out-alt", href: "/logout" },
    ];

    return (
        <>
            {/* Overlay */}
            {isVisible && (
                <div
                    className="fixed inset-0 bg-black opacity-50 z-40"
                    onClick={onClose}
                ></div>
            )}

            {/* Account Navigation */}
            <nav
                className={`fixed top-0 right-0 h-screen bg-white dark:bg-gray-900 z-50 transition-all duration-300 ease-in-out 
                    ${isVisible ? "w-64" : "w-0 hidden"}`}
            >
                <div className="flex justify-end px-2 py-2.5">
                    <div className="w-10 h-10 rounded-full overflow-hidden relative">
                        <Image src="/avatar.png" alt="User" width={40} height={40} objectFit="cover" className="bg-gray-500" />
                    </div>
                </div>
                <ul>
                    {accountItems.map((item, index) => (
                        <li
                            key={index}
                            className="rounded-sm hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer"
                        >
                            <Link
                                href={item.href}
                                className="flex items-center space-x-2 py-2 px-4"
                                onClick={item.onClick}
                            >
                                <IcoButton
                                    style={item.icon}
                                    size="text-lg"
                                    color="text-black dark:text-white bg-transparent cursor-pointer"
                                />
                                <span className="text-black dark:text-white text-sm md:text-base">
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

export default AccountNavigation;