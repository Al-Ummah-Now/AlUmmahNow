'use client';

/**
 * The chosen videos in playlist order, before saving (create form, "Add to
 * playlist" → New playlist). With a manual order every row can move:
 *
 * - pointer and touch: drag the row by its handle (the handle takes no
 *   scrolling, so a finger drag moves the row, not the page);
 * - keyboard: focus the handle, Space, arrows, Space (dnd-kit), or Alt+↑ /
 *   Alt+↓ anywhere on the row (the bulk-rename order's shortcut, #809), or the
 *   Move up / Move down buttons.
 *
 * Positions update as rows move and every move is announced. Lists run top to
 * bottom in both directions, so RTL needs no mirrored keys.
 */

import React, { useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, Film, GripVertical, X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import '@/theme/playlist-tools.css';
import type { PickedVideo } from './VideoPicker';
import { fill, localTitle } from './text';
import { MUTED, TEXT } from './styles';

interface Props {
  videos: PickedVideo[];
  onChange: (next: PickedVideo[]) => void;
  /** Manual order: rows can move. Automatic: shown in the chosen order, the playlist sorts them. */
  manual: boolean;
  /** Rows can be taken out of the selection */
  removable?: boolean;
  disabled?: boolean;
  testId?: string;
  /** Labels the list (id of its heading) */
  labelledBy?: string;
}

/** Moves one video by `delta` places (clamped); the same list when it can't move. */
export function moveBy<T>(list: T[], index: number, delta: number): T[] {
  const to = Math.min(list.length - 1, Math.max(0, index + delta));
  return to === index ? list : arrayMove(list, index, to);
}

export default function SortableVideoList({ videos, onChange, manual, removable, disabled, testId = 'order', labelledBy }: Props) {
  const { t, lang } = useLanguage();
  const p = t.playlistTools;
  const [status, setStatus] = useState('');
  const titleOf = (video: PickedVideo) => localTitle(video, lang);
  const total = videos.length;

  const move = (index: number, delta: number) => {
    const next = moveBy(videos, index, delta);
    if (next === videos) return;
    onChange(next);
    const video = videos[index];
    setStatus(fill(p.dndMoved, { title: titleOf(video), position: next.indexOf(video) + 1, total }));
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const indexOf = (id: string | number) => videos.findIndex((v) => v.id === id);
  const nameOf = (id: string | number) => {
    const video = videos.find((v) => v.id === id);
    return video ? titleOf(video) : '';
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = indexOf(active.id);
    const to = indexOf(over.id);
    if (from >= 0 && to >= 0) onChange(arrayMove(videos, from, to));
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => fill(p.dndPickedUp, { title: nameOf(active.id), position: indexOf(active.id) + 1, total }),
    onDragOver: ({ active, over }) => (over ? fill(p.dndMoved, { title: nameOf(active.id), position: indexOf(over.id) + 1, total }) : undefined),
    onDragEnd: ({ active, over }) => (over ? fill(p.dndDropped, { title: nameOf(active.id), position: indexOf(over.id) + 1, total }) : undefined),
    onDragCancel: ({ active }) => fill(p.dndCancelled, { title: nameOf(active.id) }),
  };

  const list = (
    <ol className="space-y-1" aria-labelledby={labelledBy} data-testid={testId} data-manual={manual || undefined}>
      {videos.map((video, index) => (
        <Row
          key={video.id}
          video={video}
          index={index}
          total={total}
          manual={manual}
          removable={removable}
          disabled={disabled}
          testId={testId}
          onMove={(delta) => move(index, delta)}
          onRemove={() => {
            onChange(videos.filter((v) => v.id !== video.id));
            setStatus('');
          }}
        />
      ))}
    </ol>
  );

  return (
    <div className="space-y-2">
      <p id={`${testId}-hint`} className={`text-xs ${MUTED}`}>{manual ? p.reorderHint : p.autoNoDrag}</p>
      {manual ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ announcements, screenReaderInstructions: { draggable: p.reorderHint } }}>
          <SortableContext items={videos.map((v) => v.id)} strategy={verticalListSortingStrategy}>
            {list}
          </SortableContext>
        </DndContext>
      ) : list}
      <span className="sr-only" role="status" aria-live="polite" data-testid={`${testId}-status`}>{status}</span>
    </div>
  );
}

interface RowProps {
  video: PickedVideo;
  index: number;
  total: number;
  manual: boolean;
  removable?: boolean;
  disabled?: boolean;
  testId: string;
  onMove: (delta: number) => void;
  onRemove: () => void;
}

function Row({ video, index, total, manual, removable, disabled, testId, onMove, onRemove }: RowProps) {
  const { t, lang } = useLanguage();
  const p = t.playlistTools;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: video.id, disabled: !manual || disabled });
  const title = localTitle(video, lang);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!manual || disabled || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    onMove(event.key === 'ArrowUp' ? -1 : 1);
    // Keep the focus on the moved row's handle
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="${testId}-handle"][data-video-id="${video.id.replace(/["\\]/g, "\\$&")}"]`)?.focus());
  };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onKeyDown={onKeyDown}
      className="pl-row flex items-center gap-2 p-1.5"
      data-dragging={isDragging || undefined}
      data-testid={`${testId}-row`}
      data-video-id={video.id}
      data-position={index + 1}
    >
      {manual && (
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="pl-handle flex-none"
          {...attributes}
          {...listeners}
          aria-label={fill(p.dragHandle, { title })}
          aria-describedby={`${testId}-hint`}
          disabled={disabled}
          data-testid={`${testId}-handle`}
          data-video-id={video.id}
        >
          <GripVertical className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
      <span className="pl-pos flex-none" data-testid={`${testId}-position`}>{index + 1}</span>
      <span className={`pl-thumb flex-none ${video.isShort ? 'pl-thumb-short' : ''}`}>
        {video.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={video.thumbnailUrl} alt="" loading="lazy" />
        ) : (
          <Film className="h-5 w-5" aria-hidden="true" />
        )}
      </span>
      <span className={`min-w-0 flex-1 line-clamp-2 text-sm font-medium ${TEXT}`} dir="auto">{title}</span>
      <span className="flex flex-none items-center">
        {manual && (
          <>
            <button type="button" className="b b-ghost b-icon" onClick={() => onMove(-1)} disabled={disabled || index === 0} aria-label={fill(p.moveUpTitle, { title })} title={fill(p.moveUpTitle, { title })} data-testid={`${testId}-up`}>
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" className="b b-ghost b-icon" onClick={() => onMove(1)} disabled={disabled || index === total - 1} aria-label={fill(p.moveDownTitle, { title })} title={fill(p.moveDownTitle, { title })} data-testid={`${testId}-down`}>
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </button>
          </>
        )}
        {removable && (
          <button type="button" className="b b-ghost b-icon" onClick={onRemove} disabled={disabled} aria-label={fill(p.unselect, { title })} title={fill(p.unselect, { title })} data-testid={`${testId}-remove`}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </span>
    </li>
  );
}
