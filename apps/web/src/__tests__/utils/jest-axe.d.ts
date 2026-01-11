/**
 * Type declaration for jest-axe (optional dependency)
 * This allows the code to compile even when jest-axe is not installed.
 * The actual import is handled with a try/catch at runtime.
 */
declare module 'jest-axe' {
  export function axe(container: Element): Promise<{ violations: unknown[] }>;
  export function toHaveNoViolations(): jest.CustomMatcherResult;
}
