'use client';
// The one Upload action: the first item of the header's action cluster (before notifications and the
// account), a header pill like the account button with a "+" and a short label, icon only on phones.
import Link from '@/components/common/AppLink';
import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { mayUpload, useCreatorAccess } from '@/hooks/useCreatorAccess';
import { studioUploadHref } from '@/lib/studio/links';

const Icon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 5v14" /><path d="M5 12h14" />
  </svg>
);

export function UploadAction() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const { user: account } = useMultiAccount();
  const creator = useCreatorAccess();
  // The accessible name says what it does; the visible label is the short "Upload"
  const label = t.upload.uploadVideo;
  const short = t.navigation.upload;
  // Uploading is by invitation: no Upload for a signed-in user without a creator tier
  if (user && !mayUpload(creator)) return null;
  // Signed in without a channel: nowhere to upload to yet
  if (user && !account?.channel) {
    const why = t.upload.createChannelToUpload;
    return (
      <span className="upload-action" role="link" aria-disabled="true" aria-label={`${label}. ${why}`} title={why} data-testid="header-upload" data-state="disabled">
        <Icon /><span className="upload-action-label">{short}</span>
      </span>
    );
  }
  // Studio's upload for the active channel (the page's picker preselects it);
  // signed out goes to the upload page too, which asks them to sign in first
  const href = account?.channel?.id ? studioUploadHref(lang, account.channel.id) : `/${lang}/upload`;
  return (
    <Link href={href} className="upload-action" aria-label={label} title={label} data-testid="header-upload" data-state={user ? 'ready' : 'signed-out'}>
      <Icon /><span className="upload-action-label">{short}</span>
    </Link>
  );
}
