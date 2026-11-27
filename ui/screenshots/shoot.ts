import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer } from 'vite'
import { SHOTS, type Shot } from './shots.ts'

/**
 * Makes the screenshots of the UI for the website. It starts the screenshot page
 * (the real UI with a fake backend), and drives each state with Playwright.
 *
 * Usage: pnpm --dir ui screenshots [name ...]
 */

const OUTPUT = fileURLToPath(
  new URL('../../docs/screenshots/', import.meta.url),
)
const CONFIG = fileURLToPath(new URL('./vite.config.ts', import.meta.url))

/** The time that the clock of the page shows: a Thursday afternoon. */
const NOW = new Date('2026-11-26T14:30:00+01:00')
const VIEWPORT = { width: 1440, height: 900 }

/** The themes of the application. The system theme gives no other image. */
const THEMES = ['light', 'dark', 'neon', 'high-contrast'] as const
type ShotTheme = (typeof THEMES)[number]

/** Stops carets, animations, and transitions, so that each run gives the same image. */
const STILL_CSS = `
*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
}
`

async function openPage(
  browser: Browser,
  url: string,
  shot: Shot,
  theme: ShotTheme,
): Promise<Page> {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: theme === 'light' ? 'light' : 'dark',
    locale: 'en-US',
    timezoneId: 'Europe/Berlin',
  })
  const page = await context.newPage()
  page.on('pageerror', (error) =>
    console.error(`[${shot.name}] ${error.message}`),
  )
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning')
      console.error(`[${shot.name}] ${message.text()}`)
  })
  await page.clock.setFixedTime(NOW)
  await page.addInitScript(
    ({ theme, shell, tabs }) => {
      localStorage.setItem('tabloxide.theme', theme)
      localStorage.setItem('tabloxide.shell', JSON.stringify(shell))
      Object.assign(window, { __SCREENSHOT_TABS__: tabs })
    },
    {
      theme,
      shell: shot.shell ?? {},
      tabs: shot.tabs ?? null,
    },
  )
  await page.goto(url)
  await page.addStyleTag({ content: STILL_CSS })
  await page.waitForSelector('.app-shell')
  return page
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
  const loading = await page.getByText(/Loading…|Reading the schema/).count()
  if (loading > 0) console.warn('A loading text is still visible.')
}

async function main(): Promise<void> {
  // A name selects a shot in all themes (`plan`), or in one theme (`plan-dark`).
  const names = process.argv.slice(2)
  const jobs = SHOTS.flatMap((shot) =>
    THEMES.map((theme) => ({ shot, theme, file: `${shot.name}-${theme}` })),
  ).filter(
    ({ shot, file }) =>
      names.length === 0 || names.includes(shot.name) || names.includes(file),
  )
  await mkdir(OUTPUT, { recursive: true })
  const server = await createServer({ configFile: CONFIG })
  await server.listen()
  const url = server.resolvedUrls?.local[0] ?? 'http://localhost:1431/'
  const browser = await chromium.launch()
  try {
    for (const { shot, theme, file } of jobs) {
      const page = await openPage(browser, url, shot, theme)
      await shot.drive(page)
      await settle(page)
      await page.screenshot({
        path: `${OUTPUT}${file}.png`,
        animations: 'disabled',
        caret: 'hide',
      })
      console.log(`docs/screenshots/${file}.png`)
      await page.context().close()
    }
  } finally {
    await browser.close()
    await server.close()
  }
}

await main()
