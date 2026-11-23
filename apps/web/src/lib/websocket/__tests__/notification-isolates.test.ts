/**
 * An excerpt inside a notification line is its own bidi isolate: an English post excerpt in the
 * Arabic «نشرت …: …» line keeps its full stop at its own end (owner review frames).
 */
import { AR_TRANSLATIONS } from '@/lib/i18n/translations/ar';
import { isolateParams, resolveNotificationText } from '../notification-text';

describe('notification excerpts are bidi isolates', () => {
  it('wraps excerpts only: names, words and numbers stay bare', () => {
    expect(isolateParams({ channelName: 'Noor', postExcerpt: 'Hello.', count: 3 })).toEqual({ channelName: 'Noor', postExcerpt: '⁨Hello.⁩', count: 3 });
  });

  it('an English excerpt in the Arabic new-post line', () => {
    const { message } = resolveNotificationText(
      { type: 'notification', notificationId: '', userId: '', notificationKey: 'newPost', notificationType: 'community', params: { channelName: 'حلقة الفجر للتذكير والتفسير', postExcerpt: 'Assalamu alaikum everyone.' } } as never,
      AR_TRANSLATIONS,
      'ar',
    );
    expect(message).toBe('نشرت حلقة الفجر للتذكير والتفسير: ⁨Assalamu alaikum everyone.⁩');
  });
});
