'use client';
// Prototype only: labels the site as a demo and offers demo-only controls.
import { useEffect, useState } from 'react';
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
      <Link href={`/${lang}/demo/sign-in`}>Sign-in page</Link>
    </div>
  );
}

export function DemoBar() {
  const { setTheme, resolvedTheme } = useTheme();
  const [opt, setOpt] = useState('a');
  useEffect(() => {
    const saved = window.localStorage.getItem('demo-upload') ?? 'a';
    setOpt(saved);
    document.documentElement.dataset.upload = saved;
  }, []);
  const choose = (v: string) => {
    setOpt(v);
    window.localStorage.setItem('demo-upload', v);
    document.documentElement.dataset.upload = v;
  };
  return (
    <div className="demo-bar" role="group" aria-label="Demo controls">
      <span>Demo</span>
      <button type="button" aria-pressed={resolvedTheme !== 'dark'} onClick={() => setTheme('light')}>Light</button>
      <button type="button" aria-pressed={resolvedTheme === 'dark'} onClick={() => setTheme('dark')}>Dark</button>
      <span>Upload</span>
      {[['a', 'A header'], ['b', 'B menu side'], ['c', 'C floating']].map(([v, l]) => (
        <button key={v} type="button" aria-pressed={opt === v} onClick={() => choose(v)}>{l}</button>
      ))}
    </div>
  );
}
