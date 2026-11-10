'use client';

import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { ChannelTabConfig, ChannelTab } from '@al-ummah/shared-types';
import { SortableTabItem } from './SortableTabItem';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';

interface TabManagementProps {
  channelId: string;
  initialConfig: ChannelTabConfig;
  onSave: (config: { defaultTab: string; tabs: ChannelTab[] }) => Promise<boolean>;
}

export default function TabManagement({
  channelId,
  initialConfig,
  onSave,
}: TabManagementProps) {
  const { t, lang } = useLanguage();
  const [tabs, setTabs] = useState<ChannelTab[]>(initialConfig.tabs);
  const [defaultTab, setDefaultTab] = useState(initialConfig.defaultTab);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Configure sensors for better mobile experience
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required before drag starts
      },
    }),
    // Keyboard reordering: focus a handle, Space to pick up, arrows to move, Space to drop
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Handle drag and drop reordering
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setTabs((currentTabs) => {
        const oldIndex = currentTabs.findIndex((tab) => tab.id === active.id);
        const newIndex = currentTabs.findIndex((tab) => tab.id === over.id);

        const reordered = arrayMove(currentTabs, oldIndex, newIndex);

        // Update positions
        return reordered.map((tab, index) => ({
          ...tab,
          position: index,
        }));
      });

      setHasChanges(true);
      logger.debug('TabManagement: Tabs reordered', {
        activeId: active.id,
        overId: over.id,
        channelId,
      });
    }
  };

  // Toggle tab visibility
  const handleToggleVisibility = (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    const defaultTabObj = tabs.find((t) => t.id === defaultTab);

    // Prevent hiding the default tab
    if (tab && tab.visible && defaultTab === tabId) {
      setError(t.channel.tabs.cannot_hide_default_tab);
      setTimeout(() => setError(null), 3000);
      logger.warn('TabManagement: Cannot hide default tab', { tabId, channelId });
      return;
    }

    // Prevent hiding any tab if the default tab is hidden
    if (tab && tab.visible && defaultTabObj && !defaultTabObj.visible) {
      setError(t.channel.tabs.default_must_be_visible);
      setTimeout(() => setError(null), 3000);
      logger.warn('TabManagement: Cannot hide tab when default tab is hidden', { tabId, defaultTab, channelId });
      return;
    }

    setTabs((currentTabs) => {
      const updatedTabs = currentTabs.map((tab) =>
        tab.id === tabId ? { ...tab, visible: !tab.visible } : tab
      );

      return updatedTabs;
    });

    setHasChanges(true);
    logger.debug('TabManagement: Tab visibility toggled', { tabId, channelId });
  };

  // Set default tab
  const handleSetDefault = (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);

    if (!tab || !tab.visible) {
      logger.warn('TabManagement: Cannot set invisible tab as default', {
        tabId,
        channelId,
      });
      return;
    }

    setDefaultTab(tabId);
    setHasChanges(true);
    logger.debug('TabManagement: Default tab set', { tabId, channelId });
  };

  // Save changes
  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      logger.debug('TabManagement: Saving tab configuration', {
        channelId,
        defaultTab,
        tabsCount: tabs.length,
      });

      const result = await onSave({ defaultTab, tabs });

      if (result) {
        setHasChanges(false);
        setSuccess(t.channel.tabs.changes_saved);
        setTimeout(() => setSuccess(null), 3000);
        logger.debug('TabManagement: Tab configuration saved successfully', {
          channelId,
        });
      } else {
        throw new Error('Save failed');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('TabManagement: Error saving tab configuration', {
        error: err,
        errorMessage,
        channelId,
      });
      setError(t.channel.tabs.save_failed);
    } finally {
      setIsSaving(false);
    }
  };

  // Check if a tab can be hidden (at least one visible tab required)
  const canHideTab = (tabId: string): boolean => {
    const visibleTabs = tabs.filter((tab) => tab.visible);
    const tab = tabs.find((t) => t.id === tabId);
    const defaultTabObj = tabs.find((t) => t.id === defaultTab);

    // Can't hide if it's the default tab
    if (tabId === defaultTab) {
      return false;
    }

    // Can't hide any tab if the default tab is hidden
    if (defaultTabObj && !defaultTabObj.visible) {
      return false;
    }

    // Can't hide if it's the last visible tab
    if (tab?.visible && visibleTabs.length <= 1) {
      return false;
    }

    return true;
  };

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header with save button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div>
          <p className="text-sm md:text-base text-gray-600 dark:text-gray-400">
            {t.channel.tabs.drag_to_reorder}
          </p>
        </div>

        <Button
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
          variant={hasChanges ? 'default' : 'outline'}
          className="w-full sm:w-auto h-10 md:h-9"
        >
          {isSaving ? t.common.loading : t.channel.tabs.save_changes}
        </Button>
      </div>

      {/* Success message */}
      {success && (
        <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-800 dark:text-green-300">
          {success}
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Info message */}
      {hasChanges && (
        <div className="p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg text-sm text-orange-800 dark:text-orange-300">
          {t.channel.tabs.default_must_be_visible}
        </div>
      )}

      {/* Drag-and-drop list */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={tabs.map((tab) => tab.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2 md:space-y-3">
            {tabs.map((tab) => (
              <SortableTabItem
                key={tab.id}
                tab={tab}
                isDefault={defaultTab === tab.id}
                onToggleVisibility={() => handleToggleVisibility(tab.id)}
                onSetDefault={() => handleSetDefault(tab.id)}
                canHide={canHideTab(tab.id)}
                locale={lang}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Footer info */}
      <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-800 dark:text-blue-300">
        <p>{t.channel.tabs.at_least_one_visible}</p>
      </div>
    </div>
  );
}
