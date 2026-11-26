import type {
  ChangeKind,
  CommitInfo,
  FileStatus_Serialize as FileStatus,
  StatusReport_Serialize as StatusReport,
} from '../bindings'
import { dayName } from '../history/historyStore'
import { aheadBehind } from '../shell/menus'
import { CHANGE_LABELS } from './changeLabels'
import type { GitOverview } from './gitStore'

export type Repository = Extract<GitOverview, { state: 'repository' }>

export type GitMode = 'changes' | 'history' | 'branches'

/** The groups of the Changes mode, in their sequence. */
export type ChangeGroup = 'conflicts' | 'staged' | 'changes'

export const GROUP_LABELS: Record<ChangeGroup, string> = {
  conflicts: 'Conflicts',
  staged: 'Staged',
  changes: 'Changes',
}

/** One row of the Changes mode. A file with staged and other changes has two rows. */
export type ChangeRow = {
  key: string
  group: ChangeGroup
  file: FileStatus
}

/** The kind of a change, as a letter and as text, for one row. */
export function changeKind(row: ChangeRow): { letter: string; text: string } {
  const { file, group } = row
  if (group === 'conflicts') return { letter: '!', text: 'conflict' }
  if (group === 'changes' && file.is_untracked)
    return { letter: 'U', text: 'new' }
  const kind: ChangeKind | null =
    group === 'staged' ? file.staged : file.unstaged
  if (!kind) return { letter: '', text: '' }
  const letters: Record<ChangeKind, string> = {
    added: 'A',
    modified: 'M',
    deleted: 'D',
    renamed: 'R',
    copied: 'C',
    'type-changed': 'T',
  }
  return { letter: letters[kind], text: CHANGE_LABELS[kind] }
}

export function rowKey(group: ChangeGroup, path: string): string {
  return `${group}:${path}`
}

/** The last part of a path. */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** The folder of a path, or an empty text for a file at the root. */
export function folderName(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

const contains = (text: string, filter: string) =>
  text.toLowerCase().includes(filter.trim().toLowerCase())

/** The changed files in groups: conflicts, staged, and other changes. */
export function changeGroups(
  files: FileStatus[],
  filter: string,
): { group: ChangeGroup; rows: ChangeRow[] }[] {
  const visible = files.filter((file) => contains(file.path, filter))
  const rows = (group: ChangeGroup, test: (file: FileStatus) => boolean) =>
    visible
      .filter(test)
      .map((file) => ({ key: rowKey(group, file.path), group, file }))
  return [
    {
      group: 'conflicts' as const,
      rows: rows('conflicts', (f) => f.is_conflicted),
    },
    {
      group: 'staged' as const,
      rows: rows('staged', (f) => !f.is_conflicted && f.staged !== null),
    },
    {
      group: 'changes' as const,
      rows: rows(
        'changes',
        (f) => !f.is_conflicted && (f.unstaged !== null || f.is_untracked),
      ),
    },
  ].filter((item) => item.rows.length > 0)
}

/** The text of the scope: the branch and its commits to push and to pull. */
export function branchText(status: StatusReport): string {
  const counts = aheadBehind(status.ahead, status.behind)
  const name = status.branch ?? 'Detached HEAD'
  return counts ? `${name} ${counts}` : name
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`

export function commitCount(count: number): string {
  return plural(count, 'commit', 'commits')
}

export function fileCount(count: number): string {
  return plural(count, 'file', 'files')
}

export type RemoteAction = 'fetch' | 'pull' | 'push'

/**
 * The primary remote action: Push if the branch has commits to push or has no
 * upstream, Pull if it is only behind, else Fetch.
 */
export function primaryRemote(status: StatusReport): {
  action: RemoteAction
  label: string
} {
  if (status.has_commits && status.upstream === null)
    return { action: 'push', label: 'Push and set the upstream' }
  if (status.ahead > 0)
    return { action: 'push', label: `Push ${commitCount(status.ahead)}` }
  if (status.behind > 0)
    return { action: 'pull', label: `Pull ${commitCount(status.behind)}` }
  return { action: 'fetch', label: 'Fetch' }
}

/** The time of a commit, in seconds since 1970. */
export function commitSeconds(commit: CommitInfo): number {
  return Date.parse(commit.date) / 1000
}

/**
 * `true` if the remote has the commit. The history starts at the current commit, so
 * the first `ahead` commits are not on the upstream branch.
 */
export function isPushed(index: number, status: StatusReport): boolean {
  return status.upstream !== null && index >= status.ahead
}

export function filterCommits(
  commits: CommitInfo[],
  filter: string,
): CommitInfo[] {
  if (!filter.trim()) return commits
  return commits.filter(
    (commit) =>
      contains(commit.subject, filter) ||
      contains(commit.author, filter) ||
      contains(commit.id, filter),
  )
}

/** The commits in groups by day. The newest group is first. */
export function groupCommits(
  commits: CommitInfo[],
  now = new Date(),
): { day: string; commits: CommitInfo[] }[] {
  const groups: { day: string; commits: CommitInfo[] }[] = []
  for (const commit of commits) {
    const day = dayName(commitSeconds(commit), now)
    const last = groups[groups.length - 1]
    if (last?.day === day) last.commits.push(commit)
    else groups.push({ day, commits: [commit] })
  }
  return groups
}

/** The form above the branches: a new branch, or a new name for a branch. */
export type BranchForm =
  | { mode: 'create'; name: string }
  | { mode: 'rename'; from: string; name: string }

/** One row of the Branches mode. */
export type BranchRow = {
  key: string
  name: string
  /** The name of the local branch that Enter switches to. */
  target: string
  isRemote: boolean
  isCurrent: boolean
  lastCommit: number | null
}

export function branchGroups(
  repository: Repository,
  filter: string,
): { label: string; rows: BranchRow[] }[] {
  const local = repository.branches.map((branch): BranchRow => ({
    key: `local:${branch.name}`,
    name: branch.name,
    target: branch.name,
    isRemote: false,
    isCurrent: branch.is_current,
    lastCommit: branch.last_commit,
  }))
  const remote = (repository.remote_branches ?? []).map(
    (branch): BranchRow => ({
      key: `remote:${branch.name}`,
      name: branch.name,
      target: branch.local_name,
      isRemote: true,
      isCurrent: false,
      lastCommit: branch.last_commit,
    }),
  )
  return [
    { label: 'Local', rows: local.filter((row) => contains(row.name, filter)) },
    {
      label: 'Remote',
      rows: remote.filter((row) => contains(row.name, filter)),
    },
  ].filter((group) => group.rows.length > 0)
}
