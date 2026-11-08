/**
 * #289: older videos carry the channel's display name in the legacy `channel`
 * field (on production every recent video has channel: "Mostafa Elbadry").
 * The watch page linked /channels/<that name>, which asked the API for
 * GET /api/channels/Mostafa%20Elbadry and got a 404.
 */
import { playerChannelHref, playerChannelId, playerChannelName } from '../player-channel';

const legacy = { channel: 'Mostafa Elbadry', channelName: '', channelId: '57876fcd-b828-43d4-9464-2ece1dcb4d4a' };

describe('watch page channel', () => {
  it('links to the channel id, never the legacy channel name', () => {
    expect(playerChannelId(legacy)).toBe('57876fcd-b828-43d4-9464-2ece1dcb4d4a');
    expect(playerChannelHref('en', legacy)).toBe('/en/channels/57876fcd-b828-43d4-9464-2ece1dcb4d4a');
    expect(playerChannelHref('ar', legacy)).toBe('/ar/channels/57876fcd-b828-43d4-9464-2ece1dcb4d4a');
  });

  it('has no link when the video has no channel id', () => {
    expect(playerChannelHref('en', { channelId: null })).toBeUndefined();
    expect(playerChannelHref('en', { channelId: '' })).toBeUndefined();
  });

  it('shows channelName, falling back to the legacy name', () => {
    expect(playerChannelName(legacy)).toBe('Mostafa Elbadry');
    expect(playerChannelName({ channel: 'Old', channelName: 'Lectures' })).toBe('Lectures');
  });
});
