"use client";
import React, { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import IcoButton from "@/components/iconButton";
import Link from "next/link";
import { AccountNavigationProps, NavItem } from "./interfaces";
import DialogDefault from "../login";
import { useTheme } from "next-themes"
import LoginWrapper from "../login/loginButton";
import LogoutWrapper from "../login/logoutButton";
import UserAvatar from '@/components/UserAvatar';

const AccountNavigation: React.FC<AccountNavigationProps> = ({
    isVisible,
    onClose,
    user,
    profile
}) => {
    const [naveItems, setNaveItems] = React.useState<NavItem[]>([]);
    const [login, setLogin] = React.useState(false);
    const [logout, setLogout] = React.useState(false);
    const { theme, setTheme } = useTheme();

    const path = usePathname();
    const params = useSearchParams()?.toString();

    const newPath = path.replace("en", "ar");
    const newParams = params ? `?${params}` : "";
    const newUrl = `${newPath}${newParams}`;

    useEffect(() => {
        const handleLogin = () => setLogin(!login);
        const handleLogout = () => setLogout(!logout);
        const handleClick = () => {
            if (theme === "dark" || theme === "system") {
                setTheme("light");
            } else if (theme === "light" || theme === "system") {
                setTheme("dark");
            }
        };

        const items: NavItem[] = [
            {
                label: "Dark Mode",
                icon: `${theme === "dark" ? "fa-sun" : "fa-moon"}`,
                href: "#",
                onClick: handleClick,
            },
            {
                label: "العربية",
                icon: "fa-align-right",
                href: newUrl,
            }
        ];
        if (user) {
            items.push({ label: "Profile", icon: "fa-user", href: "/en/profile", onClick: onClose });
            items.push({ label: "Analytics", icon: "fa-chart-line", href: "/en/analytics", onClick: onClose });
            items.push({ label: "Settings", icon: "fa-cog", href: "/en/settings", onClick: onClose });
            
            // Add moderation link for admin/moderator users
            if (user.roles?.includes('admin') || user.roles?.includes('moderator')) {
                items.push({ label: "Moderation", icon: "fa-shield-alt", href: "/en/moderation", onClick: onClose });
            }
        }
        if (user) {
            items.push({ label: "Logout", icon: "fa-sign-out-alt", href: "#", onClick: handleLogout });
        } else {
            items.push({ label: "Login", icon: "fa-sign-in-alt", href: "#", onClick: handleLogin });
        }
        setNaveItems(items);
    }, [user, newUrl, login, logout, profile, theme, setTheme, onClose]);


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
                className={`fixed top-0 right-0 h-screen bg-transparent z-50 transition-all duration-300 ease-in-out 
                    ${isVisible ? "w-44" : "w-0 hidden"}`}
            >
                <div className="flex justify-end px-2 py-1.5">
                    <UserAvatar avatarUrl={profile?.avatarUrl} alt="User" />
                </div>
                <ul className="bg-white dark:bg-gray-900 h-screen">
                    {naveItems.map((item, index) => (
                        <li
                            key={index + 1}
                            className="hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer"
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
            <DialogDefault
                title="Login?"
                message="You will be redirected to the login page. Please enter your credentials
              to access your account. If you don&apos;t have an account, please register"
                open={login}
                setOpen={setLogin}>
                <LoginWrapper />
            </DialogDefault>
            <DialogDefault
                title="Logout?"
                message="You will be logged out of your account. Please confirm to proceed."
                open={logout}
                setOpen={setLogout}>
                <LogoutWrapper />
            </DialogDefault>
        </>
    );
};

export default AccountNavigation;