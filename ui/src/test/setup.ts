import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, expect } from 'vitest'

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

// jsdom has no canvas. axe-core asks for one, and jsdom then prints a message.
HTMLCanvasElement.prototype.getContext = () => null

/**
 * Rules of axe-core that a component test cannot check.
 * - `color-contrast`: jsdom does not calculate layout or colours.
 * - `region`: a test renders one component without the landmarks of the application.
 */
const DISABLED_AXE_RULES = ['color-contrast', 'region']
const MAX_HTML_LENGTH = 200

/** Returns one line for each element that breaks an accessibility rule of axe-core. */
async function accessibilityViolations(): Promise<string[]> {
  if (!document.body.firstElementChild) return []
  const results = await axe.run(document.body, {
    rules: Object.fromEntries(
      DISABLED_AXE_RULES.map((rule) => [rule, { enabled: false }]),
    ),
  })
  return results.violations.flatMap((violation) =>
    violation.nodes.map(
      (node) =>
        `${violation.id}: ${violation.help}: ${node.html.slice(0, MAX_HTML_LENGTH)}`,
    ),
  )
}

// Each test also checks the accessibility rules on the DOM that it leaves.
// A test fails if its last state breaks a rule.
afterEach(async () => {
  try {
    expect(await accessibilityViolations()).toEqual([])
  } finally {
    cleanup()
    localStorage.clear()
    delete document.documentElement.dataset.theme
  }
})
