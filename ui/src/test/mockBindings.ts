import { vi } from 'vitest'

/** Mock of the generated bindings. Use it as the factory result of `vi.mock('../bindings')`. */
export function createBindingsMock() {
  return {
    commands: {
      appInfo: vi
        .fn()
        .mockResolvedValue({ name: 'Tabloxide', version: '0.1.0' }),
      workspaceOpen: vi.fn(),
      workspaceCurrent: vi.fn().mockResolvedValue(null),
      workspaceClose: vi.fn().mockResolvedValue(undefined),
      workspaceRecent: vi.fn().mockResolvedValue({ status: 'ok', data: [] }),
      workspaceRecentRemove: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: [] }),
      connectionTemplate: vi.fn(),
      connectionSave: vi.fn(),
      connectionDelete: vi.fn(),
      connectionDuplicate: vi.fn(),
      connectionTest: vi.fn(),
      engineList: vi.fn().mockImplementation(async () => ({
        status: 'ok',
        data: (await import('../engines/engineStore')).DEFAULT_ENGINES,
      })),
      connectorDownload: vi.fn(),
      connectorInspectFile: vi.fn(),
      connectorInstallFile: vi.fn(),
      connectorRemove: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      sessionOpen: vi.fn(),
      sessionClose: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      queryPreview: vi.fn().mockResolvedValue([]),
      queryRun: vi.fn(),
      queryCancel: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      resultFetch: vi.fn(),
      resultClose: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      resultExportCsv: vi.fn(),
      schemaList: vi.fn(),
      schemaRelations: vi.fn(),
      schemaRelationDetail: vi.fn(),
      schemaSample: vi.fn(),
      gitOverview: vi.fn().mockResolvedValue({
        status: 'ok',
        data: { state: 'no-repository', version: '2.43.0' },
      }),
      gitSetEnabled: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      gitInit: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      gitClone: vi.fn(),
      gitStage: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      gitUnstage: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      gitDiscard: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      gitDiff: vi.fn(),
      gitCommit: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      gitBranchCreate: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      gitBranchSwitch: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      gitBranchRename: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      gitBranchDelete: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: 'deleted' }),
      gitLog: vi.fn().mockResolvedValue({ status: 'ok', data: [] }),
      gitCommitFiles: vi.fn().mockResolvedValue({ status: 'ok', data: [] }),
      gitCommitDiff: vi.fn(),
      gitConflict: vi.fn(),
      gitResolveText: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      gitResolveDelete: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      gitMergeAbort: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      gitCredentialAnswer: vi.fn().mockResolvedValue(undefined),
      workspaceWatch: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      gitFetch: vi.fn().mockResolvedValue({ status: 'ok', data: '' }),
      gitPull: vi.fn().mockResolvedValue({ status: 'ok', data: '' }),
      gitPush: vi.fn().mockResolvedValue({ status: 'ok', data: '' }),
      gitConsoleRun: vi.fn(),
      gitConsoleCancel: vi.fn().mockResolvedValue(null),
      gitConsoleHistory: vi.fn().mockResolvedValue({ status: 'ok', data: [] }),
      gitConsoleNames: vi.fn().mockResolvedValue({
        status: 'ok',
        data: { branches: [], remotes: [], tags: [], files: [] },
      }),
      fileList: vi.fn().mockResolvedValue({ status: 'ok', data: [] }),
      fileRead: vi.fn(),
      fileWrite: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      fileRelativePath: vi.fn(),
      historySearch: vi.fn().mockResolvedValue({ status: 'ok', data: [] }),
      historyClear: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      preferencesLoad: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          editor: {
            font_size: 14,
            tab_width: 2,
            line_numbers: true,
            word_wrap: false,
          },
          history_retention_days: 90,
          guardrails: {
            development: 'risky',
            staging: 'risky',
            production: 'always',
          },
          assistant: { model: 'claude-opus-5-5' },
          check_for_updates: true,
        },
      }),
      preferencesSave: vi.fn(),
      updateCheck: vi.fn().mockResolvedValue({
        status: 'ok',
        data: { status: 'not-configured' },
      }),
      planRead: vi.fn(),
      updateInstall: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      uiStateLoad: vi.fn().mockResolvedValue({
        status: 'ok',
        data: { tabs: [], active_tab: null },
      }),
      uiStateSave: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      assistantStatus: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: { has_key: true } }),
      assistantKeySet: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      assistantKeyDelete: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      assistantAsk: vi.fn(),
      assistantCancel: vi.fn().mockResolvedValue(undefined),
      assistantExplain: vi.fn(),
    },
  }
}
