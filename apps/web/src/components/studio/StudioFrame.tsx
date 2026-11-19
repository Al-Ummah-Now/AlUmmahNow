'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from '@/components/common/AppLink';
import { usePathname, useRouter } from 'next/navigation';
import { Check, ChevronsUpDown, ExternalLink, FileText, LogOut, Menu, PenLine, Plus, Radio, UploadCloud, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useOptionalAuth } from '@/components/AuthProvider/authContext';
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
import { itemPath, STUDIO_NAV, switchedPath, visibleNav, visibleTabs, type StudioFeatures } from '@/lib/studio/nav';
import { studioLiveHref, studioUploadHref } from '@/lib/studio/links';
import { can, roleForChannel, type StudioRole } from '@/lib/studio/permissions';
import { cn } from '@/lib/utils';
import { removeTeamMember } from '@/lib/channels/team';
import { logger } from '@/lib/logger-client';
import { getCmsUrl } from '@/lib/runtime-config';
import { cmsLinks, isScholar } from '@/lib/scholars/sites';

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
  /** Features on for this channel: the white-label site and GET /api/me/features (lib/studio/nav.ts) */
  features?: StudioFeatures;
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

function ChannelSwitcher({ locale, channel, segments, role }: { locale: string; channel: StudioChannel; segments: string[]; role: StudioRole }) {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, switchToChannel, reloadChannels } = useMultiAccount();
  const { confirm, dialog } = useConfirm();
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const channels = user?.channels ?? [];

  // Anyone but the owner can leave (spec §3.3): most roles can't open Settings
  const leave = async () => {
    if (!user) return;
    const ok = await confirm({
      title: t.studio.switcher.leaveTitle.replace('{channel}', channel.name),
      description: t.studio.switcher.leaveBody,
      confirmLabel: t.studio.switcher.leaveConfirm,
      testId: 'studio-leave-dialog',
    });
    if (!ok) return;
    setLeaveError(null);
    try {
      await removeTeamMember(channel.id, user.id);
      await reloadChannels();
      router.push(`/${locale}/studio`);
    } catch (error) {
      logger.error('[Studio] Leaving the channel failed', { channelId: channel.id, error });
      setLeaveError(t.studio.switcher.leaveFailed);
    }
  };

  const open = async (id: string, ownerId: string, listedRole?: StudioRole | null) => {
    if (!user || id === channel.id) return;
    await switchToChannel(id);
    const role = listedRole ?? roleForChannel({ userId: ownerId }, user.id);
    const path = role ? switchedPath(segments, role) : 'dashboard';
    router.push(`/${locale}/studio/${encodeURIComponent(id)}/${path}`);
  };

  return (
    <>
    <div className="flex min-w-0 flex-1 items-center gap-2" data-testid="studio-channel-header">
      <Avatar url={channel.avatarUrl} name={channel.name} />
      {/* dir keeps a name or handle in the other script in order; match-parent lines the block up
          with the UI's start edge (a Latin name in the Arabic UI aligns right, like its neighbours).
          A long name or handle wraps onto more lines instead of being cut. */}
      <span className="min-w-0 flex-1 text-start">
        <span dir="auto" className="block text-sm font-medium text-foreground [overflow-wrap:anywhere] [text-align:match-parent]" data-testid="studio-channel-name">{channel.name}</span>
        {channel.handle && <span dir="ltr" className="block text-xs text-muted-foreground [overflow-wrap:anywhere] [text-align:match-parent]">{formatHandle(channel.handle)}</span>}
      </span>
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="studio-switcher"
        aria-label={`${t.studio.switcher.label}: ${channel.name}`}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronsUpDown aria-hidden="true" className="h-4 w-4" />
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
        {role !== 'owner' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void leave()} data-testid="studio-leave-channel" className="text-destructive focus:text-destructive">
              <LogOut aria-hidden="true" className="me-2 h-4 w-4" />
              {t.studio.switcher.leave}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    </div>
    {dialog}
    {leaveError && <p role="alert" className="text-xs text-destructive" data-testid="studio-leave-error">{leaveError}</p>}
    </>
  );
}

/**
 * Scholars write articles in the CMS (AlUmmahNowCMS docs/SCHOLARS.md, #744).
 * Scholar is a site role for the CMS, never a channel role; the CMS signs the
 * browser in through SSO, so the editor opens without a second sign-in.
 */
function useScholarLinks(locale: string) {
  const { user } = useOptionalAuth();
  return isScholar(user?.roles) ? cmsLinks(getCmsUrl(), locale) : null;
}

function NavLinks({ locale, role, channelId, active, features, onNavigate, articlesHref }: { locale: string; role: StudioRole; channelId: string; active?: string; features?: StudioFeatures; onNavigate?: () => void; articlesHref?: string }) {
  const { t } = useLanguage();
  const settings = visibleNav(role, features).filter((item) => item.id === 'settings');
  const main = visibleNav(role, features).filter((item) => item.id !== 'settings');
  const link = (item: (typeof STUDIO_NAV)[number]) => {
    const current = item.id === active;
    return (
      <Link
        key={item.id}
        href={`/${locale}/studio/${encodeURIComponent(channelId)}/${itemPath(role, item, features)}`}
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
      {articlesHref && (
        <a
          href={articlesHref}
          onClick={onNavigate}
          data-testid="studio-nav-articles"
          className="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FileText aria-hidden="true" className="h-4 w-4" />
          {t.studio.articles.mine}
          <span className="sr-only"> {t.studio.articles.opensCms}</span>
        </a>
      )}
      {settings.length > 0 && <div className="mt-auto pt-4">{settings.map(link)}</div>}
    </nav>
  );
}

function Rail({ locale, role, channel, segments, features, onNavigate, onClose, className }: { locale: string; role: StudioRole; channel: StudioChannel; segments: string[]; features?: StudioFeatures; onNavigate?: () => void; onClose?: () => void; className?: string }) {
  const { t } = useLanguage();
  const articles = useScholarLinks(locale);
  return (
    <div className={cn('flex h-full min-w-0 flex-col gap-3 p-3', className)}>
      {/* One header row: in the drawer the close button has its own space at the start edge,
          then the channel (avatar, name, handle) and its switcher button. Flex mirrors it in RTL. */}
      <div className="flex w-full min-w-0 items-center gap-1" data-testid="studio-rail-header">
        {onClose && (
          <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" onClick={onClose} aria-label={t.studio.closeMenu} data-testid="studio-close-menu">
            <X aria-hidden="true" className="h-5 w-5" />
          </Button>
        )}
        <ChannelSwitcher locale={locale} channel={channel} segments={segments} role={role} />
      </div>
      {can(role, 'video.upload') && features?.upload && (
        <Button asChild>
          <Link href={studioUploadHref(locale, channel.id)} onClick={onNavigate} data-testid="studio-upload">
            <UploadCloud aria-hidden="true" className="me-2 h-4 w-4" />
            {t.studio.upload}
          </Link>
        </Button>
      )}
      {can(role, 'live.manage') && features?.live && (
        <Button asChild variant="outline">
          <Link href={studioLiveHref(locale, channel.id)} onClick={onNavigate} data-testid="studio-golive-link">
            <Radio aria-hidden="true" className="me-2 h-4 w-4" />
            {t.studio.goLive}
          </Link>
        </Button>
      )}
      {articles && (
        <Button asChild variant="outline">
          <a href={articles.write} onClick={onNavigate} data-testid="studio-write-article">
            <PenLine aria-hidden="true" className="me-2 h-4 w-4" />
            {t.studio.articles.write}
            <span className="sr-only"> {t.studio.articles.opensCms}</span>
          </a>
        </Button>
      )}
      <NavLinks locale={locale} role={role} channelId={channel.id} active={segments[0]} features={features} onNavigate={onNavigate} articlesHref={articles?.articles} />
    </div>
  );
}

/** The Studio shell: left rail, phone drawer, tabs of the current page. */
export function StudioFrame({ locale, role, channel, features, children }: Props) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const segments = useMemo(() => {
    const parts = (pathname ?? '').split('/').filter(Boolean);
    return parts.slice(3).map(decodeURIComponent);
  }, [pathname]);

  const item = STUDIO_NAV.find((candidate) => candidate.id === segments[0]);
  const tabs = item ? visibleTabs(role, item, features) : [];
  const base = `/${locale}/studio/${encodeURIComponent(channel.id)}`;
  const title = item ? t.studio.nav[item.id] : t.studio.title;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-background text-foreground md:flex" data-testid="studio-frame">
      <aside className="sticky top-0 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 border-e border-border md:block">
        <Rail locale={locale} role={role} channel={channel} segments={segments} features={features} />
      </aside>

      <div className="flex items-center gap-2 border-b border-border p-2 md:hidden">
        <Button variant="ghost" size="icon" aria-label={t.studio.openMenu} onClick={() => setDrawerOpen(true)} className="h-11 w-11" data-testid="studio-open-menu">
          <Menu aria-hidden="true" className="h-5 w-5" />
        </Button>
        <span className="truncate text-sm font-medium">{title}</span>
      </div>
      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogContent showClose={false} data-slot="sheet-content" className="top-0 grid-cols-1 h-full max-w-xs translate-x-0 translate-y-0 rounded-none border-e p-0 ltr:left-0 rtl:left-auto rtl:right-0">
          <DialogTitle className="sr-only">{t.studio.title}</DialogTitle>
          <Rail locale={locale} role={role} channel={channel} segments={segments} features={features} onNavigate={() => setDrawerOpen(false)} onClose={() => setDrawerOpen(false)} />
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
                  href={`${base}/${item.id}/${tab.id}`}
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
