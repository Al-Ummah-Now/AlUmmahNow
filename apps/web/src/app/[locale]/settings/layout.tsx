import { Suspense } from 'react';
import { SettingsBreadcrumb } from '@/components/settings/SettingsBreadcrumb';

/** Every settings sub-page gets the "Settings › <page>" trail and a back link to its parent. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <SettingsBreadcrumb />
      </Suspense>
      {children}
    </>
  );
}
