/**
 * Transcript rendering for `history_read`: one model-facing line per
 * content-bearing session event, capped by `TextRetainer`, plus the checkpoint
 * index of the spans compaction replaced.
 * @module @deepseek-ai/dsh-experimental-tool-history-read/transcript
 */

import { describeOmitted, TextRetainer } from '@deepseek-ai/dsh-output-retention'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
// Type-only: resolves the `compaction/summary` session-event declaration this module reads.
import type {} from '@deepseek-ai/dsh-compaction'

/** One compaction checkpoint: the summary event and the span it replaced. */
export interface HistoryCheckpoint {
  /** Seq of the `compaction/summary` event that replaced the span. */
  readonly seq: number
  /** First shadowed event seq, inclusive. */
  readonly start: number
  /** Last shadowed event seq, inclusive. */
  readonly end: number
  /** Heuristic token price of the replaced span. */
  readonly tokens: number
  /** The summary text the model reads in place of the span. */
  readonly summary: string
}

/** Rendering limits shared by both read modes. */
export interface TranscriptLimits {
  /** Inclusive byte budget for the whole transcript. */
  readonly maxBytes: number
  /** Maximum events rendered in one span read. */
  readonly maxEvents: number
  /** Maximum characters rendered from one event's text. */
  readonly maxEventChars: number
}

/** Text of one content-block list, ignoring blocks that carry no prose. */
function textOf(blocks: readonly ContentBlock[]): string {
  return blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
}

/** Bound one line to the per-event character budget. */
function clip(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)} …`
}

/** One labelled transcript line, or `undefined` when the blocks carry no prose. */
function messageLine(label: string, blocks: readonly ContentBlock[], maxChars: number): string | undefined {
  const text = textOf(blocks)
  return text.length === 0 ? undefined : `${label}: ${clip(text, maxChars)}`
}

/**
 * The model-facing transcript line for one event.
 * @param event - one raw session event.
 * @param maxChars - per-event character budget.
 * @returns the line, or `undefined` when the event carries no transcript content.
 */
export function transcriptLine(event: SessionEvent, maxChars: number): string | undefined {
  switch (event.type) {
    case 'user/message':
      return messageLine('user', event.data.content, maxChars)
    case 'system/message':
      return messageLine('system', event.data.message.content, maxChars)
    case 'assistant/message':
      return messageLine('assistant', event.data.message.content, maxChars)
    case 'tool/call':
      return `tool call ${event.data.name}(${clip(event.data.arguments, maxChars)})`
    case 'tool/result':
      // The result message holds one `tool-result` block wrapping the tool's content blocks.
      return messageLine('tool result', event.data.message.content[0].content, maxChars)
    /**
     * Every other event — including any merge-extensible type this package does
     * not own — carries no transcript prose, so a span read skips it.
     */
    default:
      return undefined
  }
}

/**
 * The compaction checkpoints recorded in one session log, in log order.
 * @param events - the session's raw events.
 * @returns one entry per `compaction/summary` event.
 */
export function checkpointsOf(events: readonly SessionEvent[]): HistoryCheckpoint[] {
  const checkpoints: HistoryCheckpoint[] = []
  for (const event of events) {
    if (event.type !== 'compaction/summary') continue
    checkpoints.push({
      seq: event.seq,
      start: event.data.shadowedRange.start,
      end: event.data.shadowedRange.end,
      tokens: event.data.shadowedTokenCount,
      summary: textOf(event.data.summary),
    })
  }
  return checkpoints
}

/**
 * Render the checkpoint index the model reads before asking for a span.
 * @param checkpoints - the session's compaction checkpoints.
 * @param maxEventChars - per-entry summary character budget.
 * @returns the index text.
 */
export function renderCheckpoints(checkpoints: readonly HistoryCheckpoint[], maxEventChars: number): string {
  if (checkpoints.length === 0) {
    return 'No compaction has removed history from this session: every event is still in your current view.'
  }
  const lines = checkpoints.map((checkpoint) => {
    const span = `${String(checkpoint.start)}–${String(checkpoint.end)}`
    return `checkpoint #${String(checkpoint.seq)} replaced events #${span} (${String(checkpoint.end - checkpoint.start + 1)} events, ${String(checkpoint.tokens)} tokens): ${clip(checkpoint.summary, maxEventChars)}`
  })
  return [
    'Compaction replaced this history. Read a span with history_read({ from, to }):',
    ...lines,
  ].join('\n')
}

/**
 * Render one event span as a bounded transcript.
 * @param events - the session's raw events, indexed by seq.
 * @param from - first seq to render, inclusive.
 * @param to - last seq to render, inclusive.
 * @param limits - rendering limits.
 * @returns the transcript text, with an omission footer when bounded.
 */
export function renderSpan(
  events: readonly SessionEvent[],
  from: number,
  to: number,
  limits: TranscriptLimits,
): string {
  const span = events.slice(from, to + 1)
  const rendered = span
    .slice(0, limits.maxEvents)
    .flatMap((event) => {
      const line = transcriptLine(event, limits.maxEventChars)
      return line === undefined ? [] : [line]
    })
  const unreadEvents = span.length - Math.min(span.length, limits.maxEvents)
  const retainer = new TextRetainer({ kind: 'head', maxBytes: limits.maxBytes })
  for (const line of rendered) retainer.push(`${line}\n`)
  const retained = retainer.finish()
  const notices = [
    ...unreadEvents === 0 ? [] : [`Omitted ${String(unreadEvents)} later events.`],
    ...retained.truncated ? [describeOmitted(retained.omittedBytes, 'bytes')] : [],
  ]
  const body = retained.text.trimEnd()
  if (body.length === 0 && notices.length === 0) return `Events #${String(from)}–${String(to)} hold no transcript content.`
  return [...body.length === 0 ? [] : [body], ...notices].join('\n')
}
