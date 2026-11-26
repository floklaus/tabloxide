import { DetailView } from '../tabs/DetailView'
import { useTabsStore } from '../tabs/tabsStore'

/** The detail tab that is active, as the editor area shows it. */
export function ActiveDetail() {
  const detail = useTabsStore(
    (state) => state.tabs.find((tab) => tab.id === state.activeId)?.detail,
  )
  return detail ? <DetailView detail={detail} /> : null
}
