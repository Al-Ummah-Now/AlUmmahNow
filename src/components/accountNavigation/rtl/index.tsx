"use client";
import React, { useEffect } from "react";
import { redirect, useSearchParams, usePathname } from "next/navigation";
import IcoButton from "@/components/iconButton";
import Image from 'next/image';
import Link from "next/link";
import { Profile } from "@/interfaces";
import { AccountNavigationProps, NavItem } from "./../interfaces";
import { useTheme } from "next-themes"
import DialogDefault from "@/components/login/rtl";

const AccountNavigation: React.FC<AccountNavigationProps> = ({
    isVisible,
    onClose,
    user,
    profile
}) => {
    const [naveItems, setNaveItems] = React.useState([]);
    const [login, setLogin] = React.useState(false);
    const [logout, setLogout] = React.useState(false);
    const { theme, setTheme } = useTheme();
    let path = usePathname();
    let params = useSearchParams()?.toString();

    const newPath = path.replace("rtl", "").replace("//", "/");
    const newParams = params ? `?${params}` : "";
    const newUrl = `${newPath}${newParams}`;

    useEffect(() => {
        const handleLogin = () => setLogin(!login);
        const handleLogout = () => setLogout(!logout);
        const handleClick = () => {
          if (theme === "dark") {
            setTheme("light");
          } else if (theme === "light") {
            setTheme("dark");
          }
        };

        let items: NavItem[] = [
            {
                label: "الوضع الداكن",
                icon: `${theme === "dark" ? "fa-sun" : "fa-moon"}`,
                href: "#",
                onClick: handleClick,
            },
            {
                label: "English",
                icon: "fa-align-right",
                href: newUrl,
            },
        ];
        if(profile){
            items.push({ label: "الملف الشخصي", icon: "fa-user", href: "/profile" });
            items.push({ label: "الإعدادات", icon: "fa-cog", href: "/settings" });
        }
        user
            ? items.push({ label: "تسجيل الخروج", icon: "fa-sign-out-alt", href: "#", onClick: handleLogout })
            : items.push({ label: "تسجيل الدخول", icon: "fa-sign-in-alt", href: "#", onClick: handleLogin });

        setNaveItems(items);
    }, [user, newUrl, login, logout, profile, theme, setTheme]);

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
            <nav className={`fixed top-0 left-0 h-screen bg-white dark:bg-gray-900 z-50 transition-all duration-300 ease-in-out 
                ${isVisible ? "w-48" : "w-0 hidden"}`}
                style={{ direction: "rtl" }} // Set RTL direction
            >
                <div className="flex justify-end px-2 py-2.5">
                    <div className="w-10 h-10 rounded-full overflow-hidden relative">
                        <Image src={profile?.avatarUrl ? profile.avatarUrl : "/avatar.png"} alt="User" width={40} height={40} objectFit="cover" className="bg-gray-500" />
                    </div>
                </div>
                <ul>
                    {naveItems.map((item, index) => (
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
            <DialogDefault open={login} setOpen={setLogin}></DialogDefault>
        </>
    );
};

export default AccountNavigation;