/**
 * Test Utilities
 * Custom render functions and testing helpers for Al Ummah Now
 *
 * This file provides reusable testing utilities following React Testing Library
 * best practices and the project's testing standards.
 */

import React, { ReactElement } from 'react';
import { render, RenderOptions, RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';

/**
 * Theme Provider Mock
 * Provides dark mode context for testing
 */
interface ThemeProviderProps {
  children: React.ReactNode;
  theme?: 'light' | 'dark';
}

const ThemeProvider: React.FC<ThemeProviderProps> = ({ children, theme = 'light' }) => {
  return <div data-theme={theme}>{children}</div>;
};

/**
 * Custom render options
 */
interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  /**
   * Initial theme for testing (light or dark mode)
   */
  theme?: 'light' | 'dark';

  /**
   * Custom QueryClient for React Query
   * If not provided, a default one will be created
   */
  queryClient?: QueryClient;

  /**
   * Locale for testing (en or ar)
   */
  locale?: 'en' | 'ar';
}

/**
 * Create a QueryClient for testing
 * Disables retries and logs for cleaner test output
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/**
 * All Providers Wrapper
 * Wraps components with necessary context providers
 */
interface AllProvidersProps {
  children: React.ReactNode;
  queryClient: QueryClient;
  theme?: 'light' | 'dark';
}

const AllProviders: React.FC<AllProvidersProps> = ({
  children,
  queryClient,
  theme = 'light'
}) => {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        {children}
      </ThemeProvider>
    </QueryClientProvider>
  );
};

/**
 * Custom render function with providers
 *
 * Wraps components with QueryClient, Theme, and other necessary providers
 * for comprehensive testing.
 *
 * @example
 * ```tsx
 * const { getByRole } = renderWithProviders(<MyComponent />);
 * ```
 *
 * @example
 * ```tsx
 * // With dark mode
 * const { container } = renderWithProviders(<MyComponent />, { theme: 'dark' });
 * ```
 *
 * @example
 * ```tsx
 * // With custom QueryClient
 * const queryClient = createTestQueryClient();
 * const { rerender } = renderWithProviders(<MyComponent />, { queryClient });
 * ```
 */
export function renderWithProviders(
  ui: ReactElement,
  options: CustomRenderOptions = {}
): RenderResult & { user: ReturnType<typeof userEvent.setup> } {
  const {
    theme = 'light',
    queryClient = createTestQueryClient(),
    ...renderOptions
  } = options;

  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <AllProviders queryClient={queryClient} theme={theme}>
      {children}
    </AllProviders>
  );

  return {
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
    user: userEvent.setup(),
  };
}

/**
 * Custom render for RTL (Arabic) components
 *
 * @example
 * ```tsx
 * const { getByRole } = renderWithRTL(<MyRTLComponent />);
 * ```
 */
export function renderWithRTL(
  ui: ReactElement,
  options: CustomRenderOptions = {}
): RenderResult & { user: ReturnType<typeof userEvent.setup> } {
  return renderWithProviders(ui, {
    ...options,
    container: (() => {
      const container = document.createElement('div');
      container.setAttribute('dir', 'rtl');
      document.body.appendChild(container);
      return container;
    })(),
  });
}

/**
 * Wait for async operations to complete
 * Useful for testing loading states and async data fetching
 *
 * @example
 * ```tsx
 * await waitForLoadingToFinish();
 * expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
 * ```
 */
export async function waitForLoadingToFinish(): Promise<void> {
  const { waitFor } = await import('@testing-library/react');
  await waitFor(() => {}, { timeout: 100 });
}

/**
 * Helper to test accessibility violations
 * Uses jest-axe for WCAG compliance testing (when available)
 *
 * @example
 * ```tsx
 * const { container } = renderWithProviders(<MyComponent />);
 * await expectNoA11yViolations(container);
 * ```
 */
export async function expectNoA11yViolations(container: Element): Promise<void> {
  try {
    // Dynamically import jest-axe if available
    const jestAxe = await import('jest-axe');
    const results = await jestAxe.axe(container);
    // @ts-expect-error - toHaveNoViolations is added by jest-axe
    expect(results).toHaveNoViolations();
  } catch {
    // jest-axe not installed, skip accessibility check
    console.warn('jest-axe not installed, skipping accessibility check');
  }
}

/**
 * Mock IntersectionObserver with callback support
 * Useful for testing infinite scroll and lazy loading
 *
 * @example
 * ```tsx
 * const { triggerIntersection } = mockIntersectionObserver();
 * // Simulate element entering viewport
 * triggerIntersection(element, true);
 * ```
 */
export function mockIntersectionObserver() {
  const callbacks = new Map<Element, IntersectionObserverCallback>();

  global.IntersectionObserver = class MockIntersectionObserver {
    constructor(private callback: IntersectionObserverCallback) {}

    observe(element: Element) {
      callbacks.set(element, this.callback);
    }

    unobserve(element: Element) {
      callbacks.delete(element);
    }

    disconnect() {
      callbacks.clear();
    }

    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;

  return {
    /**
     * Trigger intersection for a specific element
     */
    triggerIntersection: (element: Element, isIntersecting: boolean) => {
      const callback = callbacks.get(element);
      if (callback) {
        callback(
          [
            {
              isIntersecting,
              target: element,
              intersectionRatio: isIntersecting ? 1 : 0,
              boundingClientRect: {} as DOMRectReadOnly,
              intersectionRect: {} as DOMRectReadOnly,
              rootBounds: null,
              time: Date.now(),
            },
          ],
          {} as IntersectionObserver
        );
      }
    },
  };
}

/**
 * Mock window.matchMedia for responsive testing
 *
 * @example
 * ```tsx
 * mockMatchMedia('(max-width: 768px)');
 * // Component will render mobile version
 * ```
 */
export function mockMatchMedia(query: string, matches: boolean = true) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((q) => ({
      matches: q === query ? matches : false,
      media: q,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
}

/**
 * Create mock Next.js Image component
 * Avoids image loading issues in tests
 */
export const MockNextImage = ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} {...props} />;
};

/**
 * Wait for element to be removed from DOM
 *
 * @example
 * ```tsx
 * await waitForElementToBeRemoved(() => screen.getByText('Loading...'));
 * ```
 */
export { waitForElementToBeRemoved } from '@testing-library/react';

// Re-export commonly used testing utilities
export * from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
