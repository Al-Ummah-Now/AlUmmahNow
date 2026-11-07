import { PreferencesControls } from './PreferencesControls';

/**
 * Layout for pages outside the authenticated area (home, login errors,
 * access denied, not found): preferences in a header, content centred.
 */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex justify-end px-4 py-3">
        <PreferencesControls />
      </header>
      <main id="main-content" className="flex-1 flex items-center justify-center px-4 pb-12">
        {children}
      </main>
    </div>
  );
}
