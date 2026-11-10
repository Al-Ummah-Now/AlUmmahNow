'use client';
// The one Upload action: in the top bar after the logo, before the search box, outlined, and a 44px icon button on phones.
import Link from 'next/link';
import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useMultiAccount } from '@/hooks/useMultiAccount';

const Icon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 16V5" /><path d="M7 10l5-5 5 5" /><path d="M5 19h14" />
  </svg>
);

export function UploadAction() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const { user: account } = useMultiAccount();
  const label = t.upload.uploadVideo;
  // Signed in without a channel: nowhere to upload to yet
  if (user && !account?.channel) {
    const why = t.upload.createChannelToUpload;
    return (
      <span className="upload-action" role="link" aria-disabled="true" aria-label={`${label}. ${why}`} title={why} data-testid="header-upload" data-state="disabled">
        <Icon /><span className="upload-action-label">{label}</span>
      </span>
    );
  }
  // Signed out goes to the upload page too, which asks them to sign in first
  return (
    <Link href={`/${lang}/upload`} className="upload-action" aria-label={label} title={label} data-testid="header-upload" data-state={user ? 'ready' : 'signed-out'}>
      <Icon /><span className="upload-action-label">{label}</span>
    </Link>
  );
}
