// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom'

// jsdom has no TextEncoder/TextDecoder, and Next's server modules create one when they load
// (next/dist/server/stream-utils): any suite whose imports reach them failed to load (#1183's
// category-suggestion-form run). Node's own implementations, only where the environment lacks them.
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util'
if (typeof globalThis.TextEncoder === 'undefined') globalThis.TextEncoder = NodeTextEncoder
if (typeof globalThis.TextDecoder === 'undefined') globalThis.TextDecoder = NodeTextDecoder

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: jest.fn(),
      replace: jest.fn(),
      prefetch: jest.fn(),
      back: jest.fn(),
      pathname: '/',
      query: {},
      asPath: '/',
    }
  },
  useSearchParams() {
    return new URLSearchParams()
  },
  usePathname() {
    return '/'
  },
}))

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return []
  }
  unobserve() {}
}

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
}

// Mock matchMedia (jsdom only: server tests opt into `@jest-environment node`)
if (typeof window !== 'undefined') Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
})
