import { useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '../connections/ConfirmDialog'
import { branchItems } from '../shell/menus'
import type { MenuItem } from '../shell/menu/menuModel'
import { SideView, type ViewAction } from '../view/SideView'
import { EmptyState, ViewError } from '../view/ViewState'
import { BranchList } from './BranchList'
import { ChangesList } from './ChangesList'
import { CommitBox } from './CommitBox'
import { CommitList } from './CommitList'
import { runPrimaryRemote } from './gitActions'
import {
  branchText,
  commitCount,
  fileCount,
  primaryRemote,
  type BranchForm,
  type GitMode,
  type Repository,
} from './gitModel'
import { useGitStore } from './gitStore'
import { useRemoteStore } from './remoteStore'

const NO_FILTERS: Record<GitMode, string> = {
  changes: '',
  history: '',
  branches: '',
}

const FILTER_LABELS: Record<GitMode, string> = {
  changes: 'Filter the changed files',
  history: 'Filter the commits',
  branches: 'Filter the branches',
}

/** The text of Git after an operation, or its error, at the top of the body. */
function GitMessages() {
  const output = useGitStore((state) => state.output)
  const error = useGitStore((state) => state.error)
  const clearMessages = useGitStore((state) => state.clearMessages)
  if (error) {
    return (
      <div className="view-state view-state--error" role="alert">
        <p className="view-state__detail git__output">{error}</p>
        <button type="button" className="link-button" onClick={clearMessages}>
          Dismiss
        </button>
      </div>
    )
  }
  if (!output) return null
  return (
    <div className="view-state git-output" role="status">
      <p className="view-state__detail git__output">{output}</p>
      <button type="button" className="link-button" onClick={clearMessages}>
        Dismiss
      </button>
    </div>
  )
}

/** The actions of the overflow menu of the Git view. */
function overflowItems(
  repository: Repository | null,
  isEnabled: boolean,
  handlers: {
    onNewBranch: () => void
    onAbortMerge: () => void
  },
): MenuItem[] {
  const git = useGitStore.getState()
  const isIdle = git.busy === null
  const enable: MenuItem = {
    kind: 'action',
    label: isEnabled ? 'Disable Git for this workspace' : 'Enable Git',
    run: () => void git.setEnabled(!isEnabled),
  }
  const refresh: MenuItem = {
    kind: 'action',
    label: 'Read the status again',
    shortcut: 'F5',
    run: () => void git.refresh(),
  }
  if (!repository) return [refresh, { kind: 'separator' }, enable]
  const { files, has_commits: hasCommits } = repository.status
  const toStage = files
    .filter(
      (file) => !file.is_conflicted && (file.unstaged || file.is_untracked),
    )
    .map((file) => file.path)
  const toUnstage = files
    .filter((file) => !file.is_conflicted && file.staged)
    .map((file) => file.path)
  return [
    {
      kind: 'action',
      label: 'Fetch',
      disabled: !isIdle,
      run: () => void git.fetch(),
    },
    {
      kind: 'action',
      label: 'Pull',
      disabled: !isIdle,
      run: () => void git.pull(),
    },
    {
      kind: 'action',
      label: 'Push',
      disabled: !isIdle,
      run: () => void git.push(),
    },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Stage all',
      disabled: !isIdle || toStage.length === 0,
      run: () => void git.stage(toStage),
    },
    {
      kind: 'action',
      label: 'Unstage all',
      disabled: !isIdle || toUnstage.length === 0,
      run: () => void git.unstage(toUnstage),
    },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'New branch…',
      disabled: !isIdle || !hasCommits,
      run: handlers.onNewBranch,
    },
    ...(repository.merge_message !== null
      ? [
          {
            kind: 'action' as const,
            label: 'Abort the merge…',
            disabled: !isIdle,
            run: handlers.onAbortMerge,
          },
        ]
      : []),
    { kind: 'separator' },
    refresh,
    enable,
  ]
}

function statusText(
  repository: Repository,
  mode: GitMode,
  commits: number,
): string {
  const { status } = repository
  if (mode === 'branches') {
    const count = repository.branches.length
    return `${count} local ${count === 1 ? 'branch' : 'branches'}`
  }
  if (mode === 'history') {
    const unpushed =
      status.upstream && status.ahead > 0
        ? ` · ${commitCount(status.ahead)} not pushed to ${status.upstream}`
        : ''
    return `${commitCount(commits)}${unpushed}`
  }
  const upstream = status.upstream ? '' : ' · no upstream'
  return `${fileCount(status.files.length)} changed${upstream}`
}

/**
 * The Git view after the view standards: the branch as the scope, the modes
 * Changes, History, and Branches, and the commit box at the bottom.
 */
export function GitPanel() {
  const overview = useGitStore((state) => state.overview)
  const busy = useGitStore((state) => state.busy)
  const history = useGitStore((state) => state.history)
  const progress = useRemoteStore((state) => state.progress)
  const [mode, setMode] = useState<GitMode>('changes')
  const [filters, setFilters] = useState(NO_FILTERS)
  const [branchForm, setBranchForm] = useState<BranchForm | null>(null)
  const [isAborting, setIsAborting] = useState(false)
  const filterRef = useRef<HTMLInputElement>(null)
  const focusRef = useRef<() => void>(() => {})
  const git = useGitStore.getState

  // The status can change outside the application. Read it when the window gets the focus.
  useEffect(() => {
    void git().refresh()
    const onFocus = () => void git().refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [git])

  const repository = overview?.state === 'repository' ? overview : null
  const isHistoryShown = repository !== null && mode === 'history'
  useEffect(() => {
    if (isHistoryShown && !git().history) void git().loadHistory()
  }, [isHistoryShown, git])

  const filter = filters[mode]
  const setFilter = (value: string) =>
    setFilters((current) => ({ ...current, [mode]: value }))
  const listProps = {
    filter,
    filterRef,
    focusRef,
    onClearFilter: () => setFilter(''),
  }
  const newBranch = () => {
    setMode('branches')
    setBranchForm({ mode: 'create', name: '' })
  }

  const remote = repository ? primaryRemote(repository.status) : null
  const primary: ViewAction | undefined =
    repository && remote
      ? {
          icon:
            remote.action === 'push'
              ? 'arrow-up'
              : remote.action === 'pull'
                ? 'arrow-down'
                : 'refresh',
          label: remote.label,
          disabled: busy !== null,
          run: () => runPrimaryRemote(repository),
        }
      : undefined
  const changes = repository?.status.files.length ?? 0

  return (
    <SideView<GitMode>
      title="Git"
      scope={
        repository
          ? {
              text: branchText(repository.status),
              label: `Branch: ${branchText(repository.status)}. Switch the branch`,
              items: branchItems,
            }
          : undefined
      }
      primary={primary}
      overflow={
        overview
          ? () =>
              overflowItems(repository, overview.state !== 'disabled', {
                onNewBranch: newBranch,
                onAbortMerge: () => setIsAborting(true),
              })
          : undefined
      }
      modes={
        repository
          ? {
              label: 'Git modes',
              value: mode,
              onChange: setMode,
              options: [
                {
                  value: 'changes',
                  label: (
                    <>
                      Changes{changes > 0 ? ' ' : ''}
                      {changes > 0 && (
                        <span className="view__mode-count">{changes}</span>
                      )}
                    </>
                  ),
                },
                { value: 'history', label: 'History' },
                { value: 'branches', label: 'Branches' },
              ],
            }
          : undefined
      }
      filter={
        repository
          ? {
              value: filter,
              onChange: setFilter,
              label: FILTER_LABELS[mode],
              placeholder: 'Filter  /',
              inputRef: filterRef,
              onLeave: () => focusRef.current(),
            }
          : undefined
      }
      status={
        busy ? (
          <>
            {busy}…
            {progress && <span className="git__progress">{progress}</span>}
          </>
        ) : repository ? (
          statusText(repository, mode, history?.commits.length ?? 0)
        ) : null
      }
      footer={
        repository && mode === 'changes' ? (
          <CommitBox repository={repository} />
        ) : null
      }
    >
      <GitMessages />
      {overview?.state === 'disabled' && (
        <EmptyState
          text="Git is disabled for this workspace."
          action={{
            label: 'Enable Git',
            run: () => void git().setEnabled(true),
          }}
        />
      )}
      {overview?.state === 'not-installed' && (
        <ViewError
          title={overview.message}
          onRetry={() => void git().refresh()}
        />
      )}
      {overview?.state === 'no-repository' && (
        <EmptyState
          text="The workspace folder is not in a Git repository."
          action={{
            label: 'Initialise a repository',
            run: () => void git().init(),
          }}
        />
      )}
      {repository && mode === 'changes' && (
        <ChangesList
          repository={repository}
          {...listProps}
          onAbortMerge={() => setIsAborting(true)}
        />
      )}
      {repository && mode === 'history' && (
        <CommitList repository={repository} {...listProps} />
      )}
      {repository && mode === 'branches' && (
        <BranchList
          repository={repository}
          {...listProps}
          form={branchForm}
          onForm={setBranchForm}
        />
      )}
      {isAborting && (
        <ConfirmDialog
          title="Abort the merge?"
          message="This restores the files to their state before the merge. You lose the conflicts that you resolved."
          confirmLabel="Abort the merge"
          onConfirm={() => {
            void git().abortMerge()
            setIsAborting(false)
          }}
          onCancel={() => setIsAborting(false)}
        />
      )}
    </SideView>
  )
}
