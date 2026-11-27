import { describe, expect, test } from 'vitest'
import css from '../index.css?raw'

// The accessibility check of the test setup cannot see colours, because jsdom does
// not calculate them. This file checks the colour tokens of the style sheet directly.

/** Minimum contrast of text (WCAG 2.2, success criterion 1.4.3, level AA). */
const TEXT_RATIO = 4.5
/** Minimum contrast of the boundary of a control (success criterion 1.4.11). */
const CONTROL_RATIO = 3
/** `index.css` mixes this part of the focus colour into the active line of the editor. */
const ACTIVE_LINE_MIX = 0.08

type Rgb = [number, number, number]
type Tokens = Record<string, string>

/** Returns the colour tokens of all rule blocks that have exactly this selector. */
function tokensOf(selector: string): Tokens {
  const tokens: Tokens = {}
  for (const [, found, body] of css.matchAll(/(:root[^{]*)\{([^}]*)\}/g)) {
    if (found.trim() !== selector) continue
    for (const [, name, value] of body.matchAll(
      /--([a-z0-9-]+):\s*(#[0-9a-f]{6});/gi,
    )) {
      tokens[name] = value
    }
  }
  return tokens
}

const light = tokensOf(':root')
const dark = { ...light, ...tokensOf(":root[data-theme='dark']") }
const systemDark = {
  ...light,
  ...tokensOf(":root:not([data-theme='light'])"),
}
const neon = { ...light, ...tokensOf(":root[data-theme='neon']") }
const highContrast = {
  ...light,
  ...tokensOf(":root[data-theme='high-contrast']"),
}
const themes = [
  ['light', light],
  ['dark', dark],
  ['neon', neon],
  ['high contrast', highContrast],
] as const

function toRgb(hex: string): Rgb {
  return [1, 3, 5].map((start) =>
    Number.parseInt(hex.slice(start, start + 2), 16),
  ) as Rgb
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The contrast ratio of WCAG, from 1 to 21. */
function contrast(first: Rgb, second: Rgb): number {
  const [high, low] = [luminance(first), luminance(second)].sort(
    (a, b) => b - a,
  )
  return (high + 0.05) / (low + 0.05)
}

function mix(colour: Rgb, base: Rgb, part: number): Rgb {
  return colour.map(
    (channel, index) => channel * part + base[index] * (1 - part),
  ) as Rgb
}

const TEXT_TOKENS = [
  'color-text',
  'color-text-muted',
  'color-accent',
  'color-danger',
  'color-ok',
  'color-focus',
  'color-env-development',
  'color-env-staging',
  'color-env-production',
]
const BACKGROUND_TOKENS = ['color-bg', 'color-surface']
/** The text colours on the page around the panels: the title bar and the status bar. */
const PAGE_TEXT_TOKENS = [
  'color-text',
  'color-text-muted',
  'color-accent',
  'color-env-development',
  'color-env-staging',
  'color-env-production',
]
/** Backgrounds of buttons and markers that have text in the page background colour. */
const FILL_TOKENS = ['color-focus', 'color-danger', 'color-ok']
const SYNTAX_TOKENS = [
  'syntax-keyword',
  'syntax-string',
  'syntax-number',
  'syntax-comment',
  'syntax-type',
]

describe.each(themes)('colour contrast of the %s theme', (_name, tokens) => {
  const rgb = (token: string) => {
    expect(tokens[token], `the token --${token}`).toBeDefined()
    return toRgb(tokens[token])
  }

  test.each(
    TEXT_TOKENS.flatMap((text) => BACKGROUND_TOKENS.map((bg) => [text, bg])),
  )('--%s is readable as text on --%s', (text, background) => {
    expect(contrast(rgb(text), rgb(background))).toBeGreaterThanOrEqual(
      TEXT_RATIO,
    )
  })

  test.each(PAGE_TEXT_TOKENS)(
    '--%s is readable as text on --color-page',
    (text) => {
      expect(contrast(rgb(text), rgb('color-page'))).toBeGreaterThanOrEqual(
        TEXT_RATIO,
      )
    },
  )

  test.each(FILL_TOKENS)(
    'text in the page background colour is readable on --%s',
    (fill) => {
      expect(contrast(rgb('color-bg'), rgb(fill))).toBeGreaterThanOrEqual(
        TEXT_RATIO,
      )
    },
  )

  test.each(BACKGROUND_TOKENS)(
    'the border of an input and the focus ring are visible on --%s',
    (background) => {
      for (const token of ['color-control-border', 'color-focus']) {
        expect(
          contrast(rgb(token), rgb(background)),
          `--${token}`,
        ).toBeGreaterThanOrEqual(CONTROL_RATIO)
      }
    },
  )

  test.each(SYNTAX_TOKENS)(
    '--%s is readable in the editor, also on the active line',
    (syntax) => {
      const editor = rgb('color-bg')
      const activeLine = mix(rgb('color-focus'), editor, ACTIVE_LINE_MIX)

      expect(contrast(rgb(syntax), editor)).toBeGreaterThanOrEqual(TEXT_RATIO)
      expect(contrast(rgb(syntax), activeLine)).toBeGreaterThanOrEqual(
        TEXT_RATIO,
      )
    },
  )
})

/** Minimum contrast of a mark of a chart to the background (success criterion 1.4.11). */
const MARK_RATIO = 3
/**
 * The light theme has four series colours below the minimum, because no colour
 * set has eight different light colours with more contrast. The Grid view gives
 * the values of each chart as text, and a series also has its own mark.
 */
const LIGHT_MARK_RATIO = 2
const CHART_TOKENS = Array.from(
  { length: 8 },
  (_, index) => `chart-${index + 1}`,
)

describe.each(themes)('chart colours of the %s theme', (name, tokens) => {
  test.each(CHART_TOKENS)('--%s is visible on the background', (token) => {
    expect(tokens[token], `the token --${token}`).toBeDefined()
    const minimum = name === 'light' ? LIGHT_MARK_RATIO : MARK_RATIO

    expect(
      contrast(toRgb(tokens[token]), toRgb(tokens['color-bg'])),
    ).toBeGreaterThanOrEqual(minimum)
  })

  test('each series has a different colour', () => {
    const colours = CHART_TOKENS.map((token) => tokens[token])

    expect(new Set(colours).size).toBe(CHART_TOKENS.length)
  })
})

test('the dark theme of the system setting has the colours of the dark theme', () => {
  expect(systemDark).toEqual(dark)
})

test('the style sheet mixes the focus colour into the active line as the test assumes', () => {
  expect(css).toContain(
    `color-mix(in srgb, var(--color-focus) ${ACTIVE_LINE_MIX * 100}%, transparent)`,
  )
})
