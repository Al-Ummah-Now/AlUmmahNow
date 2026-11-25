import { API_ERROR_CATALOGUE } from '@al-ummah/shared-types';
import { channelSaveError } from '../save-error';

describe('a refused channel save', () => {
  const texts = { handleTaken: 'taken', saveFailed: 'failed' };

  it('a handle change during a move says the channel is being moved, in the page language (AUN-CHANNEL-CLAIM §3.3)', () => {
    const refused = { status: 409, code: 'move_in_progress' };
    expect(channelSaveError(refused, texts, 'en')).toBe(API_ERROR_CATALOGUE.move_in_progress.en);
    expect(channelSaveError(refused, texts, 'ar')).toBe(API_ERROR_CATALOGUE.move_in_progress.ar);
  });

  it('a taken handle, and any other failure', () => {
    expect(channelSaveError({ status: 409, code: 'handle_unavailable', reason: 'taken' }, texts, 'en')).toBe('taken');
    expect(channelSaveError({ status: 409, code: 'handle_unavailable', reason: 'reserved' }, texts, 'en')).toBe('failed');
    expect(channelSaveError({ status: 500 }, texts, 'en')).toBe('failed');
  });
});
