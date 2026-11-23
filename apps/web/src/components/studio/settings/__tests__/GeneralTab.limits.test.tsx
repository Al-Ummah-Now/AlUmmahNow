/**
 * Settings → General: the tier's name (admin text, often Latin) sits in its own <bdi> inside the
 * upload-limits sentence, so it keeps its direction in Arabic: «تسمح فئة قناتك «Creator» …».
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { AR_TRANSLATIONS } from '@/lib/i18n/translations/ar';
import { GeneralTab } from '../GeneralTab';

jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: AR_TRANSLATIONS, lang: 'ar', isRTL: true }) }));
jest.mock('@/hooks/useCreatorAccess', () => ({
  useCreatorAccess: () => ({ status: 'ready', access: { tier: { name: 'Creator' }, limits: { perHour: 300, perDay: 2000 } } }),
}));
jest.mock('@/lib/channels/team', () => ({ loadTeam: jest.fn() }));
jest.mock('@/lib/logger-client', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('@/components/channelManagement/DeleteChannelDialog', () => ({ DeleteChannelDialog: () => null }));

it('isolates the tier name in the Arabic limits sentence', () => {
  render(<GeneralTab locale="ar" role="owner" channel={{ id: 'ch1', name: 'حلقة الفجر' } as never} />);
  const card = screen.getByTestId('studio-general-limits');
  const bdi = card.querySelector('bdi');
  expect(bdi?.textContent).toBe('Creator');
  expect(card.textContent).toContain('«Creator»');
  expect(card.textContent).not.toContain('{tier}');
});
