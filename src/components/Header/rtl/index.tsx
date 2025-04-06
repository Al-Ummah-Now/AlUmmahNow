"use client";
import React from "react";
import Image from 'next/image';
import IcoButton from '@/components/iconButton';
import { redirect } from "next/navigation";

const HeaderRTL: React.FC<{ toggleCollapse: () => void }> = ({ toggleCollapse }) => {

  const handleClick = () => {
    redirect('/rtl/');
  };

  return (
    <header className="header flex items-center justify-between p-2 pt-3 bg-[#093041]  text-black dark:text-white " dir="rtl">
      {/* Menu Section */}
      <div className="flex items-center space-x-reverse space-x-4 !pr-6">
        <IcoButton
          style="fa-bars"
          color="text-black dark:text-white bg-gray-200 dark:bg-gray-700"
          onClick={toggleCollapse}
        />
      </div>

      {/* Logo Section */}
      <div className="flex-1 flex justify-center items-center space-x-2">
        <div className="flex rounded-4xl p-4 cursor-pointer justify-center items-center" onClick={handleClick}>
          <div className="relative left-0 w-15 h-15 rounded-full overflow-hidden">
            <Image src="/logo.png" alt="Logo" sizes="10vw" fill />
          </div>
          <h2 className="text-4xl font-(font-family:Farsi Simple Bold) font-semibold text-[#ffa037] cursor-pointer">الأمة الآن</h2>
        </div>
      </div>

      {/* User Account Section */}
      <div className="flex items-center space-x-4">
        <div className="w-10 h-10 rounded-full overflow-hidden relative">
          <Image src="/avatar.png" alt="User" width={40} height={40} objectFit="cover" className="bg-gray-500" />
        </div>
      </div>
    </header>
  );
};

export default HeaderRTL;