import React from 'react';
import { render, screen, within } from '@testing-library/react';
import type { UploadQueueItem, UploadStatus } from '@al-ummah/shared-types';
import { UploadProcessingCard } from '../UploadProcessingCard';
import { BatchUploadQueue } from '../BatchUploadQueue';
import { batchNotice, type ProcessingPhase } from '@/lib/upload/processing-status';

jest.mock('@/theme/upload-status.css', () => ({}), { virtual: true });
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

let mockLang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => {
    const isAr = mockLang === 'ar';
    return {
      t: isAr
        ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS
        : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
      lang: mockLang,
      locale: mockLang,
      dir: isAr ? 'rtl' : 'ltr',
      isRTL: isAr,
    };
  },
}));

// Any wording that invites the uploader to leave the page, in English or Arabic
const LEAVE = /leave this page|you can leave|close this page|navigate away|مغادرة|غادر|إغلاق هذه الصفحة|يمكنك إغلاق/i;

describe('UploadProcessingCard (single upload)', () => {
  beforeEach(() => {
    mockLang = 'en';
  });

  const card = (phase: ProcessingPhase) =>
    render(<UploadProcessingCard videoId="vid-1" title="Tafsir Surah Al-Fatiha" phase={phase} onUploadAnother={jest.fn()} />);

  it('says the upload is done and the video is processing, without a watch link or an invitation to leave', () => {
    card('processing');
    expect(screen.getByRole('heading', { name: 'Upload complete' })).toBeInTheDocument();
    expect(screen.getByTestId('upload-processing-message')).toHaveTextContent(
      "We're processing your video. It will be available once processing finishes, and we'll notify you when it's ready.",
    );
    expect(screen.getByTestId('upload-success')).toHaveAttribute('data-phase', 'processing');
    expect(screen.queryByTestId('upload-view-video')).toBeNull();
    expect(document.body.textContent).not.toMatch(LEAVE);
    expect(document.body.textContent).not.toMatch(/ready to watch|watch now/i);
    // The step track marks Processing as the current step
    expect(screen.getByText('Processing', { selector: 'li' })).toHaveAttribute('aria-current', 'step');
  });

  it('announces status changes politely', () => {
    card('processing');
    const status = screen.getByTestId('upload-processing-status');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('shows Ready with a View video link once processed', () => {
    card('ready');
    expect(screen.getByRole('heading', { name: 'Your video is ready' })).toBeInTheDocument();
    expect(screen.getByTestId('upload-processing-status')).toHaveTextContent('"Tafsir Surah Al-Fatiha" is ready to watch');
    expect(screen.getByTestId('upload-view-video')).toHaveAttribute('href', '/en/video/vid-1');
  });

  it('links a failed video to its edit page and shows no raw error', () => {
    card('failed');
    expect(screen.getByRole('heading', { name: "Your video couldn't be processed" })).toBeInTheDocument();
    expect(screen.getByTestId('upload-edit-video')).toHaveAttribute('href', '/en/video/vid-1/edit');
    expect(screen.queryByTestId('upload-view-video')).toBeNull();
    expect(document.body.textContent).not.toMatch(/error:|exception|status code|undefined/i);
  });

  it('renders in Arabic with Arabic links', () => {
    mockLang = 'ar';
    card('ready');
    expect(screen.getByRole('heading', { name: 'الفيديو جاهز' })).toBeInTheDocument();
    expect(screen.getByTestId('upload-view-video')).toHaveAttribute('href', '/ar/video/vid-1');
    expect(screen.getByTestId('upload-view-video')).toHaveTextContent('مشاهدة الفيديو');
  });
});

function queueItem(status: UploadStatus, n: number): UploadQueueItem {
  return {
    id: `f${n}`,
    videoId: `v${n}`,
    file: new File(['x'], `clip-${n}.mp4`, { type: 'video/mp4' }),
    metadata: { title: `Lesson ${n}` },
    status,
    progress: status === 'completed' ? 100 : 40,
    bytesUploaded: 40,
    bytesTotal: 100,
    retryCount: 0,
  } as unknown as UploadQueueItem;
}

const noop = () => undefined;
function renderQueue(files: UploadQueueItem[], phases: Record<string, ProcessingPhase>, running: boolean) {
  return render(
    <BatchUploadQueue
      files={files}
      overallProgress={50}
      isUploading={running}
      processingPhases={phases}
      notice={batchNotice(files, phases, running)}
      onPauseAll={noop}
      onResumeAll={noop}
      onCancelAll={noop}
      onRemoveFile={noop}
      onPauseFile={noop}
      onResumeFile={noop}
      onCancelFile={noop}
      onRetryFile={noop}
    />,
  );
}

describe('BatchUploadQueue processing status', () => {
  beforeEach(() => {
    mockLang = 'en';
  });

  const inProgress: Array<[string, UploadStatus[], boolean]> = [
    ['one file uploading', ['completed', 'uploading', 'pending'], true],
    ['one file paused', ['completed', 'paused'], false],
    ['files still queued', ['completed', 'pending'], true],
    ['every file uploading', ['uploading', 'uploading'], true],
  ];

  for (const lang of ['en', 'ar'] as const) {
    for (const [name, statuses, running] of inProgress) {
      it(`never says the uploader can leave while uploads are in progress (${name}, ${lang})`, () => {
        mockLang = lang;
        const files = statuses.map((s, i) => queueItem(s, i));
        const phases: Record<string, ProcessingPhase> = { v0: 'ready' };
        const { container } = renderQueue(files, phases, running);
        expect(container.textContent).not.toMatch(LEAVE);
        expect(screen.getByTestId('batch-notice')).toHaveAttribute('data-notice', 'keepOpen');
      });
    }
  }

  it('asks to keep the page open while files upload', () => {
    renderQueue([queueItem('completed', 1), queueItem('uploading', 2)], {}, true);
    expect(screen.getByTestId('batch-notice')).toHaveTextContent(
      "Keep this page open until all uploads finish. Processing continues on our side after that, and we'll notify you when each video is ready.",
    );
  });

  it('shows "Uploaded · Processing" per row, then Ready with a View video link', () => {
    const files = [queueItem('completed', 1), queueItem('completed', 2)];
    const { rerender } = renderQueue(files, {}, false);
    const rows = screen.getAllByTestId('batch-file');
    for (const row of rows) {
      expect(row).toHaveAttribute('data-processing', 'processing');
      expect(within(row).getByTestId('batch-file-status')).toHaveTextContent('Uploaded · Processing');
    }
    expect(screen.getByTestId('batch-notice')).toHaveAttribute('data-notice', 'processing');
    expect(screen.queryByTestId('batch-file-view')).toBeNull();

    const phases: Record<string, ProcessingPhase> = { v1: 'ready', v2: 'failed' };
    rerender(
      <BatchUploadQueue
        files={files}
        overallProgress={100}
        isUploading={false}
        processingPhases={phases}
        notice={batchNotice(files, phases, false)}
        onPauseAll={noop}
        onResumeAll={noop}
        onCancelAll={noop}
        onRemoveFile={noop}
        onPauseFile={noop}
        onResumeFile={noop}
        onCancelFile={noop}
        onRetryFile={noop}
      />,
    );
    const [ready, failed] = screen.getAllByTestId('batch-file');
    expect(within(ready).getByTestId('batch-file-status')).toHaveTextContent('Ready');
    expect(within(ready).getByTestId('batch-file-view')).toHaveAttribute('href', '/en/video/v1');
    expect(within(failed).getByTestId('batch-file-status')).toHaveTextContent("Couldn't be processed");
    expect(within(failed).getByTestId('batch-file-edit')).toHaveAttribute('href', '/en/video/v2/edit');
    // One polite announcement region for the queue
    expect(screen.getByTestId('batch-processing-announcement')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByTestId('batch-processing-announcement').textContent).toMatch(/Lesson [12]/);
  });

  it('labels the uploaded count without implying the videos are watchable', () => {
    renderQueue([queueItem('completed', 1), queueItem('pending', 2)], {}, false);
    expect(screen.getByTestId('batch-summary')).toHaveTextContent('1 of 2 uploaded');
  });

  it('shows Arabic row statuses', () => {
    mockLang = 'ar';
    renderQueue([queueItem('completed', 1)], {}, false);
    expect(screen.getByTestId('batch-file-status')).toHaveTextContent('تم الرفع · قيد المعالجة');
  });
});
