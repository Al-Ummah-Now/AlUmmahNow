"use client";
import { SIDEBAR_PATHS } from '@/lib/navigation/destinations';
import React, { useEffect } from "react";
import IcoButton from "@/components/iconButton";
import Link from 'next/link';
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useTheme } from 'next-themes';
import { saveLanguagePreference } from '@/lib/i18n/utils';
import { NavPrefs } from '@/components/ThemeDemo/NavPrefs';
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
                    <li><NavPrefs theme={theme} setTheme={setTheme} lang={locale} onLanguage={switchLanguage} labels={{ theme: tAr.navigation.theme, language: tAr.navigation.language, light: tAr.navigation.light, dark: tAr.navigation.dark, en: 'English', ar: 'العربية' }} /></li>

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
