import type { TextAnnotation } from '../types/editor'

// Common irregular past participles
const IRREGULAR_PP =
  'written|known|seen|found|made|done|given|taken|left|told|shown|brought|' +
  'felt|kept|held|set|put|become|come|run|begun|gone|sent|built|paid|said|' +
  'heard|met|read|lost|won|broken|fallen|grown|drawn|driven|eaten|forgotten|' +
  'hidden|ridden|risen|stolen|sworn|thrown|worn|woken|chosen|frozen|gotten|' +
  'proven|shaken|spoken|stolen|undertaken|woven|withdrawn|born|caught|bought|' +
  'brought|fought|taught|thought|sought|hit|hurt|let|put|cut|shut|split|spread|' +
  'led|fed|bled|bred|fled|sped|spun|stung|struck|strung|swung|flung|clung|' +
  'rung|sung|slung|hung|dug|dug|stuck|struck|stunk|shrunk|drunk|sunk|sprung'

// Pattern: [to-be form] [optional adverb] [past participle]
// Handles: "was written", "is being known", "were quickly sent"
const PASSIVE_PATTERN = new RegExp(
  `\\b(is|was|were|are|been|being|be|am)\\b(\\s+\\w+ly)?\\s+(${IRREGULAR_PP}|\\w+ed)\\b`,
  'gi'
)

function findSentenceStart(text: string, pos: number): number {
  let i = pos - 1
  while (i > 0) {
    // Look for sentence-ending punctuation followed by whitespace
    if (/[.!?]/.test(text[i]) && i + 1 < text.length && /\s/.test(text[i + 1])) {
      return i + 2
    }
    // Also stop at paragraph breaks
    if (text[i] === '\n' && i > 0 && text[i - 1] === '\n') {
      return i + 1
    }
    i--
  }
  return 0
}

function findSentenceEnd(text: string, pos: number): number {
  let i = pos
  while (i < text.length) {
    if (/[.!?]/.test(text[i])) {
      return i + 1
    }
    if (text[i] === '\n') {
      return i
    }
    i++
  }
  return text.length
}

export function detectPassiveVoice(text: string): TextAnnotation[] {
  const annotations: TextAnnotation[] = []
  const seenRanges = new Set<string>()

  PASSIVE_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = PASSIVE_PATTERN.exec(text)) !== null) {
    const matchStart = match.index
    const matchEnd = match.index + match[0].length

    // Skip if this looks like "has been" (perfect passive is sometimes fine)
    // and skip matches inside markdown headers
    const lineStart = text.lastIndexOf('\n', matchStart) + 1
    const lineText = text.slice(lineStart, matchEnd)
    if (lineText.trimStart().startsWith('#')) continue

    const from = findSentenceStart(text, matchStart)
    const to = findSentenceEnd(text, matchEnd)
    const key = `${from}-${to}`

    if (seenRanges.has(key)) continue
    seenRanges.add(key)

    const sentence = text.slice(from, to).trim()
    annotations.push({
      id: `pv-${matchStart}`,
      type: 'passive_voice',
      from,
      to,
      matchedText: sentence,
      message: `Passive voice: "${match[0].trim()}"`,
      suggestion: undefined
    })
  }

  return annotations
}
