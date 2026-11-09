'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, BellRing, Check } from 'lucide-react';
import type { ChannelBellLevel } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { NotificationsService } from '@/services/api/notifications';
import { MenuButton } from '@/components/common/MenuButton';
import { logger } from '@/lib/logger-client';

interface ChannelBellMenuProps {
  channelId: string;
}

const ICONS: Record<ChannelBellLevel, React.ComponentType<{ className?: string }>> = {
  all: BellRing,
  highlights: Bell,
  none: BellOff,
};

/**
 * Per-channel notification bell (Story 29.10): all / highlights / none.
 * Rendered next to the Subscribe button while subscribed.
 */
export function ChannelBellMenu({ channelId }: ChannelBellMenuProps) {
  const { t } = useLanguage();
  const texts = t.notificationCenter.channelBell;
  const [bell, setBell] = useState<ChannelBellLevel>('highlights');
  const [message, setMessage] = useState<'saved' | 'error' | null>(null);

  // Set once the user picks a level, so a slower initial load cannot overwrite it.
  const chosen = useRef(false);

  useEffect(() => {
    let cancelled = false;
    chosen.current = false;
    void NotificationsService.channelBell(channelId).then((result) => {
      if (!cancelled && !chosen.current && result?.bell) setBell(result.bell);
    });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const choose = async (level: ChannelBellLevel) => {
    chosen.current = true;
    const previous = bell;
    setBell(level);
    const ok = await NotificationsService.setChannelBell(channelId, level);
    if (!ok) {
      logger.warn('[ChannelBellMenu] Failed to set bell', { channelId, level });
      setBell(previous);
    }
    setMessage(ok ? 'saved' : 'error');
  };

  const Icon = ICONS[bell];
  const levels: ChannelBellLevel[] = ['all', 'highlights', 'none'];

  return (
    <span className="inline-flex items-center" data-testid="channel-bell" data-bell={bell}>
      <MenuButton
        label={`${texts.label}: ${texts[bell]}`}
        testId="channel-bell-button"
        buttonClassName="rounded-lg bg-gray-200 p-1.5 text-gray-900 shadow-md hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        items={levels.map((level) => {
          const LevelIcon = ICONS[level];
          return {
            id: level,
            label: texts[level],
            description: texts[`${level}Description` as const],
            checked: bell === level,
            icon: bell === level ? <Check className="h-4 w-4" /> : <LevelIcon className="h-4 w-4" />,
            testId: `channel-bell-option-${level}`,
            onSelect: () => choose(level),
          };
        })}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </MenuButton>
      <span className="sr-only" role="status" aria-live="polite">
        {message === 'saved' ? texts.saved : message === 'error' ? texts.error : ''}
      </span>
    </span>
  );
}

export default ChannelBellMenu;
