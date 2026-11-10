'use client';

import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

export interface PickedItem {
  id: string;
  label: string;
  thumbnailUrl?: string | null;
  /** Round thumbnail (channels) */
  round?: boolean;
}

interface SelectedListProps {
  items: PickedItem[];
  onChange: (items: PickedItem[]) => void;
  testId: string;
}

/**
 * The picked items in the order they'll show on the channel, with move and
 * remove buttons (keyboard and screen-reader friendly, no drag needed).
 */
export function SelectedList({ items, onChange, testId }: SelectedListProps) {
  const { t } = useLanguage();
  const f = t.channelSections.form;
  if (items.length === 0) return null;

  const move = (from: number, to: number) => {
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  return (
    <ol className="space-y-1.5" data-testid={testId}>
      {items.map((item, index) => (
        <li
          key={item.id}
          data-picked-id={item.id}
          className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5"
        >
          <span className="w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground">{index + 1}</span>
          {item.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- small picker thumbnail
            <img
              src={item.thumbnailUrl}
              alt=""
              className={item.round ? 'h-8 w-8 shrink-0 rounded-full object-cover' : 'h-8 w-14 shrink-0 rounded object-cover'}
            />
          ) : (
            <span className={item.round ? 'h-8 w-8 shrink-0 rounded-full bg-muted' : 'h-8 w-14 shrink-0 rounded bg-muted'} />
          )}
          <span className="min-w-0 flex-1 truncate text-sm text-foreground" dir="auto">{item.label}</span>
          <div className="flex shrink-0 items-center">
            <IconButton label={`${f.moveUp}: ${item.label}`} disabled={index === 0} onClick={() => move(index, index - 1)}>
              <ChevronUp className="h-4 w-4" />
            </IconButton>
            <IconButton
              label={`${f.moveDown}: ${item.label}`}
              disabled={index === items.length - 1}
              onClick={() => move(index, index + 1)}
            >
              <ChevronDown className="h-4 w-4" />
            </IconButton>
            <IconButton label={`${f.remove}: ${item.label}`} onClick={() => onChange(items.filter((i) => i.id !== item.id))}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        </li>
      ))}
    </ol>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}
