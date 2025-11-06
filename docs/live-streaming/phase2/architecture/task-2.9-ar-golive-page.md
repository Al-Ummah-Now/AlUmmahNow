# Task 2.9: /ar/go-live Page (Arabic RTL)

**Phase**: 2 - Go Live Creator Tools
**Type**: Architecture Specification
**Estimated Time**: 5 hours
**Dependencies**: Task 2.8 (English Go Live Page)
**Status**: 📝 Not Started

---

## Goal

Create an Arabic (RTL) version of the go-live page with proper bidirectional text handling, mirrored layouts, localized content, and culturally appropriate UX.

## Architecture Pattern

**Pattern**: RTL-Aware Server Component with Locale-Specific Components
**Strategy**: Shared logic with English version, RTL-specific presentation

## Component Structure

```typescript
// File: /apps/web/src/app/ar/go-live/page.tsx
import { GoLiveWizard } from '@/components/GoLiveForm/rtl';
import { arabicMetadata } from '@/lib/metadata/ar';

export const metadata = arabicMetadata.goLive;

export default async function GoLivePageArabic({ searchParams }) {
  // Same authentication and validation logic as English
  const session = await getAuthSession();

  if (!session?.user) {
    redirect(`/ar/auth/signin?redirect=/ar/go-live`);
  }

  const [quota, channels] = await Promise.all([
    getUserStreamingQuota(session.user.id),
    getUserChannels(session.user.id)
  ]);

  if (!quota.canStream) {
    return <QuotaExceededViewRTL quota={quota} />;
  }

  if (channels.length === 0) {
    return <CreateChannelFirstViewRTL />;
  }

  return (
    <div dir="rtl" className="container mx-auto px-4 py-8">
      <PageHeaderRTL
        title="بث مباشر"
        description="أنشئ بثك المباشر في 4 خطوات سهلة"
      />

      <GoLiveWizardRTL
        userId={session.user.id}
        channels={channels}
        quota={quota}
        locale="ar"
        onSuccess={(streamId) => router.push(`/ar/dashboard/streams/${streamId}`)}
        onCancel={() => router.push('/ar/dashboard')}
      />
    </div>
  );
}
```

## Data Flow

Same as English version, but with RTL rendering:
```
Page Load → Check Auth → Fetch Data
     ↓                        ↓
RTL Layout → Arabic Labels → Mirrored Wizard
     ↓                                  ↓
Arabic Validation → RTL Error Messages → Localized Success
```

## Dependencies

- **react-i18next** - Translations
- **rtl-css-js** - CSS mirroring
- **arabic-reshaper** - Text shaping for better rendering
- **hijri-date** - Islamic calendar support

## Integration Points

- Same APIs as English version
- Arabic translation service
- RTL-aware help content
- Arabic keyboard shortcuts

## Performance Considerations

```typescript
// RTL-specific optimizations
const useRTLOptimizations = () => {
  useEffect(() => {
    // Preload Arabic fonts
    const fonts = [
      'https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;500;600;700',
      'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700'
    ];

    fonts.forEach(url => {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = url;
      document.head.appendChild(link);
    });

    // Enable Arabic text rendering optimizations
    document.documentElement.style.textRendering = 'optimizeLegibility';
    document.documentElement.style.fontFeatureSettings = '"kern" 1, "liga" 1';

    return () => {
      document.documentElement.style.textRendering = '';
      document.documentElement.style.fontFeatureSettings = '';
    };
  }, []);
};

// Memoized Arabic formatters
const arabicFormatters = {
  number: new Intl.NumberFormat('ar-SA', { numberingSystem: 'arab' }),
  date: new Intl.DateTimeFormat('ar-SA', {
    calendar: 'islamic-umalqura',
    dateStyle: 'full',
    timeStyle: 'short'
  }),
  relativeTime: new Intl.RelativeTimeFormat('ar-SA', { numeric: 'auto' }),
  duration: (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${arabicNumerals(hours)} ساعة ${arabicNumerals(minutes)} دقيقة`;
  }
};
```

## Security Considerations

```typescript
// Bidirectional text security (prevent text spoofing)
const sanitizeBidiText = (text: string): string => {
  // Remove dangerous Unicode characters
  const dangerousChars = [
    '\u202A', // LTR embedding
    '\u202B', // RTL embedding
    '\u202C', // Pop directional formatting
    '\u202D', // LTR override
    '\u202E', // RTL override
    '\u2066', // LTR isolate
    '\u2067', // RTL isolate
    '\u2068', // First strong isolate
    '\u2069', // Pop directional isolate
  ];

  let sanitized = text;
  dangerousChars.forEach(char => {
    sanitized = sanitized.replace(new RegExp(char, 'g'), '');
  });

  return sanitized;
};

// Prevent mixed script attacks
const validateArabicInput = (text: string): ValidationResult => {
  const scripts = detectScripts(text);

  // Allow Arabic + English + Common (numbers, punctuation)
  const allowedScripts = ['Arabic', 'Latin', 'Common'];
  const invalidScripts = scripts.filter(s => !allowedScripts.includes(s));

  if (invalidScripts.length > 0) {
    return {
      valid: false,
      error: 'يحتوي النص على أحرف غير مدعومة'
    };
  }

  return { valid: true };
};
```

## Error Handling

```typescript
// Arabic error messages
const errorMessagesAR: Record<string, string> = {
  'auth.required': 'يجب تسجيل الدخول',
  'quota.exceeded': 'تجاوزت حد البث المباشر',
  'channel.required': 'يجب إنشاء قناة أولاً',
  'title.required': 'العنوان مطلوب',
  'title.tooShort': 'العنوان قصير جداً (٣ أحرف على الأقل)',
  'title.tooLong': 'العنوان طويل جداً (١٠٠ حرف كحد أقصى)',
  'description.tooLong': 'الوصف طويل جداً',
  'schedule.past': 'لا يمكن جدولة البث في الماضي',
  'schedule.tooSoon': 'يجب أن يكون البث المجدول بعد ٥ دقائق على الأقل',
  'category.required': 'الفئة مطلوبة',
  'tags.tooMany': 'عدد الوسوم كثير جداً (١٠ كحد أقصى)',
  'thumbnail.invalidFormat': 'صيغة الصورة غير صحيحة',
  'thumbnail.tooLarge': 'حجم الصورة كبير جداً (٥ ميجابايت كحد أقصى)',
  'rtmp.connectionFailed': 'فشل الاتصال بخادم RTMP',
  'network.error': 'خطأ في الاتصال بالإنترنت',
  'server.error': 'خطأ في الخادم، حاول مرة أخرى'
};

// RTL error display
const ErrorMessageRTL: React.FC<{ error: string }> = ({ error }) => (
  <div className="flex items-start gap-2 text-red-600" dir="rtl">
    <span className="mt-0.5">⚠️</span>
    <span className="text-sm font-arabic">{errorMessagesAR[error] || error}</span>
  </div>
);
```

## Type Safety

```typescript
// Locale-aware types
type LocalizedString<T extends string = string> = {
  en: T;
  ar: T;
};

interface LocalizedStreamData extends StreamDetailsData {
  title: LocalizedString<string>;
  description?: LocalizedString<string>;
  locale: 'ar' | 'en';
}

// Arabic-specific validation schema
const arabicStreamSchema = streamDetailsSchema.extend({
  title: z.string()
    .min(3, 'العنوان قصير جداً')
    .max(100, 'العنوان طويل جداً')
    .refine(validateArabicInput, 'يحتوي العنوان على أحرف غير مدعومة'),

  description: z.string()
    .max(5000, 'الوصف طويل جداً')
    .optional()
    .transform(val => sanitizeBidiText(val || ''))
});
```

## RTL Layout Considerations

```css
/* RTL-specific styles */
.rtl-wizard {
  direction: rtl;
  text-align: right;
}

/* Mirror step indicators */
.rtl-wizard .step-indicator {
  transform: scaleX(-1);
}

.rtl-wizard .step-indicator > * {
  transform: scaleX(-1);
}

/* Flip icons */
.rtl-wizard .icon-arrow-right {
  transform: rotate(180deg);
}

/* Arabic numerals */
.rtl-wizard .number {
  font-feature-settings: "lnum" 1;
}
```

## Testing Criteria

- [ ] All text displayed in Arabic
- [ ] Layout mirrored (RTL)
- [ ] Arabic numerals used
- [ ] Islamic calendar option available
- [ ] Error messages in Arabic
- [ ] Help content in Arabic
- [ ] Keyboard shortcuts work with Arabic layout
- [ ] Copy/paste preserves text direction
- [ ] Mixed Arabic/English handled correctly
- [ ] Success notifications in Arabic

## Acceptance Criteria

- [ ] Full RTL layout
- [ ] All labels/messages in Arabic
- [ ] Mirrored step indicators
- [ ] Arabic number formatting
- [ ] Islamic (Hijri) calendar option
- [ ] Bidirectional text handling
- [ ] Arabic error messages
- [ ] Same functionality as English version
- [ ] No text overflow issues
- [ ] Proper font rendering

## Related Tasks

- **Depends On**: Task 2.8 (English Go Live Page)
- **Blocks**: None
- **Related**: All Phase 2 RTL components

## References

- [ADR-002: Phase 2 Architecture](/docs/architecture/ADR-002-phase2-golive-architecture.md#task-9-argo-live-page)
- [RTL CSS Guide](https://rtlstyling.com/)
- [Arabic Typography Best Practices](https://www.w3.org/International/articles/inline-bidi-markup/)

---

**Last Updated**: 2025-11-06
**Reviewed By**: N/A
**Implementation Status**: Not Started
