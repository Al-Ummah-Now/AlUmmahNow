"use client";
import React from "react";
import Image from 'next/image';
import IcoButton from '@/components/iconButton';
import { useRouter, usePathname } from "next/navigation";
import { HeaderProps } from "../interfaces";
import { UnifiedNavigationRTL } from '@/components/UnifiedNavigation/rtl';
import { useI18n } from '@/lib/i18n';
import { useAuth } from "@/components/AuthProvider/authContext";
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { UploadButton } from '@/components/UploadButton';

const HeaderRTL: React.FC<HeaderProps> = ({ toggleCollapse }) => {
  const router = useRouter();
  const pathname = usePathname();
  const locale = pathname?.startsWith('/ar') ? 'ar' : 'en';
  const { t } = useI18n(locale);
  const { user } = useAuth();
  const { user: multiAccountUser } = useMultiAccount();
  const activeChannel = multiAccountUser?.channel;
  const handleClick = () => {
    router.push(`/${locale}/`);
  };

  return (
    <header className="header flex items-center justify-between px-2 bg-[#093041]  text-black dark:text-white " dir="rtl">
      {/* Menu Section */}
      <div className="flex items-center space-x-reverse space-x-4 ">
        <IcoButton
          style="fa-bars"
          size="text-lg"
          color="text-[#ffa037] bg-transparent"
          onClick={toggleCollapse}
        />
      </div>

      {/* Logo Section */}
      <div className="flex-1 flex justify-center items-center space-x-2">
        <div className="flex rounded-4xl p-1 cursor-pointer justify-center items-center" onClick={handleClick}>
          <div className="relative left-0 w-13 h-13 rounded-full overflow-hidden">
            <Image src="/logo.png" alt="Logo" sizes="10vw" fill />
          </div>
          <h2 className="text-2xl font-[farsi] text-[#ffa037] cursor-pointer">
            {t.common.appName}
          </h2>
        </div>
      </div>

      {/* Unified Navigation and Upload Button */}
      <div className="flex items-center gap-2">
        {user && activeChannel && (
          <UploadButton
            href={`/${locale}/upload`}
            text={t.upload.uploadVideo}
            hideTextOnMobile
            size="sm"
          />
        )}
        <UnifiedNavigationRTL />
      </div>
    </header>
  );
};

export default HeaderRTL;