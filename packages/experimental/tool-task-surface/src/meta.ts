/**
 * The tagged payload `show_task_surface` persists with its result — the one
 * module the tool writes and the projection reads back.
 *
 * @module @deepseek-ai/dsh-experimental-tool-task-surface/meta
 */

import { z } from 'zod'

/** Wire tool name: the model-facing entry point and the client's keyed dispatch value. */
export const TASK_SURFACE_TOOL_NAME = 'show_task_surface'

/** Discriminator on the persisted result metadata; foreign metadata is ignored. */
export const TASK_SURFACE_META_KIND = 'dsh/task-surface'

/**
 * Durable presentation payload of one successful call: the panel's identity
 * plus the model exactly as logged. Replay reads both back instead of
 * re-deriving them, so a reloaded client shows the panel the first one showed.
 */
export interface TaskSurfaceMeta {
  readonly kind: typeof TASK_SURFACE_META_KIND
  readonly version: 1
  readonly surfaceId: string
  /** The validated panel model; carriers re-validate it before rendering. */
  readonly model: unknown
}

/** Validates one `tool/result.meta` payload. */
export const taskSurfaceMetaSchema = z.object({
  kind: z.literal(TASK_SURFACE_META_KIND),
  version: z.literal(1),
  surfaceId: z.string().min(1),
  model: z.unknown(),
})
