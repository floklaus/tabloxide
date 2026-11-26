import type {
  CommitInfo,
  FileStatus_Serialize as FileStatus,
} from '../bindings'
import type { GitOverview } from '../git/gitStore'

export function ok<T>(data: T) {
  return { status: 'ok' as const, data }
}

export function failed(message: string) {
  return {
    status: 'error' as const,
    error: { kind: 'git' as const, message, issues: [] },
  }
}

export function file(overrides: Partial<FileStatus>): FileStatus {
  return {
    path: 'a.sql',
    original_path: null,
    staged: null,
    unstaged: null,
    is_untracked: false,
    is_conflicted: false,
    ...overrides,
  }
}

/** A repository on `main` with the branch `feature`. */
export function repository(
  files: FileStatus[] = [],
  overrides: object = {},
  mergeMessage: string | null = null,
): GitOverview {
  return {
    state: 'repository',
    version: '2.43.0',
    root: '/work/sql-project',
    branches: [
      { name: 'feature', is_current: false, last_commit: null },
      { name: 'main', is_current: true, last_commit: null },
    ],
    remote_branches: [],
    merge_message: mergeMessage,
    status: {
      branch: 'main',
      has_commits: true,
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
      files,
      ...overrides,
    },
  }
}

export function commit(index: number): CommitInfo {
  return {
    id: `${index}`.padStart(40, 'a'),
    short_id: `aaaaaa${index}`,
    author: 'Ada',
    date: '2026-11-14T10:00:00+01:00',
    subject: `commit ${index}`,
  }
}

/** A commit at a time, for the groups by day. */
export function commitAt(index: number, date: Date): CommitInfo {
  return { ...commit(index), date: date.toISOString() }
}
