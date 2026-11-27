import type { Page } from 'playwright'

/** One screenshot: the start state of the page, and the steps that make the final state. */
export type Shot = {
  /** The file name in docs/screenshots, without `.png`. */
  name: string
  theme?: 'light' | 'dark'
  /** The stored layout of the window (`tabloxide.shell` in the local storage). */
  shell?: Record<string, unknown>
  /** The file tabs that the window restores at the start. */
  tabs?: { files: string[]; active: string }
  drive: (page: Page) => Promise<void>
}

const LOCAL_ID = 'conn-local-shop'

function layout(
  sidebarView: string,
  options: { assistant?: boolean; editorSize?: number; results?: boolean } = {},
) {
  return {
    sidebarView,
    layoutId: null,
    zoom: 0.9,
    sidebarWidth: 300,
    editorSize: options.editorSize ?? 46,
    panels: {
      sidebar: true,
      assistant: options.assistant ?? false,
      results: options.results ?? true,
      statusBar: true,
    },
  }
}

/** Calls a store action in the page. The stores are on `window` only in the screenshot page. */
async function store(page: Page, script: string): Promise<void> {
  await page.evaluate(
    `(async (s) => { ${script} })(window.__SCREENSHOT_STORES__)`,
  )
}

async function runQuery(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: /^Run\b/ })
    .first()
    .click()
  await page.locator('.results').waitFor()
}

/** Sends a request in the assistant panel and waits for the end of the answer. */
async function ask(page: Page, text: string, end: string): Promise<void> {
  const request = page.getByPlaceholder('Describe the statement that you need')
  await request.fill(text)
  await request.press('Enter')
  await page.getByText(end).first().waitFor()
}

async function expandSchema(
  page: Page,
  schema: string,
  relation?: string,
): Promise<void> {
  await page.getByRole('treeitem', { name: schema }).first().waitFor()
  await store(page, `await s.schema.getState().toggleSchema('${schema}')`)
  if (relation) {
    await store(
      page,
      `await s.schema.getState().toggleRelation('${schema}', '${relation}')`,
    )
  }
}

async function mainWindow(page: Page): Promise<void> {
  await expandSchema(page, 'public', 'item')
  await runQuery(page)
  await page.getByText('Herb planter, 3 pots').waitFor()
  await ask(
    page,
    'Add the share of the total revenue to each item.',
    'after row 15',
  )
}

export const SHOTS: Shot[] = [
  {
    name: 'main-light',
    shell: layout('schema', { assistant: true }),
    drive: mainWindow,
  },
  {
    name: 'main-dark',
    theme: 'dark',
    shell: layout('schema', { assistant: true }),
    drive: mainWindow,
  },
  {
    name: 'git-changes',
    shell: layout('git', { results: false }),
    tabs: {
      files: ['queries/items.sql', 'reports/daily_sales.sql'],
      active: 'reports/daily_sales.sql',
    },
    drive: async (page) => {
      const message = page.getByLabel('Commit message')
      await message.fill('Add the open orders query and count order lines')
      await store(
        page,
        `s.tabs.getState().openDetail({ kind: 'diff', path: 'reports/daily_sales.sql', staged: true }, 'daily_sales.sql (staged)')`,
      )
      await page
        .locator('.cm-mergeView, .diff, [class*="diff"]')
        .first()
        .waitFor()
    },
  },
  {
    name: 'git-history',
    shell: layout('git', { results: false }),
    drive: async (page) => {
      await page.getByRole('tab', { name: 'History' }).click()
      await page
        .getByText('Show the revenue of each item in the top list')
        .first()
        .click()
      await page.getByText('queries/items.sql').first().waitFor()
    },
  },
  {
    name: 'git-console',
    shell: layout('files', { editorSize: 40 }),
    drive: async (page) => {
      await store(page, `s.resultsView.getState().setView('console')`)
      const input = page.getByLabel('Git command')
      for (const line of ['log --oneline -5', 'status -sb', 'branch']) {
        await input.fill(line)
        await input.press('Enter')
        await page.waitForTimeout(200)
      }
      await page.getByText('vacuum-checks').waitFor()
    },
  },
  {
    name: 'plan',
    shell: layout('schema', { editorSize: 30 }),
    drive: async (page) => {
      await expandSchema(page, 'public')
      await store(
        page,
        `s.plan.setState({ skipsConfirm: ['${LOCAL_ID}'] })
         const tab = s.tabs.getState().tabs[0]
         await s.plan.getState().explain(tab.content.split('\\n').slice(1).join('\\n').trim(), true)`,
      )
      await page.locator('.plan__tree').waitFor()
      const allFields = page.getByLabel('Show all fields of each step')
      if (await allFields.isChecked()) await allFields.uncheck()
    },
  },
  {
    name: 'ai-query-error',
    shell: layout('files', { assistant: true }),
    tabs: {
      files: ['queries/items.sql', 'queries/open_orders.sql'],
      active: 'queries/open_orders.sql',
    },
    drive: async (page) => {
      await runQuery(page)
      await page.getByRole('button', { name: 'Explain and fix' }).click()
      await page.getByText('can also help the sort').waitFor()
    },
  },
  {
    name: 'table-detail',
    shell: layout('schema', { results: false }),
    drive: async (page) => {
      await expandSchema(page, 'public')
      await page.getByRole('treeitem', { name: 'orders' }).first().click()
      await page.getByText('orders_customer_id_fkey').first().waitFor()
    },
  },
  {
    name: 'connections',
    shell: layout('connections', { results: false }),
    drive: async (page) => {
      for (const name of [
        'Orders archive',
        'Local shop',
        'Staging shop',
        'Live shop',
      ]) {
        const row = page
          .getByRole('option', { name: new RegExp(`^${name},`) })
          .first()
        await row.click()
        await row.press('Control+Enter')
      }
      // A click on the empty part of the detail tab hides the row actions.
      await page.mouse.click(1000, 800)
    },
  },
  {
    name: 'connectors',
    shell: layout('files'),
    drive: async (page) => {
      await store(page, `s.shell.getState().openDialog('preferences')`)
      await page.getByRole('tab', { name: 'Connectors' }).click()
      await page.getByText('MongoDB').first().waitFor()
    },
  },
  {
    name: 'mongodb',
    shell: layout('schema', { editorSize: 30 }),
    tabs: {
      files: ['archive/closed_orders.mongodb.js'],
      active: 'archive/closed_orders.mongodb.js',
    },
    drive: async (page) => {
      await expandSchema(page, 'orders_archive', 'orders')
      await runQuery(page)
      await page.getByText('A-2026-09881').waitFor()
    },
  },
  {
    name: 'history',
    shell: layout('history', { results: false }),
    drive: async (page) => {
      await page.getByText('Live shop').first().waitFor()
      await page.getByRole('option').nth(2).click()
      await page.waitForTimeout(300)
    },
  },
]
