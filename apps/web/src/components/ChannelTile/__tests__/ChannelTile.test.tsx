import React from 'react';
import { render, screen } from '@testing-library/react';
import { ChannelTile } from '../index';

const language = { lang: 'en', locale: 'en', dir: 'ltr', isRTL: false, t: { discovery: { verified: 'Verified' } } };
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => language }));
jest.mock('next/image', () => ({ __esModule: true, default: () => null }));

const channel = { id: 'c1', name: 'Moving Recitations', description: '', avatarUrl: '', coverUrl: '', isVerified: false, subscribersCount: 2000, videosCount: 8 };

describe('ChannelTile', () => {
  it('wraps a long name to two lines instead of cutting it on one', () => {
    render(<ChannelTile channel={channel as never} variant="compact" />);
    const name = screen.getByTestId('channel-tile-name');
    expect(name).toHaveTextContent('Moving Recitations');
    expect(name).toHaveClass('line-clamp-2', 'break-words');
    expect(name).not.toHaveClass('truncate');
  });

  it('puts each count on its own line, kept with its noun, with no separator to leave dangling', () => {
    render(<ChannelTile channel={channel as never} variant="compact" />);
    const counts = screen.getByTestId('channel-tile-counts');
    expect(counts).toHaveClass('flex-col');
    expect(counts.textContent).not.toContain('•');
    const parts = [...counts.children] as HTMLElement[];
    expect(parts.map((p) => p.textContent)).toEqual(['2K subscribers', '8 videos']);
    for (const part of parts) expect(part).toHaveClass('whitespace-nowrap');
  });
});
