import { Icon } from '../shell/icons'
import { MenuButton } from '../shell/menu/MenuButton'
import { usePlanStore } from './planStore'
import { usePlanTarget } from './planTarget'

const EXPLAIN_TEXT = 'The plan of the statement at the cursor. It does not run.'
const MEASURE_TEXT = 'Runs the statement and measures each step.'

/**
 * The split button "Explain" of the editor bar. The button reads the plan. Its
 * menu has Explain and Explain and measure. A blocked action gives its reason.
 */
export function ExplainButton({ isBusy }: { isBusy: boolean }) {
  const explain = usePlanTarget((state) => state.explain)
  const measure = usePlanTarget((state) => state.measure)
  const isReading = usePlanStore((state) => state.status === 'reading')
  const isDisabled = isBusy || isReading
  const request = (doesMeasure: boolean) =>
    void usePlanStore.getState().request(doesMeasure)

  return (
    <div className="split-button" role="group" aria-label="Explain">
      <button
        type="button"
        className="button split-button__main"
        disabled={isDisabled || explain !== null}
        aria-keyshortcuts="Control+E"
        title={explain?.message ?? `${EXPLAIN_TEXT} (Ctrl+E)`}
        onClick={() => request(false)}
      >
        Explain
        <span className="query__key" aria-hidden="true">
          Ctrl+E
        </span>
      </button>
      <MenuButton
        label="More explain actions"
        menuLabel="Explain actions"
        className="button split-button__more"
        items={() => [
          {
            kind: 'action',
            label: 'Explain',
            shortcut: 'Ctrl+E',
            detail: explain?.message ?? EXPLAIN_TEXT,
            disabled: isDisabled || explain !== null,
            run: () => request(false),
          },
          {
            kind: 'action',
            label: 'Explain and measure',
            shortcut: 'Ctrl+Shift+E',
            detail: measure?.message ?? MEASURE_TEXT,
            disabled: isDisabled || measure !== null,
            run: () => request(true),
          },
        ]}
      >
        <Icon name="chevron" size={14} />
      </MenuButton>
    </div>
  )
}
