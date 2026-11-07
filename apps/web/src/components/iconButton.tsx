"use client";

import { Button } from "./ui/button";

interface IcoButtonProps {
  style: string;
  color?: string;
  size?: string;
  onClick?: () => void;
  /** Accessible name; icon-only buttons need one for screen readers */
  ariaLabel?: string;
  testId?: string;
}

const IcoButton: React.FC<IcoButtonProps> = ({ style, color, size, onClick, ariaLabel, testId }) => {
  return (
    <Button
      variant="silent"
      onClick={onClick}
      aria-label={ariaLabel}
      data-testid={testId}
      className={`shadow-none hover:shadow-none ${color ? color : ""} ${size ? size : ""}`}
    >
      <i className={`fas ${style}`} aria-hidden="true" />
    </Button>
  );
}


export default IcoButton;
