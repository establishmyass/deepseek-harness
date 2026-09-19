/**
 * Text extraction and byte capping for side-session notes.
 * @module @deepseek-ai/dsh-side-sessions/text
 */

import type { Message } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'

/**
 * The text of one derived message, joined across its text blocks; non-text
 * blocks such as tool calls contribute nothing.
 * @param message - one derived conversation message.
 * @returns the message's text, empty when it carries no text block.
 */
export function messageText(message: Message): string {
  return message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

/**
 * The last non-empty assistant text among derived messages.
 * @param messages - the derived conversation history.
 * @returns the text, or `undefined` when no assistant message carries any.
 */
export function lastAssistantText(messages: readonly Message[]): string | undefined {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'assistant') continue
    const text = messageText(message).trim()
    if (text.length > 0) return text
  }
  return undefined
}

/**
 * The session's final settled assistant text.
 * @param session - the session whose derived history is read.
 * @returns the last non-empty assistant text, or `undefined` when none settled.
 */
export function finalAssistantText(session: Session): string | undefined {
  return lastAssistantText(session.deriveMessages())
}

/**
 * Whether the byte at `index` continues a multi-byte character.
 * @param bytes - the encoded text.
 * @param index - position inside the array.
 * @returns whether the byte carries the UTF-8 continuation marker.
 */
function isContinuationByte(bytes: Uint8Array, index: number): boolean {
  const byte = bytes[index]
  /* v8 ignore next -- every call site passes an index below the array length */
  if (byte === undefined) return false
  return (byte & 0xC0) === 0x80
}

/**
 * Cap `text` to a UTF-8 byte budget without splitting a character.
 * @param text - the text to cap.
 * @param maxBytes - inclusive byte budget; the result never exceeds it.
 * @returns the capped text and whether the cap dropped anything.
 */
export function capBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = new TextEncoder().encode(text)
  if (bytes.length <= maxBytes) return { text, truncated: false }
  let end = maxBytes
  // A continuation byte at the cut means its character straddles the budget; walk back to its lead byte.
  while (end > 0 && isContinuationByte(bytes, end)) end -= 1
  return { text: new TextDecoder().decode(bytes.subarray(0, end)), truncated: true }
}
