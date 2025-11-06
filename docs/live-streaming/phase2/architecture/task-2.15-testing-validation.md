# Task 2.15: Testing & Validation (Integration Tests)

**Phase**: 2 - Go Live Creator Tools
**Type**: Architecture Specification
**Estimated Time**: 10 hours
**Dependencies**: All previous Phase 2 tasks
**Status**: 📝 Not Started

---

## Goal

Implement comprehensive test suite covering unit tests, integration tests, E2E tests, and validation scenarios for all go-live workflows to ensure production readiness.

## Architecture Pattern

**Pattern**: Layered Testing Strategy
**Strategy**: Unit → Integration → E2E → Performance → Security

## Test Structure

```typescript
// Integration test example
describe('Go Live Wizard', () => {
  describe('Step 1: Stream Details', () => {
    it('should validate required fields', async () => {
      const { getByLabelText, getByText } = render(<StreamDetailsStep />);
      
      const submitButton = getByText('Next');
      fireEvent.click(submitButton);
      
      expect(await screen.findByText('Title is required')).toBeInTheDocument();
      expect(await screen.findByText('Category is required')).toBeInTheDocument();
    });

    it('should accept valid stream details', async () => {
      const onNext = jest.fn();
      const { getByLabelText } = render(<StreamDetailsStep onNext={onNext} />);
      
      fireEvent.change(getByLabelText('Title'), { target: { value: 'Test Stream' } });
      fireEvent.change(getByLabelText('Category'), { target: { value: 'education' } });
      fireEvent.change(getByLabelText('Language'), { target: { value: 'en' } });
      
      fireEvent.click(getByText('Next'));
      
      await waitFor(() => {
        expect(onNext).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Test Stream',
            category: 'education',
            language: 'en'
          })
        );
      });
    });
  });

  describe('Complete Wizard Flow', () => {
    it('should complete all steps and create stream', async () => {
      const onSuccess = jest.fn();
      render(<GoLiveWizard onSuccess={onSuccess} />);
      
      // Step 1: Details
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Integration Test' } });
      fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'education' } });
      fireEvent.click(screen.getByText('Next'));
      
      // Step 2: Thumbnail (skip)
      await waitFor(() => screen.getByText('Skip'));
      fireEvent.click(screen.getByText('Skip'));
      
      // Step 3: RTMP
      await waitFor(() => screen.getByText('RTMP Configuration'));
      expect(screen.getByText(/rtmp:\/\//)).toBeInTheDocument();
      fireEvent.click(screen.getByText('Next'));
      
      // Step 4: Review & Confirm
      await waitFor(() => screen.getByText('Review'));
      fireEvent.click(screen.getByText('Create Stream'));
      
      // Verify stream creation
      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(expect.any(String));
      });
    });
  });
});

// E2E test example (Playwright)
test.describe('Go Live Flow', () => {
  test('creator can go live successfully', async ({ page }) => {
    // Login
    await page.goto('/en/auth/signin');
    await page.fill('[name="email"]', 'creator@test.com');
    await page.fill('[name="password"]', 'password');
    await page.click('button[type="submit"]');
    
    // Navigate to go live
    await page.waitForNavigation();
    await page.goto('/en/go-live');
    
    // Fill stream details
    await page.fill('[name="title"]', 'E2E Test Stream');
    await page.selectOption('[name="category"]', 'education');
    await page.click('button:has-text("Next")');
    
    // Skip thumbnail
    await page.click('button:has-text("Skip")');
    
    // Verify RTMP credentials
    await expect(page.locator('text=/rtmp:\\/\\//i')).toBeVisible();
    const streamKey = await page.locator('[data-testid="stream-key"]').textContent();
    expect(streamKey).toMatch(/^[a-zA-Z0-9]{32}$/);
    await page.click('button:has-text("Next")');
    
    // Review and create
    await expect(page.locator('text=E2E Test Stream')).toBeVisible();
    await page.click('button:has-text("Create Stream")');
    
    // Verify success
    await expect(page.locator('text=Stream Created')).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard\/streams\/[a-z0-9-]+/);
  });

  test('prevents going live without quota', async ({ page }) => {
    // Login as user with no quota
    await page.goto('/en/auth/signin');
    await page.fill('[name="email"]', 'noquota@test.com');
    await page.fill('[name="password"]', 'password');
    await page.click('button[type="submit"]');
    
    // Try to go live
    await page.goto('/en/go-live');
    
    // Should show quota exceeded
    await expect(page.locator('text=Quota Exceeded')).toBeVisible();
    await expect(page.locator('button:has-text("Upgrade Plan")')).toBeVisible();
  });
});
```

## Test Coverage Matrix

```typescript
const testCoverage = {
  wizard: {
    step1_details: [
      'validation_required_fields',
      'validation_title_length',
      'validation_description_xss',
      'validation_scheduled_time',
      'validation_tags',
      'auto_save_draft',
      'draft_recovery'
    ],
    step2_thumbnail: [
      'upload_valid_image',
      'reject_invalid_format',
      'reject_oversized_file',
      'client_side_compression',
      'resumable_upload',
      'skip_thumbnail'
    ],
    step3_rtmp: [
      'generate_credentials',
      'copy_to_clipboard',
      'server_selection',
      'connection_test',
      'qr_code_generation'
    ],
    step4_review: [
      'display_all_data',
      'edit_each_section',
      'cost_estimation',
      'idempotent_creation',
      'optimistic_ui',
      'rollback_on_error'
    ]
  },
  dashboard: {
    controls: [
      'go_live_action',
      'end_stream_action',
      'pause_resume',
      'emergency_stop',
      'authorization_checks'
    ],
    metrics: [
      'realtime_viewer_count',
      'realtime_status_updates',
      'websocket_fallback',
      'metrics_batching',
      'analytics_charts'
    ]
  },
  errors: {
    handling: [
      'network_retry',
      'validation_messages',
      'rtmp_diagnostics',
      'quota_redirect',
      'auth_redirect',
      'error_boundary'
    ]
  },
  success: {
    states: [
      'stream_created_notification',
      'go_live_celebration',
      'milestone_detection',
      'stream_ended_summary'
    ]
  }
};
```

## Performance Tests

```typescript
// Load testing
describe('Performance', () => {
  it('should handle 100 concurrent users creating streams', async () => {
    const users = Array.from({ length: 100 }, (_, i) => ({
      id: `user${i}`,
      token: `token${i}`
    }));

    const results = await Promise.allSettled(
      users.map(user => createStream(user.token, {
        title: `Stream ${user.id}`,
        category: 'education'
      }))
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    expect(successful).toBeGreaterThan(95); // 95% success rate
    expect(failed).toBeLessThan(5);
  });

  it('should render dashboard under 100ms', async () => {
    const start = performance.now();
    
    render(<StreamDashboard streamId="test-123" />);
    await waitForLoadingToFinish();
    
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(100);
  });
});
```

## Security Tests

```typescript
describe('Security', () => {
  it('should prevent XSS in stream title', async () => {
    const maliciousTitle = '<script>alert("XSS")</script>';
    
    const { getByLabelText } = render(<StreamDetailsStep />);
    fireEvent.change(getByLabelText('Title'), { target: { value: maliciousTitle } });
    
    const titleInput = getByLabelText('Title') as HTMLInputElement;
    expect(titleInput.value).not.toContain('<script>');
  });

  it('should never expose stream key in plain text logs', async () => {
    const consoleSpy = jest.spyOn(console, 'log');
    
    render(<RTMPSetupStep streamKey="secret-key-12345" />);
    
    const logs = consoleSpy.mock.calls.flat().join(' ');
    expect(logs).not.toContain('secret-key-12345');
    
    consoleSpy.mockRestore();
  });

  it('should enforce authentication on all pages', async () => {
    // Mock unauthenticated state
    mockAuth({ user: null });
    
    const { container } = render(<GoLivePage />);
    
    await waitFor(() => {
      expect(window.location.href).toContain('/auth/signin');
    });
  });
});
```

## Testing Criteria

- [ ] Unit tests: >80% coverage
- [ ] Integration tests: all critical flows
- [ ] E2E tests: complete user journeys
- [ ] Performance tests: <100ms render
- [ ] Security tests: XSS, auth, CSRF
- [ ] Accessibility tests: WCAG 2.1 AA
- [ ] Mobile tests: responsive design
- [ ] Cross-browser: Chrome, Firefox, Safari
- [ ] Load tests: 100 concurrent users
- [ ] Error scenarios: all error types

## Acceptance Criteria

- [ ] All wizard steps have unit tests
- [ ] Complete wizard flow integration test
- [ ] E2E test for successful stream creation
- [ ] E2E test for quota exceeded
- [ ] E2E test for RTMP setup
- [ ] Performance tests pass
- [ ] Security tests pass
- [ ] Accessibility tests pass
- [ ] Error handling tests pass
- [ ] Real-time features tested
- [ ] CI/CD pipeline runs all tests
- [ ] Test coverage report generated

## Related Tasks

- **Depends On**: All Phase 2 tasks
- **Blocks**: Phase 2 completion
- **Related**: All implementation tasks

## References

- [ADR-002: Phase 2 Architecture](/docs/architecture/ADR-002-phase2-golive-architecture.md)

---

**Last Updated**: 2025-11-06
**Reviewed By**: N/A
**Implementation Status**: Not Started
