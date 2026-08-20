import '@testing-library/jest-dom/vitest'

// jsdom no implementa ResizeObserver y los graficos lo usan para medirse
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (RO as unknown as typeof ResizeObserver)
