"use client";
import React from "react";
import Image from 'next/image';
import IcoButton from '@/components/iconButton';
import { redirect } from "next/navigation";
import { HeaderProps } from "../interfaces";

const HeaderRTL: React.FC<HeaderProps> = ({ toggleCollapse, toggleAccountCollapse, profile }) => {

  const handleClick = () => {
    redirect('/rtl/');
  };

  return (
    <header className="header flex items-center justify-between px-2 bg-[#093041]  text-black dark:text-white " dir="rtl">
      {/* Menu Section */}
      <div className="flex items-center space-x-reverse space-x-4 !pr-6">
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
          <h2 className="text-2xl font-[farsi] text-[#ffa037] cursor-pointer">الأمة الآن</h2>
        </div>
      </div>

      {/* User Account Section */}
      <div className="flex items-center space-x-4">
        <div className="w-10 h-10 rounded-full overflow-hidden relative cursor-pointer" onClick={toggleAccountCollapse}>
          <Image src={profile?.avatarUrl ? profile.avatarUrl : "/avatar.png"} alt="User" width={40} height={40} objectFit="cover" className="bg-gray-500" />
        </div>
      </div>
    </header>
  );
};

export default HeaderRTL;