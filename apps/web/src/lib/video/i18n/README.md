# Video player i18n

```ts
const { t, dir, plural } = useVideoPlayerI18n(lang);
plural('videos', 5); // "5 videos", "٥ مقاطع فيديو"
```

## Plurals

Add a table under `pluralization` in `translations/en.ts` and `ar.ts`. `other` is required. English needs `one` and `other`; Arabic also uses `zero`, `one`, `two`, `few` and `many`. `{{count}}` becomes the localized number. Outside React, call `plural(lang, key, count)`.

## Validating a language from outside the code

`isValidLanguage` narrows a string from a URL, cookie or API to `SupportedLanguage`:

```ts
const lang = isValidLanguage(saved) ? saved : 'en';
```

`isLanguageSupported` is the same check, kept for existing callers.

## Regional date formats

`ErrorDisplay` takes an optional `locale` (`ar-EG`, `en-GB`, ...). Without it, dates use `ar-SA` or `en-US`.
