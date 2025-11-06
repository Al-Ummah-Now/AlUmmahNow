# Task 2.2: Step 1 - Stream Details Form with Zod Validation

**Phase**: 2 - Go Live Creator Tools
**Type**: Architecture Specification
**Estimated Time**: 6 hours
**Dependencies**: Task 2.1 (GoLive Wizard)
**Status**: 📝 Not Started

---

## Goal

Create a comprehensive stream details form with real-time Zod validation, character counters, and auto-save functionality for capturing essential stream metadata.

## Architecture Pattern

**Pattern**: Schema-Driven Form Validation with Progressive Enhancement
**Strategy**: Client-side validation with server-side confirmation

## Component Structure

```typescript
// File: /apps/web/src/components/GoLiveForm/StreamDetailsStep.tsx
interface StreamDetailsStepProps {
  initialData?: Partial<StreamDetailsData>;
  onNext: (data: StreamDetailsData) => void;
  onCancel: () => void;
  onSaveDraft: (data: Partial<StreamDetailsData>) => void;
}

// Zod Schema with comprehensive validation
const streamDetailsSchema = z.object({
  title: z.string()
    .min(3, 'Title must be at least 3 characters')
    .max(100, 'Title must be 100 characters or less')
    .regex(/^[^<>'"]*$/, 'Title contains invalid characters'),

  description: z.string()
    .max(5000, 'Description must be 5000 characters or less')
    .optional()
    .transform(val => DOMPurify.sanitize(val || '')),

  category: z.enum(STREAM_CATEGORIES),

  language: z.enum(['en', 'ar']),

  scheduledStartTime: z.string()
    .datetime()
    .optional()
    .refine(
      (date) => !date || new Date(date) > new Date(Date.now() + 5 * 60 * 1000),
      'Scheduled time must be at least 5 minutes in the future'
    ),

  isPrivate: z.boolean().default(false),

  allowChat: z.boolean().default(true),

  tags: z.array(
    z.string()
      .max(30, 'Tag too long')
      .regex(/^[a-zA-Z0-9\-_\u0600-\u06FF]+$/, 'Invalid tag format')
  )
  .max(10, 'Maximum 10 tags allowed')
  .optional(),

  ageRestriction: z.enum(['all', '13+', '18+']).default('all'),

  recordStream: z.boolean().default(true)
});

type StreamDetailsData = z.infer<typeof streamDetailsSchema>;
```

## Data Flow

```
User Input → Real-time Validation → Update Character Counters
     ↓              ↓                         ↓
Field Blur → Validate Field → Show Error/Success
     ↓                                        ↓
Idle 30s → Auto-save Draft → Store in sessionStorage
     ↓                                        ↓
Submit → Validate All → Save to Parent State → Next Step
```

## Dependencies

- **@hookform/resolvers** - Zod integration for react-hook-form
- **isomorphic-dompurify** - XSS prevention
- **date-fns** - Date manipulation and formatting
- **react-select** - Enhanced dropdown components

## Integration Points

- Category API for dynamic stream categories
- Tag suggestions API for autocomplete
- User preferences API for default values
- Content moderation API for title/description checking

## Performance Considerations

```typescript
// Virtual scrolling for long tag lists
const TagInput = ({ tags, onAdd, onRemove }: TagInputProps) => {
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const loadSuggestions = useMemo(
    () => debounce(async (query: string) => {
      const results = await api.getTagSuggestions(query);
      setSuggestions(results);
    }, 300),
    []
  );

  return (
    <VirtualizedAutocomplete
      items={suggestions}
      onSelect={onAdd}
      loadMore={loadSuggestions}
      maxHeight={200}
    />
  );
};

// Memoized validation functions
const validateTitle = useMemo(() =>
  debounce((title: string) => {
    return streamDetailsSchema.shape.title.safeParse(title);
  }, 300),
  []
);

// Lazy validation on blur for complex fields
const { register, handleSubmit, formState: { errors, touchedFields } } = useForm({
  resolver: zodResolver(streamDetailsSchema),
  mode: 'onBlur', // Validate on blur, not on every keystroke
  reValidateMode: 'onChange'
});
```

## Error Handling

```typescript
const errorMessages = {
  title: {
    required: t('errors.title.required'),
    minLength: t('errors.title.minLength'),
    maxLength: t('errors.title.maxLength'),
    invalid: t('errors.title.invalid')
  },
  description: {
    maxLength: t('errors.description.maxLength'),
    unsafe: t('errors.description.unsafe')
  },
  category: {
    required: t('errors.category.required')
  },
  scheduledStartTime: {
    pastDate: t('errors.schedule.pastDate'),
    tooSoon: t('errors.schedule.tooSoon')
  },
  tags: {
    tooMany: t('errors.tags.tooMany'),
    invalid: t('errors.tags.invalid')
  }
};

// Progressive error display
const getFieldError = (field: string, errors: FieldErrors) => {
  const error = errors[field];
  if (!error) return null;
  if (error.type === 'required' && !touchedFields[field]) return null;
  return errorMessages[field]?.[error.type] || error.message;
};

// Inline validation feedback
const FieldWithValidation = ({ name, label, ...props }) => {
  const { field, fieldState } = useController({ name });
  const error = fieldState.error;
  const isValid = field.value && !error;

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium">{label}</label>
      <div className="relative">
        <input
          {...field}
          {...props}
          className={cn(
            "w-full px-3 py-2 border rounded-md",
            error && "border-red-500",
            isValid && "border-green-500"
          )}
        />
        {isValid && <CheckIcon className="absolute right-3 top-2.5 text-green-500" />}
      </div>
      {error && <p className="text-sm text-red-600">{error.message}</p>}
    </div>
  );
};
```

## Type Safety

```typescript
type StreamDetailsData = z.infer<typeof streamDetailsSchema>;

// Strongly typed form fields
const fields: Array<keyof StreamDetailsData> = [
  'title', 'description', 'category', 'language',
  'scheduledStartTime', 'isPrivate', 'allowChat',
  'tags', 'ageRestriction', 'recordStream'
];

// Category enum
const STREAM_CATEGORIES = [
  'education',
  'quran',
  'lecture',
  'discussion',
  'event',
  'other'
] as const;

type StreamCategory = typeof STREAM_CATEGORIES[number];

// Type-safe field configuration
interface FieldConfig<T extends keyof StreamDetailsData> {
  name: T;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'checkbox' | 'datetime' | 'tags';
  required: boolean;
  placeholder?: string;
  helpText?: string;
}
```

## Security Considerations

- **Input Sanitization**: All text fields sanitized with DOMPurify
- **HTML Stripping**: Remove HTML from description field
- **SQL Injection Prevention**: Parameterized queries on backend
- **Rate Limiting**: Limit auto-save to 1 request per 10 seconds
- **XSS Protection**: Escape user input in preview displays

```typescript
// Secure input handling
const sanitizeInput = (value: string, field: string): string => {
  // Remove dangerous characters
  let sanitized = DOMPurify.sanitize(value, {
    ALLOWED_TAGS: [], // No HTML allowed
    ALLOWED_ATTR: []
  });

  // Additional field-specific sanitization
  if (field === 'title') {
    sanitized = sanitized.replace(/[<>'"]/g, '');
  }

  return sanitized.trim();
};
```

## Testing Criteria

- [ ] Form validation shows errors correctly
- [ ] Character counters update in real-time
- [ ] Auto-save triggers after 30s idle
- [ ] All fields validate with correct messages
- [ ] Category dropdown loads dynamic values
- [ ] Tag input supports autocomplete
- [ ] Scheduled time validates future dates
- [ ] XSS protection prevents script injection
- [ ] Form submits with valid data
- [ ] Draft recovery works after refresh

## Acceptance Criteria

- [ ] All 10 form fields render correctly
- [ ] Real-time validation with Zod
- [ ] Character counters for title/description
- [ ] Tag input with autocomplete (max 10)
- [ ] Category selection from dynamic list
- [ ] DateTime picker for scheduled streams
- [ ] Checkbox controls for privacy/chat/recording
- [ ] Age restriction dropdown
- [ ] Error messages in both English/Arabic
- [ ] Auto-save draft every 30 seconds
- [ ] Success state enables "Next" button

## Related Tasks

- **Depends On**: Task 2.1 (GoLive Wizard)
- **Blocks**: Task 2.5 (Review Step)
- **Related**: Task 2.9 (Arabic RTL version)

## References

- [ADR-002: Phase 2 Architecture](/docs/architecture/ADR-002-phase2-golive-architecture.md#task-2-step-1-stream-details-form)
- [Zod Documentation](https://zod.dev/)
- [React Hook Form](https://react-hook-form.com/)

---

**Last Updated**: 2025-11-06
**Reviewed By**: N/A
**Implementation Status**: Not Started
