import Link from '@/components/common/AppLink';
import { ArrowLeft } from 'lucide-react';

/** "Back to …" above a Studio sub-page (a playlist, a post). The arrow mirrors in Arabic. */
export function StudioBackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      data-testid="studio-back"
      className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft aria-hidden="true" className="h-4 w-4 rtl:-scale-x-100" />
      {label}
    </Link>
  );
}
