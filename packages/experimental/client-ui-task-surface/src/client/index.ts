/**
 * Browser half of the Task Surface panel: one keyed Tool view that turns a
 * `show_task_surface` call into a fillable form and submits it as one ordinary
 * user message.
 *
 * @module @deepseek-ai/dsh-experimental-client-ui-task-surface/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TaskSurfaceCard, type TaskSurfaceInjected } from './TaskSurfaceCard.tsx'
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
 * Install the keyed `show_task_surface` Tool view.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-task-surface: dictionaries')
  const sessions = ctx.sessions
  const submit = async (sessionId: SessionId, text: string): Promise<void> => {
    const live: SessionFace | undefined = sessions.binding(sessionId)?.session
    if (live === undefined) throw new Error('this session is not materialized yet')
    // One ordinary user message through the same admission path the composer
    // uses, so the submission stays visible, replayable, and turn-starting.
    const result = await live.prompt([{ type: 'text', text }], 'queue')
    if (!result.ok) {
      throw new Error(`task surface submission failed: ${result.error.code}: ${result.error.message}`)
    }
  }
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'show_task_surface',
    locale: NS,
    inject: (sessionId: SessionId): TaskSurfaceInjected => ({ submit: text => submit(sessionId, text) }),
  }, TaskSurfaceCard))
}
