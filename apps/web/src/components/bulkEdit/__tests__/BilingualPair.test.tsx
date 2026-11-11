import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BilingualPair } from '../BilingualPair';
import { registerTranslator } from '@/lib/i18n/translate-text';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', isRTL: false }),
}));

function Titles({ withTicks = false }: { withTicks?: boolean }) {
  const [values, setValues] = useState({ en: 'Lesson', ar: '' });
  const [ticked, setTicked] = useState({ en: true, ar: false });
  return (
    <BilingualPair
      legend="Titles"
      labels={{ en: 'English title', ar: 'Arabic title' }}
      {...(withTicks ? { ticked, onTick: (l, on) => setTicked((t) => ({ ...t, [l]: on })) } : {})}
      textOf={(l) => values[l]}
      onTranslated={(l, text) => setValues((v) => ({ ...v, [l]: text }))}
      idPrefix="t"
      testId="pair"
    >
      {(l, { heading }) => (
        <input aria-labelledby={heading} dir={l === 'ar' ? 'rtl' : 'ltr'} lang={l} value={values[l]}
          onChange={(e) => setValues((v) => ({ ...v, [l]: e.target.value }))} data-testid={`field-${l}`} />
      )}
    </BilingualPair>
  );
}

describe('BilingualPair', () => {
  afterEach(() => act(() => registerTranslator(null)));

  it('shows English and Arabic together, each field named by its column', () => {
    render(<Titles />);
    expect(screen.getByRole('group', { name: 'Titles' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'English title' })).toHaveAttribute('lang', 'en');
    const ar = screen.getByRole('textbox', { name: 'Arabic title' });
    expect(ar).toHaveAttribute('dir', 'rtl');
    expect(ar).toHaveAttribute('lang', 'ar');
  });

  it('lets each language be ticked on its own', () => {
    render(<Titles withTicks />);
    expect(screen.queryByTestId('field-ar')).toBeNull();
    fireEvent.click(screen.getByTestId('pair-tick-ar'));
    expect(screen.getByTestId('field-ar')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pair-tick-en'));
    expect(screen.queryByTestId('field-en')).toBeNull();
  });

  it('translates from the other language once a translator is registered', async () => {
    render(<Titles />);
    expect(screen.queryByTestId('pair-translate-ar')).toBeNull();
    act(() => registerTranslator(async (text) => (text === 'Lesson' ? 'الدرس' : text)));
    expect(screen.getByTestId('pair-translate-en')).toBeDisabled();
    await act(async () => {
      fireEvent.click(screen.getByTestId('pair-translate-ar'));
    });
    expect(screen.getByTestId('field-ar')).toHaveValue('الدرس');
  });
});
