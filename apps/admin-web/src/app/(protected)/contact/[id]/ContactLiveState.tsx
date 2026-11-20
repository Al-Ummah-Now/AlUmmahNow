'use client';

/**
 * The status and read state the message page shows, owned by the browser once
 * a change succeeds (owner bug 2026-11-19: "its marked as spam now but button
 * stil normal"). A change updates them at once from admin-api's answer, so the
 * page never waits on router.refresh() to show it. A newer server render wins
 * only when it differs from the previous server render, so a refresh that
 * still carries the old status cannot put the old state back.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ComponentProps } from 'react';
import type { ContactStatus } from '@/lib/api/types';
import { useLanguage } from '@/i18n/I18nProvider';
import { translateDynamic } from '@/i18n/translate';
import { ContactStatusChip } from '@/components/ui';

export interface ContactLive {
  status: ContactStatus;
  read: boolean;
}

interface ContactLiveContext {
  live: ContactLive;
  update: (patch: Partial<ContactLive>) => void;
}

const Context = createContext<ContactLiveContext | null>(null);

export function ContactLiveProvider({ status, read, children }: ContactLive & { children: React.ReactNode }) {
  const [live, setLive] = useState<ContactLive>({ status, read });
  // Only a server render that changed takes over (another admin's change, a reload)
  const [server, setServer] = useState<ContactLive>({ status, read });
  if (server.status !== status || server.read !== read) {
    setServer({ status, read });
    setLive((prev) => ({ status: server.status !== status ? status : prev.status, read: server.read !== read ? read : prev.read }));
  }
  const update = useCallback((patch: Partial<ContactLive>) => setLive((prev) => ({ ...prev, ...patch })), []);
  const value = useMemo(() => ({ live, update }), [live, update]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useContactLive(): ContactLiveContext {
  const context = useContext(Context);
  if (!context) throw new Error('useContactLive needs a ContactLiveProvider');
  return context;
}

/** The message card: carries the shown status and read state for tests and styling. */
export function ContactMessageArticle(props: ComponentProps<'article'>) {
  const { live } = useContactLive();
  return <article {...props} data-status={live.status} data-read={live.read ? 'true' : 'false'} />;
}

/** The status chip in the message header. */
export function ContactLiveStatusChip() {
  const { t } = useLanguage();
  const { live } = useContactLive();
  return <ContactStatusChip status={live.status} label={translateDynamic(t, 'contactStatus', live.status)} large />;
}
