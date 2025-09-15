import { vi } from 'vitest'
import '@testing-library/jest-dom'

// Mock WebSocket
global.WebSocket = vi.fn(() => ({
  send: vi.fn(),
  close: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  readyState: 1
})) as any

// Mock fetch
global.fetch = vi.fn()

// Mock URL methods
global.URL.createObjectURL = vi.fn()
global.URL.revokeObjectURL = vi.fn()

// Mock navigator.clipboard
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: vi.fn()
  }
})

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks()
})