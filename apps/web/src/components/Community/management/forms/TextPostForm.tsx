'use client';

import { useRef } from 'react';
import { QafSourcePicker } from './QafSourcePicker';

import { charactersLeft, charactersOver } from '@/lib/format/characters';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface TextPostFormProps {
  channelId?: string;
  content: string;
  onChange: (content: string) => void;
  locale: string;
  error?: string;
}

const MAX_CHARS = 5000;

export function TextPostForm({ channelId, content, onChange, locale, error }: TextPostFormProps) {
  const editor = useRef<HTMLTextAreaElement>(null);
  const isRTL = locale === 'ar';
  const remaining = MAX_CHARS - content.length;
  const isNearLimit = remaining < 100;
  const isOverLimit = remaining < 0;

  return (
    <div className="space-y-3">
      <Label htmlFor="content" className="text-sm md:text-base">
        {isRTL ? 'المحتوى' : 'Content'}
      </Label>

      {channelId && <QafSourcePicker channelId={channelId} editor={editor} value={content} onChange={onChange} maxLength={MAX_CHARS} />}
      <Textarea
        ref={editor}
        id="content"
        value={content}
        onChange={(e) => onChange(e.target.value)}
        placeholder={isRTL
          ? 'شارك أفكارك مع مجتمعك...'
          : 'Share your thoughts with your community...'
        }
        dir={isRTL ? 'rtl' : 'ltr'}
        className={`
          min-h-[150px]    /* Mobile: shorter */
          md:min-h-[200px] /* Desktop: taller */
          resize-y
          text-sm md:text-base
          ${error ? 'border-destructive' : ''}
        `}
        maxLength={MAX_CHARS}
      />

      <div className={`
        flex
        items-center
        justify-between
        text-xs md:text-sm
      `}>
        <span className={`
          ${isOverLimit
            ? 'text-destructive font-semibold'
            : isNearLimit
            ? 'text-orange-500'
            : 'text-muted-foreground'
          }
        `}>
          {remaining >= 0 ? charactersLeft(isRTL, remaining) : charactersOver(isRTL, Math.abs(remaining), { limit: true })}
        </span>

        {error && (
          <span className="text-destructive text-xs md:text-sm">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
