'use client';

import { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/hooks/useLanguage';

/** The query an invite's first sign-in lands with (admin-api `inviteLandingPath`). */
export const INVITE_WELCOME_PARAM = 'welcome';
export const INVITE_WELCOME_VALUE = 'invite';

/**
 * The short first-run welcome after accepting a creator invite: shown once,
 * on the page the invite lands on (the Studio of the invited channel, else
 * the account settings), while the URL has `?welcome=invite`. Dismiss drops
 * the query, so a reload or a shared link never shows it again.
 */
function Welcome({ variant }: { variant: 'studio' | 'account' }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useLanguage();
  if (params?.get(INVITE_WELCOME_PARAM) !== INVITE_WELCOME_VALUE) return null;
  const text = t.studio.dashboard.inviteWelcome;

  const dismiss = () => {
    const next = new URLSearchParams(params.toString());
    next.delete(INVITE_WELCOME_PARAM);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <section
      aria-labelledby="invite-welcome-title"
      className="mb-4 flex items-start gap-3 rounded-md border border-border bg-card p-4"
      data-testid="invite-welcome"
    >
      <div className="min-w-0 flex-1">
        <h2 id="invite-welcome-title" className="mb-1 text-base font-semibold text-foreground">{text.title}</h2>
        <p className="text-sm text-muted-foreground">{variant === 'studio' ? text.studio : text.account}</p>
      </div>
      <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0" onClick={dismiss} aria-label={text.dismiss} data-testid="invite-welcome-dismiss">
        <X aria-hidden="true" className="size-5" />
      </Button>
    </section>
  );
}

/** Suspense: pages that prerender read the query only in the browser. */
export function InviteWelcome(props: { variant: 'studio' | 'account' }) {
  return (
    <Suspense fallback={null}>
      <Welcome {...props} />
    </Suspense>
  );
}
