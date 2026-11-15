import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom does not implement ResizeObserver. The pane library needs the constructor.
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= ResizeObserverStub

// A Tauri channel registers its callback in the webview. Tests have no webview.
// A test sends a message to a channel through its `onmessage` property.
let nextCallbackId = 1
Object.defineProperty(window, '__TAURI_INTERNALS__', {
  value: {
    transformCallback: () => nextCallbackId++,
    unregisterCallback: () => {},
  },
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  delete document.documentElement.dataset.theme
})
