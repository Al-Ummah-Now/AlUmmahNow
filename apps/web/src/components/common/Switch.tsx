'use client';

import React from 'react';

export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role' | 'type' | 'aria-checked'> {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}

/**
 * The one on/off switch for the site. A `button[role=switch]` with
 * `aria-checked`; the visuals are the `.sw` rules in `theme/system.css`
 * (track + thumb positioned with logical insets, so it mirrors in RTL).
 *
 * Plain class names only: utility classes such as `rounded-full`/`w-11`
 * are matched by theme selectors and used to break the layout.
 */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, className, onClick, ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      data-state={checked ? 'on' : 'off'}
      className={className ? `sw ${className}` : 'sw'}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange(!checked);
      }}
    >
      <span className="sw-track" data-switch-track="" aria-hidden="true">
        <span className="sw-thumb" data-switch-thumb="" />
      </span>
    </button>
  );
});

export default Switch;
