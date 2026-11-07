"use client";
import React from "react";
import IcoButton from '@/components/iconButton';
import Link from "next/link";
import { HeaderProps } from "./interfaces";
import { UnifiedNavigation } from '@/components/UnifiedNavigation';
import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from "@/components/AuthProvider/authContext";
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { UploadButton } from '@/components/UploadButton';

const Header: React.FC<HeaderProps> = ({ toggleCollapse, isNavOpen = false }) => {
  const { t, lang: locale } = useLanguage();
  const { user } = useAuth();
  const { user: multiAccountUser } = useMultiAccount();
  const activeChannel = multiAccountUser?.channel;

  return (
    // Fixed height (h-14): the account menu swaps a skeleton for the avatar
    // after hydration, which must not push the page content down (layout shift)
    <header className="header flex items-center justify-between px-2 h-14 bg-[#093041]  text-black dark:text-white ">
      {/* Menu Section */}
      <div className="flex-1 flex items-center justify-start space-x-4">
        <IcoButton
          style="fa-bars"
          size="text-lg"
          color="text-[#ffa037]  bg-transparent"
          onClick={toggleCollapse}
          ariaLabel={isNavOpen ? t.a11y.closeNavigationMenu : t.a11y.openNavigationMenu}
          ariaExpanded={isNavOpen}
          testId="nav-drawer-toggle"
        />
      </div>

      {/* Logo Section */}
      <div className="flex-1 flex justify-center items-center space-x-2">
        <Link href={`/${locale}/`} className="flex rounded-4xl p-1 cursor-pointer justify-center items-center" aria-label={t.a11y.goToHomePage}>
          {/* <div className="relative left-0 w-13 h-13 rounded-full overflow-hidden">
            <Image src="/logo.png" alt="Logo" sizes="10vw" fill />
          </div> */}
          <h2 className="text-lg font-semibold text-[#ffa037] cursor-pointer">
            {t.common.appName}
          </h2>
        </Link>
      </div>

      {/* Unified Navigation and Upload Button */}
      <div className="flex-1 flex items-center justify-end gap-2">
        {user && activeChannel && (
          <UploadButton
            href={`/${locale}/upload`}
            text={t.upload.uploadVideo}
            hideTextOnMobile
            size="sm"
          />
        )}
        <UnifiedNavigation />
      </div>
    </header>
  );
};

export default Header;