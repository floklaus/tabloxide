/** Converts an unknown thrown value to a message for the user. */
export function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'An unknown error occurred.'
}
