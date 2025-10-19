/**
 * Focus Trap Hook
 *
 * Traps keyboard focus within a container element for modal dialogs.
 * Implements WCAG 2.1 Level A compliance for keyboard accessibility.
 *
 * Features:
 * - Focus cycles within modal (Tab wraps from last to first element)
 * - Shift+Tab cycles backwards
 * - First focusable element receives focus on mount
 * - Focus returns to trigger element on unmount
 * - ESC key handling (via separate listener)
 *
 * WCAG Compliance:
 * - 2.1.1 Keyboard (Level A) - All functionality via keyboard
 * - 2.1.2 No Keyboard Trap (Level A) - Can escape with ESC
 * - 2.4.3 Focus Order (Level A) - Logical focus order
 * - 2.4.7 Focus Visible (Level AA) - Focus indicators visible
 *
 * Usage:
 * ```tsx
 * const containerRef = useFocusTrap(isModalOpen);
 * return <div ref={containerRef}>...</div>;
 * ```
 */

import { useEffect, useRef } from 'react';

/**
 * Selector for all focusable elements
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Get all focusable elements within a container
 */
function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];

  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * Focus Trap Hook
 *
 * @param isActive - Whether the focus trap is active
 * @returns Ref to attach to the container element
 */
export function useFocusTrap(isActive: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    // Store current focus to restore later
    previousFocusRef.current = document.activeElement as HTMLElement;

    // Get all focusable elements
    const focusableElements = getFocusableElements(containerRef.current);

    // Focus first element if no element is focused
    if (focusableElements.length > 0 && !containerRef.current.contains(document.activeElement)) {
      focusableElements[0].focus();
    }

    /**
     * Handle Tab key to trap focus
     */
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements(containerRef.current);
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey) {
        // Shift+Tab: Moving backwards
        if (document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab: Moving forwards
        if (document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    };

    // Add event listener
    document.addEventListener('keydown', handleKeyDown);

    // Cleanup
    return () => {
      document.removeEventListener('keydown', handleKeyDown);

      // Restore previous focus
      if (previousFocusRef.current && document.body.contains(previousFocusRef.current)) {
        previousFocusRef.current.focus();
      }
    };
  }, [isActive]);

  return containerRef;
}
