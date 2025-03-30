"use client";
import React from "react";
import Image from 'next/image';
import IcoButton from './iconButton';

const Header: React.FC<{ toggleCollapse: () => void }> = ({ toggleCollapse }) => {


  return (
    <header className="flex items-center justify-between p-4 bg-ummah-bg ">
      {/* Menu Section */}
      <div className="flex items-center space-x-4 pl-2">
        <IcoButton style="fa-bars" color='text-ummah-bg bg-ummah-text' onClick={toggleCollapse}>
        </IcoButton>
      </div>

      {/* Logo Section */}
      <div className="flex-1 flex justify-center items-center space-x-2">
        <Image src="/logo.png" alt="Logo" width={80} height={80} />
        <h2 className="text-xl font-semibold text-ummah-text">Al Ummah Now</h2>
      </div>

      {/* User Account Section */}
      <div className="flex items-center space-x-4">
        <div className="w-10 h-10 rounded-full overflow-hidden relative">
          <Image src="/avatar.png" alt="User" width={40} height={40} objectFit="cover" className='bg-ummah-label' />
        </div>
      </div>
    </header>
  );
};

export default Header;