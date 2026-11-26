#!/usr/bin/env node
// Writes the index of the official connectors (index.json) with a new connector
// version. The output has no signature. The maintainer signs it on their own machine:
//
//   minisign -S -s <key> -m index.json
//
// and copies index.json and index.json.minisig to the website repository, into
// public/connectors/v1/. Section 10.5 of docs/Connector Design.md gives the rules.
//
// Usage:
//   node scripts/connector-index.mjs --dir <folder with the packages>
//     --manifest <connector.toml> --base-url <address of the release files>
//     [--current <the index.json that is published now>] [--days 90]
//
// The script writes the JSON to the standard output.

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

const DAY_SECONDS = 24 * 60 * 60

/** Reads the fields of a connector.toml that the index needs. Only `key = "value"` lines. */
export function readManifest(text) {
  const fields = {}
  for (const line of text.split('\n')) {
    const match = /^\s*([a-z_]+)\s*=\s*(?:"([^"]*)"|(\d+))\s*$/.exec(line)
    if (match) fields[match[1]] = match[2] ?? Number(match[3])
  }
  for (const key of ['engine', 'display_name', 'version', 'protocol']) {
    if (fields[key] === undefined)
      throw new Error(`connector.toml has no ${key}.`)
  }
  return fields
}

/** Returns the target triple of a package name, for example `x86_64-unknown-linux-gnu`. */
export function targetOf(fileName, engine, version) {
  const prefix = `tabloxide-connector-${engine}-${version}-`
  if (!fileName.startsWith(prefix) || !fileName.endsWith('.tar.gz')) return null
  return fileName.slice(prefix.length, -'.tar.gz'.length)
}

/**
 * Returns the index with the new connector version. The new version replaces an
 * entry with the same engine and version. `packages` is a list of `{ name, size, sha256 }`.
 */
export function buildIndex({
  current,
  manifest,
  packages,
  baseUrl,
  now,
  days,
}) {
  const byTarget = {}
  for (const file of packages) {
    const target = targetOf(file.name, manifest.engine, manifest.version)
    if (target === null) continue
    byTarget[target] = {
      url: `${baseUrl.replace(/\/$/, '')}/${file.name}`,
      size: file.size,
      sha256: file.sha256,
    }
  }
  if (Object.keys(byTarget).length === 0) {
    throw new Error('The folder has no package of this connector version.')
  }
  const entry = {
    engine: manifest.engine,
    display_name: manifest.display_name,
    version: manifest.version,
    protocol: manifest.protocol,
    publisher: manifest.publisher ?? 'Tabloxide project',
    packages: byTarget,
  }
  const others = (current?.connectors ?? []).filter(
    (item) => !(item.engine === entry.engine && item.version === entry.version),
  )
  return {
    format: 1,
    issued: Math.max(now, (current?.issued ?? 0) + 1),
    expires: now + days * DAY_SECONDS,
    connectors: [...others, entry],
  }
}

function readPackages(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.tar.gz'))
    .map((name) => {
      const path = join(dir, name)
      return {
        name,
        size: statSync(path).size,
        sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
      }
    })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      manifest: { type: 'string' },
      'base-url': { type: 'string' },
      current: { type: 'string' },
      days: { type: 'string', default: '90' },
    },
  })
  if (!values.dir || !values.manifest || !values['base-url']) {
    console.error(
      'Usage: connector-index.mjs --dir <folder> --manifest <connector.toml> --base-url <url> [--current <index.json>] [--days 90]',
    )
    process.exit(2)
  }
  const index = buildIndex({
    current: values.current
      ? JSON.parse(readFileSync(values.current, 'utf8'))
      : null,
    manifest: readManifest(readFileSync(values.manifest, 'utf8')),
    packages: readPackages(values.dir),
    baseUrl: values['base-url'],
    now: Math.floor(Date.now() / 1000),
    days: Number(values.days),
  })
  process.stdout.write(`${JSON.stringify(index, null, 2)}\n`)
}
