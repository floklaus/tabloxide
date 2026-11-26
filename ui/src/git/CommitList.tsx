import { useEffect, type RefObject } from 'react'
import { timeText } from '../history/historyStore'
import { Icon } from '../shell/icons'
import { useTabsStore } from '../tabs/tabsStore'
import { useViewKeys, type KeyRow } from '../view/useViewKeys'
import { EmptyState, Loading, NoMatch } from '../view/ViewState'
import { showCommit } from './gitActions'
import {
  commitSeconds,
  filterCommits,
  groupCommits,
  isPushed,
  type Repository,
} from './gitModel'
import { useGitStore } from './gitStore'

type Props = {
  repository: Repository
  filter: string
  filterRef: RefObject<HTMLInputElement | null>
  focusRef: { current: () => void }
  onClearFilter: () => void
}

/**
 * The History mode of the Git view: the commits of the current branch in groups by
 * day. Space shows a commit in the preview tab. Enter keeps the tab.
 */
export function CommitList({
  repository,
  filter,
  filterRef,
  focusRef,
  onClearFilter,
}: Props) {
  const history = useGitStore((state) => state.history)
  const selectedKey = useTabsStore((state) => {
    const detail = state.tabs.find((tab) => tab.id === state.activeId)?.detail
    return detail?.kind === 'commit' ? detail.id : null
  })
  const all = history?.commits ?? []
  const commits = filterCommits(all, filter)
  const groups = groupCommits(commits)
  const keyRows: KeyRow[] = commits.map((commit) => ({
    key: commit.id,
    label: commit.subject,
  }))
  const positions = new Map(all.map((commit, index) => [commit.id, index]))
  const byKey = new Map(commits.map((commit) => [commit.id, commit]))
  const show = (key: string, keep: boolean) => {
    const commit = byKey.get(key)
    if (commit) showCommit(commit, keep)
  }

  const keys = useViewKeys({
    kind: 'list',
    rows: keyRows,
    selectedKey,
    filterRef,
    onSelect: (key) => show(key, false),
    onOpen: (key) => show(key, true),
    onRefresh: () => void useGitStore.getState().loadHistory(),
    onEscape: () => useTabsStore.getState().closePreview(),
    contextItems: (key) => {
      const commit = byKey.get(key)
      if (!commit) return []
      return [
        {
          kind: 'action',
          label: 'Show the commit',
          shortcut: 'Enter',
          run: () => showCommit(commit, true),
        },
        {
          kind: 'action',
          label: 'Copy the commit name',
          run: () =>
            void navigator.clipboard.writeText(commit.id).catch(() => {}),
        },
      ]
    },
  })
  useEffect(() => {
    focusRef.current = () => keys.focusRow()
  })

  if (!history || (history.isLoading && all.length === 0))
    return <Loading text="Reading the history" />
  if (all.length === 0) return <EmptyState text="The branch has no commits." />

  return (
    <>
      {commits.length === 0 && (
        <NoMatch noun="commits" filter={filter} onClear={onClearFilter} />
      )}
      {commits.length > 0 && (
        <div role="listbox" aria-label="Commit history" className="view-list">
          {groups.map((group) => (
            <div key={group.day} role="group" aria-label={group.day}>
              <div className="view-group" aria-hidden="true">
                <span>{group.day}</span>
                <span>{group.commits.length}</span>
              </div>
              {group.commits.map((commit) => {
                const index = keyRows.findIndex((row) => row.key === commit.id)
                const pushed = isPushed(
                  positions.get(commit.id) ?? 0,
                  repository.status,
                )
                return (
                  <div
                    key={commit.id}
                    {...keys.rowProps(keyRows[index], index)}
                    className="view-row view-row--two"
                    aria-label={`${commit.subject}, ${commit.short_id}${pushed ? '' : ', not pushed'}`}
                  >
                    <span className="view-row__lines">
                      <span className="view-row__label">{commit.subject}</span>
                      <span className="view-row__line">
                        {commit.author} · {timeText(commitSeconds(commit))}
                      </span>
                    </span>
                    <span className="git-commit__aside">
                      <span className="view-row__code">{commit.short_id}</span>
                      {!pushed && (
                        <span
                          className="git-commit__unpushed"
                          title="Not pushed"
                          aria-hidden="true"
                        >
                          <Icon name="arrow-up" size={14} />
                        </span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
      {history.hasMore && (
        <button
          type="button"
          className="link-button git-more"
          disabled={history.isLoading}
          onClick={() => void useGitStore.getState().loadMoreHistory()}
        >
          {history.isLoading ? 'Loading the commits…' : 'Load more commits'}
        </button>
      )}
      {keys.contextMenu}
    </>
  )
}
