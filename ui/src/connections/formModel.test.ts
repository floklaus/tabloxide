import { describe, expect, test } from 'vitest'
import { makeProfile } from '../test/fixtures'
import { issueFor, toDraft, toProfile } from './formModel'

describe('formModel', () => {
  test('converts a profile to a draft and back without a change', () => {
    const profile = makeProfile({
      socket_path: '/var/run/postgresql',
      query_timeout_secs: 30,
      read_only: true,
      params: { application_name: 'tabloxide', options: '-c a=b' },
      secret: { type: 'env-var', name: 'PGPASSWORD' },
    })

    const result = toProfile(toDraft(profile))

    expect(result).toEqual({ ok: true, profile })
  })

  test('omits the optional fields when they are empty', () => {
    const result = toProfile(toDraft(makeProfile()))

    expect(result.ok && Object.keys(result.profile)).not.toContain(
      'socket_path',
    )
    expect(result.ok && Object.keys(result.profile)).not.toContain(
      'query_timeout_secs',
    )
    expect(result.ok && Object.keys(result.profile)).not.toContain('params')
  })

  test('removes spaces around text values', () => {
    const draft = {
      ...toDraft(makeProfile()),
      name: '  Local  ',
      host: ' localhost ',
    }

    const result = toProfile(draft)

    expect(result.ok && result.profile.name).toBe('Local')
    expect(result.ok && result.profile.host).toBe('localhost')
  })

  test('reports a port that is not a number', () => {
    const result = toProfile({ ...toDraft(makeProfile()), port: 'abc' })

    expect(result).toEqual({
      ok: false,
      issues: [{ field: 'port', message: 'Enter a number.' }],
    })
  })

  test('reports timeouts that are not numbers', () => {
    const draft = {
      ...toDraft(makeProfile()),
      connectTimeoutSecs: '',
      queryTimeoutSecs: '1.5',
    }

    const result = toProfile(draft)

    expect(!result.ok && result.issues.map((issue) => issue.field)).toEqual([
      'connect_timeout_secs',
      'query_timeout_secs',
    ])
  })

  test('reports a parameter line without a name and a value', () => {
    const result = toProfile({
      ...toDraft(makeProfile()),
      params: 'application_name',
    })

    expect(!result.ok && result.issues[0].field).toBe('params')
  })

  test('keeps an equals sign in a parameter value', () => {
    const result = toProfile({
      ...toDraft(makeProfile()),
      params: 'options=-c a=b\n\n',
    })

    expect(result.ok && result.profile.params).toEqual({ options: '-c a=b' })
  })

  test('issueFor returns the message of the field', () => {
    const issues = [{ field: 'name', message: 'Enter a name.' }]

    expect(issueFor(issues, 'name')).toBe('Enter a name.')
    expect(issueFor(issues, 'host')).toBeUndefined()
  })
})
