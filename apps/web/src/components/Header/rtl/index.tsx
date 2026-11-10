"use client";
import React from "react";
import { HeaderSearch } from '@/components/Header/HeaderSearch';
import Image from 'next/image';
import IcoButton from '@/components/iconButton';
import Link from "next/link";
import { HeaderProps } from "../interfaces";
import { UnifiedNavigationRTL } from '@/components/UnifiedNavigation/rtl';
import { useLanguage } from '@/hooks/useLanguage';
import { UploadAction } from '@/components/Header/UploadAction';
import { NotificationBell } from '@/components/notifications/NotificationBell';

const HeaderRTL: React.FC<HeaderProps> = ({ toggleCollapse, isNavOpen = false }) => {
  const { t, lang: locale } = useLanguage();
  return (
    // Fixed height (h-14): the account menu swaps a skeleton for the avatar
    // after hydration, which must not push the page content down (layout shift)
    <header className="header flex items-center justify-between px-2 h-14 bg-[#093041] text-white " dir="rtl">
      {/* Menu Section */}
      <div className="flex-none sm:flex-1 flex items-center justify-start space-x-reverse space-x-4 ">
        <IcoButton
          style="fa-bars"
          size="text-lg"
          color="text-[var(--fanous-color-accent)] bg-transparent"
          onClick={toggleCollapse}
          ariaLabel={isNavOpen ? t.a11y.closeNavigationMenu : t.a11y.openNavigationMenu}
          ariaExpanded={isNavOpen}
          testId="nav-drawer-toggle"
        />
      </div>

      {/* Logo and Upload, at the start */}
      <div className="flex-1 min-w-0 flex justify-start items-center gap-2">
        <Link href={`/${locale}/`} className="flex min-w-0 rounded-4xl p-1 cursor-pointer justify-start items-center" aria-label={t.a11y.goToHomePage}>
          {/* <div className="relative left-0 w-13 h-13 rounded-full overflow-hidden">
            <Image src="/logo.png" alt="Logo" sizes="10vw" fill />
          </div> */}
          <div className="relative left-0 w-30 max-w-full h-13 overflow-hidden">
            <Image src="/Al Ummah Now Name.png" alt={t.common.appName} sizes="10vw" fill style={{ objectFit: 'contain' }} />
          </div>
        </Link>
        {/* Upload follows the logo, before the search box */}
        <UploadAction />
      </div>

      {/* Search, notifications and account */}
      <div className="flex-none sm:flex-1 flex items-center justify-end gap-2">
        <HeaderSearch />
        <NotificationBell dir="rtl" />
        <UnifiedNavigationRTL />
      </div>
    </header>
  );
};

export default HeaderRTL;