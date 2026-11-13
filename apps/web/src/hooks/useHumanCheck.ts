'use client';

/**
 * Turnstile before a comment, post or report (docs/features/bot-protection.md).
 *
 *   const { ensureHuman, checking } = useHumanCheck();
 *   const check = await ensureHuman('comment');
 *   if (!check.ok) → show t.humanCheck.failed
 *   else submit with check.token (undefined when no check is needed)
 *
 * `checking` is true while the (normally invisible) check runs, for a status line.
 */
import { useCallback, useState } from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import { getHumanCheck, type HumanCheckKind } from '@/lib/api/human-check';
import { getTurnstileToken } from '@/lib/turnstile/client';

export type HumanCheckResult = { ok: true; token?: string } | { ok: false };

export function useHumanCheck() {
  const { lang, t } = useLanguage();
  const [checking, setChecking] = useState(false);

  const ensureHuman = useCallback(
    async (kind: HumanCheckKind | 'contact', knownSiteKey?: string | null): Promise<HumanCheckResult> => {
      let siteKey = knownSiteKey ?? null;
      if (!siteKey && kind !== 'contact') {
        const status = await getHumanCheck(kind);
        if (!status.required || !status.siteKey) return { ok: true };
        siteKey = status.siteKey;
      }
      if (!siteKey) return { ok: true };
      setChecking(true);
      try {
        const token = await getTurnstileToken({
          siteKey,
          action: kind,
          locale: lang === 'ar' ? 'ar' : 'en',
          dialogLabel: t.humanCheck.dialogLabel,
        });
        return token ? { ok: true, token } : { ok: false };
      } finally {
        setChecking(false);
      }
    },
    [lang, t],
  );

  return { ensureHuman, checking, messages: t.humanCheck };
}
