import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BilingualPair } from '../BilingualPair';
import { registerTranslator, TranslateFailure } from '@/lib/i18n/translate-text';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', isRTL: false }),
}));

function Titles({ withTicks = false, initial = { en: 'Lesson', ar: '' } }: { withTicks?: boolean; initial?: { en: string; ar: string } }) {
  const [values, setValues] = useState(initial);
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

  it('passes what is translated, and says to review it', async () => {
    const translator = jest.fn(async () => 'الدرس');
    render(<Titles />);
    act(() => registerTranslator(translator));
    await act(async () => {
      fireEvent.click(screen.getByTestId('pair-translate-ar'));
    });
    expect(translator).toHaveBeenCalledWith('Lesson', 'en', 'ar', { field: 'title' });
    expect(screen.getByTestId('pair-translate-note-ar')).toHaveTextContent('Machine translation: review it before saving.');
  });

  it('asks before replacing text already in the field, and keeps it on "Keep mine"', async () => {
    render(<Titles initial={{ en: 'Lesson', ar: 'عنواني' }} />);
    act(() => registerTranslator(async () => 'الدرس'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('pair-translate-ar'));
    });
    expect(screen.getByText('Replace your text?')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
    });
    expect(screen.getByTestId('field-ar')).toHaveValue('عنواني');

    await act(async () => {
      fireEvent.click(screen.getByTestId('pair-translate-ar'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    });
    expect(screen.getByTestId('field-ar')).toHaveValue('الدرس');
  });

  it("explains today's limit with its reset time and a spent budget; switched off says nothing", async () => {
    let failure: Error = new TranslateFailure('fair_use_limit', '2026-11-15T00:00:00.000Z');
    render(<Titles />);
    act(() => registerTranslator(async () => {
      throw failure;
    }));
    await act(async () => {
      fireEvent.click(screen.getByTestId('pair-translate-ar'));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/You’ve used today’s translations\. More at \S/);
    failure = new TranslateFailure('feature_off');
    await act(async () => {
      fireEvent.click(screen.getByTestId('pair-translate-ar'));
    });
    expect(screen.queryByRole('alert')).toBeNull();
    failure = new TranslateFailure('budget_spent');
    await act(async () => {
      fireEvent.click(screen.getByTestId('pair-translate-ar'));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Translations are used up for today. Try again tomorrow.');
    failure = new Error('boom');
    await act(async () => {
      fireEvent.click(screen.getByTestId('pair-translate-ar'));
    });
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn’t translate. Try again.");
    expect(screen.getByTestId('field-ar')).toHaveValue('');
  });

  it('notes that Quran in {…} was kept, but not for a {n} pattern', async () => {
    render(<Titles initial={{ en: 'Read {قل هو الله أحد} daily', ar: '' }} />);
    act(() => registerTranslator(async () => 'اقرأ {قل هو الله أحد} يوميًا'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('pair-translate-ar'));
    });
    expect(screen.getByTestId('pair-translate-note-ar')).toHaveTextContent('Quran in {…} was kept as written.');
  });
});
