import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply as nodeApply } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import type { TaskSurfaceCardProps } from '../src/client/TaskSurfaceCard.tsx'
import type { TaskSurfaceDockInjected } from '../src/client/TaskSurfaceDock.tsx'
import { en, NS, zh } from '../src/client/locales.ts'

/** One registration captured from the mocked Slot registry. */
interface Registration {
  readonly options: {
    readonly name: string
    readonly id?: string
    readonly key?: string
    readonly locale?: string
    readonly inject?: (sessionId: SessionId) => unknown
  }
  readonly component: unknown
}

/** A Client context carrying only what this plugin touches. */
function bench(
  promptResult: { ok: boolean; error?: { code: string; message: string } } = { ok: true },
  commandResult: {
    ok: boolean
    error?: { code: string; message: string }
    value?: { matched: boolean }
  } = { ok: true, value: { matched: true } },
) {
  const registered: Registration[] = []
  const prompt = vi.fn(() => Promise.resolve(promptResult))
  const command = vi.fn(() => Promise.resolve(commandResult))
  const binding = vi.fn((): { session: { prompt: typeof prompt; command: typeof command } } | undefined => ({
    session: { prompt, command },
  }))
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
  return { ctx, registered, prompt, command, binding }
}

/** One registration's inject face, resolved for a session. */
function face(
  test: ReturnType<typeof bench>,
  name: string,
  sessionId = 'session-1',
): TaskSurfaceCardProps & TaskSurfaceDockInjected {
  const entry = test.registered.find(candidate => candidate.options.name === name)
  if (entry === undefined) throw new Error(`no registration for ${name}`)
  const inject = entry.options.inject as (id: SessionId) => TaskSurfaceCardProps & TaskSurfaceDockInjected
  return inject(sessionId as SessionId)
}

describe('@deepseek-ai/dsh-experimental-client-ui-task-surface registration', () => {
  it('installs its dictionaries, one keyed Tool view, and one input dock', () => {
    expect(nodeApply).toBeTypeOf('function')
    nodeApply()
    expect(inject).toEqual(['sessions', 'slots', 'locale'])
    const test = bench()
    expect(test.ctx.locale.register).toHaveBeenCalledWith(NS, { zh, en })
    expect(test.ctx.slots.inject).toHaveBeenCalledWith('tool.call.toolview', expect.any(Function))
    expect(test.ctx.slots.inject).toHaveBeenCalledWith('conversation.input.dock', expect.any(Function))
    expect(test.registered.map(entry => entry.options)).toEqual([
      expect.objectContaining({ name: 'tool.call.toolview', key: 'show_task_surface', locale: NS }),
      expect.objectContaining({ name: 'conversation.input.dock', id: 'task-surface', locale: NS }),
    ])
    expect(test.registered[0]?.component).toBeTypeOf('function')
    expect(test.registered[1]?.component).toBeTypeOf('function')
  })

  it('submits one ordinary user message for the session the mounts belong to', async () => {
    const test = bench()
    const card = face(test, 'tool.call.toolview')
    const dock = face(test, 'conversation.input.dock')
    await card.submit('Task Surface "Plan" answers')
    await dock.submit('Task Surface "Plan" answers again')
    expect(test.binding).toHaveBeenCalledWith('session-1')
    expect(test.prompt).toHaveBeenNthCalledWith(1, [{ type: 'text', text: 'Task Surface "Plan" answers' }], 'queue')
    expect(test.prompt).toHaveBeenNthCalledWith(2, [{ type: 'text', text: 'Task Surface "Plan" answers again' }], 'queue')
  })

  it('reports a missing session and a rejected admission to the panel', async () => {
    const missing = bench()
    missing.binding.mockReturnValueOnce(undefined)
    const card = face(missing, 'tool.call.toolview')
    await expect(card.submit('x')).rejects.toThrow('not materialized')

    const rejected = bench({ ok: false, error: { code: 'queue-closed', message: 'no room' } })
    const dock = face(rejected, 'conversation.input.dock')
    await expect(dock.submit('x')).rejects.toThrow('task surface submission failed: queue-closed: no room')
  })

  it('dismisses through the Host command and reports every failure mode', async () => {
    const test = bench()
    const dock = face(test, 'conversation.input.dock')
    await dock.dismiss('surface-1')
    expect(test.command).toHaveBeenCalledWith('/task-surface dismiss surface-1')

    const refused = bench({ ok: true }, { ok: false, error: { code: 'offline', message: 'gone' } })
    await expect(face(refused, 'conversation.input.dock').dismiss('x'))
      .rejects.toThrow('task surface dismissal failed: offline: gone')

    const unmatched = bench({ ok: true }, { ok: true, value: { matched: false } })
    await expect(face(unmatched, 'conversation.input.dock').dismiss('x'))
      .rejects.toThrow('this host offers no /task-surface command')

    const noSession = bench()
    noSession.binding.mockReturnValueOnce(undefined)
    await expect(face(noSession, 'conversation.input.dock').dismiss('x'))
      .rejects.toThrow('not materialized')
  })
})
