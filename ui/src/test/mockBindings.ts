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
      connectionTemplate: vi.fn(),
      connectionSave: vi.fn(),
      connectionDelete: vi.fn(),
      connectionDuplicate: vi.fn(),
      connectionTest: vi.fn(),
      sessionOpen: vi.fn(),
      sessionClose: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      queryRun: vi.fn(),
      queryCancel: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      resultFetch: vi.fn(),
      resultClose: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      resultExportCsv: vi.fn(),
    },
  }
}
