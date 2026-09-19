import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolDefinition, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as taskSurface from '@deepseek-ai/dsh-experimental-tool-task-surface'

/** Script entry: one text answer, or one call to a named tool. */
type ScriptEntry =
  | { readonly text: string }
  | { readonly call: { readonly name: string; readonly arguments: object } }

/** Streams one scripted answer per model call. */
class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: ScriptEntry[]) {
    super()
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
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
  readonly adapter: ScriptedAdapter
  readonly plugin: Awaited<ReturnType<Context['plugin']>>
}

/** Mount the real loop and this plugin over a scripted model. */
async function harness(script: ScriptEntry[] = []): Promise<Harness> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const loop = await mountAgentLoopTestHarness(ctx)
  const adapter = new ScriptedAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const plugin = await ctx.plugin(taskSurface)
  const agent = await loop.create(SessionId('caller'), { provider: 'mock', model: 'mock-model' }, { cwd: '/workspace' })
  return { ctx, agent, adapter, plugin }
}

/** One realistic panel covering every declared block and field kind. */
const MODEL = {
  version: 1,
  title: 'Ship the panel',
  description: 'Compare two release options.',
  sections: [
    {
      id: 'options',
      title: 'Options',
      layout: { kind: 'grid', columns: 2 },
      blocks: [
        { kind: 'markdown', text: '**Canary** first.\n\n![chart](https://example.test/x.png)' },
        { kind: 'metrics', items: [{ label: 'Risk', value: 'low', detail: 'one shard' }] },
        {
          kind: 'table',
          columns: [{ id: 'opt', label: 'Option' }, { id: 'eta', label: 'ETA' }],
          rows: [{ opt: 'canary', eta: '2h' }, { opt: 'big bang', eta: '10m' }],
        },
        { kind: 'notice', tone: 'warning', text: 'Rollback needs the feature flag.' },
      ],
    },
  ],
  fields: [
    { kind: 'text', id: 'note', label: 'Note', multiline: true, initial: 'none' },
    {
      kind: 'choice',
      id: 'strategy',
      label: 'Strategy',
      options: [{ id: 'canary', label: 'Canary' }, { id: 'all', label: 'All at once' }],
      initial: 'canary',
    },
    { kind: 'multi-choice', id: 'checks', label: 'Checks', options: [{ id: 'smoke', label: 'Smoke' }], initial: ['smoke'] },
    { kind: 'toggle', id: 'notify', label: 'Notify', initial: true },
  ],
  submit: { label: 'Approve' },
} as const

/** Execute `show_task_surface` through the same registry boundary a model call uses. */
function show(test: Harness, model: unknown): Promise<ToolExecutionResult> {
  return test.ctx.tools.execute({
    name: 'show_task_surface',
    arguments: { model },
    callId: ToolCallId('surface-call'),
    signal: new AbortController().signal,
    agent: test.agent,
  })
}

/** The model-facing text of one completed execution. */
function resultText(result: ToolExecutionResult): string {
  return result.content.map(block => block.type === 'text' ? block.text : '').join('\n')
}

/** A model with the given section count, one markdown block each. */
function withSections(count: number): object {
  return {
    ...MODEL,
    sections: Array.from({ length: count }, (_value, index) => ({
      id: `s${String(index)}`,
      blocks: [{ kind: 'markdown', text: 'text' }],
    })),
  }
}

describe('@deepseek-ai/dsh-experimental-tool-task-surface registration', () => {
  it('registers one tool with Loader-safe exports and disposes it', async () => {
    const test = await harness()
    expect(taskSurface.name).toBe('tool-task-surface')
    expect(taskSurface.inject).toEqual(['tools'])
    expect('default' in taskSurface).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(taskSurface)).toBe(taskSurface)
    const tool: ToolDefinition | undefined = test.ctx.tools.get('show_task_surface')
    if (tool === undefined) throw new Error('show_task_surface was not registered')
    expect(tool.description).toContain('structured Task Surface panel')
    // Omission is the contract: an unclassified call is an exclusive ordering barrier.
    expect(Object.keys(tool)).not.toContain('isConcurrencySafe')

    await test.plugin.dispose()
    expect(test.ctx.tools.get('show_task_surface')).toBeUndefined()
  })
})

describe('show_task_surface', () => {
  it('publishes one panel and ends the turn instead of asking the model to continue', async () => {
    const test = await harness([{ call: { name: 'show_task_surface', arguments: { model: MODEL } } }])
    test.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'plan the release' }], source: { kind: 'user' } }))
    await test.agent.whenIdle()

    // The tool call requested a follow-up model call; concluding the turn suppressed it.
    expect(test.adapter.requests).toHaveLength(1)
    const results = test.agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    const text = JSON.stringify(results)
    expect(text).toContain('is open in the panel')
    expect(text).toContain('ordinary message to bypass it')
    expect(text).toMatch(/\([0-9a-f]{16}\)/u)
  })

  it('returns one stable content-addressed surface id for the same arguments', async () => {
    const test = await harness()
    const first = await show(test, MODEL)
    const second = await show(test, MODEL)
    expect(first.isError).toBe(false)
    if (first.isError) throw new Error('expected success')
    const value = first.value as { readonly surfaceId: string }
    expect(value.surfaceId).toMatch(/^[0-9a-f]{16}$/u)
    expect(second.isError).toBe(false)
    if (second.isError) throw new Error('expected success')
    expect(second.value).toEqual(first.value)

    const other = await show(test, { ...MODEL, title: 'Another panel' })
    if (other.isError) throw new Error('expected success')
    expect(other.value).not.toEqual(first.value)
  })

  it('rejects a model over the section, block, field, row, and byte limits', async () => {
    const test = await harness()

    const sections = await show(test, withSections(13))
    expect(sections.isError).toBe(true)
    expect(resultText(sections)).toContain('13 sections, the limit is 12')

    const blocks = await show(test, {
      ...MODEL,
      sections: [{ id: 's', blocks: Array.from({ length: 9 }, () => ({ kind: 'markdown', text: 'x' })) }],
    })
    expect(blocks.isError).toBe(true)
    expect(resultText(blocks)).toContain('9 blocks, the limit is 8')

    const fields = await show(test, {
      ...MODEL,
      fields: Array.from({ length: 25 }, (_value, index) => ({ kind: 'toggle', id: `f${String(index)}`, label: 'T' })),
    })
    expect(fields.isError).toBe(true)
    expect(resultText(fields)).toContain('25 fields, the limit is 24')

    const rows = await show(test, {
      ...MODEL,
      sections: [{
        id: 'table',
        blocks: [{
          kind: 'table',
          columns: [{ id: 'a', label: 'A' }],
          rows: Array.from({ length: 201 }, () => ({ a: 1 })),
        }],
      }],
    })
    expect(rows.isError).toBe(true)
    expect(resultText(rows)).toContain('201 rows, the limit is 200')

    const bytes = await show(test, {
      ...MODEL,
      sections: [{ id: 'big', blocks: [{ kind: 'markdown', text: 'x'.repeat(70 * 1024) }] }],
    })
    expect(bytes.isError).toBe(true)
    expect(resultText(bytes)).toContain('the limit is 65536')
  })

  it('accepts a panel with no fields at all', async () => {
    const test = await harness()
    const { fields: _fields, ...withoutFields } = MODEL
    const result = await show(test, withoutFields)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(result.value).toHaveProperty('surfaceId')
  })

  it('rejects a field kind outside the supported subset and unknown model keys', async () => {
    const test = await harness()
    const order = await show(test, {
      ...MODEL,
      fields: [{ kind: 'order', id: 'plan', label: 'Order', options: [{ id: 'a', label: 'A' }] }],
    })
    expect(order.isError).toBe(true)
    expect(order.error?.info?.code).toBe('INVALID_ARGS')
    expect(resultText(order)).toContain('invalid arguments')

    const unknown = await show(test, { ...MODEL, extra: true })
    expect(unknown.isError).toBe(true)
    expect(unknown.error?.info?.code).toBe('INVALID_ARGS')
  })
})
