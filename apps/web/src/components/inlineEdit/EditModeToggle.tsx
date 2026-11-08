'use client';

/**
 * "Edit mode" switch on settings headers. Off: the page looks exactly like
 * the public page. On: every editable region shows a pencil and a guide line.
 */

import React from 'react';
import { Pencil } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { cn } from '@/lib/utils';

interface EditModeToggleProps {
  on: boolean;
  onChange: (on: boolean) => void;
  className?: string;
  /** Read to screen readers with the switch */
  description?: string;
}

export function EditModeToggle({ on, onChange, className, description }: EditModeToggleProps) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        'inline-flex items-center gap-2.5 min-h-10 ps-3 pe-2 rounded-full border text-sm font-medium transition-colors',
        on ? 'border-[var(--inline-edit-ring)] text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
        className
      )}
      title={description}
      data-testid="edit-mode-toggle"
    >
      <Pencil className={cn('w-4 h-4', on && 'text-[var(--inline-edit-ring)]')} aria-hidden="true" />
      {t.inlineEdit.editMode}
      {description && <span className="sr-only">. {description}</span>}
      <span
        aria-hidden="true"
        className={cn('relative w-9 h-5 rounded-full transition-colors', on ? 'bg-[var(--inline-edit-ring)]' : 'bg-muted-foreground/40')}
      >
        <span
          className={cn(
            'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-[inset-inline-start]',
            on ? 'start-[1.125rem]' : 'start-0.5'
          )}
        />
      </span>
    </button>
  );
}

export default EditModeToggle;
