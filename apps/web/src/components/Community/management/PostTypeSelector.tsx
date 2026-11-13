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
  Link2
} from 'lucide-react';

interface PostTypeSelectorProps {
  selected: PostType | null;
  onSelect: (type: PostType) => void;
  locale: string;
}

interface PostTypeCard {
  type: PostType;
  icon: React.ComponentType<{ className?: string }>;
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
    description: { en: 'Upload up to 10 images', ar: 'ارفع حتى 10 صور' }
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

export function PostTypeSelector({ selected, onSelect, locale }: PostTypeSelectorProps) {
  const isRTL = locale === 'ar';

  return (
    <div
      role="radiogroup"
      aria-label={isRTL ? 'نوع المنشور' : 'Post type'}
      className="
      grid
      grid-cols-2          /* Mobile: 2 columns */
      sm:grid-cols-3       /* Tablet: 3 columns */
      lg:grid-cols-5       /* Desktop: 5 a row (9 kinds) */
      gap-3                /* Mobile: compact gaps */
      md:gap-4             /* Desktop: larger gaps */
    ">
      {POST_TYPES.map((postType) => {
        const Icon = postType.icon;
        const isSelected = selected === postType.type;
        const label = isRTL ? postType.label.ar : postType.label.en;
        const description = isRTL ? postType.description.ar : postType.description.en;

        return (
          <Card
            key={postType.type}
            className={`
              cursor-pointer
              transition-all
              p-4                /* Mobile: standard padding */
              md:p-6             /* Desktop: more padding */
              hover:shadow-lg
              hover:border-primary/50
              active:scale-[0.98]  /* Mobile: tap feedback */
              ${isSelected
                ? 'border-primary border-2 bg-primary/5 shadow-md'
                : 'border-border hover:bg-muted/50'
              }
            `}
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
            <div className="
              flex
              flex-col
              items-center
              gap-2              /* Mobile: compact spacing */
              md:gap-3           /* Desktop: more spacing */
              text-center
            ">
              <div className={`
                p-3              /* Mobile: smaller icon container */
                md:p-4           /* Desktop: larger icon container */
                rounded-full
                ${isSelected
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
                }
              `}>
                <Icon className="
                  w-5 h-5        /* Mobile: smaller icons */
                  md:w-6 md:h-6  /* Desktop: larger icons */
                " />
              </div>

              <div className="space-y-1">
                <h3 className={`
                  font-semibold
                  text-sm        /* Mobile: smaller text */
                  md:text-base   /* Desktop: normal text */
                  ${isSelected ? 'text-primary' : 'text-foreground'}
                `}>
                  {label}
                </h3>
                <p className="
                  text-xs        /* Mobile: extra small */
                  md:text-sm     /* Desktop: small */
                  text-muted-foreground
                  line-clamp-2
                ">
                  {description}
                </p>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
