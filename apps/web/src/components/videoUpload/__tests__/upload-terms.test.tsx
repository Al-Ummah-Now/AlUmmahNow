/** The single upload form while the creator Terms refuse it (#1929): idle for the page, and it starts once they are accepted. */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EN_TRANSLATIONS as mockEn } from '@al-ummah/shared-types';
import VideoUpload from '..';

const mockInitiate = jest.fn();
const mockMark = jest.fn();
const mockT = { ...mockEn };
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: mockT, lang: 'en', dir: 'ltr', isRTL: false }) }));
jest.mock('@/hooks/useCreatorAccess', () => ({ markCreatorTermsRequired: () => mockMark(), refreshCreatorAccess: jest.fn() }));
jest.mock('@/lib/api/upload-client', () => ({ initiateVideoUpload: (...a: unknown[]) => mockInitiate(...a), completeVideoUpload: jest.fn(), scheduleUploadedVideo: jest.fn() }));
jest.mock('@/lib/upload/resilient-tus', () => ({ ResilientUpload: class { async start() { return undefined; } async abort() { return undefined; } }, grantedUploadUrl: jest.fn(), reportUploadFailure: jest.fn(), requestUploadResume: jest.fn(), tusEndpointFor: () => 'https://api.test/tus' }));
jest.mock('@/lib/upload/fingerprint', () => ({ tryFileFingerprint: jest.fn().mockResolvedValue('fp') }));
jest.mock('@/lib/upload/picked-file', () => ({ checkPickedFile: jest.fn().mockResolvedValue({ kind: 'new' }) }));
jest.mock('@/lib/upload/resume-store', () => ({ findRememberedUpload: () => null, forgetUpload: jest.fn(), rememberUpload: jest.fn() }));
jest.mock('@/lib/auth/client-token', () => ({ fetchClientAuthToken: jest.fn(), getClientAuthHeaders: jest.fn() }));
jest.mock('@/lib/runtime-config', () => ({ getApiUrl: () => 'https://api.test' }));
jest.mock('@/lib/logger-client', () => ({ logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
const mockReport = jest.fn((..._a: unknown[]) => 'REF');
jest.mock('@/lib/upload/report-upload-error', () => ({ ...jest.requireActual('@/lib/upload/report-upload-error'), reportUploadError: (...a: unknown[]) => mockReport(...a) }));
jest.mock('@/lib/version-skew/VersionSkewProvider', () => ({ useHoldReloadWhile: jest.fn() }));
jest.mock('@/hooks/useLeaveGuard', () => ({ useLeaveGuard: () => null }));
jest.mock('@/hooks/useFeatures', () => ({ useFeatures: () => ({ features: {} }) }));
jest.mock('@/hooks/useCategorySuggestion', () => ({ useCategorySuggestion: () => ({ suggestion: null, loading: false }) }));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('../ThumbnailUploadSection', () => ({ ThumbnailUploadSection: () => null }));
jest.mock('../CategorySelector', () => ({ CategorySelector: () => null }));
jest.mock('../TemplateSelector', () => ({ TemplateSelector: () => null }));
jest.mock('../ScheduleDateTimeSelector', () => ({ ScheduleDateTimeSelector: () => null }));
jest.mock('../PlaylistPicker', () => ({ PlaylistPicker: () => null }));

const refused = { success: false, status: 403, code: 'terms_required', error: 'x' };
const onWorkChange = jest.fn();
const onError = jest.fn();
const form = (termsAccepted: number) => <VideoUpload channel={{ id: 'ch1', name: 'Noor' }} onUploadComplete={jest.fn()} onProgress={jest.fn()} onError={onError} onWorkChange={onWorkChange} termsAccepted={termsAccepted} />;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

async function submit() {
  const view = render(form(0));
  fireEvent.change(screen.getByTestId('upload-file-input'), { target: { files: [new File(['x'], 'lesson.mp4', { type: 'video/mp4' })] } });
  fireEvent.change(await screen.findByTestId('upload-title-en'), { target: { value: 'Lesson 7' } });
  fireEvent.click(screen.getByTestId('upload-submit'));
  await waitFor(() => expect(mockInitiate).toHaveBeenCalledTimes(1));
  await flush();
  return view;
}

beforeEach(() => jest.clearAllMocks());

it('refused: said in its words, not reported, and the page may ask; accepting uploads the same video', async () => {
  mockInitiate.mockResolvedValue(refused);
  const { rerender } = await submit();
  expect(onError).toHaveBeenLastCalledWith(mockEn.creator.termsRequired);
  expect(mockMark).toHaveBeenCalledTimes(1);
  expect(mockReport).not.toHaveBeenCalled();
  expect(onWorkChange).toHaveBeenLastCalledWith({ hasFile: true, busy: false });
  // The form is as it was: nothing says the upload failed
  expect(screen.getByTestId('upload-title-en')).toHaveValue('Lesson 7');
  expect(screen.getByTestId('upload-submit')).toBeEnabled();
  expect(screen.queryByTestId('upload-error')).toBeNull();
  mockInitiate.mockResolvedValue({ success: true, result: { videoId: 'v1', tusSessionId: 's', authToken: 't', chunkSize: 1, resumable: true } });
  rerender(form(1));
  await waitFor(() => expect(mockInitiate).toHaveBeenCalledTimes(2));
  expect(mockInitiate.mock.calls[1]).toEqual(mockInitiate.mock.calls[0]);
  await flush();
  expect(onWorkChange).toHaveBeenLastCalledWith({ hasFile: true, busy: true });
});

it('refused again, it waits for the next acceptance', async () => {
  mockInitiate.mockResolvedValue(refused);
  const { rerender } = await submit();
  rerender(form(1));
  await flush();
  expect(mockInitiate).toHaveBeenCalledTimes(2);
  rerender(form(1));
  await flush();
  expect(mockInitiate).toHaveBeenCalledTimes(2);
});

it('another failure stays busy and is not started by accepting', async () => {
  mockInitiate.mockResolvedValue({ success: false, status: 500, error: 'x' });
  const { rerender } = await submit();
  expect(onWorkChange).toHaveBeenLastCalledWith({ hasFile: true, busy: true });
  rerender(form(1));
  await flush();
  expect(mockInitiate).toHaveBeenCalledTimes(1);
});
