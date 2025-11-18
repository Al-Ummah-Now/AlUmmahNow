'use client';

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
          {remaining >= 0
            ? (isRTL
              ? `${remaining.toLocaleString('ar-SA')} حرف متبقي`
              : `${remaining.toLocaleString()} characters remaining`)
            : (isRTL
              ? `${Math.abs(remaining).toLocaleString('ar-SA')} حرف زائد`
              : `${Math.abs(remaining).toLocaleString()} characters over limit`)
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
