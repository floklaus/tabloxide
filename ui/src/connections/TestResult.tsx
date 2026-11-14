import type { TestState } from './connectionStore'

/** Shows the result of a connection test with the advice that tells the user what to correct. */
export function TestResult({ state }: { state: TestState | undefined }) {
  if (!state) return null
  if (state.status === 'testing') {
    return (
      <p className="message" role="status">
        Testing the connection…
      </p>
    )
  }
  if (state.status === 'connected') {
    return (
      <p className="message message--ok" role="status">
        Connected. Server version {state.version}.
      </p>
    )
  }
  return (
    <div className="message message--error" role="alert">
      <p className="message__title">
        The connection failed. {state.error.advice}
      </p>
      <p className="message__detail">{state.error.detail}</p>
    </div>
  )
}
