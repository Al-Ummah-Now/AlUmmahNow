# Al Ummah Now - Testing Documentation

## Overview

This directory contains the comprehensive testing infrastructure for the Al Ummah Now live streaming feature. We follow Test-Driven Development (TDD) principles and aim for high code coverage across all components.

## Test Structure

```
apps/web/src/
├── __tests__/
│   ├── utils/
│   │   ├── test-utils.tsx          # Custom render functions and helpers
│   │   └── mock-data.ts             # Mock data generators
│   └── README.md                    # This file
├── components/live-streaming/
│   ├── ViewerCount/
│   │   └── __tests__/
│   │       ├── ViewerCount.test.tsx      # LTR variant tests
│   │       └── ViewerCountRTL.test.tsx   # RTL variant tests
│   ├── LiveStreamCard/
│   │   └── __tests__/
│   │       └── LiveStreamCard.test.tsx   # Card component tests
│   ├── TabNavigation/
│   │   └── __tests__/
│   │       └── TabNavigation.test.tsx    # Tab navigation tests
│   └── ... (other components)
└── hooks/
    └── __tests__/
        └── useLiveStreams.test.ts        # Hook tests
```

## Testing Tools

### Core Testing Libraries

- **Jest**: JavaScript testing framework
- **React Testing Library**: Component testing with user-centric approach
- **@testing-library/user-event**: Realistic user interaction simulation
- **@testing-library/jest-dom**: Custom Jest matchers for DOM assertions

### Testing Utilities

All custom testing utilities are in `src/__tests__/utils/`:

#### test-utils.tsx

Provides enhanced render functions with providers:

```tsx
import { renderWithProviders } from '@/__tests__/utils/test-utils';

// Basic usage
const { getByRole } = renderWithProviders(<MyComponent />);

// With dark mode
const { container } = renderWithProviders(<MyComponent />, { theme: 'dark' });

// With custom QueryClient
const queryClient = createTestQueryClient();
const { rerender } = renderWithProviders(<MyComponent />, { queryClient });

// RTL (Arabic) variant
const { getByRole } = renderWithRTL(<MyRTLComponent />);
```

**Available utilities**:
- `renderWithProviders()` - Render with QueryClient and Theme providers
- `renderWithRTL()` - Render with RTL direction for Arabic components
- `createTestQueryClient()` - Create a QueryClient optimized for testing
- `expectNoA11yViolations()` - Test for WCAG compliance with jest-axe
- `mockIntersectionObserver()` - Mock IntersectionObserver for infinite scroll tests
- `mockMatchMedia()` - Mock window.matchMedia for responsive tests

#### mock-data.ts

Provides realistic test data generators:

```tsx
import {
  createMockLiveStream,
  createMockLiveStreams,
  createMockChannel,
} from '@/__tests__/utils/mock-data';

// Single stream
const stream = createMockLiveStream({ status: 'live', viewerCount: 1234 });

// Multiple streams
const streams = createMockLiveStreams(10, 'live');

// Mixed streams
const mixed = createMixedMockStreams({ live: 5, scheduled: 10, ended: 20 });

// Realistic streams with random data
const realistic = createRealisticStreams(10, 'live');
```

**Available generators**:
- `createMockLiveStream()` - Generate a single live stream
- `createMockLiveStreams()` - Generate multiple streams of same status
- `createMixedMockStreams()` - Generate streams with different statuses
- `createRealisticStreams()` - Generate streams with realistic random data
- `createMockChannel()` - Generate channel data
- `createMockAPIResponse()` - Mock API response structure
- `createMockPaginatedResponse()` - Mock paginated API response
- `createMockError()` - Create mock error objects

## Test Categories

### 1. Unit Tests

Test individual components and functions in isolation.

**Example: ViewerCount Component Tests**
```tsx
describe('ViewerCount Component', () => {
  it('renders with correct count', () => {
    renderWithProviders(<ViewerCount count={1234} />);
    expect(screen.getByText('1.2K')).toBeInTheDocument();
  });

  it('applies live indicator styling', () => {
    const { container } = renderWithProviders(
      <ViewerCount count={100} isLive />
    );
    const status = container.querySelector('[role="status"]');
    expect(status).toHaveClass('text-red-600');
  });
});
```

**Coverage Goals**:
- Component rendering: 100%
- Props validation: 100%
- User interactions: >95%
- Accessibility: 100%
- Edge cases: >90%

### 2. Hook Tests

Test custom React hooks with renderHook from React Testing Library.

**Example: useLiveStreams Hook Tests**
```tsx
describe('useLiveStreams Hook', () => {
  it('fetches live streams successfully', async () => {
    const mockStreams = createMockLiveStreams(5, 'live');
    mockedAPI.list.mockResolvedValueOnce({ success: true, result: { data: mockStreams } });

    const { result } = renderHook(() => useLiveStreams(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.streams).toHaveLength(5);
  });
});
```

### 3. Accessibility Tests

Every component should pass WCAG 2.1 AA compliance.

**Example: Using jest-axe**
```tsx
import { expectNoA11yViolations } from '@/__tests__/utils/test-utils';

it('has no accessibility violations', async () => {
  const { container } = renderWithProviders(<MyComponent />);
  await expectNoA11yViolations(container);
});
```

**Accessibility checklist**:
- [ ] Proper ARIA attributes (role, aria-label, aria-live, etc.)
- [ ] Keyboard navigation (Tab, Arrow keys, Enter, Space)
- [ ] Focus indicators visible
- [ ] Color contrast ratios (4.5:1 for text, 3:1 for UI)
- [ ] Screen reader compatibility

### 4. RTL (Arabic) Tests

Test right-to-left layout for Arabic language support.

**Example: RTL Component Tests**
```tsx
describe('ViewerCount RTL Component', () => {
  it('has dir="rtl" attribute', () => {
    renderWithRTL(<ViewerCountRTL count={100} />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('dir', 'rtl');
  });

  it('renders Arabic numerals', () => {
    renderWithRTL(<ViewerCountRTL count={123} />);
    expect(screen.getByText('١٢٣')).toBeInTheDocument();
  });
});
```

### 5. Dark Mode Tests

Verify components render correctly in both light and dark themes.

**Example: Dark Mode Tests**
```tsx
it('renders correctly in dark mode', () => {
  const { container } = renderWithProviders(
    <MyComponent />,
    { theme: 'dark' }
  );
  const element = container.firstChild;
  expect(element).toHaveClass('dark:bg-gray-900');
});
```

## Running Tests

### Run all tests
```bash
cd apps/web
pnpm test
```

### Run specific test file
```bash
pnpm test ViewerCount
```

### Run tests in watch mode
```bash
pnpm test:watch
```

### Run tests with coverage
```bash
pnpm test:coverage
```

### Run tests for specific pattern
```bash
pnpm test -- --testNamePattern="accessibility"
```

## Coverage Reports

Coverage reports are generated in `apps/web/coverage/`.

**Coverage thresholds**:
- Branches: >80%
- Functions: >80%
- Lines: >80%
- Statements: >80%

View coverage:
```bash
pnpm test:coverage
open coverage/lcov-report/index.html
```

## Best Practices

### 1. Write Tests Before Implementation (TDD)

```tsx
// ❌ WRONG: Write component first
export const MyComponent = () => { ... };
// Then write tests

// ✅ CORRECT: Write tests first
describe('MyComponent', () => {
  it('renders successfully', () => {
    // Write failing test first
  });
});
// Then implement component
```

### 2. Test User Behavior, Not Implementation

```tsx
// ❌ WRONG: Testing implementation details
expect(component.state.count).toBe(5);
expect(mockFunction).toHaveBeenCalledWith({ internal: 'data' });

// ✅ CORRECT: Testing user-visible behavior
expect(screen.getByText('5 items')).toBeInTheDocument();
await user.click(screen.getByRole('button', { name: 'Add' }));
expect(screen.getByText('6 items')).toBeInTheDocument();
```

### 3. Use Semantic Queries

Priority order (from React Testing Library):
1. `getByRole` - Best for accessibility
2. `getByLabelText` - Form fields
3. `getByPlaceholderText` - Form fields without labels
4. `getByText` - Non-interactive content
5. `getByDisplayValue` - Form inputs with values
6. `getByAltText` - Images
7. `getByTitle` - Last resort
8. `getByTestId` - Avoid unless necessary

```tsx
// ✅ CORRECT: Semantic queries
const button = screen.getByRole('button', { name: 'Submit' });
const heading = screen.getByRole('heading', { name: 'Welcome' });
const input = screen.getByLabelText('Email address');

// ❌ WRONG: test-id queries (use only when semantic queries don't work)
const element = screen.getByTestId('submit-button');
```

### 4. Use userEvent for Interactions

```tsx
import { renderWithProviders } from '@/__tests__/utils/test-utils';

it('handles user interactions', async () => {
  const { user } = renderWithProviders(<MyComponent />);

  // Click
  await user.click(screen.getByRole('button'));

  // Type
  await user.type(screen.getByRole('textbox'), 'Hello World');

  // Keyboard
  await user.keyboard('{Enter}');
  await user.keyboard('{ArrowDown}');
});
```

### 5. Test Accessibility

```tsx
describe('Accessibility', () => {
  it('has proper ARIA attributes', () => {
    renderWithProviders(<MyComponent />);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-label', 'Close dialog');
  });

  it('supports keyboard navigation', async () => {
    const { user } = renderWithProviders(<MyComponent />);
    const button = screen.getByRole('button');
    button.focus();
    await user.keyboard('{Enter}');
    expect(mockOnClick).toHaveBeenCalled();
  });

  it('has no WCAG violations', async () => {
    const { container } = renderWithProviders(<MyComponent />);
    await expectNoA11yViolations(container);
  });
});
```

### 6. Mock External Dependencies

```tsx
// Mock API
jest.mock('@/lib/api/livestreams', () => ({
  LiveStreamsAPI: {
    list: jest.fn(),
  },
}));

// Mock Next.js components
jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: any) => <img {...props} />,
}));
```

### 7. Clean Up After Tests

```tsx
describe('MyComponent', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
    jest.clearAllMocks();
  });

  // Tests...
});
```

## Common Issues and Solutions

### Issue: "Unable to find element"

**Solution**: Use `waitFor` for async operations
```tsx
// ❌ WRONG
expect(screen.getByText('Loading...')).toBeInTheDocument();

// ✅ CORRECT
await waitFor(() => {
  expect(screen.getByText('Loaded!')).toBeInTheDocument();
});
```

### Issue: "Can't perform a React state update on an unmounted component"

**Solution**: Clean up properly in tests
```tsx
afterEach(() => {
  cleanup(); // From @testing-library/react
  queryClient.clear();
});
```

### Issue: "IntersectionObserver is not defined"

**Solution**: Already mocked in `jest.setup.js`, but you can customize:
```tsx
import { mockIntersectionObserver } from '@/__tests__/utils/test-utils';

const { triggerIntersection } = mockIntersectionObserver();
triggerIntersection(element, true);
```

### Issue: "matchMedia is not a function"

**Solution**: Already mocked in `jest.setup.js`, but you can customize:
```tsx
import { mockMatchMedia } from '@/__tests__/utils/test-utils';

mockMatchMedia('(max-width: 768px)', true);
```

## Test Coverage by Component

### Completed Tests

#### ViewerCount (LTR + RTL)
- ✅ Rendering with different counts
- ✅ Number formatting (compact vs full)
- ✅ Loading states
- ✅ Click handlers
- ✅ Accessibility (ARIA labels, roles)
- ✅ Dark mode variants
- ✅ RTL layout and Arabic numerals
- **Coverage**: ~95%

#### LiveStreamCard (LTR)
- ✅ Rendering for all stream statuses (live, scheduled, ended)
- ✅ Image loading and error handling
- ✅ User interactions (click, keyboard)
- ✅ Accessibility
- ✅ Dark mode
- ✅ Variants (default, compact, featured)
- **Coverage**: ~90%

#### TabNavigation (LTR)
- ✅ Tab rendering and selection
- ✅ Keyboard navigation (Arrow keys, Home, End)
- ✅ Click interactions
- ✅ ARIA attributes and accessibility
- ✅ Count badges
- ✅ Dark mode
- **Coverage**: ~92%

#### useLiveStreams Hook
- ✅ Data fetching and pagination
- ✅ Filtering by status, category, channel
- ✅ Error handling and retry logic
- ✅ Auto-refetch for live streams
- ✅ Convenience hooks (useLiveNow, useScheduledStreams, useEndedStreams)
- **Coverage**: ~88%

### Pending Tests

The following components still need comprehensive tests:

- EmptyState (LTR + RTL)
- GridSkeleton
- useInfiniteScroll hook
- Live page integration tests
- E2E tests (optional)

## Contributing

When adding new components:

1. **Write tests first** (TDD approach)
2. Create test file in `__tests__/` directory next to component
3. Follow naming convention: `ComponentName.test.tsx` or `ComponentNameRTL.test.tsx`
4. Use utilities from `@/__tests__/utils/test-utils`
5. Aim for >80% coverage
6. Include accessibility tests
7. Test both light and dark modes
8. For bilingual components, test both LTR and RTL variants

## Resources

- [React Testing Library Docs](https://testing-library.com/docs/react-testing-library/intro/)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Testing Library Queries](https://testing-library.com/docs/queries/about)
- [Common Mistakes](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [jest-axe Documentation](https://github.com/nickcolley/jest-axe)

## Questions?

For questions about testing strategy or specific test cases, please:
1. Check this README
2. Review existing tests for similar patterns
3. Consult the team in #testing channel
4. Create a GitHub issue with the `testing` label
