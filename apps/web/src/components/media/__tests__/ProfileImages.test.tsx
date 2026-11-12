import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { AvatarImage, CoverImage, EditableAvatar, EditableCover, normalizeImageUrl } from '../ProfileImages';

const labels = { pick: 'Click to change cover', change: 'Change cover', remove: 'Remove cover' };
const COVER = 'https://images.alummahnow.net/5f09f3bb_cover.jpeg';

describe('normalizeImageUrl', () => {
  it('collapses the doubled slash old uploads saved after the host', () => {
    expect(normalizeImageUrl('https://images.alummahnow.net//4b623aeb_avatar.jpeg')).toBe('https://images.alummahnow.net/4b623aeb_avatar.jpeg');
    expect(normalizeImageUrl('https://images.alummahnow.net///x.jpeg')).toBe('https://images.alummahnow.net/x.jpeg');
  });

  it('keeps canonical, relative and in-path URLs as they are', () => {
    expect(normalizeImageUrl(COVER)).toBe(COVER);
    expect(normalizeImageUrl('/avatar.png')).toBe('/avatar.png');
    expect(normalizeImageUrl('https://cdn.example/a//b.png')).toBe('https://cdn.example/a//b.png');
  });

  it('treats empty and whitespace as no image', () => {
    expect(normalizeImageUrl('')).toBeUndefined();
    expect(normalizeImageUrl('  ')).toBeUndefined();
    expect(normalizeImageUrl(undefined)).toBeUndefined();
    expect(normalizeImageUrl(null)).toBeUndefined();
  });
});

describe('CoverImage / AvatarImage', () => {
  it('renders the cover as an <img> (no theme background rule can blank it)', () => {
    render(<CoverImage src={COVER} alt="Current cover photo" testId="cover" />);
    const img = screen.getByTestId('cover');
    expect(img.tagName).toBe('IMG');
    expect(img).toHaveAttribute('src', COVER);
    expect(img).toHaveAttribute('alt', 'Current cover photo');
  });

  it('renders nothing for a missing cover, and drops a cover that fails to load', () => {
    const { container, rerender } = render(<CoverImage src="" alt="" testId="cover" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CoverImage src={COVER} alt="" testId="cover" />);
    fireEvent.error(screen.getByTestId('cover'));
    expect(screen.queryByTestId('cover')).toBeNull();
  });

  it('falls back to the default avatar unless told not to', () => {
    const { rerender } = render(<AvatarImage src={undefined} alt="" testId="avatar" />);
    expect(screen.getByTestId('avatar')).toHaveAttribute('src', '/avatar.png');
    rerender(<AvatarImage src={undefined} alt="" testId="avatar" fallback={null} />);
    expect(screen.queryByTestId('avatar')).toBeNull();
  });
});

describe('EditableCover', () => {
  it('shows the current cover as a preview with Change and Remove', () => {
    const onPick = jest.fn();
    const onRemove = jest.fn();
    render(<EditableCover url={COVER} alt="cover" onPick={onPick} onRemove={onRemove} labels={labels} testId="ec" imageTestId="ec-img" />);
    expect(screen.getByTestId('ec-img')).toHaveAttribute('src', COVER);
    // The cover is a plain container: no button wraps the Change/Remove buttons (axe nested-interactive)
    expect(screen.getByTestId('ec')).not.toHaveAttribute('role');
    expect(screen.getByTestId('ec')).not.toHaveAttribute('tabindex');
    expect(screen.getByRole('button', { name: 'Change cover' })).toBe(screen.getByTestId('ec-change'));

    // Remove clears the cover without also opening the picker
    fireEvent.click(screen.getByTestId('ec-remove'));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('opens the picker from the cover area and the focusable Change button; no Remove without a cover', () => {
    const onPick = jest.fn();
    render(<EditableCover url="" alt="cover" onPick={onPick} onRemove={jest.fn()} labels={labels} testId="ec" imageTestId="ec-img" />);
    expect(screen.queryByTestId('ec-remove')).toBeNull();
    expect(screen.queryByTestId('ec-img')).toBeNull();
    fireEvent.click(screen.getByTestId('ec'));
    const change = screen.getByRole('button', { name: labels.pick });
    expect(change).not.toHaveAttribute('tabindex');
    fireEvent.click(change);
    expect(onPick).toHaveBeenCalledTimes(2);
  });
});

describe('EditableAvatar', () => {
  const avatarLabels = { pick: 'Click to change avatar', change: 'Change photo', remove: 'Remove photo' };

  it('shows the current photo unobstructed, with Change and Remove beside it', () => {
    const onRemove = jest.fn();
    render(<EditableAvatar url="https://images.alummahnow.net//a_avatar.jpeg" alt="me" onPick={jest.fn()} onRemove={onRemove} labels={avatarLabels} testId="ea" imageTestId="ea-img" placeholder={<span>P</span>} />);
    expect(screen.getByTestId('ea-img')).toHaveAttribute('src', 'https://images.alummahnow.net/a_avatar.jpeg');
    expect(screen.queryByText('P')).toBeNull();
    fireEvent.click(screen.getByTestId('ea-remove'));
    expect(onRemove).toHaveBeenCalled();
  });

  it('shows the placeholder and no Remove when there is no photo', () => {
    render(<EditableAvatar url={undefined} alt="me" onPick={jest.fn()} onRemove={jest.fn()} labels={avatarLabels} testId="ea" imageTestId="ea-img" placeholder={<span>P</span>} />);
    expect(screen.getByText('P')).toBeInTheDocument();
    expect(screen.queryByTestId('ea-remove')).toBeNull();
    expect(screen.getByTestId('ea-change')).toHaveTextContent(avatarLabels.pick);
  });
});
