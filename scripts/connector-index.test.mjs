import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildIndex, readManifest, targetOf } from './connector-index.mjs'

const MANIFEST = readManifest(`engine = "mongodb"
display_name = "MongoDB"
version = "0.2.0"
protocol = 1
program = "tabloxide-connector-mongodb"
language = "mongodb-shell"
default_port = 27017
publisher = "Tabloxide project"
`)

const BASE =
  'https://github.com/floklaus/tabloxide/releases/download/connector-mongodb-v0.2.0/'

test('reads the fields of connector.toml', () => {
  assert.equal(MANIFEST.engine, 'mongodb')
  assert.equal(MANIFEST.protocol, 1)
  assert.throws(() => readManifest('engine = "x"'), /version|display_name/)
})

test('finds the target in the name of a package', () => {
  assert.equal(
    targetOf(
      'tabloxide-connector-mongodb-0.2.0-x86_64-pc-windows-msvc.tar.gz',
      'mongodb',
      '0.2.0',
    ),
    'x86_64-pc-windows-msvc',
  )
  assert.equal(targetOf('other.tar.gz', 'mongodb', '0.2.0'), null)
})

test('adds the new version, replaces the same version, and keeps the others', () => {
  const current = {
    format: 1,
    issued: 2000,
    expires: 3000,
    connectors: [
      { engine: 'mongodb', version: '0.1.0', packages: {} },
      { engine: 'mongodb', version: '0.2.0', packages: { old: {} } },
    ],
  }

  const index = buildIndex({
    current,
    manifest: MANIFEST,
    packages: [
      {
        name: 'tabloxide-connector-mongodb-0.2.0-aarch64-apple-darwin.tar.gz',
        size: 10,
        sha256: 'ab',
      },
      { name: 'notes.txt', size: 1, sha256: 'cd' },
    ],
    baseUrl: BASE,
    now: 1000,
    days: 90,
  })

  assert.equal(index.issued, 2001, 'issued always grows')
  assert.equal(index.expires, 1000 + 90 * 86400)
  assert.deepEqual(
    index.connectors.map((item) => item.version),
    ['0.1.0', '0.2.0'],
  )
  assert.deepEqual(index.connectors[1].packages, {
    'aarch64-apple-darwin': {
      url: `${BASE}tabloxide-connector-mongodb-0.2.0-aarch64-apple-darwin.tar.gz`,
      size: 10,
      sha256: 'ab',
    },
  })
})

test('refuses a folder without a package of the version', () => {
  assert.throws(
    () =>
      buildIndex({
        current: null,
        manifest: MANIFEST,
        packages: [],
        baseUrl: BASE,
        now: 1,
        days: 1,
      }),
    /no package/,
  )
})
