'use client';
// The one Upload action: the first item of the header's app actions (before notifications; docs/design/NAV.md
// "Header"), a 40px header pill with an upload icon (a tray with an arrow up, the menus' stroke icon set; owner
// decision 2026-11-13, replacing the "+") and a short label. On phones (below 640px) the header has no room
// left once language and light/dark sit in it, so Upload is the centre item of the bottom tab bar instead
// (variant "tab", the YouTube pattern); the header's copy is hidden there.
import Link from '@/components/common/AppLink';
import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { mayCreateChannel, mayUpload, useCreatorAccess } from '@/hooks/useCreatorAccess';
import { studioUploadHref } from '@/lib/studio/links';

const Icon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" />
  </svg>
);

/** A lantern-like arrow up into a frame: the Request tier pill (same stroke set as Upload) */
const UpgradeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l7 7h-4v6H9v-6H5z" /><path d="M5 21h14" />
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
  // Uploading is by invitation: a signed-in user whose tier allows no uploads gets a pill to /upgrade
  // in its place, labelled by the page's mode (owner, 2026-11-15): "Request tier" while it takes
  // requests, "Upgrade" while it sells, nothing while upgrades are closed or the mode is unknown
  if (user && !mayUpload(creator)) {
    if (creator.status !== 'ready' || creator.access.pendingDeletion) return null;
    // No mode (it could not be read): no pill, rather than advertise requests that may be off
    const mode = creator.access.upgradeMode;
    if (!mode || mode === 'closed') return null;
    const request = mode === 'pay' ? t.creator.upgrade : t.creator.requestAccess;
    if (variant === 'tab') {
      return (
        <Link href={`/${lang}/upgrade`} className="tb tb-phone" aria-label={request} data-testid="tab-request-access" data-mode={mode}>
          <UpgradeIcon /><span>{request}</span>
        </Link>
      );
    }
    return (
      <Link href={`/${lang}/upgrade`} className="upload-action" aria-label={request} title={request} data-testid="header-request-access" data-mode={mode}>
        <UpgradeIcon /><span className="upload-action-label">{request}</span>
      </Link>
    );
  }
  // No active channel (signed in, acting as yourself): someone who may create a channel gets the
  // normal Upload, whose page offers "Create a channel" or a pick of their channels (owner review
  // 2026-11-16); someone who may not has nowhere to upload to, so Upload is not shown at all, never
  // a greyed-out control (owner rule 6)
  const tab = variant === 'tab';
  if (user && !account?.channel && !mayCreateChannel(creator)) return null;
  // Studio's upload for the active channel (the page's picker preselects it);
  // signed out goes to the upload page too, which asks them to sign in first
  const href = account?.channel?.id ? studioUploadHref(lang, account.channel.id) : `/${lang}/upload`;
  if (tab) {
    return (
      <Link href={href} className="tb tb-phone" aria-label={label} data-testid="tab-upload" data-state={user ? 'ready' : 'signed-out'}>
        <Icon /><span>{short}</span>
      </Link>
    );
  }
  return (
    <Link href={href} className="upload-action" aria-label={label} title={label} data-testid="header-upload" data-state={user ? 'ready' : 'signed-out'}>
      <Icon /><span className="upload-action-label">{short}</span>
    </Link>
  );
}
