import type { TextAnnotation } from '../types/editor'

// Matches "was/were + optional adverb + verb-ing"
const PAST_PROGRESSIVE_PATTERN = /\b(was|were)\b(\s+\w+ly)?\s+(\w+ing)\b/gi

function findSentenceStart(text: string, pos: number): number {
  let i = pos - 1
  while (i > 0) {
    if (/[.!?]/.test(text[i]) && i + 1 < text.length && /\s/.test(text[i + 1])) {
      return i + 2
    }
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
    if (/[.!?]/.test(text[i])) return i + 1
    if (text[i] === '\n') return i
    i++
  }
  return text.length
}

// Gerunds that are commonly nouns/adjectives rather than past progressive verbs
const NOUN_GERUNDS = new Set([
  'morning', 'evening', 'ceiling', 'feeling', 'something', 'nothing', 'anything',
  'everything', 'meeting', 'building', 'opening', 'beginning', 'ending', 'following',
  'interesting', 'amazing', 'surprising', 'concerning', 'leading', 'according',
  'existing', 'remaining', 'overwhelming', 'encouraging', 'promising', 'confusing',
  'missing', 'boring', 'exciting', 'shocking', 'outstanding', 'underlying'
])

export function detectPastProgressive(text: string): TextAnnotation[] {
  const annotations: TextAnnotation[] = []
  const seenRanges = new Set<string>()

  PAST_PROGRESSIVE_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = PAST_PROGRESSIVE_PATTERN.exec(text)) !== null) {
    const verb = match[3].toLowerCase()
    if (NOUN_GERUNDS.has(verb)) continue

    const matchStart = match.index
    const matchEnd = match.index + match[0].length

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
      id: `pp-${matchStart}`,
      type: 'past_progressive',
      from,
      to,
      matchedText: sentence,
      message: `Past progressive: "${match[0].trim()}" — consider simple past`,
      suggestion: undefined
    })
  }

  return annotations
}
