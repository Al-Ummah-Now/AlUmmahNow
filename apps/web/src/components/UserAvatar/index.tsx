"use client";
import React from "react";
import Image from 'next/image';
import { useRealTimeNotifications } from '@/hooks/useRealTimeNotifications';

interface UserAvatarProps {
    avatarUrl?: string | null;
    alt?: string;
    onClick?: () => void;
    className?: string;
}

const UserAvatar: React.FC<UserAvatarProps> = ({
    avatarUrl,
    alt = "User",
    onClick,
    className = ""
}) => {
    const { isConnected } = useRealTimeNotifications({
        maxNotifications: 10,
        autoRemoveAfter: 10000
    });

    return (
        <div
            className={`relative w-12 h-12 flex items-center justify-center ${onClick ? 'cursor-pointer' : ''} ${className}`}
            onClick={onClick}
        >
            {/* Connection status ring - only show in development */}
            {process.env.NODE_ENV === 'development' && (
                <div className={`absolute inset-0 rounded-full border-2 pointer-events-none ${
                    isConnected ? 'border-green-500' : 'border-red-500'
                } animate-pulse`} />
            )}
            <div className="w-10 h-10 shrink-0 aspect-square rounded-full overflow-hidden relative">
                <Image
                    src={avatarUrl || "/avatar.png"}
                    alt={alt}
                    fill
                    sizes="40px"
                    className="bg-gray-500 object-cover"
                />
            </div>
        </div>
    );
};

export default UserAvatar;
