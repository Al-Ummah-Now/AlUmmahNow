/** Channel moves (wiki AUN-CHANNEL-CLAIM §3.6): both owners' notices, in the reader's language, and the channel list reload. */
describe('channel move notifications', () => {
  const { resolveNotificationText } = jest.requireActual('@/lib/websocket/notification-text');
  const { isCenterKey } = jest.requireActual('@/lib/notifications/render');
  const { changesChannelAccess } = jest.requireActual('@/lib/notifications/channel-access');
  const { EN_TRANSLATIONS } = jest.requireActual('@/lib/i18n/translations/en');
  const { AR_TRANSLATIONS } = jest.requireActual('@/lib/i18n/translations/ar');
  // Names are isolated (FSI … PDI), so either script keeps its own order inside the other
  const n = (name: string) => `\u2068${name}\u2069`;
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
    expect(resolveNotificationText(event('channelHandleChangedByTeam', { channel: 'Corner', handle: 'corner2' }), EN_TRANSLATIONS).message).toBe(`The Al Ummah Now team changed the handle of ${n('Corner')} to ${n('@corner2')}.`);
    expect(isCenterKey('channelHandleChangedByTeam')).toBe(true);
  });

  it('an owner’s offer reads with their name, in English and Arabic (CC-6)', () => {
    expect(isCenterKey('channelMoveOffered')).toBe(true);
    const params = { channel: 'Corner (Kids)', owner: 'Amina', member: 'أمينة' };
    const said = {
      channelMoveOffered: [`${n('Amina')} wants to hand ${n('Corner (Kids)')} over to you. Open it to accept or decline.`, `وصلك عرض من ${n('Amina')} لنقل القناة ${n('Corner (Kids)')} إليك. يمكنك قبول العرض أو رفضه.`],
      channelMoveAccepted: [`${n('أمينة')} accepted, and ${n('Corner (Kids)')} is now theirs.`, `قُبل عرضك، وانتقلت ملكية القناة ${n('Corner (Kids)')} إلى ${n('أمينة')}.`],
      channelMoveDeclined: [`${n('أمينة')} declined to take over ${n('Corner (Kids)')}.`, `رُفض عرضك نقل القناة ${n('Corner (Kids)')} إلى ${n('أمينة')}.`],
      channelMoveCancelled: [`The offer to take over ${n('Corner (Kids)')} is no longer open.`, `سُحب عرض نقل القناة ${n('Corner (Kids)')} إليك.`],
      channelMoveStopped: [`The Al Ummah Now team stopped the move of ${n('Corner (Kids)')}.`, `أوقف فريق الأمة الآن نقل القناة ${n('Corner (Kids)')}.`],
    };
    for (const [key, [en, ar]] of Object.entries(said)) {
      expect(isCenterKey(key)).toBe(true);
      expect(resolveNotificationText(event(key, params), EN_TRANSLATIONS).message).toBe(en);
      expect(resolveNotificationText(event(key, params), AR_TRANSLATIONS, 'ar').message).toBe(ar);
    }
    expect(changesChannelAccess('channelMoveAccepted')).toBe(true);
  });

  it('reads in English', () => {
    expect(resolveNotificationText(event('channelMovedIn', { channel: 'Corner' }), EN_TRANSLATIONS).message).toBe(`You are now the owner of ${n('Corner')}.`);
    expect(resolveNotificationText(event('channelMovedOutByTeam', { channel: 'Corner' }), EN_TRANSLATIONS).message).toBe(`The Al Ummah Now team moved your channel ${n('Corner')} to another account.`);
    expect(resolveNotificationText(event('channelMovedOutByTeamWithReason', { channel: 'Corner', reason: 'Asked\u202e by\nemail\u2069' }), EN_TRANSLATIONS).message).toBe(`The Al Ummah Now team moved your channel ${n('Corner')} to another account. Reason: ${n('Asked by email')}`);
  });

  it('reads in Arabic, with the Arabic channel name', () => {
    const { title, message } = resolveNotificationText(event('channelMovedIn', { channel: 'Corner', channel_ar: 'الركن' }), AR_TRANSLATIONS, 'ar');
    expect(title).toBe('أصبحت مالك قناة');
    expect(message).toBe(`أصبحت الآن مالك القناة ${n('الركن')}.`);
    expect(resolveNotificationText(event('channelMovedOutByTeam', { channel: 'Corner' }), AR_TRANSLATIONS, 'ar').message).toBe(`نقل فريق الأمة الآن قناتك ${n('Corner')} إلى حساب آخر.`);
  });
});
