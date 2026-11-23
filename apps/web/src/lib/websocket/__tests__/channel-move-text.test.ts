/** Channel moves (wiki AUN-CHANNEL-CLAIM §3.6): both owners' notices, in the reader's language, and the channel list reload. */
describe('channel move notifications', () => {
  const { resolveNotificationText } = jest.requireActual('@/lib/websocket/notification-text');
  const { isCenterKey } = jest.requireActual('@/lib/notifications/render');
  const { changesChannelAccess } = jest.requireActual('@/lib/notifications/channel-access');
  const { EN_TRANSLATIONS } = jest.requireActual('@/lib/i18n/translations/en');
  const { AR_TRANSLATIONS } = jest.requireActual('@/lib/i18n/translations/ar');
  const event = (notificationKey: string, params: Record<string, string>) => ({
    type: 'notification', notificationId: 'n', userId: 'u', notificationType: 'system', notificationKey, params,
  });

  it('both keys are notification-center keys and reload the channel list', () => {
    for (const key of ['channelMovedIn', 'channelMovedOutByTeam']) {
      expect(isCenterKey(key)).toBe(true);
      expect(changesChannelAccess(key)).toBe(true);
    }
    expect(changesChannelAccess('newVideo')).toBe(false);
  });

  it('a handle the team changed reads with the new @handle', () => {
    expect(resolveNotificationText(event('channelHandleChangedByTeam', { channel: 'Corner', handle: 'corner2' }), EN_TRANSLATIONS).message).toBe('The Al Ummah Now team changed the handle of Corner to @corner2.');
    expect(isCenterKey('channelHandleChangedByTeam')).toBe(true);
  });

  it('reads in English', () => {
    expect(resolveNotificationText(event('channelMovedIn', { channel: 'Corner' }), EN_TRANSLATIONS).message).toBe('You are now the owner of Corner.');
    expect(resolveNotificationText(event('channelMovedOutByTeam', { channel: 'Corner' }), EN_TRANSLATIONS).message).toBe('The Al Ummah Now team moved your channel Corner to another account.');
  });

  it('reads in Arabic, with the Arabic channel name', () => {
    const { title, message } = resolveNotificationText(event('channelMovedIn', { channel: 'Corner', channel_ar: 'الركن' }), AR_TRANSLATIONS, 'ar');
    expect(title).toBe('أصبحت مالك قناة');
    expect(message).toBe('أصبحت الآن مالك القناة الركن.');
    expect(resolveNotificationText(event('channelMovedOutByTeam', { channel: 'Corner' }), AR_TRANSLATIONS, 'ar').message).toBe('نقل فريق الأمة الآن قناتك Corner إلى حساب آخر.');
  });
});
