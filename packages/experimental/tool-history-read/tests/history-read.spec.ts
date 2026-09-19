import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import { createUserMessage, LlmAdapter, MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import type {
  SessionEventSearchPage,
  SessionEventSearchRequest,
  SessionSearchExecContext,
  SessionSearchHit,
  SessionSearchPage,
  SessionSearchRequest,
} from '@deepseek-ai/dsh-session-query'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as historyRead from '@deepseek-ai/dsh-experimental-tool-history-read'
import type { Config } from '@deepseek-ai/dsh-experimental-tool-history-read'
import { checkpointsOf, renderCheckpoints, renderSpan, transcriptLine } from '../src/transcript.ts'

/** The query service's search half is unused here; only its concrete reads matter. */
class ReadOnlyQuery extends SessionQueryEngine {
  override searchSessions(request: SessionSearchRequest, _exec?: SessionSearchExecContext): Promise<SessionSearchPage<SessionSearchHit>> {
    return Promise.reject(new Error(`unused searchSessions: ${request.query}`))
  }

  override searchEvents(request: SessionEventSearchRequest): Promise<SessionEventSearchPage> {
    return Promise.reject(new Error(`unused searchEvents: ${request.query}`))
  }
}

/** Script entry: one text answer, or one call to a named tool. */
type ScriptEntry =
  | { readonly text: string }
  | { readonly call: { readonly name: string; readonly arguments: object } }

/** Streams one scripted answer per model call. */
class ScriptedAdapter extends LlmAdapter {
  constructor(private readonly script: ScriptEntry[]) {
    super()
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('ScriptedAdapter: script exhausted')
    if ('text' in entry) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: entry.text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: entry.text } }
    } else {
      const id = ToolCallId('scripted-call')
      const json = JSON.stringify(entry.call.arguments)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: entry.call.name, argumentsDelta: json }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: entry.call.name, arguments: json } }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

interface Harness {
  readonly ctx: Context
  readonly agent: Agent
  readonly plugin: Awaited<ReturnType<Context['plugin']>>
}

/** Mount the real loop, the read-only query service, and this plugin over a scripted model. */
async function harness(script: ScriptEntry[] = [], config: Partial<Config> = {}): Promise<Harness> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const loop = await mountAgentLoopTestHarness(ctx)
  ctx.llm.registerAdapter(['mock'], new ScriptedAdapter(script))
  await ctx.plugin(ReadOnlyQuery)
  const plugin = await ctx.plugin(historyRead, { maxBytes: 8000, maxEvents: 200, maxEventChars: 2000, ...config })
  const agent = await loop.create(SessionId('caller'), { provider: 'mock', model: 'mock-model' }, { cwd: '/workspace' })
  return { ctx, agent, plugin }
}

/** Run one model turn so the session carries real transcript events. */
async function turn(test: Harness, text: string): Promise<void> {
  test.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await test.agent.whenIdle()
}

/** Execute `history_read` through the same registry boundary a model call uses. */
function read(
  test: Harness,
  args: Record<string, unknown>,
  agent: Agent | undefined = test.agent,
): Promise<ToolExecutionResult> {
  return test.ctx.tools.execute({
    name: 'history_read',
    arguments: args,
    callId: ToolCallId('history-call'),
    signal: new AbortController().signal,
    ...agent === undefined ? {} : { agent },
  })
}

/** The model-facing text of one completed execution. */
function resultText(result: ToolExecutionResult): string {
  return result.content.map(block => block.type === 'text' ? block.text : '').join('\n')
}

/** One recorded compaction checkpoint over seqs 1–3. */
function appendCheckpoint(test: Harness): void {
  test.agent.session.append('compaction/summary', {
    compactionId: CompactionId('compaction-1'),
    summary: [{ type: 'text', text: 'Earlier: the user asked for the weather and got a forecast.' }],
    shadowedRange: { start: SessionSeq(1), end: SessionSeq(3) },
    shadowedSeqs: [SessionSeq(1), SessionSeq(2), SessionSeq(3)],
    shadowedTokenCount: 120,
    provider: 'mock',
    model: 'mock-model',
  })
}

/** One hand-built user event for the pure transcript tests. */
function userEvent(seq: number, text: string): SessionEvent {
  return {
    type: 'user/message',
    seq: SessionSeq(seq),
    time: 0,
    data: { id: MessageId(`m-${String(seq)}`), role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } },
    surfaceOp: 'append',
  }
}

/** One hand-built event with no transcript content. */
function markerEvent(seq: number): SessionEvent {
  return { type: 'turn/start', seq: SessionSeq(seq), time: 0, data: { turn: 0 } }
}

describe('@deepseek-ai/dsh-experimental-tool-history-read registration', () => {
  it('registers one tool with Loader-safe exports and disposes it', async () => {
    const test = await harness()
    expect(historyRead.name).toBe('tool-history-read')
    expect(historyRead.inject).toEqual(['tools', 'sessionQuery'])
    expect('default' in historyRead).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(historyRead)).toBe(historyRead)
    const tool = test.ctx.tools.get('history_read')
    if (tool === undefined) throw new Error('history_read was not registered')
    expect(tool.description).toContain('conversation history that context compaction removed')
    expect(Object.keys(tool)).not.toContain('isConcurrencySafe')
    expect(tool.output.render({}, { text: 'rendered' })).toEqual([{ type: 'text', text: 'rendered' }])

    await test.plugin.dispose()
    expect(test.ctx.tools.get('history_read')).toBeUndefined()
  })
})

describe('history_read', () => {
  it('lists compaction checkpoints, and says so when nothing was compacted', async () => {
    const test = await harness([{ text: 'first answer' }])
    await turn(test, 'hello')

    const empty = await read(test, {})
    expect(resultText(empty)).toBe('No compaction has removed history from this session: every event is still in your current view.')

    appendCheckpoint(test)
    const listed = await read(test, {})
    expect(resultText(listed)).toContain('Read a span with history_read({ from, to }):')
    expect(resultText(listed)).toContain('checkpoint #')
    expect(resultText(listed)).toContain('replaced events #1–3 (3 events, 120 tokens)')
    expect(resultText(listed)).toContain('the user asked for the weather')
  })

  it('reads a span back as a transcript of the real turn events', async () => {
    const test = await harness([{ text: 'the first answer' }, { call: { name: 'no_such_tool', arguments: { question: 42 } } }])
    await turn(test, 'hello there')
    await turn(test, 'call the tool')

    const transcript = await read(test, { from: 0, to: test.agent.session.seq - 1 })
    const text = resultText(transcript)
    expect(text).toContain('user: hello there')
    expect(text).toContain('assistant: the first answer')
    expect(text).toContain('tool call no_such_tool(')
    expect(text).toContain('tool result:')
    expect(transcript.isError).toBe(false)
  })

  it('bounds a long span with an omission notice', async () => {
    const test = await harness([{ text: 'a'.repeat(4000) }], { maxBytes: 500 })
    await turn(test, 'hello')

    const bounded = await read(test, { from: 0, to: test.agent.session.seq - 1 })
    const text = resultText(bounded)
    expect(text).toContain('user: hello')
    expect(text).toContain('Omitted ')
    expect(text).toContain('bytes.')
    expect(text.length).toBeLessThan(1000)
  })

  it('rejects a range outside the session and a lone bound', async () => {
    const test = await harness([{ text: 'answer' }])
    await turn(test, 'hello')
    const lastSeq = test.agent.session.seq - 1

    const loneBound = await read(test, { from: 1 })
    expect(loneBound.isError).toBe(true)
    expect(resultText(loneBound)).toContain('needs both from and to')

    for (const args of [{ from: -1, to: 1 }, { from: 3, to: 2 }, { from: 0, to: lastSeq + 5 }]) {
      const rejected = await read(test, args)
      expect(rejected.isError).toBe(true)
      expect(resultText(rejected)).toContain('outside this session')
    }
  })

  it('rejects a call with no calling agent', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(ReadOnlyQuery)
    await ctx.plugin(historyRead, { maxBytes: 8000, maxEvents: 200, maxEventChars: 2000 })
    const rejected = await ctx.tools.execute({
      name: 'history_read',
      arguments: {},
      callId: ToolCallId('history-call'),
      signal: new AbortController().signal,
    })
    expect(rejected.isError).toBe(true)
    expect(resultText(rejected)).toContain('requires a calling agent')
  })
})

describe('history_read transcript helpers', () => {
  it('renders one line per content-bearing event and skips the rest', () => {
    expect(transcriptLine(userEvent(1, ' hi '), 100)).toBe('user: hi')
    expect(transcriptLine(userEvent(2, 'x'.repeat(20)), 5)).toBe('user: xxxxx …')
    expect(transcriptLine({
      type: 'tool/call',
      seq: SessionSeq(3),
      time: 0,
      data: { turn: 0, step: 0, callId: ToolCallId('c-1'), name: 'bash', arguments: '{"command":"ls"}' },
    }, 100)).toBe('tool call bash({"command":"ls"})')
    expect(transcriptLine(markerEvent(4), 100)).toBeUndefined()
    expect(transcriptLine(userEvent(5, '   '), 100)).toBeUndefined()
  })

  it('collects checkpoints and renders both an empty and a populated index', () => {
    const checkpoint: SessionEvent = {
      type: 'compaction/summary',
      seq: SessionSeq(9),
      time: 0,
      data: {
        compactionId: CompactionId('compaction-9'),
        summary: [{ type: 'text', text: 's'.repeat(30) }],
        shadowedRange: { start: SessionSeq(2), end: SessionSeq(6) },
        shadowedSeqs: [SessionSeq(2), SessionSeq(6)],
        shadowedTokenCount: 42,
        provider: 'mock',
        model: 'mock-model',
      },
    }
    const found = checkpointsOf([userEvent(1, 'hello'), checkpoint])
    expect(found).toEqual([{ seq: 9, start: 2, end: 6, tokens: 42, summary: 's'.repeat(30) }])
    expect(renderCheckpoints([], 100)).toBe('No compaction has removed history from this session: every event is still in your current view.')
    expect(renderCheckpoints(found, 10)).toContain('checkpoint #9 replaced events #2–6 (5 events, 42 tokens): ssssssssss …')
  })

  it('bounds rendered spans by width and by count', () => {
    const events = [userEvent(0, 'alpha'), userEvent(1, 'beta'), userEvent(2, 'gamma')]
    const wide = { maxBytes: 8000, maxEvents: 200, maxEventChars: 2000 }
    expect(renderSpan(events, 0, 2, wide)).toBe('user: alpha\nuser: beta\nuser: gamma')
    expect(renderSpan(events, 0, 2, { ...wide, maxEvents: 2 })).toBe('user: alpha\nuser: beta\nOmitted 1 later events.')
    expect(renderSpan(events, 0, 2, { ...wide, maxEvents: 1 })).toBe('user: alpha\nOmitted 2 later events.')
    expect(renderSpan(events, 0, 2, { ...wide, maxEvents: 0 })).toBe('Omitted 3 later events.')
    expect(renderSpan([markerEvent(0)], 0, 0, wide)).toBe('Events #0–0 hold no transcript content.')

    const narrow = renderSpan(events, 0, 2, { ...wide, maxBytes: 6 })
    expect(narrow.startsWith('user:')).toBe(true)
    expect(narrow).toContain('Omitted ')
    expect(narrow).toContain('bytes.')
    expect(narrow.length).toBeLessThan(60)
  })
})
