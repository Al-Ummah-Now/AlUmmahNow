'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ChannelTabConfig } from '@al-ummah/shared-types';
import TabManagement from '@/components/TabManagement';
import { Button } from '@/components/ui/button';
import { getChannelTabConfig, updateChannelTabConfig } from '@/lib/api/channel-tabs';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';

/**
 * Customisation → Layout → Tabs (spec §4.9): show, hide and order the
 * channel page's tabs. The page guard has checked channel.edit; the API
 * checks it again on save.
 */
export function TabsView({ channelId }: { channelId: string }) {
  const { t } = useLanguage();
  const [config, setConfig] = useState<ChannelTabConfig | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const tabConfig = await getChannelTabConfig(channelId);
      setConfig(tabConfig);
      setState(tabConfig ? 'ready' : 'error');
    } catch (error) {
      logger.error('[Studio] Channel tabs not loaded', { channelId, error });
      setState('error');
    }
  }, [channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async (data: { defaultTab: string; tabs: Array<{ id: string; visible: boolean; position: number }> }): Promise<boolean> => {
    try {
      const result = await updateChannelTabConfig(channelId, data);
      if (!result) return false;
      setConfig(result);
      return true;
    } catch (error) {
      logger.error('[Studio] Channel tabs not saved', { channelId, error });
      return false;
    }
  };

  if (state === 'loading') {
    return (
      <div role="status" aria-label={t.common.loading} className="space-y-3" data-testid="studio-tabs-loading">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
        ))}
      </div>
    );
  }

  if (state === 'error' || !config) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/40 bg-card p-4 text-card-foreground" data-testid="studio-tabs-error">
        <p className="text-sm">{t.errors.networkError}</p>
        <Button variant="outline" className="mt-3 min-h-11" onClick={() => void load()}>
          {t.common.retry}
        </Button>
      </div>
    );
  }

  return (
    <section aria-labelledby="studio-tabs-heading" className="space-y-4" data-testid="studio-layout-tabs">
      <div>
        <h2 id="studio-tabs-heading" className="text-lg font-semibold text-foreground">{t.channel.tabs.manage_tabs}</h2>
        <p className="mt-1 text-sm text-muted-foreground [text-wrap:balance]">{t.channel.tabs.manage_tabs_description}</p>
      </div>
      <TabManagement channelId={channelId} initialConfig={config} onSave={handleSave} />
    </section>
  );
}
