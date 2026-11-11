/** Account warning notification text (accountWarning): the reason code becomes words in the viewer's language. */
describe('account warning notification text', () => {
  const { resolveNotificationText } = jest.requireActual('@/lib/websocket/notification-text');
  const { renderNotification, isCenterKey } = jest.requireActual('@/lib/notifications/render');
  const { EN_TRANSLATIONS } = jest.requireActual('@/lib/i18n/translations/en');
  const { AR_TRANSLATIONS } = jest.requireActual('@/lib/i18n/translations/ar');
  const event = (params: Record<string, string | number>) => ({
    type: 'notification',
    notificationId: 'n',
    userId: 'u',
    notificationType: 'system',
    notificationKey: 'accountWarning',
    params,
    actionUrl: '/community-guidelines',
  });

  it('renders in English with the reason in plain words and the warning count', () => {
    const { title, message } = resolveNotificationText(event({ reason: 'spam', count: 2 }), EN_TRANSLATIONS);
    expect(title).toBe('Your account received a warning');
    expect(message).toContain('Reason: spam or misleading content.');
    expect(message).toContain('Warnings on your account: 2.');
    expect(message).toContain('community guidelines');
  });

  it('renders in Arabic', () => {
    const { title, message } = resolveNotificationText(event({ reason: 'harassment', count: 1 }), AR_TRANSLATIONS);
    expect(title).toBe('تلقّى حسابك تحذيرًا');
    expect(message).toContain('السبب: التحرش أو التنمر.');
  });

  it('falls back to the general reason for an unknown code', () => {
    expect(resolveNotificationText(event({ reason: 'unknown', count: 1 }), EN_TRANSLATIONS).message).toContain('Reason: breaking the community guidelines.');
  });

  it('is a notification center key, rendered from a stored item', () => {
    expect(isCenterKey('accountWarning')).toBe(true);
    const { title } = renderNotification({ notificationKey: 'accountWarning', notificationType: 'system', params: { reason: 'copyright', count: 3 } }, EN_TRANSLATIONS);
    expect(title).toBe('Your account received a warning');
  });
});
