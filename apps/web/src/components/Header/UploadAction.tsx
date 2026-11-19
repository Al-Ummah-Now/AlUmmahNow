'use client';
// The one Upload action: the first item of the header's app actions (before notifications; docs/design/NAV.md
// "Header"), a 40px header pill with an upload icon (a tray with an arrow up, the menus' stroke icon set; owner
// decision 2026-11-13, replacing the "+") and a short label. On phones (below 640px) the header has no room
// left once language and light/dark sit in it, so Upload is the centre item of the bottom tab bar instead
// (variant "tab", the YouTube pattern); the header's copy is hidden there.
// Uploading is by invitation (creator tiers): signed-out visitors and accounts whose tier doesn't allow
// uploads see no Upload at all, in the header or the tab bar (never a teaser or a sign-in detour).
import Link from '@/components/common/AppLink';
import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { showsUpload, useCreatorAccess } from '@/hooks/useCreatorAccess';
import { studioUploadHref } from '@/lib/studio/links';

const Icon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" />
  </svg>
);

export function UploadAction({ variant = 'header' }: { variant?: 'header' | 'tab' }) {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const { user: account } = useMultiAccount();
  const creator = useCreatorAccess();
  // The accessible name says what it does; the visible label is the short "Upload"
  const label = t.upload.uploadVideo;
  const short = t.navigation.upload;
  // Only for a signed-in account whose tier allows uploads (not while that is still being read)
  if (!user || !showsUpload(creator)) return null;
  // A creator without a channel: nowhere to upload to yet
  const tab = variant === 'tab';
  const channelId = account?.channel?.id;
  if (!channelId) {
    const why = t.upload.createChannelToUpload;
    if (tab) {
      return (
        <span className="tb tb-phone" role="link" aria-disabled="true" aria-label={`${label}. ${why}`} title={why} data-testid="tab-upload" data-state="disabled">
          <Icon /><span>{short}</span>
        </span>
      );
    }
    return (
      <span className="upload-action" role="link" aria-disabled="true" aria-label={`${label}. ${why}`} title={why} data-testid="header-upload" data-state="disabled">
        <Icon /><span className="upload-action-label">{short}</span>
      </span>
    );
  }
  // Studio's upload for the active channel (the page's picker preselects it)
  const href = studioUploadHref(lang, channelId);
  if (tab) {
    return (
      <Link href={href} className="tb tb-phone" aria-label={label} data-testid="tab-upload" data-state="ready">
        <Icon /><span>{short}</span>
      </Link>
    );
  }
  return (
    <Link href={href} className="upload-action" aria-label={label} title={label} data-testid="header-upload" data-state="ready">
      <Icon /><span className="upload-action-label">{short}</span>
    </Link>
  );
}
