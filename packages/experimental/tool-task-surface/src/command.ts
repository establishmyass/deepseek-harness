/**
 * `/task-surface dismiss <surfaceId>`: the durable close path for one open
 * panel. It appends the log event and starts no turn, which is what keeps a
 * dismissal distinct from the ordinary-message bypass.
 *
 * @module @deepseek-ai/dsh-experimental-tool-task-surface/command
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'

const USAGE = 'Usage: /task-surface dismiss <surfaceId>'

/**
 * Append one dismissal for an exact surface id.
 * @param invocation - the dispatched human command.
 * @returns the settled command outcome.
 */
function dismiss(invocation: CommandInvocation): CommandResult {
  const [action, surfaceId, ...rest] = invocation.rawInput.trim().split(/\s+/u)
  if (action !== 'dismiss' || surfaceId === undefined || surfaceId === '' || rest.length > 0) {
    return { kind: 'error', text: USAGE }
  }
  invocation.agent.session.append('task-surface/dismissed', { surfaceId })
  return { kind: 'success', text: `Task Surface ${surfaceId} dismissed.` }
}

/**
 * Register the dismiss command.
 * @param ctx - Host context carrying the command registry.
 */
export function registerTaskSurfaceCommand(ctx: Context): void {
  ctx.commands.register({
    definitionId: CommandDefinitionId('@deepseek-ai/dsh-experimental-tool-task-surface'),
    name: 'task-surface',
    description: 'Close an open Task Surface panel',
    input: { hint: 'dismiss <surfaceId>' },
    handler: invocation => dismiss(invocation),
  })
}
