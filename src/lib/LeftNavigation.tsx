"use client";
import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import IcoButton from './iconButton';

const LeftNavigation: React.FC<{ isCollapsed: boolean }> = ({ isCollapsed }) => {

    return (
        <nav className={`bg-ummah-bg  h-screen p-4 ${isCollapsed ? 'w-30' : 'w-56'}`}>
            <ul className="space-y-4">
                <li>
                    <a href="#" className="flex items-center space-x-2 hover:bg-gray-100 rounded">
                        <IcoButton style='fa-house' color="text-ummah-bg bg-ummah-text" />
                        <span className={`${isCollapsed ? 'hidden' : 'block'} text-ummah-text`}>Home</span>
                    </a>
                </li>
                <li>
                    <a href="#" className="flex items-center space-x-2 hover:bg-gray-100 rounded">
                        <IcoButton style='fa-magnifying-glass' color="text-ummah-bg bg-ummah-text" />
                        <span className={`${isCollapsed ? 'hidden' : 'block'} text-ummah-text`}>Trending</span>
                    </a>
                </li>
                <li>
                    <a href="#" className="flex items-center space-x-2 hover:bg-gray-100 rounded">
                        <IcoButton style='fa-tv' color="text-ummah-bg bg-ummah-text" />
                        <span className={`${isCollapsed ? 'hidden' : 'block'} text-ummah-text`}>Subscriptions</span>
                    </a>
                </li>
                <li>
                    <a href="#" className="flex items-center space-x-2 hover:bg-gray-100 rounded">
                        <IcoButton style='fa-bookmark' color="text-ummah-bg bg-ummah-text" />
                        <span className={`${isCollapsed ? 'hidden' : 'block'} text-ummah-text`}>Library</span>
                    </a>
                </li>
            </ul>
        </nav>
    );
};

export default LeftNavigation;