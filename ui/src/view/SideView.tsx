import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import { Icon, type IconName } from '../shell/icons'
import { MenuButton } from '../shell/menu/MenuButton'
import type { MenuItem } from '../shell/menu/menuModel'

export type ViewScope = {
  /** The text of the scope, for example "Local shop › shop". */
  text: string
  /** The accessible name, for example "Scope: Local shop. Change the scope". */
  label: string
  /** The menu that changes the scope. Without items, the scope is only text. */
  items?: () => MenuItem[]
}

export type ViewAction = {
  icon: IconName
  label: string
  shortcut?: string
  disabled?: boolean
  run: () => void
}

export type ViewModes<T extends string> = {
  label: string
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (value: T) => void
}

export type ViewFilter = {
  value: string
  onChange: (value: string) => void
  /** The accessible name, for example "Filter the tables and columns". */
  label: string
  placeholder?: string
  inputRef?: RefObject<HTMLInputElement | null>
  /** The second Esc in an empty filter moves the focus to the list. */
  onLeave?: () => void
  /** A control after the filter field, for example a menu of the result states. */
  extra?: ReactNode
}

type SideViewProps<T extends string> = {
  title: string
  scope?: ViewScope
  /** The one primary action of the view, as an icon button. */
  primary?: ViewAction
  /** All actions of the view. The context menu has the same actions. */
  overflow?: () => MenuItem[]
  /** The modes of a view with more than one mode, for example Git. */
  modes?: ViewModes<T>
  filter?: ViewFilter
  /** The count and the age of the data, or an operation in progress. */
  status?: ReactNode
  children: ReactNode
  /** Content below the body, for example the commit box of Git. */
  footer?: ReactNode
}

function onFilterKey(
  event: KeyboardEvent<HTMLInputElement>,
  filter: ViewFilter,
) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  // The first Esc clears the text. A second Esc moves the focus to the list.
  if (filter.value) filter.onChange('')
  else filter.onLeave?.()
}

/**
 * A side view after the view standards: the header (title, scope, primary action,
 * overflow menu), the mode tabs, the toolbar with the filter, the body, and the
 * status line. Only the body scrolls.
 */
export function SideView<T extends string = string>({
  title,
  scope,
  primary,
  overflow,
  modes,
  filter,
  status,
  children,
  footer,
}: SideViewProps<T>) {
  const filterRef = filter?.inputRef
  return (
    <section className="view" aria-label={title}>
      <div className="view__header">
        <h2 className="view__title">{title}</h2>
        {scope?.items ? (
          <MenuButton
            label={scope.label}
            menuLabel={`${title}: scope`}
            className="view__scope"
            items={scope.items}
          >
            <span className="view__scope-text">{scope.text}</span>
            <Icon name="chevron" size={14} />
          </MenuButton>
        ) : scope ? (
          <span className="view__scope" aria-label={scope.label}>
            <span className="view__scope-text">{scope.text}</span>
          </span>
        ) : (
          <span className="view__spacer" />
        )}
        {primary && (
          <button
            type="button"
            className="view__icon-button"
            aria-label={primary.label}
            aria-keyshortcuts={primary.shortcut}
            title={
              primary.shortcut
                ? `${primary.label} (${primary.shortcut})`
                : primary.label
            }
            disabled={primary.disabled}
            onClick={primary.run}
          >
            <Icon name={primary.icon} size={16} />
          </button>
        )}
        {overflow && (
          <MenuButton
            label={`More ${title.toLowerCase()} actions`}
            menuLabel={`${title} actions`}
            className="view__icon-button"
            items={overflow}
          >
            <Icon name="more" size={16} />
          </MenuButton>
        )}
      </div>
      {modes && (
        <div className="view__modes" role="tablist" aria-label={modes.label}>
          {modes.options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              className="view__mode"
              aria-selected={option.value === modes.value}
              tabIndex={option.value === modes.value ? 0 : -1}
              onClick={() => modes.onChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      {filter && (
        <div className="view__toolbar">
          <input
            ref={filterRef}
            type="search"
            className="view__filter"
            aria-label={filter.label}
            placeholder={filter.placeholder ?? 'Filter'}
            value={filter.value}
            onChange={(event) => filter.onChange(event.target.value)}
            onKeyDown={(event) => onFilterKey(event, filter)}
          />
          {filter.extra}
        </div>
      )}
      <div className="view__body">{children}</div>
      {footer}
      {status !== undefined && status !== null && (
        <div className="view__status" role="status">
          {status}
        </div>
      )}
    </section>
  )
}
