/**
 * The category picker reads the live (admin-managed) list: a new category is
 * offered, a retired one is not, except as the current value of the form.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { CategorySelector } from '../CategorySelector';
import { resetCategoriesForTests } from '@/lib/api/categories';

jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ isRTL: false, lang: 'en', locale: 'en' }) }));
jest.mock('@/lib/runtime-config', () => ({ getApiUrl: () => 'https://api.test' }));
jest.mock('@/lib/logger-client', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

const categories = [
  { value: 'seerah_for_kids', label: { en: 'Seerah for kids', ar: 'السيرة للأطفال' }, position: 5, retired: false },
  { value: 'fiqh', label: { en: 'Fiqh', ar: 'الفقه' }, position: 50, retired: false },
  { value: 'islamic_news', label: { en: 'Islamic News', ar: 'أخبار إسلامية' }, position: 120, retired: true },
];

beforeEach(() => {
  resetCategoriesForTests();
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, result: { categories } }) })) as unknown as typeof fetch;
});

const options = () => Array.from(screen.getByTestId('category-select').querySelectorAll('option'));
const optionValues = () => options().map((o) => o.value);

it('offers the active categories of the live list', async () => {
  render(<CategorySelector onChange={() => undefined} />);
  await waitFor(() => expect(optionValues()).toEqual(['', 'seerah_for_kids', 'fiqh']));
});

it('keeps a retired category the video already has, with its label', async () => {
  render(<CategorySelector value="islamic_news" onChange={() => undefined} />);
  await waitFor(() => expect(optionValues()).toEqual(['', 'seerah_for_kids', 'fiqh', 'islamic_news']));
  expect(options().find((o) => o.value === 'islamic_news')?.textContent).toBe('Islamic News');
  expect((screen.getByTestId('category-select') as HTMLSelectElement).value).toBe('islamic_news');
});
