import { AccountSettingsChrome } from './AccountSettingsChrome';

/** Settings section chrome (identity header + tabs); see AccountSettingsChrome. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <AccountSettingsChrome>{children}</AccountSettingsChrome>;
}
