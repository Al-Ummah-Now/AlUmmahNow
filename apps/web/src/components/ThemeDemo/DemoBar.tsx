'use client';
// Prototype only: labels the site as a demo and offers demo-only controls.
import { useState } from 'react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { useLanguage } from '@/hooks/useLanguage';

const THEME = process.env.NEXT_PUBLIC_ACTIVE_THEME ?? 'lantern';

export function DemoBanner() {
  const { lang } = useLanguage();
  return (
    <div className="demo-banner">
      <strong>Theme demo, QA data</strong>
      <span>Theme: {THEME}</span>
      <Link href={`/${lang}/demo/sign-in`}>Sign-in design</Link>
      <DemoBar />
    </div>
  );
}

export function DemoBar() {
  const { setTheme, resolvedTheme } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <div className="demo-bar" role="group" aria-label="Demo controls">
      <div className="row">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>Demo options</button>
      </div>
      {open && (
        <div className="demo-panel">
          <div className="row">
            <strong>Mode</strong>
            <button type="button" aria-pressed={resolvedTheme !== 'dark'} onClick={() => setTheme('light')}>Light</button>
            <button type="button" aria-pressed={resolvedTheme === 'dark'} onClick={() => setTheme('dark')}>Dark</button>
          </div>
        </div>
      )}
    </div>
  );
}
