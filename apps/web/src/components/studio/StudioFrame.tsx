'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Check, ChevronsUpDown, ExternalLink, Menu, Plus, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLanguage } from '@/hooks/useLanguage';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { channelPath, formatHandle } from '@/lib/channel-url';
import { itemPath, legacyHref, STUDIO_NAV, switchedPath, visibleNav, visibleTabs } from '@/lib/studio/nav';
import { studioUploadHref } from '@/lib/studio/links';
import { can, roleForChannel, type StudioRole } from '@/lib/studio/permissions';
import { cn } from '@/lib/utils';

export interface StudioChannel {
  id: string;
  name: string;
  avatarUrl?: string;
  handle?: string;
  isHidden?: boolean;
}

interface Props {
  locale: string;
  role: StudioRole;
  channel: StudioChannel;
  children: ReactNode;
}

function Avatar({ url, name }: { url?: string; name: string }) {
  if (url) return <Image src={url} alt="" width={32} height={32} className="h-8 w-8 shrink-0 rounded-full object-cover" unoptimized />;
  return (
    <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function ChannelSwitcher({ locale, channel, segments }: { locale: string; channel: StudioChannel; segments: string[] }) {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, switchToChannel } = useMultiAccount();
  const channels = user?.channels ?? [];

  const open = async (id: string, ownerId: string, listedRole?: StudioRole | null) => {
    if (!user || id === channel.id) return;
    await switchToChannel(id);
    const role = listedRole ?? roleForChannel({ userId: ownerId }, user.id);
    const path = role ? switchedPath(segments, role) : 'dashboard';
    router.push(`/${locale}/studio/${encodeURIComponent(id)}/${path}`);
  };

  return (
    <DropdownMenu>
      {/* Named by its content (WCAG 2.5.3): an aria-label would replace the visible channel name.
          The sr-only prefix still tells screen-reader users what the button does. */}
      <DropdownMenuTrigger
        data-testid="studio-switcher"
        className="flex min-h-11 w-full items-center gap-2 rounded-md p-2 text-start hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="sr-only">{t.studio.switcher.label}: </span>
        <Avatar url={channel.avatarUrl} name={channel.name} />
        <span className="min-w-0 flex-1">
          <span dir="auto" className="block truncate text-sm font-medium text-foreground">{channel.name}</span>
          {channel.handle && <span dir="ltr" className="block truncate text-xs text-muted-foreground">{formatHandle(channel.handle)}</span>}
        </span>
        <ChevronsUpDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {channels.map((item) => (
          <DropdownMenuItem key={item.id} onSelect={() => void open(item.id, item.userId, (item as { role?: StudioRole | null }).role)}>
            <span dir="auto" className="flex-1 truncate">{item.nameLocalized?.[locale] || item.name}</span>
            {item.id === channel.id && <Check aria-hidden="true" className="h-4 w-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={channelPath(locale, channel)}>
            <ExternalLink aria-hidden="true" className="me-2 h-4 w-4" />
            {t.studio.switcher.viewChannel}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/${locale}/profile`}>
            <Plus aria-hidden="true" className="me-2 h-4 w-4" />
            {t.studio.switcher.createChannel}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NavLinks({ locale, role, channelId, active, onNavigate }: { locale: string; role: StudioRole; channelId: string; active?: string; onNavigate?: () => void }) {
  const { t } = useLanguage();
  const settings = visibleNav(role).filter((item) => item.id === 'settings');
  const main = visibleNav(role).filter((item) => item.id !== 'settings');
  const link = (item: (typeof STUDIO_NAV)[number]) => {
    const current = item.id === active;
    return (
      <Link
        key={item.id}
        href={legacyHref(locale, channelId, itemPath(role, item)) ?? `/${locale}/studio/${encodeURIComponent(channelId)}/${itemPath(role, item)}`}
        aria-current={current ? 'page' : undefined}
        onClick={onNavigate}
        data-testid={`studio-nav-${item.id}`}
        className={cn(
          'flex min-h-11 items-center rounded-md px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          current ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )}
      >
        {t.studio.nav[item.id]}
      </Link>
    );
  };
  return (
    <nav aria-label={t.studio.navLabel} className="flex flex-1 flex-col gap-1">
      {main.map(link)}
      {settings.length > 0 && <div className="mt-auto pt-4">{settings.map(link)}</div>}
    </nav>
  );
}

function Rail({ locale, role, channel, segments, onNavigate }: { locale: string; role: StudioRole; channel: StudioChannel; segments: string[]; onNavigate?: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <ChannelSwitcher locale={locale} channel={channel} segments={segments} />
      {can(role, 'video.upload') && (
        <Button asChild>
          <Link href={studioUploadHref(locale, channel.id)} onClick={onNavigate} data-testid="studio-upload">
            <UploadCloud aria-hidden="true" className="me-2 h-4 w-4" />
            {t.studio.upload}
          </Link>
        </Button>
      )}
      <NavLinks locale={locale} role={role} channelId={channel.id} active={segments[0]} onNavigate={onNavigate} />
    </div>
  );
}

/** The Studio shell: left rail, phone drawer, tabs of the current page. */
export function StudioFrame({ locale, role, channel, children }: Props) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const segments = useMemo(() => {
    const parts = (pathname ?? '').split('/').filter(Boolean);
    return parts.slice(3).map(decodeURIComponent);
  }, [pathname]);

  const item = STUDIO_NAV.find((candidate) => candidate.id === segments[0]);
  const tabs = item ? visibleTabs(role, item) : [];
  const base = `/${locale}/studio/${encodeURIComponent(channel.id)}`;
  const title = item ? t.studio.nav[item.id] : t.studio.title;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-background text-foreground md:flex" data-testid="studio-frame">
      <aside className="sticky top-0 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 border-e border-border md:block">
        <Rail locale={locale} role={role} channel={channel} segments={segments} />
      </aside>

      <div className="flex items-center gap-2 border-b border-border p-2 md:hidden">
        <Button variant="ghost" size="icon" aria-label={t.studio.openMenu} onClick={() => setDrawerOpen(true)} className="h-11 w-11" data-testid="studio-open-menu">
          <Menu aria-hidden="true" className="h-5 w-5" />
        </Button>
        <span className="truncate text-sm font-medium">{title}</span>
      </div>
      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogContent className="top-0 h-full max-w-xs translate-x-0 translate-y-0 rounded-none border-e p-0 ltr:left-0 rtl:left-auto rtl:right-0">
          <DialogTitle className="sr-only">{t.studio.title}</DialogTitle>
          <Rail locale={locale} role={role} channel={channel} segments={segments} onNavigate={() => setDrawerOpen(false)} />
        </DialogContent>
      </Dialog>

      <main id="main-content" className="min-w-0 flex-1 px-4 py-4 md:px-6">
        {channel.isHidden && (
          <p role="status" className="mb-4 rounded-md border border-border bg-muted p-3 text-sm text-foreground">{t.studio.channelHidden}</p>
        )}
        {item && tabs.length > 0 && (
          <nav aria-label={t.studio.tabsLabel} className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
            {tabs.map((tab) => {
              const current = segments[1] === tab.id;
              return (
                <Link
                  key={tab.id}
                  href={legacyHref(locale, channel.id, `${item.id}/${tab.id}`) ?? `${base}/${item.id}/${tab.id}`}
                  aria-current={current ? 'page' : undefined}
                  data-testid={`studio-tab-${tab.id}`}
                  className={cn(
                    'flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    current ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t.studio.tabs[tab.id as keyof typeof t.studio.tabs]}
                </Link>
              );
            })}
          </nav>
        )}
        {children}
      </main>
    </div>
  );
}
