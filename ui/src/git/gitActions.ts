import type { CommitInfo } from '../bindings'
import { useTabsStore } from '../tabs/tabsStore'
import {
  baseName,
  fileCount,
  primaryRemote,
  type ChangeRow,
  type Repository,
} from './gitModel'
import { useGitStore } from './gitStore'

/** Shows the diff of a changed file in a detail tab of the editor area. */
export function showDiff(path: string, staged: boolean, keep: boolean): void {
  useTabsStore
    .getState()
    .openDetail(
      { kind: 'diff', path, staged },
      staged ? `${baseName(path)} (staged)` : baseName(path),
      keep,
    )
}

/** Shows the conflict of a file in a detail tab of the editor area. */
export function showConflict(path: string, keep: boolean): void {
  useTabsStore
    .getState()
    .openDetail({ kind: 'conflict', path }, `Conflict: ${baseName(path)}`, keep)
}

/** Shows a commit in a detail tab of the editor area. */
export function showCommit(commit: CommitInfo, keep: boolean): void {
  useTabsStore
    .getState()
    .openDetail(
      { kind: 'commit', id: commit.id },
      `Commit ${commit.short_id}`,
      keep,
    )
}

/** Shows the detail of a row of the Changes mode: its diff or its conflict. */
export function showChange(row: ChangeRow, keep: boolean): void {
  if (row.group === 'conflicts') showConflict(row.file.path, keep)
  else showDiff(row.file.path, row.group === 'staged', keep)
}

/** Stages a row of the Changes mode, or unstages a staged row. */
export async function toggleStage(row: ChangeRow): Promise<void> {
  const { stage, unstage } = useGitStore.getState()
  if (row.group === 'staged') await unstage([row.file.path])
  else if (row.group === 'changes') await stage([row.file.path])
}

/** What a commit does now: its message, whether it can run, and the button text. */
export function commitPlan(repository: Repository, message: string) {
  const { files } = repository.status
  const mergeMessage = repository.merge_message
  const isMerging = mergeMessage !== null
  const staged = files.filter(
    (file) => !file.is_conflicted && file.staged !== null,
  ).length
  const conflicts = files.filter((file) => file.is_conflicted).length
  // A merge has a prepared message. The user can replace it.
  const effective = message.trim() ? message : (mergeMessage ?? '')
  // A merge without a staged change still needs its commit.
  const hasContent = isMerging ? conflicts === 0 : staged > 0
  return {
    message: effective,
    staged,
    canCommit: hasContent && effective.trim() !== '',
    label: isMerging
      ? 'Commit the merge'
      : staged > 0
        ? `Commit ${fileCount(staged)}`
        : 'Commit',
  }
}

/** Commits with the text of the message field. The field clears after a commit. */
export async function commitNow(): Promise<void> {
  const git = useGitStore.getState()
  if (git.overview?.state !== 'repository' || git.busy) return
  const plan = commitPlan(git.overview, git.message)
  if (!plan.canCommit) return
  if (await git.commit(plan.message)) useGitStore.getState().setMessage('')
}

/** Runs the primary remote action of the current branch. */
export function runPrimaryRemote(repository: Repository): void {
  const git = useGitStore.getState()
  const { action } = primaryRemote(repository.status)
  void git[action]()
}
