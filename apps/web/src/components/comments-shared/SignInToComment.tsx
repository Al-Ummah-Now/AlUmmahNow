'use client';

import { Button } from '@/components/ui/button';
import { useLanguage } from '@/hooks/useLanguage';
import { loginRoutePath } from '@/lib/auth/silent-sign-in';

/**
 * What a signed-out visitor sees instead of a comment box: one prompt for video comments
 * (watch page) and community post comments, never a composer with a guest avatar (#1622).
 */
export function SignInToComment({ testId = 'comments-sign-in' }: { testId?: string }) {
  const { t, lang } = useLanguage();
  return (
    <div className="p-4 border border-[var(--fanous-color-divider)] rounded-lg bg-[var(--fanous-color-surface-raised)] text-center" data-testid={testId}>
      <p className="text-[var(--fanous-color-text-secondary)] mb-3">
        {t.comments.signInToComment}
      </p>
      <Button
        size="sm"
        onClick={() => { window.location.href = loginRoutePath(window.location.pathname, lang); }}
      >
        {t.comments.signIn}
      </Button>
    </div>
  );
}
