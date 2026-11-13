import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { AlreadyUploadedPanel } from '../AlreadyUploadedPanel';

jest.mock('@/components/common/AppLink', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

let mockLang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: mockLang === 'ar'
      ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS
      : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: mockLang,
    isRTL: mockLang === 'ar',
  }),
}));

function panel() {
  const onUploadAgain = jest.fn();
  const onChooseAnother = jest.fn();
  render(<AlreadyUploadedPanel fileName="lecture-1.mp4" videoId="vid-9" onUploadAgain={onUploadAgain} onChooseAnother={onChooseAnother} />);
  return { onUploadAgain, onChooseAnother };
}

describe('AlreadyUploadedPanel', () => {
  it('says the file is already uploaded, links to its video and offers to upload it again (en)', () => {
    mockLang = 'en';
    const { onUploadAgain, onChooseAnother } = panel();
    expect(screen.getByRole('region', { name: 'Already uploaded' })).toBeInTheDocument();
    expect(screen.getByTestId('upload-already-uploaded-hint')).toHaveTextContent('lecture-1.mp4 · You already uploaded this file.');
    expect(screen.getByRole('link', { name: 'View video' })).toHaveAttribute('href', '/en/video/vid-9');
    fireEvent.click(screen.getByRole('button', { name: 'Upload again as a new video' }));
    expect(onUploadAgain).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Choose another file' }));
    expect(onChooseAnother).toHaveBeenCalledTimes(1);
  });

  it('is translated in Arabic, with an Arabic watch link', () => {
    mockLang = 'ar';
    panel();
    expect(screen.getByRole('region', { name: 'تم رفعه من قبل' })).toBeInTheDocument();
    expect(screen.getByTestId('upload-already-uploaded-hint')).toHaveTextContent('سبق أن رفعت هذا الملف.');
    expect(screen.getByRole('link', { name: 'مشاهدة الفيديو' })).toHaveAttribute('href', '/ar/video/vid-9');
    expect(screen.getByRole('button', { name: 'ارفعه مرة أخرى كفيديو جديد' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'اختر ملفًا آخر' })).toBeInTheDocument();
  });
});
