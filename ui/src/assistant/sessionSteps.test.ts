import { describe, expect, test } from 'vitest'
import { stepsOf } from './sessionSteps'

const states = (steps: ReturnType<typeof stepsOf>) =>
  steps.map((step) => step.state)

describe('stepsOf', () => {
  test('a session without a request has no steps', () => {
    expect(
      stepsOf({ lastTask: null, phases: [], status: 'idle', outcome: null }),
    ).toEqual([])
  })

  test('a plan request in its answer phase has three done steps', () => {
    const steps = stepsOf({
      lastTask: 'plan',
      phases: ['reading-plan', 'reading-schema', 'waiting', 'answering'],
      status: 'answering',
      outcome: 'running',
    })

    expect(states(steps)).toEqual(['done', 'done', 'done', 'active'])
  })

  test('a skipped structure read is done when a later step started', () => {
    const steps = stepsOf({
      lastTask: 'sql',
      phases: ['waiting'],
      status: 'waiting',
      outcome: 'running',
    })

    expect(states(steps)).toEqual(['done', 'active', 'pending'])
  })

  test('a stopped request marks its last step as not complete', () => {
    const steps = stepsOf({
      lastTask: 'plan',
      phases: ['reading-plan'],
      status: 'idle',
      outcome: 'stopped',
    })

    expect(states(steps)).toEqual(['failed', 'pending', 'pending', 'pending'])
  })

  test('all steps of a complete request are done', () => {
    const steps = stepsOf({
      lastTask: 'sql',
      phases: ['waiting', 'answering'],
      status: 'idle',
      outcome: 'done',
    })

    expect(states(steps)).toEqual(['done', 'done', 'done'])
  })
})
