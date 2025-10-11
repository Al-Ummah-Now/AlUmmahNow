# Testing Documentation

This document describes the test infrastructure for the Al Ummah Now web application.

## Overview

The web app uses Jest and React Testing Library for unit and integration testing. Tests are organized alongside the code they test, making them easy to find and maintain.

## Test Infrastructure

### Testing Libraries

- **Jest**: JavaScript testing framework
- **React Testing Library**: For testing React components
- **@testing-library/user-event**: For simulating user interactions
- **@testing-library/jest-dom**: Custom matchers for DOM assertions

### Configuration

- **Jest Config**: `apps/web/jest.config.js`
- **Setup File**: `apps/web/jest.setup.js`
- **TypeScript Support**: Configured through Next.js Jest integration

## Running Tests

### Commands

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage

# Run tests from monorepo root
pnpm --filter @al-ummah/web test
```

### Coverage Thresholds

Current thresholds are set conservatively at 5% to establish a baseline. As test coverage improves, these should be gradually increased.

```javascript
coverageThreshold: {
  global: {
    branches: 5,
    functions: 5,
    lines: 5,
    statements: 5,
  },
}
```

## Test Organization

Tests are organized in `__tests__` directories alongside the code they test:

```
src/
├── components/
│   └── __tests__/
│       ├── ProfileGuard.test.tsx
│       ├── SearchFilters.test.tsx
│       └── SubscribeButton.test.tsx
├── lib/
│   └── __tests__/
│       ├── api-client.test.ts
│       ├── profile-helpers.test.ts
│       └── utility.test.ts
└── interfaces/
    └── __tests__/
        └── websocket.test.ts
```

## Test Coverage by Feature

### ✅ Subscription System (PR #20)
- **SubscribeButton**: 88% coverage
  - Subscribe/unsubscribe functionality
  - Loading states
  - Subscriber count updates
  - Authentication handling

### ✅ Profile System (PR #18)
- **ProfileGuard**: Component tests
  - Profile existence checking
  - Redirect logic
  - Loading states
  - Error handling
- **Profile Helpers**: Utility tests
  - Profile creation path generation
  - Redirect decision logic

### ✅ Search Features (PR #16)
- **SearchFilters**: 68% coverage
  - Filter toggle
  - Filter changes
  - Active filter indication
  - Apply/clear functionality

### ✅ Real-time Features (PR #21)
- **WebSocket Types**: Interface tests
  - Message structures
  - Event types
  - Connection states
  - Subscription models

### ✅ Core Utilities
- **Observable Pattern**: Complete coverage
  - Value updates
  - Listener management
  - Unsubscribe functionality
- **API Client**: Comprehensive tests
  - Client creation
  - Header management
  - API accessors
- **Utility Functions**: Core functionality
  - URL resolution
  - API header creation
  - File name sanitization

## Writing Tests

### Component Testing Pattern

```typescript
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MyComponent } from '@/components/MyComponent';

// Mock dependencies
jest.mock('@/hooks/useMyHook', () => ({
  useMyHook: jest.fn(),
}));

describe('MyComponent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });

  it('should handle user interaction', async () => {
    render(<MyComponent />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    
    await waitFor(() => {
      expect(screen.getByText('Updated Text')).toBeInTheDocument();
    });
  });
});
```

### Utility Function Testing Pattern

```typescript
import { myUtility } from '../myUtility';

describe('myUtility', () => {
  it('should handle valid input', () => {
    const result = myUtility('input');
    expect(result).toBe('expected output');
  });

  it('should handle edge cases', () => {
    expect(myUtility('')).toBe('default');
    expect(myUtility(null)).toBeUndefined();
  });
});
```

## Mocking

### Common Mocks

The test setup includes automatic mocking for:

- **next/navigation**: Router, pathname, search params
- **IntersectionObserver**: For viewport tracking
- **ResizeObserver**: For responsive components
- **matchMedia**: For media queries

### Custom Mocks

Authentication and hooks are mocked in individual tests:

```typescript
jest.mock('@/components/AuthProvider/authContext', () => ({
  useAuth: jest.fn(),
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
mockUseAuth.mockReturnValue({ user: { id: 'user-123' } } as any);
```

## CI Integration

Tests run automatically in the GitHub Actions CI pipeline:

```yaml
- name: Run tests (all packages)
  run: pnpm test
  continue-on-error: true
  timeout-minutes: 5
```

Tests are set to `continue-on-error: true` during the initial implementation phase to avoid blocking deployments while test coverage is being built up.

## Future Improvements

### Planned Test Coverage

- **SubscriptionFeed**: Real-time subscription updates
- **SubscriptionManagement**: Subscription list management
- **NotificationCenter**: Notification display and interaction
- **VideoMetricsDisplay**: Real-time metrics updates
- **SearchSuggestions**: Search suggestion logic
- **TrendingContent**: Trending content display

### Coverage Goals

- Increase overall coverage to 20% in the short term
- Target 60% coverage for critical paths
- Add E2E tests using Playwright for user flows
- Add visual regression testing for UI components

## Troubleshooting

### Tests Hanging

If tests don't exit, use `--forceExit`:
```bash
pnpm test -- --forceExit
```

### Module Resolution Issues

Ensure `@/` alias is working by checking `tsconfig.json`:
```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### Async Operation Warnings

Use `waitFor` for async updates:
```typescript
await waitFor(() => {
  expect(screen.getByText('Loaded')).toBeInTheDocument();
});
```

## Resources

- [Jest Documentation](https://jestjs.io/)
- [React Testing Library](https://testing-library.com/react)
- [Testing Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
