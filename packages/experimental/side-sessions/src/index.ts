/**
 * Side sessions for a live agent: fork its session at the last completed turn
 * into an attached advisor, drive that advisor with the user's question, and
 * merge one length-capped note back into the parent session. The plugin
 * contributes the `/side` human command and owns every side session it opens;
 * it adds no new session event, service, or store method.
 * @module @deepseek-ai/dsh-side-sessions
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Agent, AgentHandle, AgentOptions } from '@deepseek-ai/dsh-agent'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { capBytes, finalAssistantText } from './text.ts'

/** Plugin name registered with the Cordis loader. */
export const name = 'side-sessions'

/** Services this plugin requires before it activates. */
export const inject = ['agents', 'commands', 'sessions']

/** Deployment-owned limits for the `/side` command. */
export interface Config {
  /** Byte cap for the note merged back into the parent session. */
  mergeMaxBytes: number
}

/** Schemastery configuration for the side-session command. */
export const Config: z<Config> = z.object({
  mergeMaxBytes: z.natural().default(4000),
})

/** Session-id prefix identifying a side session across process restarts. */
const SIDE_SESSION_PREFIX = 'side-session-'

/**
 * The advisor framing injected into every side session before its first
 * request. Pinned model-visible text: the child explains the fork without
 * mutating the parent's work.
 */
const ADVISOR_FRAMING =
  'This session was forked from another conversation to answer one side question. '
  + 'Explain and analyze; do not modify files, run mutating commands, or continue the original task.'

const USAGE = 'Usage: /side [<question>|merge|close]'

/** One live side session and the handle that owns its teardown. */
interface LiveSideSession {
  /** Session the side session was forked from. */
  readonly parentSessionId: SessionId
  /** Handle returned by the agent factory; the only object that can dispose the child. */
  readonly handle: AgentHandle
}

/**
 * The balanced completed-turn prefix of `parent`'s log: every event up to and
 * including its last `turn/end`. The in-flight turn is excluded, and an empty
 * result means the child starts unseeded.
 * @param parent - the live agent whose log is sliced.
 * @returns the seed events, contiguous from sequence zero.
 */
function completedTurnPrefix(parent: Agent): SessionEvent[] {
  // oxlint-disable-next-line typescript/no-deprecated -- The inherited prefix requires the complete sequence.
  const events = parent.session.snapshotEvents()
  const lastEnd = events.findLast(event => event.type === 'turn/end')
  if (lastEnd === undefined) return []
  // seq === array index (the append contract), so slice up to and including it.
  return events.slice(0, lastEnd.seq + 1)
}

/**
 * The parent's model route, copied field by field so an inherited history stays
 * on the same provider and model and keeps its cached prefix eligible for reuse.
 * @param parent - the live agent whose route is inherited.
 * @returns the parent's provider and model, absent when it has no route yet.
 */
function inheritedAgentOptions(parent: Agent): AgentOptions {
  const { provider, model } = parent.options
  return {
    ...provider === undefined ? {} : { provider },
    ...model === undefined ? {} : { model },
  }
}

/**
 * Live side sessions opened from one parent session, in creation order.
 * @param ctx - the composing context.
 * @param parentSessionId - the parent session's identity.
 * @returns every matching live session.
 */
function sideSessionsOf(ctx: Context, parentSessionId: SessionId): Session[] {
  return ctx.sessions.list().filter(session =>
    session.header.parentSession === parentSessionId && session.id.startsWith(SIDE_SESSION_PREFIX))
}

/**
 * Merge the newest side session's answer into the calling session as one
 * plugin-sourced context message the next request reads.
 * @param ctx - the composing context.
 * @param config - the resolved plugin configuration.
 * @param parent - the agent the command was invoked on.
 * @returns the command outcome.
 */
function merge(ctx: Context, config: Config, parent: Agent): CommandResult {
  const child = sideSessionsOf(ctx, parent.session.id).at(-1)
  if (child === undefined) {
    return { kind: 'error', text: `No side session belongs to this session yet.\n${USAGE}` }
  }
  const answer = finalAssistantText(child)
  if (answer === undefined) {
    return { kind: 'error', text: `Side session ${child.id} has no settled answer yet.` }
  }
  const capped = capBytes(answer, config.mergeMaxBytes)
  if (capped.text.length === 0) {
    return {
      kind: 'error',
      text: `The answer from ${child.id} does not fit the configured mergeMaxBytes (${String(config.mergeMaxBytes)}).`,
    }
  }
  parent.inject(createUserMessage({
    content: [{ type: 'text', text: capped.text }],
    source: { kind: 'plugin', plugin: name },
  }))
  return {
    kind: 'success',
    text: `Merged the answer from ${child.id}${capped.truncated ? ` (capped at ${String(config.mergeMaxBytes)} bytes)` : ''}.`,
  }
}

/**
 * Dispose every side session this plugin opened from the calling session.
 * @param live - the plugin's live side sessions.
 * @param parent - the agent the command was invoked on.
 * @returns the command outcome after every disposal settles.
 */
async function close(live: Map<SessionId, LiveSideSession>, parent: Agent): Promise<CommandResult> {
  const owned = [...live.entries()].filter(([, entry]) => entry.parentSessionId === parent.session.id)
  if (owned.length === 0) return { kind: 'success', text: 'No open side sessions to close.' }
  for (const [id] of owned) live.delete(id)
  await Promise.allSettled(owned.map(([, entry]) => entry.handle.dispose()))
  return { kind: 'success', text: `Closed ${String(owned.length)} side session(s).` }
}

/**
 * Fork the calling session into an advisor and ask it the given question.
 * @param ctx - the composing context.
 * @param live - the plugin's live side sessions.
 * @param parent - the agent the command was invoked on.
 * @param question - the side question to ask.
 * @returns the command outcome naming the new session.
 */
async function open(ctx: Context, live: Map<SessionId, LiveSideSession>, parent: Agent, question: string): Promise<CommandResult> {
  const seed = completedTurnPrefix(parent)
  const childId = brandString<SessionId>(`${SIDE_SESSION_PREFIX}${randomUUID()}`)
  const handle = await ctx.agents.create({
    sessionId: childId,
    meta: {
      ...parent.session.header.cwd === undefined ? {} : { cwd: parent.session.header.cwd },
      parentSession: parent.session.id,
      ...seed.length === 0 ? {} : { isSeeded: true },
    },
    ...seed.length === 0 ? {} : { seed, inheritedEventCount: SessionLogOffset(seed.length) },
    agentOptions: inheritedAgentOptions(parent),
  })
  live.set(childId, { parentSessionId: parent.session.id, handle })
  const child = handle.agent
  child.inject(createUserMessage({
    content: [{ type: 'text', text: ADVISOR_FRAMING }],
    source: { kind: 'plugin', plugin: name },
  }))
  child.followup(createUserMessage({
    content: [{ type: 'text', text: question }],
    source: { kind: 'user' },
  }))
  return {
    kind: 'success',
    text: [
      `Side session ${childId} opened with ${String(seed.length)} inherited event(s).`,
      'Run /side merge here to fold its final answer into this conversation.',
    ].join('\n'),
  }
}

/**
 * Route one `/side` invocation to its operation.
 * @param ctx - the composing context.
 * @param config - the resolved plugin configuration.
 * @param live - the plugin's live side sessions.
 * @param invocation - the dispatched human command.
 * @returns the command outcome.
 */
function dispatch(
  ctx: Context,
  config: Config,
  live: Map<SessionId, LiveSideSession>,
  invocation: CommandInvocation,
): CommandResult | Promise<CommandResult> {
  const input = invocation.rawInput.trim()
  if (input === 'merge') return merge(ctx, config, invocation.agent)
  if (input === 'close') return close(live, invocation.agent)
  if (input.length === 0) return { kind: 'error', text: `A side session needs a question to ask.\n${USAGE}` }
  return open(ctx, live, invocation.agent, input)
}

/**
 * Register the `/side` command and own every side session it opens until this
 * plugin unloads.
 * @param ctx - the composing context.
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const live = new Map<SessionId, LiveSideSession>()
  ctx.effect(() => () => {
    const closing = [...live.values()]
    live.clear()
    return Promise.allSettled(closing.map(entry => entry.handle.dispose())).then(() => undefined)
  }, 'dsh-side-sessions: close live side sessions')
  ctx.commands.register({
    definitionId: CommandDefinitionId('@deepseek-ai/dsh-side-sessions'),
    name: 'side',
    description: 'Ask a side question in a forked advisor session, or merge its answer back',
    input: { hint: '[<question>|merge|close]' },
    handler: invocation => dispatch(ctx, config, live, invocation),
  })
}
