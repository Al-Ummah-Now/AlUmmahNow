/**
 * A file input with the site's own button. The browser's "Choose File / No file chosen" follows the
 * browser's language, not the admin's, so it is hidden and its label is the button. The input stays in
 * the tab order (the ring shows on the button) and its name is the field's label plus the button's words.
 */
import type { InputHTMLAttributes, ReactNode } from 'react';
import { smallButtonClass } from '@/components/content/parts';

export function FileButton({ id, children, ...input }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> & { id: string; children: ReactNode }) {
  return (
    <div className="relative">
      <input {...input} id={id} type="file" className="peer sr-only" />
      <label htmlFor={id} className={`${smallButtonClass} min-h-11 cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-focus peer-disabled:cursor-not-allowed peer-disabled:opacity-60`}>
        {children}
      </label>
    </div>
  );
}
