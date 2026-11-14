#!/usr/bin/env node
// Smoke test: start the built application and check that it continues to run.
// Usage: node scripts/smoke-start.mjs <path to the executable>

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const RUN_TIME_MS = 10_000

const executable = process.argv[2]
if (!executable) {
  console.error('Usage: node scripts/smoke-start.mjs <path to the executable>')
  process.exit(2)
}
if (!existsSync(executable)) {
  console.error(`The executable does not exist: ${executable}`)
  process.exit(2)
}

const child = spawn(executable, [], { stdio: 'inherit' })
let isDone = false

function finish(code, message) {
  if (isDone) return
  isDone = true
  clearTimeout(timer)
  const log = code === 0 ? console.log : console.error
  log(message)
  process.exit(code)
}

const timer = setTimeout(() => {
  child.kill()
  finish(0, `PASS: the application ran for ${RUN_TIME_MS / 1000} seconds.`)
}, RUN_TIME_MS)

child.on('error', (error) => {
  finish(1, `FAIL: the application did not start: ${error.message}`)
})

child.on('exit', (code, signal) => {
  finish(
    1,
    `FAIL: the application stopped early (code ${code}, signal ${signal}).`,
  )
})
