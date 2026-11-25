import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  CURRENT_CREATOR_TERMS_VERSION,
  EN_TRANSLATIONS as mockEn,
} from '@al-ummah/shared-types';
import UploadPage from '@/app/[locale]/upload/page';

let mockCreatorState: {
  status: 'loading' | 'ready' | 'error';
  access?: { canUpload: boolean; canCreateChannel: boolean; termsAccepted?: boolean; termsVersion?: string; pendingDeletion?: boolean };
} = {
  status: 'ready',
  access: {
    canUpload: true,
    canCreateChannel: true,
    termsAccepted: false,
    termsVersion: CURRENT_CREATOR_TERMS_VERSION,
  },
};

jest.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ lang: 'en', dir: 'ltr', t: mockEn }),
}));

jest.mock('@/hooks/useCreatorAccess', () => ({
  useCreatorAccess: () => mockCreatorState,
  needsCreatorTerms: (c: typeof mockCreatorState) => c.status === 'ready' && c.access?.termsAccepted === false,
  acceptCreatorTerms: jest.fn().mockResolvedValue({ ok: true }),
  markCreatorTermsRequired: jest.fn(),
}));

jest.mock('@/hooks/useFeatures', () => ({
  useFeatures: () => ({ features: { upload: true }, loaded: true }),
}));

jest.mock('@/components/AuthProvider/authContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', name: 'Creator' } }),
}));

jest.mock('@/contexts/ActiveChannelContext', () => ({
  useActiveChannel: () => ({ activeChannel: { channelId: 'ch-1' } }),
}));

jest.mock('@/hooks/useMultiAccount', () => ({
  useMultiAccount: () => ({
    user: {
      id: 'user-1',
      channel: { id: 'ch-1', name: 'My Channel', ownerId: 'user-1' },
      channels: [{ id: 'ch-1', name: 'My Channel', ownerId: 'user-1' }],
    },
    loading: false,
  }),
}));

jest.mock('@/hooks/useLeaveGuard', () => ({
  useLeaveGuard: () => null,
}));

jest.mock('@/hooks/useBatchUpload', () => ({
  useBatchUpload: () => ({
    files: [],
    overallProgress: 0,
    isUploading: false,
    isInitiating: false,
    addFiles: jest.fn(),
    removeFile: jest.fn(),
    startUpload: jest.fn(),
    pauseUpload: jest.fn(),
    resumeUpload: jest.fn(),
    cancelUpload: jest.fn(),
    retryUpload: jest.fn(),
    pauseAll: jest.fn(),
    resumeAll: jest.fn(),
    cancelAll: jest.fn(),
    clearQueue: jest.fn(),
    clearFinished: jest.fn(),
    reorderQueue: jest.fn(),
  }),
}));

jest.mock('@/hooks/useBatchCategories', () => ({
  useBatchCategories: () => ({ suggestions: {}, request: jest.fn() }),
}));

jest.mock('@/hooks/useProcessingStatus', () => ({
  useProcessingStatus: () => ({ phases: {} }),
}));

jest.mock('@/lib/notifications/upload-results', () => ({
  useUploadResult: () => null,
  clearUploadResult: jest.fn(),
}));

jest.mock('@/hooks/useChannelPlaylists', () => ({
  useChannelPlaylists: () => ({ playlists: [], loading: false, failed: false, create: jest.fn() }),
}));

jest.mock('@/hooks/usePlaylistAdds', () => ({
  usePlaylistAdds: () => ({ queue: jest.fn(), notices: [] }),
}));

jest.mock('@/hooks/useBatchPlaylists', () => ({
  useBatchPlaylists: () => ({ batchPlaylists: [], setBatchPlaylists: jest.fn(), overrides: {}, setOverride: jest.fn() }),
}));

jest.mock('@/components/videoUpload/useBatchSetValues', () => ({
  useSetValuesSeed: () => ({ initiateValuesFor: jest.fn() }),
  useBatchSetValues: () => ({ panel: null, open: jest.fn() }),
}));

jest.mock('@/components/videoUpload', () => function MockVideoUpload() {
  return <div data-testid="mock-video-upload-form">Upload Form Draft</div>;
});

jest.mock('@/components/videoUpload/BatchUploadQueue', () => ({
  BatchUploadQueue: () => null,
}));

jest.mock('@/components/videoUpload/UploadChannelPicker', () => ({
  UploadChannelPicker: () => <div data-testid="mock-channel-picker" />,
}));

jest.mock('@/components/videoUpload/UploadProcessingCard', () => ({
  UploadProcessingCard: () => null,
}));

jest.mock('@/components/videoUpload/PlaylistPicker', () => ({
  PlaylistPicker: () => null,
}));

jest.mock('@/components/videoUpload/PlaylistAddNotices', () => ({
  PlaylistAddNotices: () => null,
}));

jest.mock('@/components/videoUpload/BatchRowPlaylists', () => ({
  BatchRowPlaylists: () => null,
}));

jest.mock('@/components/videoUpload/CategorySelector', () => ({
  CategorySelector: () => null,
}));

jest.mock('@/components/help/HelpLink', () => ({
  HelpLink: () => null,
}));

jest.mock('@/lib/actions', () => ({
  login: jest.fn(),
}));

describe('UploadPage creator terms gate and draft preservation', () => {
  it('shows full-page CreatorTermsGate before the form mounts when termsAccepted is false', () => {
    mockCreatorState = {
      status: 'ready',
      access: { canUpload: true, canCreateChannel: true, termsAccepted: false, termsVersion: CURRENT_CREATOR_TERMS_VERSION },
    };

    render(<UploadPage />);
    expect(screen.getByTestId('creator-terms-gate')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-video-upload-form')).not.toBeInTheDocument();
  });

  it('keeps the upload form mounted with CreatorTermsDialog overlay if terms become required mid-draft, and allows reopening', () => {
    mockCreatorState = {
      status: 'ready',
      access: { canUpload: true, canCreateChannel: true, termsAccepted: true, termsVersion: CURRENT_CREATOR_TERMS_VERSION },
    };

    const { rerender } = render(<UploadPage />);
    expect(screen.getByTestId('mock-video-upload-form')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Simulate focus refresh or 403 terms_required flipping termsAccepted to false
    mockCreatorState = {
      status: 'ready',
      access: { canUpload: true, canCreateChannel: true, termsAccepted: false, termsVersion: CURRENT_CREATOR_TERMS_VERSION },
    };
    rerender(<UploadPage />);

    // Form stays mounted (draft preserved!) and Terms modal opens on top
    expect(screen.getByTestId('mock-video-upload-form')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Dismissing the dialog keeps the form and shows a reopen banner
    fireEvent.click(screen.getByTestId('creator-terms-cancel'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('mock-video-upload-form')).toBeInTheDocument();
    expect(screen.getByTestId('upload-terms-banner')).toBeInTheDocument();

    // Clicking the banner button reopens the Terms dialog
    fireEvent.click(screen.getByTestId('upload-terms-reopen'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not unmount a mounted upload form into a loading skeleton when creator access returns to loading', () => {
    mockCreatorState = {
      status: 'ready',
      access: { canUpload: true, canCreateChannel: true, termsAccepted: true, termsVersion: CURRENT_CREATOR_TERMS_VERSION },
    };

    const { rerender } = render(<UploadPage />);
    expect(screen.getByTestId('mock-video-upload-form')).toBeInTheDocument();

    // Account switch publishes loading while the form is already mounted
    mockCreatorState = { status: 'loading' };
    rerender(<UploadPage />);

    expect(screen.getByTestId('mock-video-upload-form')).toBeInTheDocument();
    expect(screen.queryByTestId('upload-loading')).not.toBeInTheDocument();
  });
});
