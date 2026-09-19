/**
 * The `history_read` model-facing tool: list the conversation spans context
 * compaction replaced and read any one of them back as a bounded transcript.
 * Reads go through `ctx.sessionQuery`, so the tool never reaches a storage
 * backend or a live session's internals directly.
 * @module @deepseek-ai/dsh-experimental-tool-history-read
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
// Type-only: resolves the required ctx.sessionQuery service declaration.
import type {} from '@deepseek-ai/dsh-session-query'
import { checkpointsOf, renderCheckpoints, renderSpan } from './transcript.ts'

/** Plugin name registered with the Cordis loader. */
export const name = 'tool-history-read'

/** Services this plugin requires before it activates. */
export const inject = ['tools', 'sessionQuery']

/** Deployment-owned bounds for one `history_read` transcript. */
export interface Config {
  /** Inclusive byte budget for a rendered transcript. */
  maxBytes: number
  /** Maximum events rendered in one span read. */
  maxEvents: number
  /** Maximum characters rendered from one event or one checkpoint summary. */
  maxEventChars: number
}

/** Schemastery configuration for the history-read tool. */
export const Config: z<Config> = z.object({
  maxBytes: z.natural().default(8000),
  maxEvents: z.natural().default(200),
  maxEventChars: z.natural().default(2000),
})

const DESCRIPTION =
  'Read conversation history that context compaction removed from your view. '
  + 'Call with no arguments to list the replaced spans; then call with from and to to read one span back as a transcript. '
  + 'Spans are bounded: a long one is truncated with an omission notice. '
  + 'For a single raw event, use session_event_read instead.'

/**
 * Register the `history_read` tool.
 * @param ctx - the composing context.
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'history_read',
    description: DESCRIPTION,
    parameters: {
      from: {
        type: 'integer',
        description: 'First seq of the span to read, inclusive. Omit together with to for the checkpoint list.',
      },
      to: {
        type: 'integer',
        description: 'Last seq of the span to read, inclusive.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('history_read requires a calling agent with a session')
      const log = await ctx.sessionQuery.readSession(agent.session.id)
      if (args.from === undefined && args.to === undefined) {
        return { text: renderCheckpoints(checkpointsOf(log.events), config.maxEventChars) }
      }
      if (args.from === undefined || args.to === undefined) {
        throw new Error('history_read needs both from and to, or neither: one bound alone cannot name a span')
      }
      const lastSeq = log.events.length - 1
      if (args.from < 0 || args.to > lastSeq || args.from > args.to) {
        throw new Error(`history_read range ${String(args.from)}–${String(args.to)} is outside this session: use 0 ≤ from ≤ to ≤ ${String(lastSeq)}`)
      }
      return { text: renderSpan(log.events, args.from, args.to, config) }
    },
  }))
}
