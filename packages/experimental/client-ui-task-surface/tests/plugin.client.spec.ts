import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply as nodeApply } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import type { TaskSurfaceInjected } from '../src/client/TaskSurfaceCard.tsx'
import { en, NS, zh } from '../src/client/locales.ts'

/** One registration captured from the mocked Slot registry. */
interface Registration {
  readonly options: {
    readonly name: string
    readonly key?: string
    readonly locale?: string
    readonly inject?: (sessionId: SessionId) => TaskSurfaceInjected
  }
  readonly component: unknown
}

/** A Client context carrying only what this plugin touches. */
function bench(result: { ok: boolean; error?: { code: string; message: string } } = { ok: true }) {
  const registered: Registration[] = []
  const prompt = vi.fn(() => Promise.resolve(result))
  const binding = vi.fn((): { session: { prompt: typeof prompt } } | undefined => ({ session: { prompt } }))
  const register = vi.fn((options: Registration['options'], component: unknown) => {
    registered.push({ options, component })
    return () => {}
  })
  const ctx = {
    effect: (callback: () => unknown) => callback(),
    locale: { register: vi.fn(() => () => {}) },
    slots: { inject: vi.fn((_name: string, callback: () => unknown) => callback()), register },
    sessions: { binding },
  }
  apply(ctx as never)
  return { ctx, registered, prompt, binding }
}

describe('@deepseek-ai/dsh-experimental-client-ui-task-surface registration', () => {
  it('installs its dictionaries and one keyed show_task_surface Tool view', () => {
    expect(nodeApply).toBeTypeOf('function')
    nodeApply()
    expect(inject).toEqual(['sessions', 'slots', 'locale'])
    const test = bench()
    expect(test.ctx.locale.register).toHaveBeenCalledWith(NS, { zh, en })
    expect(test.ctx.slots.inject).toHaveBeenCalledWith('tool.call.toolview', expect.any(Function))
    expect(test.registered).toHaveLength(1)
    expect(test.registered[0]?.options).toMatchObject({ name: 'tool.call.toolview', key: 'show_task_surface', locale: NS })
    expect(test.registered[0]?.component).toBeTypeOf('function')
  })

  it('submits one ordinary user message for the session the view belongs to', async () => {
    const test = bench()
    const face = test.registered[0]?.options.inject?.('session-1' as SessionId)
    if (face === undefined) throw new Error('the view registered no inject face')
    await face.submit('Task Surface "Plan" answers')
    expect(test.binding).toHaveBeenCalledWith('session-1')
    expect(test.prompt).toHaveBeenCalledWith([{ type: 'text', text: 'Task Surface "Plan" answers' }], 'queue')
  })

  it('reports a missing session and a rejected admission to the panel', async () => {
    const missing = bench()
    missing.binding.mockReturnValueOnce(undefined)
    const noSession = missing.registered[0]?.options.inject?.('gone' as SessionId)
    await expect(noSession?.submit('x')).rejects.toThrow('not materialized')

    const rejected = bench({ ok: false, error: { code: 'queue-closed', message: 'no room' } })
    const face = rejected.registered[0]?.options.inject?.('session-1' as SessionId)
    await expect(face?.submit('x')).rejects.toThrow('task surface submission failed: queue-closed: no room')
  })
})
