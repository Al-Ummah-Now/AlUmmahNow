"use client";
import React from "react";
import Image from 'next/image';
import IcoButton from '@/components/iconButton';
import { redirect } from "next/navigation";
import { HeaderProps } from "./interfaces";
import { useRealTimeNotifications } from '@/hooks/useRealTimeNotifications';
import { useAuth } from '@/components/AuthProvider/authContext';

const Header: React.FC<HeaderProps> = ({ toggleCollapse, toggleAccountCollapse, profile }) => {
  const { user } = useAuth();
  const { isConnected } = useRealTimeNotifications({
    userId: user?.id,
    maxNotifications: 10,
    autoRemoveAfter: 10000
  });

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
          <h2 className="text-lg font-semibold text-[#ffa037] cursor-pointer">Al Ummah Now</h2>
        </div>
      </div>

      {/* User Account Section */}
      <div className="flex items-center space-x-4">
        {/* Avatar with connection status ring */}
        <div className="relative w-12 h-12 flex items-center justify-center cursor-pointer" onClick={toggleAccountCollapse}>
          {/* Connection status ring - only show in development */}
          {process.env.NODE_ENV === 'development' && (
            <div className={`absolute inset-0 rounded-full border-2 ${
              isConnected ? 'border-green-500' : 'border-red-500'
            } animate-pulse`} />
          )}
          <div className="w-10 h-10 rounded-full overflow-hidden relative">
            <Image src={profile?.avatarUrl ? profile.avatarUrl : "/avatar.png"} alt="User" objectFit="cover" className="bg-gray-500" fill />
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;