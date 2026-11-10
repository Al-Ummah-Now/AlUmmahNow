import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import PlaylistDetailsFields, { EMPTY_PLAYLIST_DETAILS, PlaylistSortFields, type PlaylistDetailsValue } from '../PlaylistDetailsFields';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', isRTL: false }),
}));

function Harness({ onValue, sortOnly }: { onValue: (v: PlaylistDetailsValue) => void; sortOnly?: boolean }) {
  const [value, setValue] = useState(EMPTY_PLAYLIST_DETAILS);
  const change = (next: PlaylistDetailsValue) => { setValue(next); onValue(next); };
  return sortOnly
    ? <PlaylistSortFields value={value} onChange={change} idPrefix="t" />
    : <PlaylistDetailsFields value={value} onChange={change} idPrefix="t" />;
}

it('new playlists start manual, public, without field controls', () => {
  render(<Harness onValue={jest.fn()} />);
  expect(screen.getByRole('radio', { name: /Manual/ })).toBeChecked();
  expect(screen.getByRole('radio', { name: /^Public/ })).toBeChecked();
  expect(screen.queryByTestId('sort-field')).toBeNull();
});

it('automatic order: choose the field and the direction, labelled for the field', () => {
  const onValue = jest.fn();
  render(<Harness onValue={onValue} sortOnly />);
  fireEvent.click(screen.getByRole('radio', { name: /Automatic/ }));
  expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ sortMode: 'auto', sortField: 'added', sortDirection: 'desc' }));
  expect(screen.getByTestId('sort-direction-desc')).toHaveTextContent('Newest first');
  expect(screen.getByTestId('sort-direction-desc')).toHaveAttribute('aria-pressed', 'true');

  fireEvent.change(screen.getByTestId('sort-field'), { target: { value: 'title' } });
  expect(screen.getByTestId('sort-direction-asc')).toHaveTextContent('A to Z');
  fireEvent.click(screen.getByTestId('sort-direction-asc'));
  expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ sortMode: 'auto', sortField: 'title', sortDirection: 'asc' }));

  fireEvent.change(screen.getByTestId('sort-field'), { target: { value: 'views' } });
  expect(screen.getByTestId('sort-direction-desc')).toHaveTextContent('Most views first');
  fireEvent.change(screen.getByTestId('sort-field'), { target: { value: 'duration' } });
  expect(screen.getByTestId('sort-direction-asc')).toHaveTextContent('Shortest first');
  fireEvent.change(screen.getByTestId('sort-field'), { target: { value: 'published' } });
  expect(screen.getByTestId('sort-direction-asc')).toHaveTextContent('Oldest first');
  // Every field is offered
  expect(Array.from((screen.getByTestId('sort-field') as HTMLSelectElement).options).map((o) => o.value)).toEqual(['added', 'published', 'title', 'views', 'duration']);
});

it('back to manual hides the field controls', () => {
  const onValue = jest.fn();
  render(<Harness onValue={onValue} sortOnly />);
  fireEvent.click(screen.getByRole('radio', { name: /Automatic/ }));
  fireEvent.click(screen.getByRole('radio', { name: /Manual/ }));
  expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ sortMode: 'manual' }));
  expect(screen.queryByTestId('sort-field')).toBeNull();
});
