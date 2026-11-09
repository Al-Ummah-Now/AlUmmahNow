'use client';
// Prototype only: appearance and language as two segmented controls in the navigation drawer.
import { Moon, Sun } from 'lucide-react';

interface NavPrefsProps {
  theme?: string;
  setTheme: (t: string) => void;
  lang: string;
  onLanguage: () => void;
  labels: { theme: string; language: string; light: string; dark: string; en: string; ar: string };
}

export function NavPrefs({ theme, setTheme, lang, onLanguage, labels }: NavPrefsProps) {
  return (
    <div className="np">
      <div className="np-group" role="group" aria-label={labels.theme}>
        <span className="np-title">{labels.theme}</span>
        <div className="np-seg">
          <button type="button" data-testid="theme-light" aria-pressed={theme !== 'dark'} onClick={() => setTheme('light')} suppressHydrationWarning><Sun aria-hidden="true" />{labels.light}</button>
          <button type="button" data-testid="theme-dark" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')} suppressHydrationWarning><Moon aria-hidden="true" />{labels.dark}</button>
        </div>
      </div>
      <div className="np-group" role="group" aria-label={labels.language}>
        <span className="np-title">{labels.language}</span>
        <div className="np-seg">
          <button type="button" lang="en" aria-pressed={lang === 'en'} onClick={() => { if (lang !== 'en') onLanguage(); }}>{labels.en}</button>
          <button type="button" lang="ar" aria-pressed={lang === 'ar'} onClick={() => { if (lang !== 'ar') onLanguage(); }}>{labels.ar}</button>
        </div>
      </div>
    </div>
  );
}
