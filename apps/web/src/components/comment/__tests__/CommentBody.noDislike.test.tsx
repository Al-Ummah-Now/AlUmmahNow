/**
 * Comment dislikes are turned off (owner decision 2026-11-12): a comment shows
 * a like button and no dislike control, in English and Arabic.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommentBody } from '../CommentBody';

let lang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: lang === 'ar'
      ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS
      : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang,
    locale: lang,
    isRTL: lang === 'ar',
  }),
}));

describe('CommentBody has no dislike control', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`shows only a like button (${locale})`, () => {
      lang = locale;
      const onLike = jest.fn();
      const { container } = render(
        <CommentBody
          dir={locale === 'ar' ? 'rtl' : 'ltr'}
          author="Noor"
          text="JazakAllah khair"
          time="1h"
          avatar=""
          likesCount={3}
          isLiked={false}
          canReact
          onLike={onLike}
        />
      );
      const buttons = screen.getAllByRole('button');
      expect(buttons).toHaveLength(1);
      const like = buttons[0];
      expect(like).toHaveAttribute('aria-pressed', 'false');
      expect(like).toHaveTextContent('3');
      expect(like.querySelector('svg')).toHaveClass('lucide-thumbs-up');
      expect(container.querySelector('.lucide-thumbs-down')).toBeNull();
      expect(screen.queryByRole('button', { name: /dislike|عدم إعجاب|عدم الإعجاب/i })).toBeNull();
      fireEvent.click(like);
      expect(onLike).toHaveBeenCalledTimes(1);
    });
  }
});
