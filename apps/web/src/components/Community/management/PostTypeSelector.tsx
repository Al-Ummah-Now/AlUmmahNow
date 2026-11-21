'use client';

import { PostType } from '@al-ummah/shared-types';
import { Card } from '@/components/ui/card';
import {
  FileText,
  Image,
  BarChart3,
  Brain,
  Video,
  Film,
  Newspaper,
  GalleryHorizontal,
  Link2,
  type LucideIcon
} from 'lucide-react';

interface PostTypeSelectorProps {
  selected: PostType | null;
  onSelect: (type: PostType) => void;
  locale: string;
}

interface PostTypeCard {
  type: PostType;
  icon: LucideIcon;
  label: {
    en: string;
    ar: string;
  };
  description: {
    en: string;
    ar: string;
  };
}

const POST_TYPES: PostTypeCard[] = [
  {
    type: PostType.TEXT,
    icon: FileText,
    label: { en: 'Text', ar: 'نص' },
    description: { en: 'Share a message with your community', ar: 'شارك رسالة مع مجتمعك' }
  },
  {
    type: PostType.IMAGE,
    icon: Image,
    label: { en: 'Image', ar: 'صورة' },
    description: { en: 'Upload up to 10 images', ar: 'ارفع حتى ١٠ صور' }
  },
  {
    type: PostType.POLL,
    icon: BarChart3,
    label: { en: 'Poll', ar: 'استطلاع' },
    description: { en: 'Ask your audience a question', ar: 'اسأل جمهورك سؤالاً' }
  },
  {
    type: PostType.QUIZ,
    icon: Brain,
    label: { en: 'Quiz', ar: 'اختبار' },
    description: { en: 'Create an interactive quiz', ar: 'أنشئ اختباراً تفاعلياً' }
  },
  {
    type: PostType.VIDEO,
    icon: Video,
    label: { en: 'Video', ar: 'مرئي' },
    description: { en: 'Share a video from your channel', ar: 'شارك مرئيًا من قناتك' }
  },
  {
    type: PostType.GIF,
    icon: Film,
    label: { en: 'GIF', ar: 'صورة متحركة' },
    description: { en: 'Add an animated GIF', ar: 'أضف صورة متحركة' }
  },
  // PostV2 kinds (packages/shared-types/src/post-schema.ts)
  {
    type: PostType.ARTICLE,
    icon: Newspaper,
    label: { en: 'Article', ar: 'مقال' },
    description: { en: 'Write an article with a cover', ar: 'اكتب مقالًا مع صورة غلاف' }
  },
  {
    type: PostType.CARDS,
    icon: GalleryHorizontal,
    label: { en: 'Cards', ar: 'بطاقات' },
    description: { en: 'Share up to 40 image cards', ar: 'شارك حتى ٤٠ بطاقة مصوّرة' }
  },
  {
    type: PostType.LINK,
    icon: Link2,
    label: { en: 'Link', ar: 'رابط' },
    description: { en: 'Share a page from another website', ar: 'شارك صفحة من موقع آخر' }
  }
];

/**
 * The nine post kinds as tiles (owner review): one column of rows on a phone, three columns from
 * 640px, so the rows are always full (3 × 3) and no slot is empty. Each tile is a row, icon at the
 * start and the name with its description beside it; descriptions wrap to a second line and are
 * never cut or ellipsised.
 */
export function PostTypeSelector({ selected, onSelect, locale }: PostTypeSelectorProps) {
  const isRTL = locale === 'ar';

  return (
    <div
      role="radiogroup"
      aria-label={isRTL ? 'نوع المنشور' : 'Post type'}
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      data-testid="post-type-grid"
    >
      {POST_TYPES.map((postType) => {
        const Icon = postType.icon;
        const isSelected = selected === postType.type;
        const label = isRTL ? postType.label.ar : postType.label.en;
        const description = isRTL ? postType.description.ar : postType.description.en;

        return (
          <Card
            key={postType.type}
            className={`flex cursor-pointer items-start gap-3 p-3 text-start transition-colors md:p-4 active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fanous-color-link)] ${
              isSelected ? 'border-2 border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/50'
            }`}
            onClick={() => onSelect(postType.type)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(postType.type);
              }
            }}
            role="radio"
            aria-checked={isSelected}
            tabIndex={0}
            data-post-type={postType.type}
          >
            <span
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1 space-y-0.5">
              <span className={`block text-sm font-semibold md:text-base ${isSelected ? 'text-primary' : 'text-foreground'}`}>{label}</span>
              <span className="block text-xs leading-snug text-muted-foreground md:text-sm" data-testid="post-type-description">{description}</span>
            </span>
          </Card>
        );
      })}
    </div>
  );
}
