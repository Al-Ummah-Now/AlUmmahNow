'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChannelTab } from '@al-ummah/shared-types';
import { GripVertical, Eye, EyeOff, Star } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

interface SortableTabItemProps {
  tab: ChannelTab;
  isDefault: boolean;
  onToggleVisibility: () => void;
  onSetDefault: () => void;
  canHide: boolean;
  locale: string;
}

export function SortableTabItem({
  tab,
  isDefault,
  onToggleVisibility,
  onSetDefault,
  canHide,
  locale,
}: SortableTabItemProps) {
  const { t, isRTL } = useLanguage();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tab.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Get localized tab name
  const tabName = tab.nameLocalized?.[locale] || tab.name;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        flex
        items-center
        gap-3
        md:gap-4
        p-3
        md:p-4
        bg-white
        dark:bg-gray-800
        border
        border-gray-200
        dark:border-gray-700
        rounded-lg
        shadow-sm
        ${isDragging ? 'opacity-50 ring-2 ring-blue-500' : ''}
        ${!tab.visible ? 'bg-gray-50 dark:bg-gray-900/50' : ''}
        transition-all
      `}
      dir={isRTL ? 'rtl' : 'ltr'}
      data-testid="tab-item"
      data-tab-id={tab.id}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="
          cursor-grab
          active:cursor-grabbing
          p-1
          hover:bg-gray-100
          dark:hover:bg-gray-700
          rounded
          transition-colors
          text-gray-400
          dark:text-gray-500
          hover:text-gray-600
          dark:hover:text-gray-300
          touch-manipulation
        "
        aria-label={`${t.channel.tabs.drag_to_reorder}: ${tabName}`}
        data-testid="tab-drag-handle"
      >
        <GripVertical className="w-5 h-5" />
      </button>

      {/* Tab name */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`
              text-sm
              md:text-base
              font-medium
              truncate
              ${
                tab.visible
                  ? 'text-gray-900 dark:text-gray-100'
                  : 'text-gray-400 dark:text-gray-600'
              }
            `}
          >
            {tabName}
          </span>
          {!tab.visible && (
            <span className="text-xs text-gray-500 dark:text-gray-600 shrink-0">
              ({t.channel.tabs.hidden})
            </span>
          )}
          {isDefault && (
            <span className="text-xs px-2 py-0.5 bg-brand-soft dark:bg-brand-soft text-brand-ink dark:text-brand-ink rounded-full shrink-0">
              {t.channel.tabs.default_tab}
            </span>
          )}
        </div>
      </div>

      {/* Visibility toggle */}
      <button
        onClick={onToggleVisibility}
        disabled={!canHide}
        className={`
          p-2
          rounded
          transition-all
          ${
            canHide
              ? 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
              : 'opacity-30 cursor-not-allowed text-gray-400 dark:text-gray-600'
          }
        `}
        title={
          canHide
            ? t.channel.tabs.toggle_visibility
            : t.channel.tabs.cannot_hide_last_tab
        }
        aria-label={
          tab.visible
            ? `${t.channel.hideTab} ${tabName}`
            : `${t.channel.showTab} ${tabName}`
        }
      >
        {tab.visible ? (
          <Eye className="w-5 h-5" />
        ) : (
          <EyeOff className="w-5 h-5" />
        )}
      </button>

      {/* Default tab selector */}
      <button
        onClick={onSetDefault}
        disabled={!tab.visible || isDefault}
        className={`
          p-2
          rounded
          transition-all
          ${
            isDefault
              ? 'text-brand-ink dark:text-brand-ink'
              : tab.visible
              ? 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 dark:text-gray-600 hover:text-brand-ink dark:hover:text-brand-ink'
              : 'opacity-30 cursor-not-allowed text-gray-300 dark:text-gray-700'
          }
        `}
        title={
          tab.visible
            ? t.channel.tabs.set_as_default
            : t.channel.tabs.default_must_be_visible
        }
        aria-label={`${t.channel.tabs.set_as_default} ${tabName}`}
      >
        <Star
          className={`w-5 h-5 ${
            isDefault ? 'fill-brand dark:fill-brand' : ''
          }`}
        />
      </button>
    </div>
  );
}
