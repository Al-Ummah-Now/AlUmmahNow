import { WatchShell } from '@/components/video/WatchShell';
import { ShortsNav } from '@/components/shorts/ShortsNav';

/**
 * /[locale]/shorts: the watch page (WatchShell, so the player stays mounted from one Short to the
 * next) with the Shorts navigation: next and previous Short by button, arrow keys or a vertical swipe.
 */
export default function ShortsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shorts-viewer" data-testid="shorts-viewer">
      <WatchShell>{children}</WatchShell>
      <ShortsNav />
    </div>
  );
}
