import { WatchShell } from '@/components/video/WatchShell';

/**
 * Keeps the watch page (and its player) mounted while the video id in the URL changes
 * (components/video/WatchShell.tsx): moving between videos never remounts the player.
 */
export default function VideoLayout({ children }: { children: React.ReactNode }) {
  return <WatchShell>{children}</WatchShell>;
}
