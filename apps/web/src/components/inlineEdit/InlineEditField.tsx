'use client';

/**
 * A piece of page text that can be edited where it is shown (settings pages).
 *
 * View: renders the value with the caller's typography, plus a pencil button
 * ("Edit {label}") while edit mode is on. Clicking the text or the pencil
 * opens an input that inherits the same font, size and colour, so the layout
 * doesn't move. Enter (Ctrl/Cmd+Enter when multiline) or Done keeps the
 * change, Esc or Cancel restores the value. Done only updates the page's
 * draft; the page saves every draft at once (see UnsavedChangesBar).
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { cn } from '@/lib/utils';

export interface InlineEditFieldProps {
  /** Current (draft) value */
  value: string;
  /** Keeps the edited value (draft only, nothing is sent) */
  onCommit: (value: string) => void;
  /** Field name used for the accessible label, e.g. "Channel name" */
  label: string;
  /** Edit mode: when false the value renders as plain text */
  editable: boolean;
  multiline?: boolean;
  maxLength?: number;
  required?: boolean;
  placeholder?: string;
  /** Shown in edit mode when the value is empty */
  emptyText?: string;
  dir?: 'ltr' | 'rtl' | 'auto';
  /** Element that wraps the value in view mode */
  as?: 'h1' | 'h2' | 'p' | 'span' | 'div';
  /** Typography/colour for the value (shared by view and input) */
  className?: string;
  /** Extra classes for the outer wrapper */
  wrapperClassName?: string;
  /** Custom rendering of the value in view mode */
  renderValue?: (value: string) => React.ReactNode;
  /** Text before the value and the input, e.g. "@" for handles */
  prefix?: string;
  /** Normalises typing (e.g. strip spaces) */
  transform?: (value: string) => string;
  /** Synchronous validation; a message blocks Done */
  validate?: (value: string) => string | null;
  /** Live value while typing (e.g. to check handle availability) */
  onDraftChange?: (value: string) => void;
  /** Extra status under the input (e.g. availability), announced politely */
  status?: React.ReactNode;
  /** Blocks Done from outside (e.g. handle taken) */
  invalid?: boolean;
  /** Marks the value as changed since the last save */
  dirty?: boolean;
  inputType?: 'text' | 'email' | 'url';
  testId?: string;
  inputTestId?: string;
}

export function InlineEditField({
  value,
  onCommit,
  label,
  editable,
  multiline = false,
  maxLength,
  required = false,
  placeholder,
  emptyText,
  dir,
  as: Tag = 'span',
  className,
  wrapperClassName,
  renderValue,
  prefix,
  transform,
  validate,
  onDraftChange,
  status,
  invalid = false,
  dirty = false,
  inputType = 'text',
  testId,
  inputTestId,
}: InlineEditFieldProps) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const pencilRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const ids = { hint: useId(), error: useId(), status: useId() };

  // Leaving edit mode closes an open field without keeping the change
  useEffect(() => {
    if (!editable && editing) {
      setEditing(false);
      setError(null);
    }
  }, [editable, editing]);

  useEffect(() => {
    if (editing) {
      const el = inputRef.current;
      el?.focus();
      el?.select();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      pencilRef.current?.focus();
    }
  }, [editing]);

  const check = (next: string): string | null => {
    if (required && next.trim() === '') return t.inlineEdit.required.replace('{field}', label);
    return validate?.(next) ?? null;
  };

  const open = () => {
    if (!editable || editing) return;
    setDraft(value);
    setError(null);
    setEditing(true);
  };

  const finish = () => {
    const problem = check(draft);
    if (problem || invalid) {
      setError(problem);
      inputRef.current?.focus();
      return;
    }
    returnFocus.current = true;
    setEditing(false);
    setError(null);
    if (draft !== value) onCommit(draft);
  };

  const cancel = () => {
    returnFocus.current = true;
    setEditing(false);
    setError(null);
    setDraft(value);
    onDraftChange?.(value);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    } else if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      finish();
    }
  };

  const change = (raw: string) => {
    const next = transform ? transform(raw) : raw;
    setDraft(next);
    onDraftChange?.(next);
    if (error) setError(check(next));
  };

  const shownError = error;
  const isInvalid = !!shownError || (editing && invalid);
  const empty = value.trim() === '';
  const describedBy = [ids.hint, shownError ? ids.error : null, status ? ids.status : null].filter(Boolean).join(' ');

  if (!editable) {
    if (empty) return null;
    return (
      <Tag className={cn(className, wrapperClassName)} dir={dir} data-testid={testId}>
        {prefix}
        {renderValue ? renderValue(value) : value}
      </Tag>
    );
  }

  if (editing) {
    const inputClass = cn(
      'block w-full min-w-0 bg-transparent border-0 p-0 m-0 [font:inherit] [color:inherit] [letter-spacing:inherit]',
      'focus:outline-none focus-visible:outline-none focus-visible:shadow-none placeholder:opacity-50',
      multiline && 'resize-none [field-sizing:content] min-h-[3lh]'
    );
    return (
      <div className={cn('min-w-0', wrapperClassName)} data-testid={testId ? `${testId}-editing` : undefined}>
        <div
          className={cn('inline-edit-target flex items-baseline gap-0.5 px-1 -mx-1', className)}
          data-editing="true"
          data-invalid={isInvalid ? 'true' : undefined}
        >
          {prefix && <span aria-hidden="true">{prefix}</span>}
          {multiline ? (
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => change(e.target.value)}
              onKeyDown={onKeyDown}
              maxLength={maxLength}
              placeholder={placeholder}
              dir={dir}
              rows={3}
              aria-label={label}
              aria-invalid={isInvalid}
              aria-describedby={describedBy}
              className={inputClass}
              data-testid={inputTestId}
            />
          ) : (
            <input
              ref={inputRef}
              type={inputType}
              value={draft}
              onChange={(e) => change(e.target.value)}
              onKeyDown={onKeyDown}
              maxLength={maxLength}
              placeholder={placeholder}
              dir={dir}
              aria-label={label}
              aria-invalid={isInvalid}
              aria-describedby={describedBy}
              autoCapitalize={inputType === 'text' && !prefix ? undefined : 'off'}
              autoCorrect={prefix || inputType !== 'text' ? 'off' : undefined}
              spellCheck={prefix || inputType !== 'text' ? false : undefined}
              enterKeyHint="done"
              className={inputClass}
              data-testid={inputTestId}
            />
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-normal not-italic tracking-normal">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={finish}
            className="inline-flex items-center gap-1.5 min-h-10 px-3 rounded-lg bg-primary text-primary-foreground font-semibold"
            data-testid={testId ? `${testId}-done` : undefined}
          >
            <Check className="w-4 h-4" aria-hidden="true" />
            {t.inlineEdit.done}
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={cancel}
            className="inline-flex items-center gap-1.5 min-h-10 px-3 rounded-lg border border-border text-foreground hover:bg-muted"
            data-testid={testId ? `${testId}-cancel` : undefined}
          >
            <X className="w-4 h-4" aria-hidden="true" />
            {t.inlineEdit.cancel}
          </button>
          <span id={ids.hint} className="text-muted-foreground hidden sm:inline">
            {multiline ? t.inlineEdit.keyboardHintMultiline : t.inlineEdit.keyboardHint}
          </span>
          {maxLength !== undefined && (
            <span className="ms-auto tabular-nums text-muted-foreground" aria-hidden="true">
              {t.inlineEdit.characterCount.replace('{count}', String(draft.length)).replace('{max}', String(maxLength))}
            </span>
          )}
        </div>
        {shownError && (
          <p id={ids.error} role="alert" className="mt-1.5 text-sm font-normal text-[var(--inline-edit-error)]" data-testid={testId ? `${testId}-error` : undefined}>
            {shownError}
          </p>
        )}
        {status && (
          <div id={ids.status} aria-live="polite" className="mt-1.5 text-sm font-normal">
            {status}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn('group/inline min-w-0 flex items-start gap-1', wrapperClassName)}>
      <Tag
        className={cn('inline-edit-target min-w-0 cursor-text px-1 -mx-1', empty && 'text-muted-foreground italic font-normal', className)}
        dir={dir}
        onClick={open}
        data-testid={testId}
        data-dirty={dirty ? 'true' : undefined}
      >
        {prefix}
        {empty ? emptyText ?? placeholder : renderValue ? renderValue(value) : value}
      </Tag>
      <button
        ref={pencilRef}
        type="button"
        onClick={open}
        aria-label={t.inlineEdit.editField.replace('{field}', label)}
        className="shrink-0 inline-flex items-center justify-center w-9 h-9 -my-1 rounded-full text-[var(--inline-edit-ring)] hover:bg-muted"
        data-testid={testId ? `${testId}-edit` : undefined}
      >
        <Pencil className="w-4 h-4" aria-hidden="true" />
      </button>
      {dirty && (
        <span className="shrink-0 self-center inline-flex items-center gap-1 text-xs font-medium not-italic tracking-normal text-[var(--inline-edit-ring)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--inline-edit-ring)]" aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">{t.inlineEdit.edited}</span>
        </span>
      )}
    </div>
  );
}

export default InlineEditField;
