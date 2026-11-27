#!/usr/bin/env node
// Runs the test pages of dist/pages/ in one browser engine, and prints the results.
// The pages come from a local server that sends the content security policy of
// src-tauri/tauri.conf.json. Run `node build.mjs` first.
//
// Usage:
//   node measure.mjs chromium    Chrome, Chromium, or Edge, in headless mode.
//                                BROWSER_PATH names the program, if the script does not find it.
//   node measure.mjs webkitgtk   WebKitGTK, the engine of Tauri on Linux. Linux only.
//   node measure.mjs serve       Only the server. Open the pages in a browser, for example
//                                Safari on macOS. The page shows its results as JSON.
//
// The script writes the results to dist/results/<engine>-<page>.json.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'

const root = import.meta.dirname
const PORT = Number(process.env.PORT ?? 8765)
const PAGES = ['csp', 'perf']
const PAGE_TIMEOUT_MS = 15 * 60 * 1000

const BROWSERS = [
  process.env.BROWSER_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
]

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
}

function applicationPolicy() {
  const file = join(root, '..', '..', 'src-tauri', 'tauri.conf.json')
  return JSON.parse(readFileSync(file, 'utf8')).app.security.csp
}

function startServer(policy) {
  const dist = join(root, 'dist', 'pages')
  const server = createServer(async (request, response) => {
    // The URL parser removes `..` from the path.
    const path = new URL(request.url, 'http://localhost').pathname
    try {
      const body = await readFile(join(dist, path))
      response.writeHead(200, {
        'content-type': MIME[extname(path)] ?? 'application/octet-stream',
        'content-security-policy': policy,
      })
      response.end(body)
    } catch {
      response.writeHead(404).end()
    }
  })
  return new Promise((resolve) =>
    server.listen(PORT, '127.0.0.1', () => resolve(server)),
  )
}

const address = (page) => `http://127.0.0.1:${PORT}/${page}.html`

async function runChromium(page) {
  const program = BROWSERS.find((path) => path && existsSync(path))
  if (!program)
    throw new Error(
      'No browser found. Set BROWSER_PATH to Chrome, Chromium, or Edge.',
    )
  const { default: puppeteer } = await import('puppeteer-core')
  const browser = await puppeteer.launch({
    executablePath: program,
    headless: true,
    protocolTimeout: 0,
  })
  try {
    const tab = await browser.newPage()
    await tab.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 })
    const pageErrors = []
    tab.on('pageerror', (error) => pageErrors.push(String(error)))
    tab.on('console', (message) => {
      if (message.text().startsWith('[measure]')) console.error(message.text())
    })
    // A module with `await` at the top level delays the load event. Do not wait for it.
    await tab.goto(address(page), { waitUntil: 'domcontentloaded', timeout: 0 })
    await tab.waitForFunction(() => document.title === 'DONE', {
      timeout: PAGE_TIMEOUT_MS,
    })
    const results = await tab.evaluate(() => window.__results)
    return { ...results, browser: await browser.version(), pageErrors }
  } finally {
    await browser.close()
  }
}

async function runWebkitgtk(page) {
  if (process.platform !== 'linux')
    throw new Error('WebKitGTK is available on Linux only.')
  const out = join(root, 'dist', 'results', `.webkitgtk-${page}.json`)
  // A clean environment. A terminal of a snap package (for example VS Code) sets library
  // paths that stop the system Python.
  const keep = ['HOME', 'DISPLAY', 'XDG_RUNTIME_DIR', 'XAUTHORITY']
  // The off-screen window needs the X11 backend. With the Wayland backend, GDK cannot
  // make the OpenGL context.
  const env = { PATH: '/usr/bin:/bin', GDK_BACKEND: 'x11' }
  for (const name of keep) if (process.env[name]) env[name] = process.env[name]
  // Not `spawnSync`: the server of this process must answer while the child runs.
  const child = spawn(
    '/usr/bin/python3',
    [join(root, 'run-webkit.py'), address(page), out],
    {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  // WebKit writes the console of the page and many GDK warnings. Show the progress,
  // the errors of the page, and the errors of the script.
  const show = (stream) => {
    let rest = ''
    stream.on('data', (chunk) => {
      const lines = (rest + chunk).split('\n')
      rest = lines.pop()
      for (const line of lines) {
        const at = Math.max(
          line.indexOf('[measure]'),
          line.indexOf('CONSOLE JS ERROR'),
        )
        if (at >= 0) console.error(line.slice(at))
        else if (line.trim() && !line.includes('Gdk-')) console.error(line)
      }
    })
  }
  show(child.stdout)
  show(child.stderr)
  const status = await new Promise((resolve) => child.on('close', resolve))
  if (status !== 0)
    throw new Error(`run-webkit.py failed with status ${status}.`)
  return JSON.parse(readFileSync(out, 'utf8'))
}

function printCsp(results) {
  const cases = Object.entries(results.cases)
  const failed = cases.filter(([, result]) => !result.ok)
  console.log(
    `The policy refuses string evaluation (control): ${results.evalBlocked ? 'yes' : 'NO'}`,
  )
  console.log(
    `Cases that drew a chart: ${cases.length - failed.length} of ${cases.length}`,
  )
  console.log(
    `Violations of the policy by ECharts: ${results.violationsBeforeControl}`,
  )
  for (const [name, result] of failed)
    console.log(`  failed: ${name}: ${result.error}`)
  for (const [name, result] of cases) {
    if (result.tipError)
      console.log(`  showTip failed: ${name}: ${result.tipError}`)
  }
  for (const violation of results.violations) {
    if (violation.phase !== 'control')
      console.log(`  violation: ${JSON.stringify(violation)}`)
  }
}

function printPerf(results) {
  console.log(`Conversion of 100 000 text cells: ${results.convertMs} ms`)
  const table = {}
  for (const [name, result] of Object.entries(results.cases)) {
    table[name] = result.timeoutMs
      ? { 'first draw': `more than ${result.timeoutMs / 1000} s` }
      : {
          'first draw': `${result.firstMs} ms`,
          zoom: `${result.zoomMs} ms`,
          runs: result.runs.join(' '),
        }
  }
  console.table(table)
}

const [engine] = process.argv.slice(2)
const runners = { chromium: runChromium, webkitgtk: runWebkitgtk }
if (engine !== 'serve' && !runners[engine]) {
  console.error('Usage: node measure.mjs <chromium|webkitgtk|serve>')
  process.exit(2)
}
if (!existsSync(join(root, 'dist', 'pages', 'csp.html'))) {
  console.error('dist/pages/ is not there. Run `node build.mjs` first.')
  process.exit(2)
}

const policy = applicationPolicy()
const server = await startServer(policy)
console.log(`Content security policy: ${policy}`)

if (engine === 'serve') {
  for (const page of PAGES) console.log(`Open ${address(page)}`)
  console.log(
    'Each page shows its results as JSON when the title is DONE. Stop with Ctrl+C.',
  )
} else {
  mkdirSync(join(root, 'dist', 'results'), { recursive: true })
  let failed = false
  for (const page of PAGES) {
    console.log(`\n== ${page} in ${engine}`)
    try {
      const results = await runners[engine](page)
      writeFileSync(
        join(root, 'dist', 'results', `${engine}-${page}.json`),
        JSON.stringify(results, null, 1),
      )
      console.log(
        `Engine: ${results.browser ?? `WebKitGTK ${results.webkitgtk}`}, ECharts ${results.echarts}`,
      )
      if (page === 'csp') printCsp(results)
      else printPerf(results)
      for (const error of results.errors ?? [])
        console.log(`  error at "${error.step}": ${error.message}`)
      for (const error of results.pageErrors ?? [])
        console.log(`  page error: ${error}`)
    } catch (error) {
      failed = true
      console.error(String(error))
    }
  }
  server.close()
  process.exit(failed ? 1 : 0)
}
