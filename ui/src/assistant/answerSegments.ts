/** One part of an answer: text, or a code block that the user can insert. */
export type Segment =
  | { type: 'text'; text: string }
  | {
      type: 'code'
      /** The language name after the opening fence. Empty if there is none. */
      language: string
      code: string
      /** `false` while the answer has the opening fence but not the closing fence. */
      isComplete: boolean
    }

const FENCE = '```'

/**
 * Splits an answer into text and fenced code blocks. The answer can be a partial
 * answer, because the text comes in parts.
 */
/**
 * Returns the code of the one complete code block of `answer`, or `null` if the
 * answer has no code block or more than one.
 */
export function onlyCodeBlock(answer: string): string | null {
  const blocks = splitAnswer(answer).filter(
    (segment) => segment.type === 'code',
  )
  const [block] = blocks
  if (blocks.length !== 1 || block.type !== 'code' || !block.isComplete) {
    return null
  }
  return block.code.replace(/\n$/, '')
}

export function splitAnswer(answer: string): Segment[] {
  const segments: Segment[] = []
  let text: string[] = []
  let code: { language: string; lines: string[] } | null = null

  const endText = () => {
    const joined = text.join('\n').trim()
    if (joined) segments.push({ type: 'text', text: joined })
    text = []
  }
  const endCode = (isComplete: boolean) => {
    if (!code) return
    segments.push({
      type: 'code',
      language: code.language,
      code: code.lines.join('\n'),
      isComplete,
    })
    code = null
  }

  for (const line of answer.split('\n')) {
    const isFence = line.trimStart().startsWith(FENCE)
    if (code) {
      if (isFence) endCode(true)
      else code.lines.push(line)
    } else if (isFence) {
      endText()
      code = { language: line.trim().slice(FENCE.length).trim(), lines: [] }
    } else {
      text.push(line)
    }
  }
  endText()
  endCode(false)
  return segments
}
