'use client';

import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import * as Menu from '@radix-ui/react-dropdown-menu';

export interface ThemedOption {
  value: string;
  label: string;
}

interface ThemedSelectProps {
  label: string;
  value: string;
  options: ThemedOption[];
  onChange(value: string): void;
  icon?: ReactNode;
  dir?: 'ltr' | 'rtl';
  testId?: string;
}

/** Compact ghost trigger with a themed menu of checkmark rows; replaces native selects. */
export function ThemedSelect({ label, value, options, onChange, icon, dir, testId }: ThemedSelectProps) {
  const current = options.find((o) => o.value === value)?.label ?? '';
  return (
    <Menu.Root dir={dir}>
      <Menu.Trigger className="ts-trigger" data-testid={testId} aria-label={`${label}: ${current}`}>
        {icon}
        <span>{label}</span>
        <span className="ts-value">{current}</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content data-slot="dropdown-menu-content" className="menu" align="start" sideOffset={6}>
          <Menu.RadioGroup value={value} onValueChange={onChange}>
            {options.map((o) => (
              <Menu.RadioItem key={o.value} value={o.value} className="ts-item" data-testid={testId ? `${testId}-${o.value}` : undefined}>
                <span style={{ display: 'inline-grid', width: 18, placeItems: 'center' }}>
                  <Menu.ItemIndicator><Check size={18} aria-hidden="true" /></Menu.ItemIndicator>
                </span>
                {o.label}
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
