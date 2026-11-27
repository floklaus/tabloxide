#!/usr/bin/env node
// Builds the test pages into dist/pages/, and builds ECharts in three sizes to measure them.
// Prints the size of each build: minified, gzip, and Brotli.
//
// Usage: node build.mjs

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { build } from 'vite'

const root = import.meta.dirname

const SIZE_BUILDS = {
  basic: 'Line, bar, and scatter, canvas renderer',
  all: 'The 14 series types of the design, two renderers',
  full: 'Complete ECharts',
}

async function run(outDir, input) {
  await build({
    root,
    configFile: false,
    base: './',
    logLevel: 'error',
    build: {
      outDir,
      emptyOutDir: true,
      chunkSizeWarningLimit: 2000,
      rollupOptions: { input },
    },
  })
}

function scriptSizes(dir) {
  const sizes = { raw: 0, gzip: 0, brotli: 0 }
  for (const entry of readdirSync(dir, { recursive: true })) {
    if (!entry.endsWith('.js')) continue
    const bytes = readFileSync(join(dir, entry))
    sizes.raw += bytes.length
    sizes.gzip += gzipSync(bytes, { level: 9 }).length
    sizes.brotli += brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length
  }
  return sizes
}

const kilobytes = (bytes) => `${Math.round(bytes / 1024)} kB`

await run('dist/pages', ['csp.html', 'perf.html'])

const table = {}
for (const [name, label] of Object.entries(SIZE_BUILDS)) {
  const outDir = `dist/size-${name}`
  await run(outDir, `src/size-${name}.js`)
  const sizes = scriptSizes(join(root, outDir))
  table[label] = {
    minified: kilobytes(sizes.raw),
    gzip: kilobytes(sizes.gzip),
    brotli: kilobytes(sizes.brotli),
  }
}
console.table(table)
