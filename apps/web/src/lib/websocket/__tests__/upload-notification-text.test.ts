/** Upload result notification text (uploadReady / uploadFailed). */
describe('upload result notification text', () => {
  const { resolveNotificationText } = jest.requireActual('@/lib/websocket/notification-text');
  const { EN_TRANSLATIONS } = jest.requireActual('@/lib/i18n/translations/en');
  const { AR_TRANSLATIONS } = jest.requireActual('@/lib/i18n/translations/ar');
  const event = (notificationKey: string) => ({
    type: 'notification',
    notificationId: 'n',
    userId: 'u',
    notificationType: 'upload',
    notificationKey,
    params: { videoTitle: 'Tafsir 1' },
  });

  it('uses the current copy even when a stored translation file still has the old realtime strings', () => {
    const stored = {
      ...EN_TRANSLATIONS,
      notifications: {
        ...EN_TRANSLATIONS.notifications,
        realtime: { ...EN_TRANSLATIONS.notifications.realtime, uploadReadyMessage: 'Your video "{videoTitle}" has finished processing' },
      },
    };
    expect(resolveNotificationText(event('uploadReady'), stored)).toEqual({ title: 'Video ready', message: 'Your video "Tafsir 1" is ready to watch' });
    expect(resolveNotificationText(event('uploadFailed'), stored)).toEqual({ title: 'Processing failed', message: '"Tafsir 1" couldn\'t be processed' });
  });

  it('renders in Arabic', () => {
    expect(resolveNotificationText(event('uploadReady'), AR_TRANSLATIONS).message).toBe('المرئي «Tafsir 1» جاهز للمشاهدة');
  });
});
