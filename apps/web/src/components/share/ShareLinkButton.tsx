'use client';

/**
 * A share button that copies the short link of a page (alummahnow.link, wiki AUN-SHORT-LINKS) and
 * says so. Used on playlist and channel pages.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Share2 } from 'lucide-react';
import type { ShortLinkTarget } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { copyText } from '@/lib/share/copy';
import { shareLink } from '@/lib/share/short-link';

interface ShareLinkButtonProps {
  target: ShortLinkTarget;
  /** The page's own URL path (e.g. /en/playlist/<id>): shared where there is no short link host */
  fallbackPath: string;
  /** What is shared, for the button's tooltip */
  title?: string;
  className?: string;
  testId?: string;
}

export function ShareLinkButton({ target, fallbackPath, title, className = '', testId = 'share-link-button' }: ShareLinkButtonProps) {
  const { t, locale } = useLanguage();
  const texts = t.library;
  const [status, setStatus] = useState<'copied' | 'failed' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onClick = async () => {
    const link = shareLink(target, `${window.location.origin}${fallbackPath}`, { locale });
    const ok = await copyText(link);
    setStatus(ok ? 'copied' : 'failed');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(null), 2500);
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        data-share-kind={target.kind}
        aria-label={texts.copyLink}
        title={title ? `${texts.share}: ${title}` : texts.share}
        className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-white dark:hover:bg-gray-800 ${className}`}
      >
        {status === 'copied' ? <Check size={18} aria-hidden="true" /> : <Share2 size={18} aria-hidden="true" />}
        <span>{status === 'copied' ? texts.linkCopied : texts.share}</span>
      </button>
      <span className="sr-only" role="status" aria-live="polite" data-testid={`${testId}-status`}>
        {status === 'copied' ? texts.linkCopied : status === 'failed' ? texts.copyFailed : ''}
      </span>
    </>
  );
}

export default ShareLinkButton;
