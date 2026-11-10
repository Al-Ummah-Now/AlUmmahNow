'use client';

import type React from 'react';
import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { bandCollisionPadding } from '@/lib/ui/visible-band';

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

/** Mounts with the open menu, so the header/tab-bar band is read when it opens. */
function BandedContent(props: React.ComponentProps<typeof Menu.Content>) {
  return <Menu.Content collisionPadding={bandCollisionPadding()} {...props} />;
}

/** Compact ghost trigger with a themed menu of checkmark rows; replaces native selects. */
export function ThemedSelect({ label, value, options, onChange, icon, dir, testId }: ThemedSelectProps) {
  const current = options.find((o) => o.value === value)?.label ?? '';
  return (
    <Menu.Root dir={dir}>
      {/* Named by its visible text ("Sort comments Newest first"): an aria-label
          that differs from what is shown fails WCAG 2.5.3 (label in name) */}
      <Menu.Trigger className="ts-trigger" data-testid={testId}>
        {icon}
        <span>{label}</span>{' '}
        <span className="ts-value">{current}</span>
      </Menu.Trigger>
      <Menu.Portal>
        <BandedContent data-slot="dropdown-menu-content" className="menu" align="start" sideOffset={6}>
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
        </BandedContent>
      </Menu.Portal>
    </Menu.Root>
  );
}
