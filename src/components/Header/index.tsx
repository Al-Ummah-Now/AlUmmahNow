"use client";
import React from "react";
import Image from 'next/image';
import IcoButton from '@/components/iconButton';
import { redirect } from "next/navigation";

const Header: React.FC<{ toggleCollapse: () => void }> = ({ toggleCollapse }) => {

  const handleClick = () => {
    redirect('/');
  };

  return (
    <header className="header flex items-center justify-between p-2 pt-3 bg-white dark:bg-gray-800 text-black dark:text-white ">
      {/* Menu Section */}
      <div className="flex items-center space-x-4 pl-4">
        <IcoButton
          style="fa-bars"
          color="text-black dark:text-white bg-gray-200 dark:bg-gray-700"
          onClick={toggleCollapse}
        />
      </div>

      {/* Logo Section */}
      <div className="flex-1 flex justify-center items-center space-x-2 cursor-pointer" onClick={handleClick}>
        <div className="relative left-0 w-15 h-15 rounded-full overflow-hidden">
          <Image src="/logo.png" alt="Logo" sizes="10vw" fill />
        </div>
        <h2 className="text-xl font-semibold text-black dark:text-white">Al Ummah Now</h2>
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

export default Header;