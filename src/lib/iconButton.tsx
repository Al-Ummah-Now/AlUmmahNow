"use client";
import { IconButton } from "@material-tailwind/react";
 
 const IcoButton: React.FC<{ style: string, color?: string, size?: string, onClick?: () => void }> = ({ style, color, size, onClick }) => {
  return (
    <IconButton onClick={onClick} className={`${color ? color: ""} ${size ? size : ""}`}>
      <i className={`fas ${style}`} />
    </IconButton>
  );
}


export default IcoButton;