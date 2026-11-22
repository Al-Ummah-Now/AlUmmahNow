/**
 * The text post editor takes the post's own direction, not the page's: an Arabic post edited on the
 * English Studio reads right to left with «؟» at its end (owner review frames).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { TextPostForm } from '../TextPostForm';

describe('TextPostForm direction', () => {
  it.each(['en', 'ar'])('the editor is dir=auto on the %s page', (locale) => {
    render(<TextPostForm content="يتناول درسنا القادم قصة أصحاب الكهف. ما الذي تودّون أن نشرحه أولًا؟" onChange={() => undefined} locale={locale} />);
    expect(screen.getByTestId('post-content-editor')).toHaveAttribute('dir', 'auto');
  });
});
