'use client';

import React from 'react';
import { useSelectedLayoutSegments } from 'next/navigation';
import { AccountSettingsHeader, type AccountSettingsSection } from '@/components/settings/AccountSettingsHeader';

/**
 * Account-level settings pages get the identity header and settings tabs.
 * Channel settings have their own chrome (the channel header).
 */
export function AccountSettingsChrome({ children }: { children: React.ReactNode }) {
  const segments = useSelectedLayoutSegments();
  const first = segments[0];
  if (first === 'channel') return <>{children}</>;
  const current: AccountSettingsSection = first === 'privacy' ? 'privacy' : first === 'upload-defaults' ? 'upload-defaults' : 'account';
  return (
    <>
      <AccountSettingsHeader current={current} />
      {children}
    </>
  );
}
