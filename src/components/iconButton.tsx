"use client";

import { Button } from "./ui/button";

const IcoButton: React.FC<{ style: string, color?: string, size?: string, onClick?: () => void }> = ({ style, color, size, onClick }) => {
  return (
    <Button variant="ghost" onClick={onClick} className={`shadow-none hover:shadow-none ${color ? color : ""} ${size ? size : ""}`}>
      <i className={`fas ${style}`} />
    </Button>
  );
}


export default IcoButton;