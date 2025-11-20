/**
 * Tests for ChannelTabs component
 * Tests tab navigation, active state highlighting, API configuration, visibility, ordering, and error handling
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChannelTabs } from '../ChannelTabs';
import { getChannelTabConfig } from '@/lib/api/channel-tabs';
import type { Channel, ChannelTabConfig } from '@al-ummah/shared-types';
import { logger } from '@/lib/logger-client';

// Mock dependencies
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
  }),
  usePathname: jest.fn(() => '/en/channels/test-channel-id'),
}));

jest.mock('@/lib/api/channel-tabs', () => ({
  getChannelTabConfig: jest.fn(),
}));

jest.mock('@/lib/logger-client', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('@/lib/i18n', () => ({
  getTranslations: jest.fn((locale: string) => ({
    channel: {
      home: locale === 'ar' ? 'الرئيسية' : 'Home',
      shorts: locale === 'ar' ? 'مقاطع قصيرة' : 'Shorts',
      live: locale === 'ar' ? 'بث مباشر' : 'Live',
      playlists: locale === 'ar' ? 'قوائم التشغيل' : 'Playlists',
      about: locale === 'ar' ? 'حول' : 'About',
    },
    video: {
      videos: locale === 'ar' ? 'الفيديوهات' : 'Videos',
    },
    community: {
      community: locale === 'ar' ? 'المجتمع' : 'Community',
    },
  })),
}));

import { usePathname } from 'next/navigation';

const mockUsePathname = usePathname as jest.MockedFunction<typeof usePathname>;
const mockGetChannelTabConfig = getChannelTabConfig as jest.MockedFunction<typeof getChannelTabConfig>;

// Mock channel data
const createMockChannel = (overrides?: Partial<Channel>): Channel => ({
  id: 'test-channel-id',
  userId: 'user-123',
  email: 'test@example.com',
  name: 'Test Channel',
  nameLocalized: { en: 'Test Channel', ar: 'قناة اختبار' },
  description: 'Test channel description',
  avatarUrl: 'https://example.com/avatar.jpg',
  isMain: true,
  subscribersCount: 1000,
  videosCount: 50,
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
  createdAt: '2024-01-01T00:00:00Z',
  ...overrides,
});

// Mock tab config
const createMockTabConfig = (overrides?: Partial<ChannelTabConfig>): ChannelTabConfig => ({
  channelId: 'test-channel-id',
  defaultTab: 'home',
  version: 1,
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
  tabs: [
    { id: 'home', name: 'Home', nameLocalized: { en: 'Home', ar: 'الرئيسية' }, type: 'system', visible: true, position: 0 },
    { id: 'videos', name: 'Videos', nameLocalized: { en: 'Videos', ar: 'الفيديوهات' }, type: 'system', visible: true, position: 1 },
    { id: 'shorts', name: 'Shorts', nameLocalized: { en: 'Shorts', ar: 'مقاطع قصيرة' }, type: 'system', visible: true, position: 2 },
    { id: 'live', name: 'Live', nameLocalized: { en: 'Live', ar: 'بث مباشر' }, type: 'system', visible: true, position: 3 },
    { id: 'playlists', name: 'Playlists', nameLocalized: { en: 'Playlists', ar: 'قوائم التشغيل' }, type: 'system', visible: true, position: 4 },
    { id: 'community', name: 'Community', nameLocalized: { en: 'Community', ar: 'المجتمع' }, type: 'system', visible: true, position: 5 },
    { id: 'about', name: 'About', nameLocalized: { en: 'About', ar: 'حول' }, type: 'system', visible: true, position: 6 },
  ],
  ...overrides,
});

describe('ChannelTabs - Navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePathname.mockReturnValue('/en/channels/test-channel-id');
  });

  it('should render all default tabs', async () => {
    const mockChannel = createMockChannel();
    mockGetChannelTabConfig.mockResolvedValue(createMockTabConfig());

    render(<ChannelTabs channel={mockChannel} locale="en" />);

    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument();
      expect(screen.getByText('Videos')).toBeInTheDocument();
      expect(screen.getByText('Shorts')).toBeInTheDocument();
      expect(screen.getByText('Live')).toBeInTheDocument();
      expect(screen.getByText('Playlists')).toBeInTheDocument();
      expect(screen.getByText('Community')).toBeInTheDocument();
      expect(screen.getByText('About')).toBeInTheDocument();
    });
  });

  it('should navigate to tab on click', async () => {
    const mockChannel = createMockChannel();
    mockGetChannelTabConfig.mockResolvedValue(createMockTabConfig());

    render(<ChannelTabs channel={mockChannel} locale="en" />);

    await waitFor(() => {
      expect(screen.getByText('Videos')).toBeInTheDocument();
    });

    const videosTab = screen.getByText('Videos');
    fireEvent.click(videosTab);

    expect(mockPush).toHaveBeenCalledWith('/en/channels/test-channel-id/videos');
  });

  it('should highlight active tab', async () => {
    const mockChannel = createMockChannel();
    mockGetChannelTabConfig.mockResolvedValue(createMockTabConfig());
    mockUsePathname.mockReturnValue('/en/channels/test-channel-id/videos');

    render(<ChannelTabs channel={mockChannel} locale="en" />);

    await waitFor(() => {
      const videosTab = screen.getByText('Videos');
      const button = videosTab.closest('button');
      expect(button).toHaveClass('border-blue-600');
    });
  });

  it('should highlight home tab when on channel root', async () => {
    const mockChannel = createMockChannel();
    mockGetChannelTabConfig.mockResolvedValue(createMockTabConfig());
    mockUsePathname.mockReturnValue('/en/channels/test-channel-id');

    render(<ChannelTabs channel={mockChannel} locale="en" />);

    await waitFor(() => {
      const homeTab = screen.getByText('Home');
      const button = homeTab.closest('button');
      expect(button).toHaveClass('border-blue-600');
    });
  });

  it('should not highlight inactive tabs', async () => {
    const mockChannel = createMockChannel();
    mockGetChannelTabConfig.mockResolvedValue(createMockTabConfig());
    mockUsePathname.mockReturnValue('/en/channels/test-channel-id/videos');

    render(<ChannelTabs channel={mockChannel} locale="en" />);

    await waitFor(() => {
      const homeTab = screen.getByText('Home');
      const button = homeTab.closest('button');
      expect(button).toHaveClass('border-transparent');
    });
  });
});

describe('ChannelTabs - Tab Configuration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePathname.mockReturnValue('/en/channels/test-channel-id');
  });

  it('should load tabs from API configuration', async () => {
    const mockChannel = createMockChannel();
    const customConfig = createMockTabConfig({
      tabs: [
        { id: 'home', name: 'Home', nameLocalized: { en: 'Home', ar: 'الرئيسية' }, type: 'system', visible: true, position: 0 },
        { id: 'videos', name: 'Videos', nameLocalized: { en: 'Videos', ar: 'الفيديوهات' }, type: 'system', visible: true, position: 1 },
        { id: 'about', name: 'About', nameLocalized: { en: 'About', ar: 'حول' }, type: 'system', visible: true, position: 2 },
      ],
    });
    mockGetChannelTabConfig.mockResolvedValue(customConfig);

    render(<ChannelTabs channel={mockChannel} locale="en" />);

    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument();
      expect(screen.getByText('Videos')).toBeInTheDocument();
      expect(screen.getByText('About')).toBeInTheDocument();
    });

    expect(mockGetChannelTabConfig).toHaveBeenCalledWith('test-channel-id');
  });

  it('should respect visibility settings', async () => {
    const mockChannel = createMockChannel();
    const customConfig = createMockTabConfig({
      tabs: [
        { id: 'home', name: 'Home', nameLocalized: { en: 'Home' }, type: 'system', visible: true, position: 0 },
        { id: 'videos', name: 'Videos', nameLocalized: { en: 'Videos' }, type: 'system', visible: false, position: 1 },
        { id: 'about', name: 'About', nameLocalized: { en: 'About' }, type: 'system', visible: true, position: 2 },
      ],
    });
    mockGetChannelTabConfig.mockResolvedValue(customConfig);

    render(<ChannelTabs channel={mockChannel} locale="en" />);

    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument();
      expect(screen.queryByText('Videos')).not.toBeInTheDocument();
      expect(screen.getByText('About')).toBeInTheDocument();
    });
  });

  it('should respect custom ordering', async () => {
    const mockChannel = createMockChannel();
    const customConfig = createMockTabConfig({
      tabs: [
        { id: 'about', name: 'About', nameLocalized: { en: 'About' }, type: 'system', visible: true, position: 0 },
        { id: 'videos', name: 'Videos', nameLocalized: { en: 'Videos' }, type: 'system', visible: true, position: 1 },
        { id: 'home', name: 'Home', nameLocalized: { en: 'Home' }, type: 'system', visible: true, position: 2 },
      ],
    });
    mockGetChannelTabConfig.mockResolvedValue(customConfig);

    const { container } = render(<ChannelTabs channel={mockChannel} locale="en" />);

    await waitFor(() => {
      const nav = container.querySelector('nav');
      const buttons = nav?.querySelectorAll('button');
      expect(buttons?.[0]?.textContent).toBe('About');
      expect(buttons?.[1]?.textContent).toBe('Videos');
      expect(buttons?.[2]?.textContent).toBe('Home');
    });
  });

  it('should fallback to default tabs on API error', async () => {
    const mockChannel = createMockChannel();
    mockGetChannelTabConfig.mockRejectedValue(new Error('Network error'));

    render(<ChannelTabs channel={mockChannel} locale="en" />);

    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument();
      expect(screen.getByText('Videos')).toBeInTheDocument();
    });

    expect(logger.error).toHaveBeenCalledWith(
      '[ChannelTabs] Failed to fetch tab configuration',
      expect.objectContaining({
        channelId: 'test-channel-id',
      })
    );
  });

  it('should fallback to default tabs when API returns null', async () => {
    const mockChannel = createMockChannel();
    mockGetChannelTabConfig.mockResolvedValue(null);

    render(<ChannelTabs channel={mockChannel} locale="en" />);

    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument();
      expect(screen.getByText('Videos')).toBeInTheDocument();
    });
  });
});

describe('ChannelTabs - Bilingual Support', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePathname.mockReturnValue('/ar/channels/test-channel-id');
  });

  it('should render Arabic tab labels', async () => {
    const mockChannel = createMockChannel();
    mockGetChannelTabConfig.mockResolvedValue(createMockTabConfig());

    render(<ChannelTabs channel={mockChannel} locale="ar" />);

    await waitFor(() => {
      expect(screen.getByText('الرئيسية')).toBeInTheDocument();
      expect(screen.getByText('الفيديوهات')).toBeInTheDocument();
      expect(screen.getByText('مقاطع قصيرة')).toBeInTheDocument();
    });
  });

  it('should navigate to Arabic routes', async () => {
    const mockChannel = createMockChannel();
    mockGetChannelTabConfig.mockResolvedValue(createMockTabConfig());

    render(<ChannelTabs channel={mockChannel} locale="ar" />);

    await waitFor(() => {
      expect(screen.getByText('الفيديوهات')).toBeInTheDocument();
    });

    const videosTab = screen.getByText('الفيديوهات');
    fireEvent.click(videosTab);

    expect(mockPush).toHaveBeenCalledWith('/ar/channels/test-channel-id/videos');
  });

  it('should fallback to English when Arabic translation missing', async () => {
    const mockChannel = createMockChannel();
    const customConfig = createMockTabConfig({
      tabs: [
        { id: 'home', name: 'Home', nameLocalized: { en: 'Home' }, type: 'system', visible: true, position: 0 },
      ],
    });
    mockGetChannelTabConfig.mockResolvedValue(customConfig);

    render(<ChannelTabs channel={mockChannel} locale="ar" />);

    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument();
    });
  });
});

describe('ChannelTabs - Loading State', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePathname.mockReturnValue('/en/channels/test-channel-id');
  });

  it('should show default tabs immediately while loading', async () => {
    const mockChannel = createMockChannel();
    mockGetChannelTabConfig.mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve(createMockTabConfig()), 100))
    );

    render(<ChannelTabs channel={mockChannel} locale="en" />);

    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Videos')).toBeInTheDocument();
  });

  it('should replace tabs after loading completes', async () => {
    const mockChannel = createMockChannel();
    const customConfig = createMockTabConfig({
      tabs: [
        { id: 'home', name: 'Home', nameLocalized: { en: 'Home' }, type: 'system', visible: true, position: 0 },
        { id: 'videos', name: 'Videos', nameLocalized: { en: 'Videos' }, type: 'system', visible: true, position: 1 },
      ],
    });
    mockGetChannelTabConfig.mockResolvedValue(customConfig);

    render(<ChannelTabs channel={mockChannel} locale="en" />);

    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument();
      expect(screen.getByText('Videos')).toBeInTheDocument();
      expect(screen.queryByText('Shorts')).not.toBeInTheDocument();
    });
  });
});

describe('ChannelTabs - Edge Cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePathname.mockReturnValue('/en/channels/test-channel-id');
  });

  it('should handle empty tab configuration', async () => {
    const mockChannel = createMockChannel();
    const customConfig = createMockTabConfig({ tabs: [] });
    mockGetChannelTabConfig.mockResolvedValue(customConfig);

    render(<ChannelTabs channel={mockChannel} locale="en" />);

    await waitFor(() => {
      const nav = screen.queryByRole('navigation');
      expect(nav?.children.length).toBe(0);
    });
  });

  it('should handle tabs with no localized names', async () => {
    const mockChannel = createMockChannel();
    const customConfig = createMockTabConfig({
      tabs: [
        { id: 'home', name: 'Home', type: 'system', visible: true, position: 0 },
      ],
    });
    mockGetChannelTabConfig.mockResolvedValue(customConfig);

    render(<ChannelTabs channel={mockChannel} locale="en" />);

    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument();
    });
  });

  it('should handle rapid channel changes', async () => {
    const mockChannel1 = createMockChannel({ id: 'channel-1' });
    const mockChannel2 = createMockChannel({ id: 'channel-2' });
    mockGetChannelTabConfig.mockResolvedValue(createMockTabConfig());

    const { rerender } = render(<ChannelTabs channel={mockChannel1} locale="en" />);

    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument();
    });

    rerender(<ChannelTabs channel={mockChannel2} locale="en" />);

    await waitFor(() => {
      expect(mockGetChannelTabConfig).toHaveBeenCalledWith('channel-2');
    });
  });

  it('should handle tabs with special characters', async () => {
    const mockChannel = createMockChannel();
    const customConfig = createMockTabConfig({
      tabs: [
        { id: 'home', name: 'Home & Videos', nameLocalized: { en: 'Home & Videos' }, type: 'system', visible: true, position: 0 },
      ],
    });
    mockGetChannelTabConfig.mockResolvedValue(customConfig);

    render(<ChannelTabs channel={mockChannel} locale="en" />);

    await waitFor(() => {
      expect(screen.getByText('Home & Videos')).toBeInTheDocument();
    });
  });
});

describe('ChannelTabs - Accessibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePathname.mockReturnValue('/en/channels/test-channel-id');
  });

  it('should render as navigation landmark', async () => {
    const mockChannel = createMockChannel();
    mockGetChannelTabConfig.mockResolvedValue(createMockTabConfig());

    const { container } = render(<ChannelTabs channel={mockChannel} locale="en" />);

    await waitFor(() => {
      expect(container.querySelector('nav')).toBeInTheDocument();
    });
  });

  it('should render tabs as buttons', async () => {
    const mockChannel = createMockChannel();
    mockGetChannelTabConfig.mockResolvedValue(createMockTabConfig());

    const { container } = render(<ChannelTabs channel={mockChannel} locale="en" />);

    await waitFor(() => {
      const buttons = container.querySelectorAll('button');
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  it('should support keyboard navigation', async () => {
    const mockChannel = createMockChannel();
    mockGetChannelTabConfig.mockResolvedValue(createMockTabConfig());

    render(<ChannelTabs channel={mockChannel} locale="en" />);

    await waitFor(() => {
      const videosTab = screen.getByText('Videos');
      videosTab.focus();
      expect(videosTab).toHaveFocus();
    });
  });
});
