import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  buildManifest,
  platformOf,
  readSignedFiles,
} from './updater-manifest.mjs'

const BASE = 'https://github.com/team/tabloxide/releases/download/v0.2.0/'

test('finds the platform from the name of the update file', () => {
  assert.deepEqual(platformOf('Tabloxide_0.2.0_amd64.AppImage'), {
    os: 'linux',
    arch: 'x86_64',
    installer: 'appimage',
  })
  assert.deepEqual(platformOf('Tabloxide_0.2.0_x64-setup.exe'), {
    os: 'windows',
    arch: 'x86_64',
    installer: 'nsis',
  })
  assert.deepEqual(platformOf('Tabloxide_0.2.0_x64_en-US.msi'), {
    os: 'windows',
    arch: 'x86_64',
    installer: 'msi',
  })
  assert.deepEqual(platformOf('Tabloxide_0.2.0_aarch64.app.tar.gz'), {
    os: 'darwin',
    arch: 'aarch64',
    installer: 'app',
  })
  assert.equal(platformOf('Tabloxide_0.2.0_aarch64.dmg'), null)
  assert.equal(platformOf('SHA256SUMS.txt'), null)
  // Without an architecture in the name, the platform is not known.
  assert.equal(platformOf('Tabloxide.app.tar.gz'), null)
})

test('gives each file its installer key and each platform a default file', () => {
  const manifest = buildManifest({
    version: 'v0.2.0',
    notes: '\n### Changes\n- Faster grid.\n',
    pubDate: '2026-11-22T10:00:00.000Z',
    baseUrl: BASE,
    files: [
      { name: 'Tabloxide_0.2.0_x64_en-US.msi', signature: 'msi-sig\n' },
      { name: 'Tabloxide_0.2.0_x64-setup.exe', signature: 'nsis-sig' },
      { name: 'Tabloxide_0.2.0_amd64.deb', signature: 'deb-sig' },
      { name: 'Tabloxide_0.2.0_amd64.AppImage', signature: 'appimage-sig' },
      { name: 'Tabloxide_0.2.0_aarch64.app.tar.gz', signature: 'app-sig' },
      { name: 'Tabloxide_0.2.0_aarch64.dmg', signature: 'not used' },
    ],
  })

  assert.equal(manifest.version, '0.2.0')
  assert.equal(manifest.notes, '### Changes\n- Faster grid.')
  assert.equal(manifest.pub_date, '2026-11-22T10:00:00.000Z')
  assert.deepEqual(Object.keys(manifest.platforms).sort(), [
    'darwin-aarch64',
    'darwin-aarch64-app',
    'linux-x86_64',
    'linux-x86_64-appimage',
    'linux-x86_64-deb',
    'windows-x86_64',
    'windows-x86_64-msi',
    'windows-x86_64-nsis',
  ])
  // The default file of Windows is the NSIS installer, and of Linux the AppImage.
  assert.equal(manifest.platforms['windows-x86_64'].signature, 'nsis-sig')
  assert.equal(manifest.platforms['linux-x86_64'].signature, 'appimage-sig')
  assert.equal(manifest.platforms['windows-x86_64-msi'].signature, 'msi-sig')
  assert.equal(
    manifest.platforms['darwin-aarch64'].url,
    `${BASE}Tabloxide_0.2.0_aarch64.app.tar.gz`,
  )
})

test('puts a file name with special characters into the address correctly', () => {
  const manifest = buildManifest({
    version: '0.2.0',
    notes: '',
    pubDate: '2026-11-22T10:00:00.000Z',
    baseUrl: BASE,
    files: [{ name: 'Tabloxide 0.2.0_amd64.AppImage', signature: 's' }],
  })

  assert.equal(
    manifest.platforms['linux-x86_64'].url,
    `${BASE}Tabloxide%200.2.0_amd64.AppImage`,
  )
})

test('fails when no update file has a signature', () => {
  assert.throws(
    () =>
      buildManifest({
        version: '0.2.0',
        notes: '',
        pubDate: '2026-11-22T10:00:00.000Z',
        baseUrl: BASE,
        files: [{ name: 'Tabloxide_0.2.0_aarch64.dmg', signature: 's' }],
      }),
    /no update file/,
  )
})

test('reads only the files that have a signature file', () => {
  const folder = mkdtempSync(join(tmpdir(), 'updater-manifest-'))
  writeFileSync(join(folder, 'a_amd64.AppImage'), 'binary')
  writeFileSync(join(folder, 'a_amd64.AppImage.sig'), 'signature')
  writeFileSync(join(folder, 'a_amd64.deb'), 'binary')

  assert.deepEqual(readSignedFiles(folder), [
    { name: 'a_amd64.AppImage', signature: 'signature' },
  ])
})
