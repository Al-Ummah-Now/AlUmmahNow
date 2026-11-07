"use client";
import React from "react";
import IcoButton from "@/components/iconButton";
import Link from 'next/link';
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { useTheme } from 'next-themes';
import { useLanguage } from '@/hooks/useLanguage';
import { saveLanguagePreference } from '@/lib/i18n/utils';
import { Sun, Moon, Globe } from 'lucide-react';

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
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const router = useRouter();
    const { user } = useMultiAccount();
    const activeChannel = user?.channel;
    // resolvedTheme: with the default "system" theme, `theme` is never 'dark',
    // so toggling from a dark system preference would be a no-op
    const { resolvedTheme: theme, setTheme } = useTheme();
    const { t, lang, oppositeLanguage, languages } = useLanguage();

    const allNavItems: NavItems[] = [
        { label: t.navigation.homeLink, icon: "fa-house", href: `/${lang}/` },
        { label: t.navigation.search, icon: "fa-magnifying-glass", href: `/${lang}/search` },
        { label: t.navigation.explore, icon: "fa-compass", href: `/${lang}/explore` },
        { label: t.navigation.upload, icon: "fa-upload", href: `/${lang}/upload` },
        { label: t.navigation.subscriptions, icon: "fa-tv", href: "#" },
        { label: t.navigation.library, icon: "fa-bookmark", href: `/${lang}/library` },
    ];

    // Filter out Upload if user has no active channel
    const navItems = activeChannel
        ? allNavItems
        : allNavItems.filter(item => item.icon !== "fa-upload");

    const toggleTheme = () => {
        setTheme(theme === 'dark' ? 'light' : 'dark');
    };

    const switchLanguage = () => {
        // Save language preference to localStorage and cookie
        saveLanguagePreference(oppositeLanguage);

        const newPath = pathname?.replace(`/${lang}`, `/${oppositeLanguage}`) || `/${oppositeLanguage}`;
        const params = searchParams?.toString();
        const newUrl = params ? `${newPath}?${params}` : newPath;
        router.push(newUrl);
    };

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
                data-testid="side-nav"
                className={`transition-all duration-300 ease-in-out ${withOverlay
                    ? "fixed top-0 bg-transparent z-50 h-screen"
                    : "bg-white dark:bg-gray-900 p-4 md:absolute"
                    } ${isCollapsed ? "w-0 hidden" : "w-48"} `}
            >
                {/* Show the bars button only in overlay mode */}
                {withOverlay && (
                    <div className="flex items-center space-x-4 pl-2 h-15">
                        <IcoButton
                            style="fa-bars"
                            size="text-lg"
                            color="text-[#ffa037]  bg-transparent"
                            onClick={onCollapse}
                            ariaLabel={t.common.close}
                            testId="nav-drawer-close"
                        />
                    </div>
                )}
                <ul className="bg-white dark:bg-gray-900 h-screen flex flex-col overflow-y-auto">
                    {/* Enhanced Controls Section - AT TOP */}
                    <li className="px-3 py-4 border-b border-gray-200 dark:border-gray-700">
                        <div className="space-y-2.5">
                            {/* Dark Mode Toggle */}
                            <button
                                onClick={toggleTheme}
                                className="relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-700/50 border border-gray-200/50 dark:border-gray-700/50 hover:border-gray-300 dark:hover:border-gray-600 transition-all duration-200 group"
                                aria-label={theme === 'dark' ? t.navigation.lightMode : t.navigation.darkMode}
                                data-testid="theme-toggle"
                                suppressHydrationWarning
                            >
                                <div
                                    className={`flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-200 ${
                                        theme === 'dark'
                                            ? 'bg-yellow-500/10 text-yellow-500 group-hover:bg-yellow-500/20'
                                            : 'bg-blue-500/10 text-blue-600 group-hover:bg-blue-500/20'
                                    }`}
                                    suppressHydrationWarning
                                >
                                    {theme === 'dark' ? (
                                        <Sun className="h-5 w-5" />
                                    ) : (
                                        <Moon className="h-5 w-5" />
                                    )}
                                </div>
                                <div className="flex-1 text-left">
                                    <div className="text-xs font-medium text-gray-600 dark:text-gray-400">
                                        {t.navigation.theme}
                                    </div>
                                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100" suppressHydrationWarning>
                                        {theme === 'dark' ? t.navigation.light : t.navigation.dark}
                                    </div>
                                </div>
                            </button>

                            {/* Language Selector */}
                            <button
                                onClick={switchLanguage}
                                className="relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-700/50 border border-gray-200/50 dark:border-gray-700/50 hover:border-gray-300 dark:hover:border-gray-600 transition-all duration-200 group"
                                aria-label={t.navigation.switchToLanguage.replace('{language}', languages[oppositeLanguage].displayName)}
                                data-testid="language-toggle"
                            >
                                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 group-hover:bg-indigo-500/20 transition-all duration-200">
                                    <Globe className="h-5 w-5" />
                                </div>
                                <div className="flex-1 text-left">
                                    <div className="text-xs font-medium text-gray-600 dark:text-gray-400">
                                        {t.navigation.language}
                                    </div>
                                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                                        {languages[oppositeLanguage].displayName}
                                    </div>
                                </div>
                            </button>
                        </div>
                    </li>

                    {navItems.map((item, index) => (
                        <li
                            key={index}
                            className="hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer"
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
                    <li className="hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer">
                        <Link href={`/${lang}/settings/privacy`} data-testid="nav-privacy" className="flex items-center space-x-2 py-2 pl-2">
                            <IcoButton style="fa-shield-halved" size="text-lg" color="text-black dark:text-white bg-transparent cursor-pointer" />
                            <span className={`${isCollapsed ? "hidden" : "block"} text-black dark:text-white text-sm md:text-base`}>
                                {t.navigation.privacyAndCookies}
                            </span>
                        </Link>
                    </li>
                </ul>
            </nav>
        </>
    );
};

export default LeftNavigationWithOverlay;
