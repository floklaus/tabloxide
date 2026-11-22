#!/usr/bin/env node
// Writes the update file (latest.json) that the updater of the application reads.
//
// Usage:
//   node scripts/updater-manifest.mjs --dir <folder> --version <version>
//     --base-url <address of the release files> [--notes-file <file>]
//
// The folder holds the update files of the release and one signature file (.sig)
// for each of them. The script writes the JSON to the standard output.
// Refer to https://v2.tauri.app/plugin/updater/ for the format.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

/** The update file kinds. The order sets the default file of a platform. */
const KINDS = [
  { suffix: '.AppImage', os: 'linux', installer: 'appimage' },
  { suffix: '.deb', os: 'linux', installer: 'deb' },
  { suffix: '.rpm', os: 'linux', installer: 'rpm' },
  { suffix: '.app.tar.gz', os: 'darwin', installer: 'app' },
  { suffix: '-setup.exe', os: 'windows', installer: 'nsis' },
  { suffix: '.msi', os: 'windows', installer: 'msi' },
]

const ARCHITECTURES = [
  { pattern: /(^|[_.-])(amd64|x86_64|x64)([_.-]|$)/, arch: 'x86_64' },
  { pattern: /(^|[_.-])(aarch64|arm64)([_.-]|$)/, arch: 'aarch64' },
  { pattern: /(^|[_.-])(i386|i686|x86)([_.-]|$)/, arch: 'i686' },
]

/** Returns the platform of an update file, or `null` for a different file. */
export function platformOf(fileName) {
  const kind = KINDS.find((candidate) => fileName.endsWith(candidate.suffix))
  if (!kind) return null
  const architecture = ARCHITECTURES.find((candidate) =>
    candidate.pattern.test(fileName),
  )
  if (!architecture) return null
  return { os: kind.os, arch: architecture.arch, installer: kind.installer }
}

/**
 * Builds the update manifest.
 * `files` is a list of `{ name, signature }`. Only files with a known platform go
 * into the manifest. Each file gets the key `<os>-<arch>-<installer>`. The first file
 * of each platform in the order of `KINDS` also gets the key `<os>-<arch>`.
 */
export function buildManifest({ version, notes, pubDate, baseUrl, files }) {
  const entries = files
    .map((file) => ({ ...file, platform: platformOf(file.name) }))
    .filter((file) => file.platform !== null)
    .sort(
      (a, b) =>
        KINDS.findIndex((kind) => kind.installer === a.platform.installer) -
        KINDS.findIndex((kind) => kind.installer === b.platform.installer),
    )
  if (entries.length === 0) {
    throw new Error('The folder has no update file with a signature.')
  }
  const base = baseUrl.replace(/\/+$/, '')
  const platforms = {}
  for (const entry of entries) {
    const { os, arch, installer } = entry.platform
    const value = {
      signature: entry.signature.trim(),
      url: `${base}/${encodeURIComponent(entry.name)}`,
    }
    platforms[`${os}-${arch}-${installer}`] = value
    platforms[`${os}-${arch}`] ??= value
  }
  return {
    version: version.replace(/^v/, ''),
    notes: notes.trim(),
    pub_date: pubDate,
    platforms,
  }
}

/** Reads the update files and their signatures from `directory`. */
export function readSignedFiles(directory) {
  const names = new Set(readdirSync(directory))
  return [...names]
    .filter((name) => !name.endsWith('.sig') && names.has(`${name}.sig`))
    .map((name) => ({
      name,
      signature: readFileSync(join(directory, `${name}.sig`), 'utf8'),
    }))
}

function main() {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      version: { type: 'string' },
      'base-url': { type: 'string' },
      'notes-file': { type: 'string' },
    },
  })
  if (!values.dir || !values.version || !values['base-url']) {
    console.error(
      'Usage: node scripts/updater-manifest.mjs --dir <folder> --version <version> --base-url <address> [--notes-file <file>]',
    )
    process.exit(2)
  }
  const notes = values['notes-file']
    ? readFileSync(values['notes-file'], 'utf8')
    : ''
  const manifest = buildManifest({
    version: values.version,
    notes,
    pubDate: new Date().toISOString(),
    baseUrl: values['base-url'],
    files: readSignedFiles(values.dir),
  })
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
