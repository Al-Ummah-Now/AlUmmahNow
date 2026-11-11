'use client';

/**
 * OptionCard: the one style for choosing between a few options shown as cards
 * (visibility, playlist order, video format, publish now or later…). A native
 * radio (or checkbox) fills the card, invisible, so keyboard, pointer and
 * screen readers use the real control; the card draws it. Selected: a solid
 * primary tint, a primary border and a check mark (theme/system.css `.ocard`).
 */

import React from 'react';
import { Check } from 'lucide-react';

export interface OptionCardProps {
  name: string;
  checked: boolean;
  onSelect: () => void;
  title: React.ReactNode;
  help?: React.ReactNode;
  icon?: React.ReactNode;
  value?: string;
  disabled?: boolean;
  type?: 'radio' | 'checkbox';
  /** On the native input (tests check and read it) */
  inputTestId?: string;
  /** On the card */
  testId?: string;
  className?: string;
}

export function OptionCard({ name, checked, onSelect, title, help, icon, value, disabled, type = 'radio', inputTestId, testId, className }: OptionCardProps) {
  return (
    <label
      className={`ocard ${className ?? ''}`}
      data-checked={checked || undefined}
      data-disabled={disabled || undefined}
      data-testid={testId}
    >
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        onChange={onSelect}
        disabled={disabled}
        className="ocard-hit"
        data-testid={inputTestId}
      />
      <span className="ocard-mark" aria-hidden="true">{checked && <Check />}</span>
      <span className="min-w-0">
        <span className="ocard-title">
          {icon}
          {title}
        </span>
        {help && <span className="ocard-help">{help}</span>}
      </span>
    </label>
  );
}

export default OptionCard;
