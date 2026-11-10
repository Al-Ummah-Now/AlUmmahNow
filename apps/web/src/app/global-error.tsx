'use client';

import './globals.css';
import '@/theme/font-faces.css';
import '@/theme/fonts.css';
import '@/theme/materials.css';
import '@/theme/bridge.css';
import '@/theme/system.css';
import { FriendlyError } from '@/components/errors/FriendlyError';

/**
 * Last-resort boundary: the root layout itself failed, so this renders its own
 * document (with the site's theme styles) around the friendly error screen.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const ar = typeof window !== 'undefined' && window.location.pathname.startsWith('/ar');
  return (
    <html lang={ar ? 'ar' : 'en'} dir={ar ? 'rtl' : 'ltr'}>
      <body className="font-inter min-h-screen bg-background text-foreground">
        <FriendlyError error={error} reset={reset} boundary="global" />
      </body>
    </html>
  );
}
