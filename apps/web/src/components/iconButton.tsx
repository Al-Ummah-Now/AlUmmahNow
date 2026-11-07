"use client";

import { Button } from "./ui/button";

interface IcoButtonProps {
  style: string;
  color?: string;
  size?: string;
  onClick?: () => void;
  /** Accessible name - required for an icon-only interactive button (WCAG 4.1.2) */
  ariaLabel?: string;
  /** For disclosure buttons such as the navigation menu toggle */
  ariaExpanded?: boolean;
}

/**
 * Font Awesome icon button.
 *
 * With `onClick` it renders a real button with a 44x44px minimum target and an
 * accessible name. Without `onClick` the icon is decorative (it is nested in a
 * link that already carries the visible label), so it renders an aria-hidden
 * <span> instead of an unlabeled button nested inside a link.
 */
const IcoButton: React.FC<IcoButtonProps> = ({ style, color, size, onClick, ariaLabel, ariaExpanded }) => {
  if (!onClick) {
    return (
      <span aria-hidden="true" className={`inline-flex items-center justify-center ${color ? color : ""} ${size ? size : ""}`}>
        <i className={`fas ${style}`} />
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant="silent"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      className={`min-h-11 min-w-11 shadow-none hover:shadow-none ${color ? color : ""} ${size ? size : ""}`}
    >
      <i className={`fas ${style}`} aria-hidden="true" />
    </Button>
  );
}


export default IcoButton;
