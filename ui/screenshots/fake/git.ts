import type {
  CommitFile_Serialize,
  CommitInfo,
  ConsoleResult_Serialize,
  FileDiff,
  FileStatus_Serialize,
  GitOverview_Serialize,
} from '../../src/bindings'
import { COMMITTED_FILES, FILES, WORKSPACE_PATH } from './workspace'

/** The Git repository of the workspace: branch main, one commit ahead of origin. */

function status(
  path: string,
  values: Partial<FileStatus_Serialize>,
): FileStatus_Serialize {
  return {
    path,
    original_path: null,
    staged: null,
    unstaged: null,
    is_untracked: false,
    is_conflicted: false,
    ...values,
  }
}

const CHANGED_FILES: FileStatus_Serialize[] = [
  status('queries/open_orders.sql', { staged: 'added' }),
  status('reports/daily_sales.sql', { staged: 'modified' }),
  status('queries/items.sql', { unstaged: 'modified' }),
  status('README.md', { unstaged: 'modified' }),
  status('maintenance/index_usage.sql', { is_untracked: true }),
]

export const OVERVIEW: GitOverview_Serialize = {
  state: 'repository',
  version: '2.47.1',
  root: WORKSPACE_PATH,
  status: {
    branch: 'main',
    has_commits: true,
    upstream: 'origin/main',
    ahead: 1,
    behind: 0,
    files: CHANGED_FILES,
  },
  branches: [
    { name: 'main', is_current: true, last_commit: 1_764_140_400 },
    { name: 'monthly-report', is_current: false, last_commit: 1_763_985_600 },
    { name: 'vacuum-checks', is_current: false, last_commit: 1_763_643_600 },
  ],
  remote_branches: [
    { name: 'origin/main', local_name: 'main', last_commit: 1_764_064_800 },
    {
      name: 'origin/monthly-report',
      local_name: 'monthly-report',
      last_commit: 1_763_985_600,
    },
  ],
  merge_message: null,
}

type Commit = [hash: string, author: string, date: string, subject: string]

const COMMIT_LIST: Commit[] = [
  [
    '4f9c2e1a7b3d5f60812c94e7a1b2c3d4e5f60718',
    'Dana Kraus',
    '2026-11-26T09:40:00+01:00',
    'Show the revenue of each item in the top list',
  ],
  [
    'b81d07c3e2f4a5968b7c6d5e4f3a2b1c0d9e8f71',
    'Dana Kraus',
    '2026-11-25T16:12:00+01:00',
    'Count only shipped orders in the daily sales',
  ],
  [
    'e3a6f9b2c1d0e8f7a6b5c4d3e2f1a0b9c8d7e6f5',
    'Malik Osei',
    '2026-11-25T11:03:00+01:00',
    'Add the orders per weekday and hour report',
  ],
  [
    '7c2b5e8f1a4d7c0b3e6f9a2d5c8b1e4f7a0d3c6b',
    'Malik Osei',
    '2026-11-24T15:47:00+01:00',
    'Sort the open orders by order time',
  ],
  [
    'a5d8c1f4b7e0a3d6c9f2b5e8a1d4c7f0b3e6a9d2',
    'Dana Kraus',
    '2026-11-24T10:21:00+01:00',
    'Add the check for unused indexes',
  ],
  [
    '2e7b0d3f6a9c2e5b8d1f4a7c0e3b6d9f2a5c8e1b',
    'Lena Fischer',
    '2026-11-21T17:30:00+01:00',
    'Use the view daily_revenue in the weekly report',
  ],
  [
    '9f1c4a7d0b3e6f9c2a5d8b1e4c7f0a3d6b9e2c5f',
    'Lena Fischer',
    '2026-11-21T09:15:00+01:00',
    'Add the customers by country query',
  ],
  [
    'c6e9b2d5f8a1c4e7b0d3f6a9c2e5b8d1f4a7c0e3',
    'Dana Kraus',
    '2026-11-20T14:02:00+01:00',
    'Add the vacuum statistics check',
  ],
  [
    '5b8e1d4a7c0f3b6e9d2a5c8f1b4e7d0a3c6f9b2e',
    'Malik Osei',
    '2026-11-19T16:44:00+01:00',
    'Add the top items query',
  ],
  [
    '0d3f6c9e2b5a8d1f4c7e0b3a6d9f2c5e8b1a4d7f',
    'Dana Kraus',
    '2026-11-19T10:05:00+01:00',
    'Start the shop reports project',
  ],
]

export const COMMITS: CommitInfo[] = COMMIT_LIST.map(
  ([id, author, date, subject]) => ({
    id,
    short_id: id.slice(0, 7),
    author,
    date,
    subject,
  }),
)

export function commitFiles(id: string): CommitFile_Serialize[] {
  if (id === COMMITS[0].id) {
    return [
      { path: 'queries/items.sql', original_path: null, kind: 'modified' },
    ]
  }
  if (id === COMMITS[1].id) {
    return [
      {
        path: 'reports/daily_sales.sql',
        original_path: null,
        kind: 'modified',
      },
      { path: 'README.md', original_path: null, kind: 'modified' },
    ]
  }
  return [
    { path: 'reports/runs_by_day.sql', original_path: null, kind: 'added' },
  ]
}

/** The diff of a file in the working tree or in the index. */
export function workingDiff(path: string): FileDiff {
  return {
    original: COMMITTED_FILES[path] ?? '',
    modified: FILES[path] ?? '',
  }
}

/** The diff of a file in a commit. */
export function commitDiff(path: string): FileDiff {
  const modified = FILES[path] ?? ''
  if (path === 'queries/items.sql') {
    return {
      original: modified
        .replace(
          '       sum(ol.quantity)                 AS units,\n       sum(ol.quantity * ol.unit_price) AS revenue\n',
          '       sum(ol.quantity)                 AS units\n',
        )
        .replace('ORDER BY revenue DESC', 'ORDER BY units DESC'),
      modified,
    }
  }
  return { original: COMMITTED_FILES[path] ?? '', modified }
}

const LOG_OUTPUT = COMMITS.slice(0, 5)
  .map((commit) => `${commit.short_id} ${commit.subject}`)
  .join('\n')

const STATUS_OUTPUT = `On branch main
Your branch is ahead of 'origin/main' by 1 commit.
  (use "git push" to publish your local commits)

Changes to be committed:
  (use "git restore --staged <file>..." to unstage)
\tnew file:   queries/open_orders.sql
\tmodified:   reports/daily_sales.sql

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
\tmodified:   README.md
\tmodified:   queries/items.sql

Untracked files:
  (use "git add <file>..." to include in what will be committed)
\tmaintenance/index_usage.sql
`

const SHORT_STATUS_OUTPUT = `## main...origin/main [ahead 1]
A  queries/open_orders.sql
M  reports/daily_sales.sql
 M README.md
 M queries/items.sql
?? maintenance/index_usage.sql
`

/** Runs one line of the Git console. */
export function consoleRun(line: string): ConsoleResult_Serialize {
  const trimmed = `git ${line.trim().replace(/^git\s+/, '')}`
  const stdout = trimmed.startsWith('git status -sb')
    ? SHORT_STATUS_OUTPUT
    : trimmed.startsWith('git log')
      ? `${LOG_OUTPUT}\n`
      : trimmed.startsWith('git status')
        ? STATUS_OUTPUT
        : trimmed.startsWith('git branch')
          ? '* main\n  monthly-report\n  vacuum-checks\n'
          : ''
  return {
    status: 'done',
    output: {
      stdout,
      stderr: '',
      is_success: true,
      is_cut: false,
      is_cancelled: false,
      note: null,
    },
  }
}
