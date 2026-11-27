import { useAssistantStore } from '../src/assistant/assistantStore'
import { useGitStore } from '../src/git/gitStore'
import { usePlanStore } from '../src/plan/planStore'
import { useResultsViewStore } from '../src/results/resultsViewStore'
import { useSchemaStore } from '../src/schema/schemaStore'
import { useShellStore } from '../src/shell/shellStore'
import { useTabsStore } from '../src/tabs/tabsStore'
import { installFakeBackend } from './fake/ipc'

/**
 * The entry of the screenshot page. It installs the fake backend, then starts the
 * real application. The stores are on `window` so that the screenshot script can
 * set a state directly.
 */
installFakeBackend()

Object.assign(window, {
  __SCREENSHOT_STORES__: {
    assistant: useAssistantStore,
    git: useGitStore,
    plan: usePlanStore,
    resultsView: useResultsViewStore,
    schema: useSchemaStore,
    shell: useShellStore,
    tabs: useTabsStore,
  },
})

await import('../src/main.tsx')
