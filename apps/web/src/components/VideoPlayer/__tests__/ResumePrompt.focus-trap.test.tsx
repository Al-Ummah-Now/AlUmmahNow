/**
 * Focus Trap Tests for ResumePrompt Component
 *
 * Tests WCAG 2.1 Level A compliance for keyboard accessibility.
 *
 * WCAG Compliance:
 * - 2.1.1 Keyboard (Level A) - All functionality via keyboard
 * - 2.1.2 No Keyboard Trap (Level A) - Can escape with ESC
 * - 2.4.3 Focus Order (Level A) - Logical focus order
 * - 2.4.7 Focus Visible (Level AA) - Focus indicators visible
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResumePrompt } from '../ResumePrompt';

describe('ResumePrompt - Focus Trap', () => {
  const defaultProps = {
    videoTitle: 'Test Video',
    savedTime: 120, // 2:00
    duration: 300, // 5:00
    thumbnailUrl: 'https://example.com/thumb.jpg',
    onResume: jest.fn(),
    onStartFromBeginning: jest.fn(),
    onDismiss: jest.fn(),
    autoResumeSeconds: 10, // Long timeout to prevent auto-resume during tests
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Initial Focus', () => {
    test('should focus the resume button on mount', () => {
      render(<ResumePrompt {...defaultProps} />);

      const resumeButton = screen.getByRole('button', { name: /resume/i });
      expect(resumeButton).toHaveFocus();
    });
  });

  describe('Tab Key Navigation', () => {
    test('should cycle focus forward through all buttons', async () => {
      const user = userEvent.setup();
      render(<ResumePrompt {...defaultProps} />);

      // Get all focusable elements
      const closeButton = screen.getByRole('button', { name: /close/i });
      const resumeButton = screen.getByRole('button', { name: /resume/i });
      const startOverButton = screen.getByRole('button', { name: /start/i });

      // Initial focus should be on resume button (autoFocus)
      expect(resumeButton).toHaveFocus();

      // Tab to next button (start over)
      await user.tab();
      expect(startOverButton).toHaveFocus();

      // Tab to close button
      await user.tab();
      expect(closeButton).toHaveFocus();

      // Tab should wrap to first button (resume)
      await user.tab();
      expect(resumeButton).toHaveFocus();
    });

    test('should cycle focus backward with Shift+Tab', async () => {
      const user = userEvent.setup();
      render(<ResumePrompt {...defaultProps} />);

      const closeButton = screen.getByRole('button', { name: /close/i });
      const resumeButton = screen.getByRole('button', { name: /resume/i });
      const startOverButton = screen.getByRole('button', { name: /start/i });

      // Initial focus on resume button
      expect(resumeButton).toHaveFocus();

      // Shift+Tab should wrap to last button (close)
      await user.tab({ shift: true });
      expect(closeButton).toHaveFocus();

      // Shift+Tab to previous button (start over)
      await user.tab({ shift: true });
      expect(startOverButton).toHaveFocus();

      // Shift+Tab to resume button
      await user.tab({ shift: true });
      expect(resumeButton).toHaveFocus();
    });

    test('should trap focus within modal', async () => {
      const user = userEvent.setup();
      render(<ResumePrompt {...defaultProps} />);

      // Tab through all elements multiple times
      for (let i = 0; i < 10; i++) {
        await user.tab();
      }

      // Focus should still be within the modal (one of the buttons)
      const focusedElement = document.activeElement;
      const modalButtons = screen.getAllByRole('button');

      expect(modalButtons).toContain(focusedElement);
    });
  });

  describe('ESC Key Handling', () => {
    test('should close modal on ESC key press', async () => {
      const user = userEvent.setup();
      const onDismiss = jest.fn();

      render(<ResumePrompt {...defaultProps} onDismiss={onDismiss} />);

      await user.keyboard('{Escape}');

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    test('should not trap user with ESC key (WCAG 2.1.2)', async () => {
      const user = userEvent.setup();
      const onDismiss = jest.fn();

      render(<ResumePrompt {...defaultProps} onDismiss={onDismiss} />);

      // User should be able to escape with ESC
      await user.keyboard('{Escape}');

      expect(onDismiss).toHaveBeenCalled();
    });
  });

  describe('Keyboard Interactions', () => {
    test('should activate resume button with Enter key', async () => {
      const user = userEvent.setup();
      const onResume = jest.fn();

      render(<ResumePrompt {...defaultProps} onResume={onResume} />);

      const resumeButton = screen.getByRole('button', { name: /resume/i });
      resumeButton.focus();

      await user.keyboard('{Enter}');

      expect(onResume).toHaveBeenCalledTimes(1);
    });

    test('should activate resume button with Space key', async () => {
      const user = userEvent.setup();
      const onResume = jest.fn();

      render(<ResumePrompt {...defaultProps} onResume={onResume} />);

      const resumeButton = screen.getByRole('button', { name: /resume/i });
      resumeButton.focus();

      await user.keyboard(' ');

      expect(onResume).toHaveBeenCalledTimes(1);
    });

    test('should activate start over button with keyboard', async () => {
      const user = userEvent.setup();
      const onStartFromBeginning = jest.fn();

      render(<ResumePrompt {...defaultProps} onStartFromBeginning={onStartFromBeginning} />);

      const startOverButton = screen.getByRole('button', { name: /start/i });

      // Tab to start over button
      await user.tab();
      expect(startOverButton).toHaveFocus();

      // Activate with Enter
      await user.keyboard('{Enter}');

      expect(onStartFromBeginning).toHaveBeenCalledTimes(1);
    });

    test('should close modal with close button via keyboard', async () => {
      const user = userEvent.setup();
      const onDismiss = jest.fn();

      render(<ResumePrompt {...defaultProps} onDismiss={onDismiss} />);

      const closeButton = screen.getByRole('button', { name: /close/i });

      // Tab to close button (resume -> start over -> close)
      await user.tab();
      await user.tab();
      expect(closeButton).toHaveFocus();

      // Activate with Enter
      await user.keyboard('{Enter}');

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe('ARIA Attributes', () => {
    test('should have proper dialog role and aria-modal', () => {
      render(<ResumePrompt {...defaultProps} />);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    test('should have aria-labelledby pointing to title', () => {
      render(<ResumePrompt {...defaultProps} />);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-labelledby', 'resume-prompt-title');

      const title = document.getElementById('resume-prompt-title');
      expect(title).toBeInTheDocument();
    });

    test('should have aria-describedby pointing to description', () => {
      render(<ResumePrompt {...defaultProps} />);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-describedby', 'resume-prompt-description');

      const description = document.getElementById('resume-prompt-description');
      expect(description).toBeInTheDocument();
    });

    test('should have accessible labels on all buttons', () => {
      render(<ResumePrompt {...defaultProps} />);

      const resumeButton = screen.getByRole('button', { name: /resume/i });
      const startOverButton = screen.getByRole('button', { name: /start/i });
      const closeButton = screen.getByRole('button', { name: /close/i });

      expect(resumeButton).toBeInTheDocument();
      expect(startOverButton).toBeInTheDocument();
      expect(closeButton).toBeInTheDocument();
    });
  });

  describe('Focus Order (WCAG 2.4.3)', () => {
    test('should have logical focus order: resume -> start over -> close', async () => {
      const user = userEvent.setup();
      render(<ResumePrompt {...defaultProps} />);

      const resumeButton = screen.getByRole('button', { name: /resume/i });
      const startOverButton = screen.getByRole('button', { name: /start/i });
      const closeButton = screen.getByRole('button', { name: /close/i });

      // Initial focus
      expect(resumeButton).toHaveFocus();

      // Tab to next
      await user.tab();
      expect(startOverButton).toHaveFocus();

      // Tab to next
      await user.tab();
      expect(closeButton).toHaveFocus();
    });
  });

  describe('Bilingual Support', () => {
    test('should maintain focus trap in RTL mode', async () => {
      const user = userEvent.setup();
      render(<ResumePrompt {...defaultProps} lang="ar" />);

      const resumeButton = screen.getByRole('button', { name: /استئناف/i });

      // Should still have focus on resume button
      expect(resumeButton).toHaveFocus();

      // Tab should still cycle through buttons
      await user.tab();
      await user.tab();
      await user.tab();

      // Should wrap back to resume button
      expect(resumeButton).toHaveFocus();
    });
  });

  describe('Edge Cases', () => {
    test('should handle rapid Tab key presses', async () => {
      const user = userEvent.setup();
      render(<ResumePrompt {...defaultProps} />);

      // Rapid Tab presses (20 times)
      for (let i = 0; i < 20; i++) {
        await user.tab();
      }

      // Focus should still be within modal
      const focusedElement = document.activeElement;
      const modalButtons = screen.getAllByRole('button');

      expect(modalButtons).toContain(focusedElement);
    });

    test('should handle rapid Shift+Tab key presses', async () => {
      const user = userEvent.setup();
      render(<ResumePrompt {...defaultProps} />);

      // Rapid Shift+Tab presses (20 times)
      for (let i = 0; i < 20; i++) {
        await user.tab({ shift: true });
      }

      // Focus should still be within modal
      const focusedElement = document.activeElement;
      const modalButtons = screen.getAllByRole('button');

      expect(modalButtons).toContain(focusedElement);
    });

    test('should handle Tab and Shift+Tab alternating', async () => {
      const user = userEvent.setup();
      render(<ResumePrompt {...defaultProps} />);

      const resumeButton = screen.getByRole('button', { name: /resume/i });
      const startOverButton = screen.getByRole('button', { name: /start/i });

      // Tab forward
      await user.tab();
      expect(startOverButton).toHaveFocus();

      // Tab backward
      await user.tab({ shift: true });
      expect(resumeButton).toHaveFocus();

      // Tab forward
      await user.tab();
      expect(startOverButton).toHaveFocus();

      // Tab backward
      await user.tab({ shift: true });
      expect(resumeButton).toHaveFocus();
    });
  });
});
