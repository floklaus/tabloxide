import { create } from 'zustand'
import { commands } from '../bindings'
import { toMessage } from '../lib/errors'
import {
  directoryOf,
  EMPTY_VIEW_FILE,
  fileName,
  parseViewFile,
  serializeViewFile,
  type ViewFile,
} from './viewFile'

/** What the application knows about a view settings file. */
export type LoadedViewFile =
  | { status: 'missing' }
  | { status: 'ok'; file: ViewFile }
  /** The file exists, but the application cannot use it. A save does not replace it. */
  | { status: 'invalid'; error: string }

type ViewFileState = {
  /** By the path of the view settings file, relative to the workspace root. */
  files: Record<string, LoadedViewFile>
  /** Reads the file from the disk. A file that does not exist is not an error. */
  load: (path: string) => Promise<LoadedViewFile>
  /**
   * Reads the file again, applies `change`, and writes the file. Thus a save
   * does not remove a view that a different program added, for example Git.
   * Returns the reason as text if the save is not possible.
   */
  update: (
    path: string,
    change: (file: ViewFile) => ViewFile,
  ) => Promise<string | null>
  reset: () => void
}

async function read(path: string): Promise<LoadedViewFile> {
  try {
    // A read of a file that does not exist is an error. The list tells the two apart.
    const list = await commands.fileList(directoryOf(path))
    if (list.status === 'error') {
      return { status: 'invalid', error: list.error.message }
    }
    if (!list.data.some((entry) => entry.path === path)) {
      return { status: 'missing' }
    }
    const text = await commands.fileRead(path)
    if (text.status === 'error') {
      return { status: 'invalid', error: text.error.message }
    }
    const parsed = parseViewFile(text.data)
    return 'file' in parsed
      ? { status: 'ok', file: parsed.file }
      : { status: 'invalid', error: parsed.error }
  } catch (error) {
    return { status: 'invalid', error: toMessage(error) }
  }
}

export const useViewFileStore = create<ViewFileState>((set, get) => {
  const remember = (path: string, loaded: LoadedViewFile) =>
    set({ files: { ...get().files, [path]: loaded } })

  return {
    files: {},
    load: async (path) => {
      const loaded = await read(path)
      remember(path, loaded)
      return loaded
    },
    update: async (path, change) => {
      const loaded = await get().load(path)
      if (loaded.status === 'invalid') {
        return `The application did not change ${fileName(path)}, because the file is not valid. ${loaded.error}`
      }
      const file = change(
        loaded.status === 'ok' ? loaded.file : EMPTY_VIEW_FILE,
      )
      try {
        const result = await commands.fileWrite(path, serializeViewFile(file))
        if (result.status === 'error') return result.error.message
      } catch (error) {
        return toMessage(error)
      }
      remember(path, { status: 'ok', file })
      return null
    },
    reset: () => set({ files: {} }),
  }
})
