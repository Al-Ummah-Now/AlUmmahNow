/**
 * Side drawer for bulk panels: an in-app dialog (focus kept inside, Escape
 * closes, title and description announced), on the inline end side, full
 * width on phones. No browser prompts.
 */
'use client';

import React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

interface BulkDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Keeps the drawer open on Escape / outside clicks (while a run is going) */
  locked?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
}

export function BulkDrawer({ open, onOpenChange, title, description, locked = false, footer, children, testId = 'bulk-drawer' }: BulkDrawerProps) {
  const { t, isRTL } = useLanguage();
  const guard = (e: Event) => {
    if (locked) e.preventDefault();
  };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => (!next && locked ? undefined : onOpenChange(next))}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--fanous-color-text-primary)] opacity-40" />
        <DialogPrimitive.Content
          dir={isRTL ? 'rtl' : 'ltr'}
          onEscapeKeyDown={guard}
          onPointerDownOutside={guard}
          onInteractOutside={guard}
          className="fixed inset-y-0 end-0 z-50 flex w-full max-w-2xl flex-col border-s border-[var(--fanous-color-divider)] bg-[var(--fanous-color-background)] text-[var(--fanous-color-text-primary)] shadow-2xl focus:outline-none"
          data-testid={testId}
        >
          <header className="flex items-start gap-3 border-b border-[var(--fanous-color-divider)] p-4">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-lg font-semibold" data-testid={`${testId}-title`}>{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-sm text-[var(--fanous-color-text-secondary)]">{description}</DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              disabled={locked}
              className="b b-ghost b-icon"
              aria-label={t.bulkEdit.close}
              data-testid={`${testId}-close`}
            >
              <X aria-hidden="true" />
            </DialogPrimitive.Close>
          </header>
          <div className="flex-1 overflow-y-auto p-4">{children}</div>
          {footer && <footer className="border-t border-[var(--fanous-color-divider)] p-4">{footer}</footer>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default BulkDrawer;
