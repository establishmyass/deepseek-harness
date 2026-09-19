/**
 * Host half of Task Surface: one model-facing panel tool, its durable
 * projection, and the dismissal command.
 *
 * This is the second slice of `.agents/notes/proposed/feature/2026-08-04-task-surface.md`:
 * the proposed `presentationMeta` payload (the tool persists the canonical
 * model with its result), the `taskSurface` Session projection, and durable
 * dismissal. The transactional submission record, the `getActive` read, and
 * the Dock's queue coordination remain later slices — the client reads the
 * projection and admits its submission as an ordinary message instead.
 *
 * @module @deepseek-ai/dsh-experimental-tool-task-surface
 */

import type { Context } from '@deepseek-ai/cordis'
import { registerTaskSurfaceCommand } from './command.ts'
import { registerTaskSurfaceProjection } from './projection.ts'
import { taskSurfaceTool } from './tool.ts'

export const name = 'tool-task-surface'
export const inject = ['tools', 'sessionProjections', 'commands']
export type { TaskSurfaceMeta } from './meta.ts'
export { TASK_SURFACE_META_KIND, TASK_SURFACE_TOOL_NAME } from './meta.ts'
export type { TaskSurfaceOpen, TaskSurfaceView } from './projection.ts'

/**
 * Install the tool, its projection unit, and the dismiss command.
 * @param ctx - Host context.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(taskSurfaceTool)
  registerTaskSurfaceProjection(ctx)
  registerTaskSurfaceCommand(ctx)
}
