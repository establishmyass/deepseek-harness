/**
 * Browser half of Task Surface: the keyed read-only Tool row and the input
 * dock, plus the two verbs they need — admit one submission, dismiss one panel.
 *
 * @module @deepseek-ai/dsh-experimental-client-ui-task-surface/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TaskSurfaceCard, type TaskSurfaceInjected } from './TaskSurfaceCard.tsx'
import { TaskSurfaceDock, type TaskSurfaceDockInjected } from './TaskSurfaceDock.tsx'
import { en, NS, zh, type TaskSurfaceKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Task Surface panel copy. */
    taskSurface: TaskSurfaceKey
  }
}

/** Required browser services: Session objects, the Slot registry, and copy. */
export const inject = ['sessions', 'slots', 'locale']

/**
 * Install the keyed Tool row and the input dock.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-task-surface: dictionaries')
  const sessions = ctx.sessions
  const liveSession = (sessionId: SessionId): SessionFace => {
    const live = sessions.binding(sessionId)?.session
    if (live === undefined) throw new Error('this session is not materialized yet')
    return live
  }
  const submit = async (sessionId: SessionId, text: string): Promise<void> => {
    // One ordinary user message through the same admission path the composer
    // uses, so the submission stays visible, replayable, and turn-starting.
    const result = await liveSession(sessionId).prompt([{ type: 'text', text }], 'queue')
    if (!result.ok) {
      throw new Error(`task surface submission failed: ${result.error.code}: ${result.error.message}`)
    }
  }
  const dismiss = async (sessionId: SessionId, surfaceId: string): Promise<void> => {
    // The Host command appends the log event that closes the projection.
    const result = await liveSession(sessionId).command(`/task-surface dismiss ${surfaceId}`)
    if (!result.ok) {
      throw new Error(`task surface dismissal failed: ${result.error.code}: ${result.error.message}`)
    }
    if (!result.value.matched) throw new Error('this host offers no /task-surface command')
  }

  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'show_task_surface',
    locale: NS,
    inject: (sessionId: SessionId): TaskSurfaceInjected => ({ submit: text => submit(sessionId, text) }),
  }, TaskSurfaceCard))

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'task-surface',
    order: 5,
    locale: NS,
    inject: (sessionId: SessionId): TaskSurfaceDockInjected => ({
      submit: text => submit(sessionId, text),
      dismiss: surfaceId => dismiss(sessionId, surfaceId),
    }),
  }, TaskSurfaceDock))
}
