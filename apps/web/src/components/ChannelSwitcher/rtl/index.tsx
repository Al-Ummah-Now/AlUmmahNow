"use client";

import React, { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { Channel } from "@al-ummah/shared-types";
import { useActiveChannel } from "@/contexts/ActiveChannelContext";
import { ChevronDown, Check } from "lucide-react";

interface ChannelSwitcherProps {
  channels: Channel[];
}

const ChannelSwitcherRtl: React.FC<ChannelSwitcherProps> = ({ channels }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { activeChannel, setActiveChannel } = useActiveChannel();

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Handle keyboard navigation
  const handleKeyDown = (event: React.KeyboardEvent, channel: Channel) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleChannelSelect(channel);
    } else if (event.key === "Escape") {
      setIsOpen(false);
    }
  };

  const handleChannelSelect = (channel: Channel) => {
    console.log("ChannelSwitcherRtl: Switching to channel:", channel);
    setActiveChannel({
      channelId: channel.id,
      name: channel.name,
      avatarUrl: channel.avatarUrl,
      isMain: channel.isMain,
    });
    setIsOpen(false);
  };

  // Don't render if no channels
  if (!channels || channels.length === 0) {
    return null;
  }

  // Single channel - show as badge (no dropdown)
  if (channels.length === 1) {
    const channel = channels[0];
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg" dir="rtl">
        <div className="relative w-8 h-8 rounded-full overflow-hidden flex-shrink-0">
          <Image
            src={channel.avatarUrl || "/avatar.png"}
            alt={channel.name}
            fill
            className="object-cover"
          />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {channel.name}
          </span>
          {channel.subscribersCount !== undefined && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {channel.subscribersCount.toLocaleString()} مشترك
            </span>
          )}
        </div>
      </div>
    );
  }

  // Find current active channel from the list
  const currentChannel = activeChannel
    ? channels.find(ch => ch.id === activeChannel.channelId) || channels[0]
    : channels[0];

  return (
    <div className="relative" ref={dropdownRef} dir="rtl">
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#ffa037] focus:ring-offset-2 dark:focus:ring-offset-gray-900"
        aria-label="اختر قناة"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <div className="relative w-8 h-8 rounded-full overflow-hidden flex-shrink-0">
          <Image
            src={currentChannel.avatarUrl || "/avatar.png"}
            alt={currentChannel.name}
            fill
            className="object-cover"
          />
        </div>
        <div className="flex flex-col items-start min-w-0 max-w-[150px]">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate w-full">
            {currentChannel.name}
          </span>
          {currentChannel.subscribersCount !== undefined && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {currentChannel.subscribersCount.toLocaleString()} مشترك
            </span>
          )}
        </div>
        <ChevronDown
          className={`w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Dropdown Menu - opens to left in RTL */}
      {isOpen && (
        <div
          className="absolute top-full left-0 mt-2 w-72 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 max-h-96 overflow-y-auto"
          role="menu"
          aria-orientation="vertical"
          aria-labelledby="channel-switcher-menu"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              قنواتك
            </h3>
          </div>

          {/* Channel List */}
          <div className="py-2">
            {channels.map((channel) => {
              const isActive = activeChannel?.channelId === channel.id;

              return (
                <button
                  key={channel.id}
                  onClick={() => handleChannelSelect(channel)}
                  onKeyDown={(e) => handleKeyDown(e, channel)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-150 focus:outline-none focus:bg-gray-100 dark:focus:bg-gray-700"
                  role="menuitem"
                  tabIndex={0}
                >
                  <div className="relative w-10 h-10 rounded-full overflow-hidden flex-shrink-0">
                    <Image
                      src={channel.avatarUrl || "/avatar.png"}
                      alt={channel.name}
                      fill
                      className="object-cover"
                    />
                  </div>
                  <div className="flex-1 flex flex-col items-start min-w-0">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate w-full">
                      {channel.name}
                      {channel.isMain && (
                        <span className="mr-2 text-xs text-[#ffa037] font-normal">
                          (الرئيسية)
                        </span>
                      )}
                    </span>
                    {channel.subscribersCount !== undefined && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {channel.subscribersCount.toLocaleString()} مشترك
                      </span>
                    )}
                  </div>
                  {isActive && (
                    <Check className="w-5 h-5 text-[#ffa037] flex-shrink-0" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Footer - Manage Channels Link */}
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
            <a
              href="/ar/channels"
              className="text-sm text-[#ffa037] hover:text-[#ff8c1a] transition-colors duration-150"
              onClick={() => setIsOpen(false)}
            >
              إدارة القنوات
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChannelSwitcherRtl;
