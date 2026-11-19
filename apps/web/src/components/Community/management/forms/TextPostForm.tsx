'use client';

import { formatNumber } from '@al-ummah/shared-types';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface TextPostFormProps {
  content: string;
  onChange: (content: string) => void;
  locale: string;
  error?: string;
}

const MAX_CHARS = 5000;

export function TextPostForm({ content, onChange, locale, error }: TextPostFormProps) {
  const isRTL = locale === 'ar';
  const remaining = MAX_CHARS - content.length;
  const isNearLimit = remaining < 100;
  const isOverLimit = remaining < 0;

  return (
    <div className="space-y-3">
      <Label htmlFor="content" className="text-sm md:text-base">
        {isRTL ? 'المحتوى' : 'Content'}
      </Label>

      <Textarea
        id="content"
        value={content}
        onChange={(e) => onChange(e.target.value)}
        placeholder={isRTL
          ? 'شارك أفكارك مع مجتمعك...'
          : 'Share your thoughts with your community...'
        }
        dir={isRTL ? 'rtl' : 'ltr'}
        // A full editor area (owner review), sized for the rich text editor that replaces it.
        // Inline: theme/system.css sets textarea { min-height: 44px } unlayered, above any utility.
        style={{ minHeight: 'clamp(16rem, 45vh, 28rem)', resize: 'none', fieldSizing: 'content' } as React.CSSProperties}
        className={`text-sm leading-relaxed md:text-base ${error ? 'border-destructive' : ''}`}
        data-testid="post-content-editor"
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
          {remaining >= 0
            ? (isRTL
              ? `${formatNumber('ar', remaining)} حرف متبقي`
              : `${formatNumber('en', remaining)} characters remaining`)
            : (isRTL
              ? `${formatNumber('ar', Math.abs(remaining))} حرف زائد`
              : `${formatNumber('en', Math.abs(remaining))} characters over limit`)
          }
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
