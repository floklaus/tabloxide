import type { ChangeKind } from '../bindings'

/** The text that the UI shows for each kind of change. */
export const CHANGE_LABELS: Record<ChangeKind, string> = {
  added: 'added',
  modified: 'modified',
  deleted: 'deleted',
  renamed: 'renamed',
  copied: 'copied',
  'type-changed': 'type changed',
}
