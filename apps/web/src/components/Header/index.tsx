"use client";
import React from "react";
import Image from 'next/image';
import IcoButton from '@/components/iconButton';
import { redirect } from "next/navigation";
import { HeaderProps } from "./interfaces";
import { UnifiedNavigation } from '@/components/UnifiedNavigation';
import { useI18n } from '@/lib/i18n';

const Header: React.FC<HeaderProps> = ({ toggleCollapse }) => {
  const { t } = useI18n('en');

  const handleClick = () => {
    redirect('/en/');
  };

  return (
    <header className="header flex items-center justify-between px-2 bg-[#093041]  text-black dark:text-white ">
      {/* Menu Section */}
      <div className="flex items-center space-x-4">
        <IcoButton
          style="fa-bars"
          size="text-lg"
          color="text-[#ffa037]  bg-transparent"
          onClick={toggleCollapse}
        />
      </div>

      {/* Logo Section */}
      <div className="flex-1 flex justify-center items-center space-x-2">
        <div className="flex rounded-4xl p-1 cursor-pointer justify-center items-center" onClick={handleClick}>
          <div className="relative left-0 w-13 h-13 rounded-full overflow-hidden">
            <Image src="/logo.png" alt="Logo" sizes="10vw" fill />
          </div>
          <h2 className="text-lg font-semibold text-[#ffa037] cursor-pointer">
            {t.common.appName}
          </h2>
        </div>
      </div>

      {/* Unified Navigation - combines AccountSwitcher, ChannelSelector, and AccountNavigation */}
      <div className="flex items-center gap-2">
        <UnifiedNavigation />
      </div>
    </header>
  );
};

export default Header;