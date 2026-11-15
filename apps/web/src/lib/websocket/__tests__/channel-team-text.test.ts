/** Channel team notifications (docs/specs/CHANNEL-ROLES.md §10): keys + params, the role code read as the reader's role name. */
describe('channel team notification text', () => {
  const { resolveNotificationText } = jest.requireActual('@/lib/websocket/notification-text');
  const { isCenterKey } = jest.requireActual('@/lib/notifications/render');
  const { EN_TRANSLATIONS } = jest.requireActual('@/lib/i18n/translations/en');
  const { AR_TRANSLATIONS } = jest.requireActual('@/lib/i18n/translations/ar');
  const event = (notificationKey: string, params: Record<string, string>) => ({
    type: 'notification', notificationId: 'n', userId: 'u', notificationType: 'system', notificationKey, params,
  });

  it('every team key is a notification-center key', () => {
    for (const key of ['channelInviteReceived', 'channelInviteAccepted', 'channelRoleChanged', 'channelMemberRemoved', 'channelMemberLeft']) {
      expect(isCenterKey(key)).toBe(true);
    }
  });

  it('renders the invitation in English with the role name, not the code', () => {
    const { message } = resolveNotificationText(event('channelInviteReceived', { inviter: 'Amina', channel: 'Community Corner', role: 'moderator' }), EN_TRANSLATIONS);
    expect(message).toBe('Amina invited you to Community Corner as Channel moderator.');
  });

  it('renders in Arabic with the Arabic role name', () => {
    const { message } = resolveNotificationText(event('channelRoleChanged', { channel: 'ركن المجتمع', role: 'editor' }), AR_TRANSLATIONS);
    expect(message).toContain('محرر');
    expect(message).toContain('ركن المجتمع');
    expect(message).not.toContain('editor');
  });

  it('removal, leaving and acceptance read their params', () => {
    expect(resolveNotificationText(event('channelMemberRemoved', { channel: 'Corner' }), EN_TRANSLATIONS).message).toBe('You no longer have access to Corner.');
    expect(resolveNotificationText(event('channelMemberLeft', { member: 'Omar', channel: 'Corner' }), EN_TRANSLATIONS).message).toBe('Omar left Corner.');
    expect(resolveNotificationText(event('channelInviteAccepted', { member: 'Sara', channel: 'Corner', role: 'admin' }), EN_TRANSLATIONS).message).toBe('Sara joined Corner as Channel admin.');
  });
});
