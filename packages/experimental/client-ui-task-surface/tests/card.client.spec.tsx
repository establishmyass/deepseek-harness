// @vitest-environment jsdom
/** The keyed Tool row: strict model parsing and the read-only panel replay. */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { parseSurfaceModel, parseSurfaceModelValue } from '../src/client/model.ts'
import { TaskSurfaceCard, type TaskSurfaceCardProps } from '../src/client/TaskSurfaceCard.tsx'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

afterEach(cleanup)

const MODEL = {
  version: 1,
  title: 'Ship the panel',
  description: 'Compare two release options.',
  sections: [
    {
      id: 'options',
      title: 'Options',
      layout: { kind: 'grid', columns: 3 },
      blocks: [
        { kind: 'markdown', text: '**Canary** first.\n\n![chart](https://example.test/x.png)' },
        { kind: 'metrics', items: [{ label: 'Risk', value: 'low', detail: 'one shard' }] },
        { kind: 'table', columns: [{ id: 'opt', label: 'Option' }, { id: 'eta', label: 'ETA' }], rows: [{ opt: 'canary', eta: '2h' }, { opt: 'big bang', eta: null }, { opt: 'hold' }] },
        { kind: 'notice', tone: 'warning', text: 'Rollback needs the feature flag.' },
      ],
    },
  ],
  fields: [
    { kind: 'text', id: 'note', label: 'Note', multiline: true, required: true, initial: 'none' },
    { kind: 'text', id: 'branch', label: 'Branch' },
    {
      kind: 'choice',
      id: 'strategy',
      label: 'Strategy',
      options: [{ id: 'canary', label: 'Canary', detail: 'one shard first' }, { id: 'all', label: 'All at once' }],
      initial: 'canary',
    },
    { kind: 'multi-choice', id: 'checks', label: 'Checks', options: [{ id: 'smoke', label: 'Smoke' }, { id: 'load', label: 'Load' }] },
    { kind: 'toggle', id: 'notify', label: 'Notify', initial: true },
  ],
  submit: { label: 'Approve' },
}

/** One running call block carrying the model as logged arguments. */
function runningBlock(model: unknown): unknown {
  return {
    callId: 'c1',
    name: 'show_task_surface',
    argsRaw: typeof model === 'string' ? model : JSON.stringify({ model }),
    turn: 1,
    step: 1,
    time: 1_000,
    subCalls: [],
  }
}

/** One settled call block, whose durable call slice still carries the arguments. */
function settledBlock(model: unknown): unknown {
  return {
    kind: 'tool-result',
    seq: 10,
    time: 2_000,
    callTime: 1_000,
    callId: 'c1',
    call: { name: 'show_task_surface', argsRaw: typeof model === 'string' ? model : JSON.stringify({ model }) },
    content: [],
    isError: false,
    subCalls: [],
  }
}

function cardProps(block: unknown): TaskSurfaceCardProps {
  return {
    block,
    callId: 'c1',
    toolName: 'show_task_surface',
    openFile: vi.fn(),
    loadImage: vi.fn(),
    sessionId: 's1',
    t,
    submit: vi.fn<(text: string) => Promise<void>>(() => Promise.resolve()),
  } as unknown as TaskSurfaceCardProps
}

describe('parseSurfaceModel', () => {
  it('accepts the declared arms and rejects everything else', () => {
    expect(parseSurfaceModel(JSON.stringify({ model: MODEL }))?.title).toBe('Ship the panel')
    // The projection mount hands over the model value itself.
    expect(parseSurfaceModelValue(MODEL)?.title).toBe('Ship the panel')
    expect(parseSurfaceModelValue(null)).toBeNull()
    expect(parseSurfaceModelValue({ ...MODEL, version: 2 })).toBeNull()
    // A streaming prefix is not a panel yet.
    expect(parseSurfaceModel('{"model":{"title":"Ship')).toBeNull()
    expect(parseSurfaceModel('42')).toBeNull()
    expect(parseSurfaceModel(JSON.stringify({ model: { ...MODEL, submit: { label: 1 } } }))).toBeNull()
    expect(parseSurfaceModel(JSON.stringify({ model: { ...MODEL, sections: 'no' } }))).toBeNull()
    expect(parseSurfaceModel(JSON.stringify({ model: { ...MODEL, sections: [{ id: 's', blocks: [{ kind: 'diff' }] }] } }))).toBeNull()
    expect(parseSurfaceModel(JSON.stringify({ model: { ...MODEL, sections: [{ id: 's', blocks: 'no' }] } }))).toBeNull()
    expect(parseSurfaceModel(JSON.stringify({ model: { ...MODEL, sections: [{ id: 's', blocks: [null] }] } }))).toBeNull()
    expect(parseSurfaceModel(JSON.stringify({ model: { ...MODEL, sections: [{ id: 's', blocks: [{ kind: 'notice', tone: 'loud', text: 'x' }] }] } }))).toBeNull()
    expect(parseSurfaceModel(JSON.stringify({ model: { ...MODEL, sections: [{ id: 's', blocks: [{ kind: 'metrics', items: [{ label: 'a', value: 2 }] }] }] } }))).toBeNull()
    expect(parseSurfaceModel(JSON.stringify({ model: { ...MODEL, sections: [{ id: 's', blocks: [{ kind: 'table', columns: [{ id: 'a' }], rows: [] }] }] } }))).toBeNull()
    expect(parseSurfaceModel(JSON.stringify({ model: { ...MODEL, sections: [{ id: 's', blocks: [{ kind: 'table', columns: [{ id: 'a', label: 'A' }], rows: 'no' }] }] } }))).toBeNull()
    expect(parseSurfaceModel(JSON.stringify({ model: { ...MODEL, fields: [{ kind: 'order', id: 'f', label: 'F' }] } }))).toBeNull()
    expect(parseSurfaceModel(JSON.stringify({ model: { ...MODEL, fields: [{ kind: 'choice', id: 'f', label: 'F', options: [{ id: 'a' }] }] } }))).toBeNull()
    expect(parseSurfaceModel(JSON.stringify({ model: { ...MODEL, fields: [{ kind: 'choice', id: 'f', label: 'F', options: 'no' }] } }))).toBeNull()
    expect(parseSurfaceModel(JSON.stringify({ model: { ...MODEL, fields: [{ kind: 'text', id: 1, label: 'F' }] } }))).toBeNull()
    expect(parseSurfaceModel(JSON.stringify({ model: { ...MODEL, fields: 'no' } }))).toBeNull()
    expect(parseSurfaceModel(JSON.stringify({}))).toBeNull()
    expect(parseSurfaceModel(JSON.stringify([]))).toBeNull()
  })

  it('drops a non-string description instead of rendering it', () => {
    expect(parseSurfaceModel(JSON.stringify({ model: { ...MODEL, description: 7 } }))?.description).toBeUndefined()
  })
})

describe('TaskSurfaceCard', () => {
  it('renders every declared block read-only, with image syntax reduced to alt text', () => {
    const { container } = render(<TaskSurfaceCard {...cardProps(settledBlock(MODEL))} />)
    expect(screen.getByText('Ship the panel')).toBeTruthy()
    expect(screen.getByText('Compare two release options.')).toBeTruthy()
    expect(screen.getByText('Options')).toBeTruthy()
    expect(container.textContent).toContain('Canary first.')
    expect(screen.getByText('chart')).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('Risk')).toBeTruthy()
    expect(screen.getByText('low')).toBeTruthy()
    expect(screen.getByText('one shard')).toBeTruthy()
    expect(screen.getByText('ETA')).toBeTruthy()
    expect(screen.getByText('2h')).toBeTruthy()
    // A cell the model omitted and a cell it nulled both render empty, not "null".
    expect(container.textContent).not.toContain('null')
    expect(screen.getByText('one shard first')).toBeTruthy()
    expect(screen.getByText('Rollback needs the feature flag.')).toBeTruthy()
    expect(container.querySelector('[data-columns="3"]')).toBeTruthy()
    // The dock owns editing: this row keeps the fields visible but not actionable.
    expect(screen.getByLabelText(/Note/u)).toHaveProperty('disabled', true)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders a running call from its streaming arguments', () => {
    render(<TaskSurfaceCard {...cardProps(runningBlock(MODEL))} />)
    expect(screen.getByText('Ship the panel')).toBeTruthy()
  })

  it('falls back to a status line for a call it cannot own', () => {
    render(<TaskSurfaceCard {...cardProps(runningBlock('{"model":{"title":'))} />)
    render(<TaskSurfaceCard {...cardProps(settledBlock('{"model":{"title":'))} />)
    expect(screen.getAllByText('这个面板还没生成完。')).toHaveLength(2)
    expect(screen.queryByRole('button')).toBeNull()
    // A settled node whose durable call slice kept no arguments at all.
    render(<TaskSurfaceCard {...cardProps({ ...settledBlock(MODEL) as object, call: undefined })} />)
    expect(screen.getAllByText('这个面板还没生成完。')).toHaveLength(3)
  })
})
