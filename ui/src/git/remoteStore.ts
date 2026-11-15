import { Channel } from '@tauri-apps/api/core'
import { create } from 'zustand'
import { commands, type GitRemoteEvent } from '../bindings'

/** A question from Git or SSH that waits for the answer of the user. */
export type CredentialRequest = {
  id: number
  prompt: string
  /** `true` if the dialog must hide the answer while the user types it. */
  isSecret: boolean
}

type RemoteState = {
  /** The last progress line of the remote operation that is in progress. */
  progress: string | null
  /** The questions that wait. The dialog shows the first one. */
  requests: CredentialRequest[]
  /**
   * Sends the answer to the first question to Git. `null` cancels, and Git stops
   * the operation. The store does not keep the answer.
   */
  answer: (value: string | null) => Promise<void>
  /** Clears the progress and the questions after the operation ended. */
  end: () => void
}

export const useRemoteStore = create<RemoteState>((set, get) => ({
  progress: null,
  requests: [],
  answer: async (value) => {
    const [request, ...rest] = get().requests
    if (!request) return
    set({ requests: rest })
    try {
      await commands.gitCredentialAnswer(request.id, value)
    } catch {
      // Without the answer, Git stops the operation after its timeout and
      // the Git panel shows the error of Git.
    }
  },
  end: () => set({ progress: null, requests: [] }),
}))

function receive(event: GitRemoteEvent) {
  if (event.type === 'progress') {
    useRemoteStore.setState({ progress: event.line })
    return
  }
  const request = {
    id: event.id,
    prompt: event.prompt,
    isSecret: event.is_secret,
  }
  useRemoteStore.setState((state) => ({
    requests: [...state.requests, request],
  }))
}

/** Makes the channel on which a remote operation sends its progress and its questions. */
export function remoteChannel(): Channel<GitRemoteEvent> {
  return new Channel<GitRemoteEvent>(receive)
}
