/**
 * The `taskSurface` projection unit: one host fold of the open panel,
 * published to client carriers as its whole current value.
 *
 * The Session log stays the authority — a successful `show_task_surface`
 * result opens the panel, a dismissal event or the next real user message
 * closes it — so a reload, a fork, and a rewind all recover the same state by
 * folding the log they have.
 *
 * @module @deepseek-ai/dsh-experimental-tool-task-surface/projection
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import { TASK_SURFACE_TOOL_NAME, taskSurfaceMetaSchema } from './meta.ts'

/** One open panel: its identity plus the model a carrier renders. */
export interface TaskSurfaceOpen {
  readonly callId: string
  readonly surfaceId: string
  readonly model: unknown
}

/** Client view of the unit: at most one open panel per Session. */
export interface TaskSurfaceView {
  readonly active: TaskSurfaceOpen | null
}

/** Host state: the published view plus the call still awaiting its result. */
interface TaskSurfaceProjectionState {
  readonly pending: { readonly callId: string; readonly model: unknown } | null
  readonly view: TaskSurfaceView
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One dismissed Task Surface. The log is the authority for the closure, so
     * a reload of either side agrees without a second store.
     */
    'task-surface/dismissed': { surfaceId: string }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    taskSurface: TaskSurfaceProjectionState
  }

  interface SessionProjectionMap {
    /** The Session's open Task Surface panel, or `null` while none is open. */
    taskSurface: TaskSurfaceView
  }
}

const openSchema = z.object({
  callId: z.string(),
  surfaceId: z.string(),
  model: z.unknown(),
})

const stateSchema = z.object({
  pending: z.object({ callId: z.string(), model: z.unknown() }).nullable(),
  view: z.object({ active: openSchema.nullable() }),
})

const viewSchema = z.object({ active: openSchema.nullable() })

/**
 * The model inside one logged `tool/call` argument string.
 * @param argsRaw - the call's argument JSON as logged.
 * @returns the declared model, or undefined when this call carries none.
 */
function modelOfArguments(argsRaw: string): unknown {
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    return (parsed as { model?: unknown }).model
  } catch {
    // A truncated or non-JSON argument string is not a panel.
    return undefined
  }
}

/**
 * Advance the panel state by one committed event.
 * @param state - panel state before the event.
 * @param event - the next committed Session event.
 * @returns the original reference, or the advanced state.
 */
function applyTaskSurface(state: TaskSurfaceProjectionState, event: SessionEvent): TaskSurfaceProjectionState {
  if (event.type === 'tool/call') {
    if (event.data.name !== TASK_SURFACE_TOOL_NAME) return state
    const model = modelOfArguments(event.data.arguments)
    if (model === undefined) return state
    return { pending: { callId: event.data.callId, model }, view: state.view }
  }
  if (event.type === 'tool/result') {
    const pending = state.pending
    if (pending === null || event.data.message.source.callId !== pending.callId) return state
    const parsed = event.data.message.content[0].isError === true
      ? undefined
      : taskSurfaceMetaSchema.safeParse(event.data.meta).data
    return parsed === undefined
      // A rejected call (invalid arguments, a denied tool) opens nothing.
      ? { pending: null, view: state.view }
      : {
        pending: null,
        view: { active: { callId: pending.callId, surfaceId: parsed.surfaceId, model: parsed.model } },
      }
  }
  if (event.type === 'task-surface/dismissed') {
    const active = state.view.active
    if (active === null || active.surfaceId !== event.data.surfaceId) return state
    return { pending: null, view: { active: null } }
  }
  if (event.type === 'user/message' && event.data.source.kind === 'user') {
    // The user's own next message is the explicit bypass: submitting answers
    // and sending something else both close the panel.
    if (state.view.active === null && state.pending === null) return state
    return { pending: null, view: { active: null } }
  }
  return state
}

/** The unit definition: registered by {@link registerTaskSurfaceProjection}, folded directly by tests. */
export const taskSurfaceProjection = {
  key: 'taskSurface',
  stateSchema,
  init: () => ({ pending: null, view: { active: null } }),
  apply: applyTaskSurface,
  wire: {
    viewSchema,
    // The stored view reference IS the wire value, so an internal-only change
    // never publishes.
    view: state => state.view,
  },
  stateVersion: 1,
} satisfies ProjectionDefinition<'taskSurface', TaskSurfaceProjectionState>

/**
 * Register the projection unit on the calling fiber.
 * @param ctx - Host context carrying the projection registry.
 */
export function registerTaskSurfaceProjection(ctx: Context): void {
  ctx.sessionProjections.register(taskSurfaceProjection)
}
