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
    <header className="flex items-center justify-between p-4 bg-white ">
      {/* Menu Section */}
      <div className="flex items-center space-x-4 pl-2">
        <IcoButton style="fa-bars" color='text-white bg-black' onClick={toggleCollapse}>
        </IcoButton>
      </div>

      {/* Logo Section */}
      <div className="flex-1 flex justify-center items-center space-x-2 cursor-pointer" onClick={handleClick}>
        <Image src="/logo.png" alt="Logo" width={80} height={80} />
        <h2 className="text-xl font-semibold text-black">Al Ummah Now</h2>
      </div>

      {/* User Account Section */}
      <div className="flex items-center space-x-4">
        <div className="w-10 h-10 rounded-full overflow-hidden relative">
          <Image src="/avatar.png" alt="User" width={40} height={40} objectFit="cover" className='bg-gray-500' />
        </div>
      </div>
    </header>
  );
};

export default Header;