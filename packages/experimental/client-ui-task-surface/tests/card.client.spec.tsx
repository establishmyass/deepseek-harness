// @vitest-environment jsdom
/** Task Surface panel: model parsing, submission formatting, and the form lifecycle. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import {
  formatSubmission, parseSurfaceModel, TaskSurfaceCard,
  type TaskSurfaceCardProps,
} from '../src/client/TaskSurfaceCard.tsx'
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

function cardProps(
  block: unknown,
  submit: (text: string) => Promise<void> = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve()),
): TaskSurfaceCardProps {
  return {
    block,
    callId: 'c1',
    toolName: 'show_task_surface',
    openFile: vi.fn(),
    loadImage: vi.fn(),
    sessionId: 's1',
    t,
    submit,
  } as unknown as TaskSurfaceCardProps
}

describe('parseSurfaceModel', () => {
  it('accepts the declared arms and rejects everything else', () => {
    expect(parseSurfaceModel(JSON.stringify({ model: MODEL }))?.title).toBe('Ship the panel')
    // A streaming prefix is not a panel yet.
    expect(parseSurfaceModel('{"model":{"title":"Ship')).toBeNull()
    expect(parseSurfaceModel(JSON.stringify({ model: { ...MODEL, version: 2 } }))).toBeNull()
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
    expect(parseSurfaceModel('42')).toBeNull()
  })

  it('drops a non-string description instead of rendering it', () => {
    expect(parseSurfaceModel(JSON.stringify({ model: { ...MODEL, description: 7 } }))?.description).toBeUndefined()
  })
})

describe('formatSubmission', () => {
  it('renders one labeled line per answered field in declaration order', () => {
    const model = parseSurfaceModel(JSON.stringify({ model: MODEL }))
    if (model === null) throw new Error('expected a parsed model')
    const text = formatSubmission(model, {
      note: '  ship it  ',
      strategy: 'all',
      checks: ['smoke', 'load', 'vanished'],
      notify: false,
    }, t)
    expect(text).toBe([
      'Task Surface「Ship the panel」的答复',
      '- Note: ship it',
      '- Strategy: All at once',
      '- Checks: Smoke, Load, vanished',
      '- Notify: 否',
    ].join('\n'))
  })

  it('omits unanswered fields, keeps the toggle state, and falls back to the raw id for an unknown choice', () => {
    const model = parseSurfaceModel(JSON.stringify({ model: MODEL }))
    if (model === null) throw new Error('expected a parsed model')
    expect(formatSubmission(model, { strategy: 'mystery' }, t)).toBe([
      'Task Surface「Ship the panel」的答复',
      '- Strategy: mystery',
      '- Notify: 否',
    ].join('\n'))
  })
})

describe('TaskSurfaceCard', () => {
  it('renders every declared block, with image syntax reduced to alt text', () => {
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
  })

  it('falls back to a status line for a call it cannot own', () => {
    render(<TaskSurfaceCard {...cardProps(settledBlock('{"model":{"title":'))} />)
    expect(screen.getByText('这个面板还没生成完。')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    // A settled node whose durable call slice kept no arguments at all.
    render(<TaskSurfaceCard {...cardProps({ ...settledBlock(MODEL) as object, call: undefined })} />)
    expect(screen.getAllByText('这个面板还没生成完。')).toHaveLength(2)
  })

  it('holds submit closed while a required field is empty, then sends the formatted message', async () => {
    const sent: string[] = []
    const submit = vi.fn<(text: string) => Promise<void>>((text) => {
      sent.push(text)
      return Promise.resolve()
    })
    render(<TaskSurfaceCard {...cardProps(runningBlock(MODEL), submit)} />)
    const button = screen.getByRole('button', { name: 'Approve' })
    fireEvent.change(screen.getByLabelText(/Note/u), { target: { value: '   ' } })
    expect(button).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText(/Note/u), { target: { value: 'ship it' } })
    expect(button).toHaveProperty('disabled', false)
    fireEvent.click(button)
    expect(sent).toEqual([[
      'Task Surface「Ship the panel」的答复',
      '- Note: ship it',
      '- Strategy: Canary',
      '- Notify: 是',
    ].join('\n')])
    expect(await screen.findByText('已发送；模型会收到这份答复。')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveProperty('disabled', true)
  })

  it('collects choices, multi-choices, and toggles from the panel controls', () => {
    const sent: string[] = []
    const submit = vi.fn<(text: string) => Promise<void>>((text) => {
      sent.push(text)
      return Promise.resolve()
    })
    render(<TaskSurfaceCard {...cardProps(runningBlock(MODEL), submit)} />)
    fireEvent.click(screen.getByLabelText('All at once'))
    fireEvent.click(screen.getByLabelText('Smoke'))
    fireEvent.click(screen.getByLabelText('Load'))
    // A second click on a checked box takes the option back out.
    fireEvent.click(screen.getByLabelText('Load'))
    fireEvent.click(screen.getByLabelText('Smoke'))
    fireEvent.click(screen.getByLabelText('Smoke'))
    fireEvent.click(screen.getByLabelText('Notify'))
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'release/1.2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(sent).toEqual([[
      'Task Surface「Ship the panel」的答复',
      '- Note: none',
      '- Branch: release/1.2',
      '- Strategy: All at once',
      '- Checks: Smoke',
      '- Notify: 否',
    ].join('\n')])
  })

  it('keeps the values editable and shows the reason when admission fails', async () => {
    const submit = vi.fn<(text: string) => Promise<void>>(() => Promise.reject(new Error('the host is offline')))
    render(<TaskSurfaceCard {...cardProps(runningBlock(MODEL), submit)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '发送失败：the host is offline')
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveProperty('disabled', false)
    expect(screen.getByLabelText(/Note/u)).toHaveProperty('value', 'none')
  })

  it('reports a rejection that is not an Error as its own text', async () => {
    // A non-Error rejection is exactly the fallback branch under test.
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors
    const submit = vi.fn<(text: string) => Promise<void>>(() => Promise.reject('boom'))
    render(<TaskSurfaceCard {...cardProps(runningBlock(MODEL), submit)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '发送失败：boom')
  })

  it('ignores a submit that arrives while a required field is still empty', () => {
    const submit = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve())
    render(<TaskSurfaceCard {...cardProps(runningBlock(MODEL), submit)} />)
    const button = screen.getByRole('button', { name: 'Approve' })
    const form = button.closest('form')
    if (form === null) throw new Error('expected the panel form')
    fireEvent.change(screen.getByLabelText(/Note/u), { target: { value: '' } })
    fireEvent.submit(form)
    expect(submit).not.toHaveBeenCalled()
  })

  it('renders a panel with no fields at all as content only', () => {
    const bare = { version: 1, title: 'T', description: 'D', sections: [], submit: { label: 'OK' } }
    const model = parseSurfaceModel(JSON.stringify({ model: bare }))
    expect(model?.fields).toBeUndefined()
    if (model === null) throw new Error('expected a parsed model')
    expect(formatSubmission(model, {}, t)).toBe('Task Surface「T」的答复')
    const { container } = render(<TaskSurfaceCard {...cardProps(runningBlock(bare))} />)
    expect(container.querySelector('form')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    // An explicit empty field list renders content only as well.
    render(<TaskSurfaceCard {...cardProps(runningBlock({ ...bare, fields: [] }))} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders a stack section and ignores field initials that contradict their arm', () => {
    const malformed = {
      version: 1,
      title: 'T',
      sections: [{ id: 's', title: 'S', blocks: [{ kind: 'markdown', text: 'plain' }] }],
      fields: [
        { kind: 'text', id: 't', label: 'T', initial: 7 },
        { kind: 'choice', id: 'c', label: 'C', options: [{ id: 'a', label: 'A' }], initial: 7 },
        { kind: 'multi-choice', id: 'm', label: 'M', options: [{ id: 'a', label: 'A' }], initial: 'a' },
        { kind: 'multi-choice', id: 'm2', label: 'M2', options: [{ id: 'a', label: 'A' }], initial: ['a'] },
        { kind: 'toggle', id: 'g', label: 'G' },
      ],
      submit: { label: 'OK' },
    }
    const sent: string[] = []
    const submit = vi.fn<(text: string) => Promise<void>>((text) => {
      sent.push(text)
      return Promise.resolve()
    })
    const { container } = render(<TaskSurfaceCard {...cardProps(runningBlock(malformed), submit)} />)
    expect(screen.getByText('S')).toBeTruthy()
    expect(container.querySelector('[data-columns]')).toBeNull()
    expect(screen.getByLabelText('T')).toHaveProperty('value', '')
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(sent).toEqual(['Task Surface「T」的答复\n- M2: A\n- G: 否'])
  })
})
