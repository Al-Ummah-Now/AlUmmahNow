"use client";
import React from "react";

interface IcoButtonProps {
  style: string;
  color?: string;
  onClick?: () => void;
}

const IcoButton: React.FC<IcoButtonProps> = ({ style, color, onClick }) => {
  return (
    <button
      className={`flex items-center justify-center w-10 h-10 rounded-full bg-black text-white dark:bg-gray-700 dark:text-white ${color}`}
      onClick={onClick}
    >
      <i className={`fas ${style}`}></i>
    </button>
  );
};

export default IcoButton;