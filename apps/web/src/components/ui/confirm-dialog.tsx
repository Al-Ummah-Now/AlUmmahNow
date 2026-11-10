'use client';

/**
 * In-app confirmation dialog for destructive actions and leave guards.
 *
 * Browser prompts (window.confirm/alert/prompt, beforeunload) are not used in
 * this app: they are unstyled, not localized and not accessible. This dialog is
 * a Radix alert dialog (focus trap, Escape closes, labelled by its title and
 * description). Focus starts on Cancel, the backdrop cancels, and high-impact
 * actions can require typing a value before the confirm button enables.
 *
 * - `<ConfirmDialog>`: controlled component.
 * - `useConfirm()`: `await confirm({...})` resolves true/false; render `dialog`.
 */

import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { useLanguage } from '@/hooks/useLanguage';

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  /** Defaults to the localized "Cancel". */
  cancelLabel?: string;
  /** Destructive styling on the confirm button (default true). */
  danger?: boolean;
  /** Exact text the user must type before the confirm button enables. */
  typeToConfirm?: string;
  /** Base test id; the parts get -confirm, -cancel and -typed suffixes. */
  testId?: string;
}

export interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  /** Called with true when confirmed, false when cancelled (button, Escape or backdrop). */
  onResult: (confirmed: boolean) => void;
}

/** True when the typed text matches the required value (surrounding spaces ignored). */
export function typedMatches(typed: string, required: string | undefined): boolean {
  return !required || typed.trim() === required.trim();
}

export function ConfirmDialog({
  open,
  onResult,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger = true,
  typeToConfirm,
  testId = 'confirm-dialog',
}: ConfirmDialogProps) {
  const { t } = useLanguage();
  const ids = useId();
  const [typed, setTyped] = useState('');
  const ready = typedMatches(typed, typeToConfirm);

  const finish = (confirmed: boolean) => {
    setTyped('');
    onResult(confirmed);
  };

  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={(next) => !next && finish(false)}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-black/50"
          data-testid={`${testId}-backdrop`}
          onClick={() => finish(false)}
        />
        <AlertDialogPrimitive.Content
          data-testid={testId}
          className="fixed inset-0 z-50 m-auto grid h-fit w-[calc(100%-2rem)] max-w-md gap-4 rounded-lg border border-[var(--fanous-c-dialog-border)] bg-[var(--fanous-c-dialog-bg)] p-6 text-start shadow-lg"
        >
          <AlertDialogPrimitive.Title className="text-lg font-semibold text-[var(--fanous-c-dialog-text)]">
            {title}
          </AlertDialogPrimitive.Title>
          {description ? (
            <AlertDialogPrimitive.Description className="text-sm text-[var(--fanous-c-dialog-muted)]">
              {description}
            </AlertDialogPrimitive.Description>
          ) : (
            <AlertDialogPrimitive.Description className="sr-only">{title}</AlertDialogPrimitive.Description>
          )}
          {typeToConfirm && (
            <div className="flex flex-col gap-1">
              <label htmlFor={`${ids}-typed`} className="text-sm text-[var(--fanous-c-dialog-muted)]">
                {t.confirmDialog.typeToConfirm.replace('{value}', typeToConfirm)}
              </label>
              <input
                id={`${ids}-typed`}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && ready) {
                    e.preventDefault();
                    finish(true);
                  }
                }}
                dir="auto"
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-md border border-[var(--fanous-c-dialog-border)] bg-transparent px-3 py-2 text-[var(--fanous-c-dialog-text)]"
                data-testid={`${testId}-typed`}
              />
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogPrimitive.Cancel className="b b-secondary w-full sm:w-auto" data-testid={`${testId}-cancel`}>
              {cancelLabel ?? t.common.cancel}
            </AlertDialogPrimitive.Cancel>
            <button
              type="button"
              className={`b ${danger ? 'b-danger' : 'b-primary'} w-full sm:w-auto`}
              disabled={!ready}
              onClick={() => finish(true)}
              data-testid={`${testId}-confirm`}
            >
              {confirmLabel}
            </button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

/**
 * Imperative confirm: `if (!(await confirm({...}))) return;`.
 * Render the returned `dialog` once in the component.
 */
export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean>; dialog: ReactNode } {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);

  const confirm = useCallback((next: ConfirmOptions) => {
    // A second request while one is open cancels the first
    resolver.current?.(false);
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const onResult = useCallback((confirmed: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setOptions(null);
    resolve?.(confirmed);
  }, []);

  const dialog = options ? <ConfirmDialog open onResult={onResult} {...options} /> : null;
  return { confirm, dialog };
}
