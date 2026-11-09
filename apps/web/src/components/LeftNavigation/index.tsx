"use client";
import { SIDEBAR_PATHS } from '@/lib/navigation/destinations';
import React, { useEffect } from "react";
import IcoButton from "@/components/iconButton";
import Link from 'next/link';
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useTheme } from 'next-themes';
import { useLanguage } from '@/hooks/useLanguage';
import { saveLanguagePreference } from '@/lib/i18n/utils';
import { NavPrefs } from '@/components/ThemeDemo/NavPrefs';

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
    // resolvedTheme: with the default "system" theme, `theme` is never 'dark',
    // so toggling from a dark system preference would be a no-op
    const { resolvedTheme: theme, setTheme } = useTheme();
    const { t, lang, oppositeLanguage, languages } = useLanguage();

    const allNavItems: NavItems[] = [
        { label: t.navigation.homeLink, icon: "fa-house", href: `/${lang}${SIDEBAR_PATHS.home}` },
        { label: t.navigation.search, icon: "fa-magnifying-glass", href: `/${lang}${SIDEBAR_PATHS.search}` },
        { label: t.navigation.explore, icon: "fa-compass", href: `/${lang}${SIDEBAR_PATHS.explore}` },
        { label: t.navigation.subscriptions, icon: "fa-tv", href: `/${lang}${SIDEBAR_PATHS.subscriptions}` },
        { label: t.navigation.library, icon: "fa-bookmark", href: `/${lang}${SIDEBAR_PATHS.library}` },
        { label: t.feed.history, icon: "fa-clock-rotate-left", href: `/${lang}${SIDEBAR_PATHS.history}` },
        { label: t.library.watchLater, icon: "fa-clock", href: `/${lang}${SIDEBAR_PATHS.watchLater}` },
        { label: t.library.likedVideos, icon: "fa-heart", href: `/${lang}${SIDEBAR_PATHS.liked}` },
    ];

    const navItems = allNavItems;

    const switchLanguage = () => {
        // Save language preference to localStorage and cookie
        saveLanguagePreference(oppositeLanguage);

        const newPath = pathname?.replace(`/${lang}`, `/${oppositeLanguage}`) || `/${oppositeLanguage}`;
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
                    <li><NavPrefs theme={theme} setTheme={setTheme} lang={lang} onLanguage={switchLanguage} labels={{ theme: t.navigation.theme, language: t.navigation.language, light: t.navigation.light, dark: t.navigation.dark, en: languages.en.displayName, ar: languages.ar.displayName }} /></li>

                    {navItems.map((item, index) => (
                        <li
                            key={index}
                            className="hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer"
                        >
                            <Link
                                href={item.href}
                                className={`flex items-center space-x-2 py-2 pl-2`}
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
                        <Link href={`/${lang}/settings/privacy`} data-testid="nav-privacy" className="flex items-center space-x-2 py-2 pl-2">
                            <IcoButton style="fa-shield-halved" size="text-lg" color="text-black dark:text-white bg-transparent cursor-pointer" />
                            <span className={`${isCollapsed ? "hidden" : "block"} text-black dark:text-white text-sm md:text-base`}>
                                {t.navigation.privacyAndCookies}
                            </span>
                        </Link>
                    </li>
                    <li className="hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer">
                        <Link href={`/${lang}/community-guidelines`} data-testid="nav-community-guidelines" className="flex items-center space-x-2 py-2 pl-2">
                            <IcoButton style="fa-people-group" size="text-lg" color="text-black dark:text-white bg-transparent cursor-pointer" />
                            <span className={`${isCollapsed ? "hidden" : "block"} text-black dark:text-white text-sm md:text-base`}>
                                {t.communityGuidelines.navLabel}
                            </span>
                        </Link>
                    </li>
                </ul>
            </nav>
        </>
    );
};

export default LeftNavigationWithOverlay;
