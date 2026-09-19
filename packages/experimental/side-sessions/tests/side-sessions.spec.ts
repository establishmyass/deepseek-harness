import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage, LlmAdapter, MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as sideSessions from '@deepseek-ai/dsh-experimental-side-sessions'
import type { Config } from '@deepseek-ai/dsh-experimental-side-sessions'
import { capBytes, lastAssistantText, messageText } from '../src/text.ts'

const USAGE = 'Usage: /side [<question>|merge|close]'

/** One scripted text answer per model call; records every request it receives. */
class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly answers: string[]) {
    super()
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const answer = this.answers.shift()
    if (answer === undefined) throw new Error('ScriptedAdapter: script exhausted')
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: answer }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

interface Harness {
  readonly ctx: Context
  readonly loop: Awaited<ReturnType<typeof mountAgentLoopTestHarness>>
  readonly parent: Agent
  readonly adapter: ScriptedAdapter
  readonly plugin: Awaited<ReturnType<Context['plugin']>>
}

/** Mount the real loop, command registry, and this plugin over a scripted model. */
async function harness(answers: string[], config: Partial<Config> = {}): Promise<Harness> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const loop = await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(CommandRuntime)
  const adapter = new ScriptedAdapter(answers)
  ctx.llm.registerAdapter(['mock'], adapter)
  const plugin = await ctx.plugin(sideSessions, { mergeMaxBytes: 4000, ...config })
  const parent = await loop.create(SessionId('parent-1'), { provider: 'mock', model: 'mock-model' }, { cwd: '/workspace' })
  return { ctx, loop, parent, adapter, plugin }
}

/** Run one parent turn so the session has a completed turn to fork. */
async function completedParentTurn(test: Harness, text: string): Promise<void> {
  test.parent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await test.parent.whenIdle()
}

/** Execute one `/side` line through the same registry boundary a UI adapter uses. */
async function run(test: Harness, line: string, agent: Agent = test.parent): Promise<CommandResult> {
  const execution = await test.ctx.commands.execute(agent, line, [], new AbortController().signal)
  if (execution === undefined) throw new Error(`command was not registered: ${line}`)
  return execution.result
}

/** The live agent of the side session forked from the harness parent. */
function sideSessionAgent(test: Harness): Agent {
  const child = test.ctx.agents.list().find(agent => agent.session.header.parentSession === test.parent.session.id)
  if (child === undefined) throw new Error('no side session agent was created')
  return child
}

/** Narrows a command result to its success text for order-independent assertions. */
function successText(result: CommandResult): string {
  if (result.kind !== 'success') throw new Error(`expected success, got ${JSON.stringify(result)}`)
  return result.text ?? ''
}

/** The last message in a session's derived history. */
function lastMessage(agent: Agent): Message {
  const message = agent.session.deriveMessages().at(-1)
  if (message === undefined) throw new Error('session history is empty')
  return message
}

describe('@deepseek-ai/dsh-experimental-side-sessions registration', () => {
  it('registers one global command with Loader-safe exports and disposes it', async () => {
    const test = await harness([])
    expect(sideSessions.name).toBe('side-sessions')
    expect(sideSessions.inject).toEqual(['agents', 'commands', 'sessions'])
    expect('default' in sideSessions).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(sideSessions)).toBe(sideSessions)

    expect(test.ctx.commands.list(test.parent)).toContainEqual({
      definitionId: '@deepseek-ai/dsh-side-sessions',
      name: 'side',
      description: 'Ask a side question in a forked advisor session, or merge its answer back',
      input: { hint: '[<question>|merge|close]' },
    })

    await test.plugin.dispose()
    expect(test.ctx.commands.find(test.parent, 'side')).toBeUndefined()
  })
})

describe('/side command', () => {
  it('requires a question when none of the operations is named', async () => {
    const test = await harness([])
    await expect(run(test, '/side')).resolves.toEqual({
      kind: 'error',
      text: `A side session needs a question to ask.\n${USAGE}`,
    })
  })

  it('forks a seeded side session on the parent route and asks the question', async () => {
    const test = await harness(['parent answer', 'four'])
    await completedParentTurn(test, 'hello')
    const result = await run(test, '/side What is 2+2?')
    const child = sideSessionAgent(test)
    await child.whenIdle()

    const events = test.parent.session.snapshotEvents()
    const seedLength = (events.findLast(event => event.type === 'turn/end')?.seq ?? -1) + 1
    expect(seedLength).toBeGreaterThan(0)
    expect(successText(result)).toContain(`Side session ${child.session.id} opened with ${String(seedLength)} inherited event(s).`)
    expect(child.session.header.parentSession).toBe(test.parent.session.id)
    expect(child.session.header.isSeeded).toBe(true)
    expect(child.session.header.cwd).toBe('/workspace')
    expect(child.session.inheritedEventCount).toBe(seedLength)

    // The inherited route keeps the forked history eligible for prefix reuse.
    expect(test.adapter.requests[1]?.provider).toBe('mock')
    expect(test.adapter.requests[1]?.model).toBe('mock-model')

    // Advisor framing precedes the question in the child's history.
    const messages = child.session.deriveMessages()
    const framing = messages.findIndex(message => message.source.kind === 'plugin' && message.source.plugin === 'side-sessions')
    const question = messages.findIndex(message => message.source.kind === 'user' && messageText(message) === 'What is 2+2?')
    expect(framing).toBeGreaterThanOrEqual(0)
    expect(question).toBeGreaterThan(framing)
  })

  it('forks an unseeded side session when the parent has no completed turn', async () => {
    const test = await harness(['answer'])
    const result = await run(test, '/side quick question')
    const child = sideSessionAgent(test)

    expect(successText(result)).toContain('opened with 0 inherited event(s)')
    expect(child.session.header.isSeeded).toBe(false)
    expect(child.session.header.parentSession).toBe(test.parent.session.id)
    await child.whenIdle()
    expect(lastMessage(child).role).toBe('assistant')
  })

  it('forks from a parent that has neither a route nor a workspace yet', async () => {
    const test = await harness([])
    const bare = await test.loop.create(SessionId('parent-bare'))
    const result = await run(test, '/side bare question', bare)
    const child = test.ctx.agents.list().find(agent => agent.session.header.parentSession === bare.session.id)
    if (child === undefined) throw new Error('no side session agent was created')

    expect(successText(result)).toContain('opened with 0 inherited event(s)')
    expect(child.session.header.cwd).toBeUndefined()
    expect(child.session.header.isSeeded).toBe(false)
    await child.whenIdle()
  })

  it('merges the newest side session answer into the parent as one plugin context message', async () => {
    const test = await harness(['parent answer', 'the child answer', 'next parent answer'])
    await completedParentTurn(test, 'hello')
    await run(test, '/side question')
    const child = sideSessionAgent(test)
    await child.whenIdle()

    const merged = await run(test, '/side merge')
    expect(successText(merged)).toContain(`Merged the answer from ${child.session.id}`)

    // Injected context waits for a waking message: the note reaches the parent's
    // next request as one plugin-sourced user message ahead of that prompt.
    await completedParentTurn(test, 'next question')
    const request = test.adapter.requests.at(-1)
    const messages = request?.messages ?? []
    const note = messages.find(message => message.source.kind === 'plugin' && message.source.plugin === 'side-sessions')
    expect(note?.role).toBe('user')
    expect(messageText(note as Message)).toBe('the child answer')
    expect(messages.indexOf(note as Message)).toBeLessThan(messages.findIndex(message => messageText(message) === 'next question'))
  })

  it('caps a merged note at the byte budget without splitting a character', async () => {
    const test = await harness(['parent answer', '答案是四十二', 'next parent answer'], { mergeMaxBytes: 8 })
    await completedParentTurn(test, 'hello')
    await run(test, '/side question')
    await sideSessionAgent(test).whenIdle()

    const merged = await run(test, '/side merge')
    expect(successText(merged)).toContain('capped at 8 bytes')

    await completedParentTurn(test, 'next question')
    const note = test.adapter.requests.at(-1)?.messages
      .find(message => message.source.kind === 'plugin' && message.source.plugin === 'side-sessions')
    expect(messageText(note as Message)).toBe('答案')
  })

  it('refuses a merged note that cannot fit the byte budget at all', async () => {
    const test = await harness(['parent answer', '四'], { mergeMaxBytes: 1 })
    await completedParentTurn(test, 'hello')
    await run(test, '/side question')
    const child = sideSessionAgent(test)
    await child.whenIdle()

    await expect(run(test, '/side merge')).resolves.toEqual({
      kind: 'error',
      text: `The answer from ${child.session.id} does not fit the configured mergeMaxBytes (1).`,
    })
    expect(messageText(lastMessage(test.parent))).toBe('parent answer')
  })

  it('reports a merge with no side session at all', async () => {
    const test = await harness([])
    await expect(run(test, '/side merge')).resolves.toEqual({
      kind: 'error',
      text: `No side session belongs to this session yet.\n${USAGE}`,
    })
  })

  it('reports a side session with no settled answer', async () => {
    const test = await harness([])
    test.ctx.sessions.create(SessionId('side-session-orphan'), { meta: { parentSession: test.parent.session.id } })
    await expect(run(test, '/side merge')).resolves.toEqual({
      kind: 'error',
      text: 'Side session side-session-orphan has no settled answer yet.',
    })
  })

  it('closes the side sessions opened from this session', async () => {
    const test = await harness(['parent answer', 'child answer'])
    await completedParentTurn(test, 'hello')
    await run(test, '/side question')
    const child = sideSessionAgent(test)
    await child.whenIdle()

    await expect(run(test, '/side close')).resolves.toEqual({ kind: 'success', text: 'Closed 1 side session(s).' })
    expect(test.ctx.agents.get(child.session.id)).toBeUndefined()
  })

  it('reports a close with nothing open', async () => {
    const test = await harness([])
    await expect(run(test, '/side close')).resolves.toEqual({ kind: 'success', text: 'No open side sessions to close.' })
  })

  it('closes live side sessions when the plugin unloads', async () => {
    const test = await harness(['parent answer', 'child answer'])
    await completedParentTurn(test, 'hello')
    await run(test, '/side question')
    const child = sideSessionAgent(test)
    await child.whenIdle()

    await test.plugin.dispose()
    expect(test.ctx.agents.get(child.session.id)).toBeUndefined()
  })
})

describe('side-session note text', () => {
  /** One derived message carrying the given blocks under an assistant role. */
  function message(content: Message['content']): Message {
    return { id: MessageId('note-1'), role: 'assistant', content, source: { kind: 'user' } }
  }

  it('joins text blocks and skips non-text blocks', () => {
    expect(messageText(message([
      { type: 'text', text: 'first' },
      { type: 'tool-call', id: ToolCallId('call-1'), name: 'bash', arguments: '{}' },
      { type: 'text', text: 'second' },
    ]))).toBe('first\nsecond')
    expect(messageText(message([]))).toBe('')
  })

  it('selects the last non-empty assistant text', () => {
    const messages: Message[] = [
      message([{ type: 'text', text: ' answer ' }]),
      { id: MessageId('m-1'), role: 'user', content: [{ type: 'text', text: 'question' }], source: { kind: 'user' } },
      message([{ type: 'text', text: '   ' }]),
    ]
    expect(lastAssistantText(messages)).toBe('answer')
    expect(lastAssistantText([])).toBeUndefined()
  })

  it('caps to the byte budget and never splits a character', () => {
    expect(capBytes('answer', 6)).toEqual({ text: 'answer', truncated: false })
    expect(capBytes('abcdef', 3)).toEqual({ text: 'abc', truncated: true })
    expect(capBytes('答案', 4)).toEqual({ text: '答', truncated: true })
    expect(capBytes('四', 1)).toEqual({ text: '', truncated: true })
  })
})
