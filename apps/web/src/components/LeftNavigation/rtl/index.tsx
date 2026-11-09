"use client";
import { SIDEBAR_PATHS } from '@/lib/navigation/destinations';
import React, { useEffect } from "react";
import IcoButton from "@/components/iconButton";
import Link from 'next/link';
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useTheme } from 'next-themes';
import { saveLanguagePreference } from '@/lib/i18n/utils';
import { Sun, Moon, Globe } from 'lucide-react';
import { getTranslations } from '@/lib/i18n';

const tAr = getTranslations('ar');

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
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const router = useRouter();
    // resolvedTheme: with the default "system" theme, `theme` is never 'dark',
    // so toggling from a dark system preference would be a no-op
    const { resolvedTheme: theme, setTheme } = useTheme();

    const locale = 'ar';

    const allNavItems: NavItems[] = [
        { label: tAr.navigation.homeLink, icon: "fa-house", href: `/${locale}${SIDEBAR_PATHS.home}` },
        { label: tAr.navigation.explore, icon: "fa-compass", href: `/${locale}${SIDEBAR_PATHS.explore}` },
        { label: tAr.navigation.subscriptions, icon: "fa-tv", href: `/${locale}${SIDEBAR_PATHS.subscriptions}` },
        { label: tAr.navigation.library, icon: "fa-bookmark", href: `/${locale}${SIDEBAR_PATHS.library}` },
        { label: tAr.feed.history, icon: "fa-clock-rotate-left", href: `/${locale}${SIDEBAR_PATHS.history}` },
        { label: tAr.library.watchLater, icon: "fa-clock", href: `/${locale}${SIDEBAR_PATHS.watchLater}` },
        { label: tAr.library.likedVideos, icon: "fa-heart", href: `/${locale}${SIDEBAR_PATHS.liked}` },
    ];

    const navItems = allNavItems;

    const toggleTheme = () => {
        setTheme(theme === 'dark' ? 'light' : 'dark');
    };

    const switchLanguage = () => {
        // Save language preference to localStorage and cookie
        saveLanguagePreference('en');

        const newPath = pathname?.replace('/ar', '/en') || '/en';
        const params = searchParams?.toString();
        const newUrl = params ? `${newPath}?${params}` : newPath;
        router.push(newUrl);
    };

    // Escape closes the open drawer
    useEffect(() => {
        if (isCollapsed || !onCollapse) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onCollapse();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [isCollapsed, onCollapse]);

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
                className={`${withOverlay? "fixed top-0 bg-transparent z-50 h-screen " : "bg-white dark:bg-gray-900 p-4 md:absolute"}
                    ${isCollapsed ? "w-0 hidden" : "w-48"}
                    transition-all duration-300`}
                style={{ direction: "rtl" }} // Set RTL direction
            >
                {/* Show the bars button only in overlay mode */}
                {withOverlay && (
                    <div className="flex items-center space-x-reverse space-x-4 pr-2 h-15">
                        <IcoButton
                            style="fa-bars"
                            size="text-lg"
                            color="text-[#ffa037] bg-transparent"
                            onClick={onCollapse}
                            ariaLabel={tAr.common.close}
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
                                aria-label={theme === 'dark' ? tAr.navigation.lightMode : tAr.navigation.darkMode}
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
                                <div className="flex-1 text-right">
                                    <div className="text-xs font-medium text-gray-600 dark:text-gray-400">
                                        {tAr.navigation.theme}
                                    </div>
                                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100" suppressHydrationWarning>
                                        {theme === 'dark' ? tAr.navigation.light : tAr.navigation.dark}
                                    </div>
                                </div>
                            </button>

                            {/* Language Selector */}
                            <button
                                onClick={switchLanguage}
                                className="relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-700/50 border border-gray-200/50 dark:border-gray-700/50 hover:border-gray-300 dark:hover:border-gray-600 transition-all duration-200 group"
                                aria-label={tAr.navigation.switchToLanguage.replace('{language}', 'English')}
                                data-testid="language-toggle"
                            >
                                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 group-hover:bg-indigo-500/20 transition-all duration-200">
                                    <Globe className="h-5 w-5" />
                                </div>
                                <div className="flex-1 text-right">
                                    <div className="text-xs font-medium text-gray-600 dark:text-gray-400">
                                        {tAr.navigation.language}
                                    </div>
                                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                                        English
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
                                className={`flex items-center space-x-2 p-2 `}
                                onClick={() => {
                                    item.onClick?.();
                                    onCollapse?.();
                                }}
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
                        <Link href={`/ar/settings/privacy`} data-testid="nav-privacy" className="flex items-center space-x-2 py-2 pl-2">
                            <IcoButton style="fa-shield-halved" size="text-lg" color="text-black dark:text-white bg-transparent cursor-pointer" />
                            <span className={`${isCollapsed ? "hidden" : "block"} text-black dark:text-white text-sm md:text-base`}>
                                {tAr.navigation.privacyAndCookies}
                            </span>
                        </Link>
                    </li>
                    <li className="hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer">
                        <Link href={`/ar/community-guidelines`} data-testid="nav-community-guidelines" className="flex items-center space-x-2 py-2 pl-2">
                            <IcoButton style="fa-people-group" size="text-lg" color="text-black dark:text-white bg-transparent cursor-pointer" />
                            <span className={`${isCollapsed ? "hidden" : "block"} text-black dark:text-white text-sm md:text-base`}>
                                {tAr.communityGuidelines.navLabel}
                            </span>
                        </Link>
                    </li>
                </ul>
            </nav>
        </>
    );
};

export default LeftNavigationWithOverlayRTL;
