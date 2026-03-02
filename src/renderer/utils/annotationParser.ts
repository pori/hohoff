import type { TextAnnotation, AnnotationType } from '../types/editor'

// Attempt to locate AI-quoted text in the document and create highlight annotations.
// Pass `overrideType` to force every resulting annotation to use that type (e.g. 'custom'
// for attachment-driven feedback) instead of inferring it from surrounding context.
export function parseAnnotationsFromAIResponse(
  aiResponse: string,
  documentContent: string,
  overrideType?: AnnotationType
): { annotations: TextAnnotation[]; droppedCount: number } {
  const annotations: TextAnnotation[] = []
  let id = 0
  const runId = Date.now()
  let droppedCount = 0

  // Match quoted strings — handles "straight", "curly", and 'single' quotes
  // Minimum 10 chars to avoid matching short words
  const quotePattern = /["""''](.{10,300}?)["""'']/g
  let match: RegExpExecArray | null

  while ((match = quotePattern.exec(aiResponse)) !== null) {
    const quotedText = match[1].trim()

    // Try exact match first
    let docIndex = documentContent.indexOf(quotedText)

    // If not found exactly, try a normalized version (collapse whitespace)
    if (docIndex === -1) {
      const normalized = quotedText.replace(/\s+/g, ' ')
      docIndex = findNormalized(documentContent, normalized)
    }

    if (docIndex === -1) {
      droppedCount++
      continue
    }

    // Don't annotate the same range twice
    const alreadyAnnotated = annotations.some(
      (a) => a.from === docIndex && a.to === docIndex + quotedText.length
    )
    if (alreadyAnnotated) continue

    // Determine annotation type — use override when provided (e.g. 'custom' for
    // attachment-driven feedback), otherwise infer from context around the quote.
    const contextStart = Math.max(0, match.index - 200)
    const contextBefore = aiResponse.slice(contextStart, match.index).toLowerCase()
    const type = overrideType ?? classifyType(contextBefore)

    // Try to extract a suggestion from text after the quote
    const afterQuote = aiResponse.slice(match.index + match[0].length, match.index + match[0].length + 400)
    const suggestion = extractSuggestion(afterQuote)

    // Extract a short message label from the ISSUE/PROBLEM line before the quote
    const message = extractMessage(aiResponse, match.index)

    annotations.push({
      id: `ai-${runId}-${id++}`,
      type,
      from: docIndex,
      to: docIndex + quotedText.length,
      matchedText: quotedText,
      message: message || `${type.replace('_', ' ')} — hover for details`,
      suggestion
    })
  }

  return { annotations: deduplicateOverlapping(annotations), droppedCount }
}

function deduplicateOverlapping(annotations: TextAnnotation[]): TextAnnotation[] {
  // Process largest spans first so the bigger annotation always wins over any
  // overlapping smaller one (e.g. a full sentence beats a sub-phrase within it).
  const sorted = [...annotations].sort((a, b) => (b.to - b.from) - (a.to - a.from))
  const kept: TextAnnotation[] = []
  for (const ann of sorted) {
    const overlaps = kept.some(k => ann.from < k.to && ann.to > k.from)
    if (!overlaps) kept.push(ann)
  }
  return kept
}

function classifyType(contextBefore: string): AnnotationType {
  if (contextBefore.includes('passive')) return 'passive_voice'
  if (
    contextBefore.includes('consistency') ||
    contextBefore.includes('timeline') ||
    contextBefore.includes('repeated') ||
    contextBefore.includes('contradiction')
  ) {
    return 'consistency'
  }
  if (
    contextBefore.includes('show don') ||
    contextBefore.includes('show-don') ||
    contextBefore.includes('show vs tell') ||
    contextBefore.includes('show/tell') ||
    contextBefore.includes('telling') ||
    contextBefore.includes('told') && contextBefore.includes('show')
  ) {
    return 'show_tell'
  }
  return 'style'
}

function extractSuggestion(text: string): string | undefined {
  // Look for SUGGESTION: "..." pattern — allow up to 400 chars to capture full rewrites
  const m = text.match(/SUGGESTION:\s*["""'](.{5,400}?)["""']/i)
  return m?.[1]?.trim()
}

function extractMessage(response: string, quoteIndex: number): string {
  // Look back for ISSUE: or PROBLEM: line
  const before = response.slice(Math.max(0, quoteIndex - 400), quoteIndex)
  const issueMatch = before.match(/(?:ISSUE|PROBLEM|WHY):\s*(.+?)(?:\n|$)/gi)
  if (issueMatch) {
    const last = issueMatch[issueMatch.length - 1]
    const text = last.replace(/^(?:ISSUE|PROBLEM|WHY):\s*/i, '').trim()
    return text.length > 200 ? text.slice(0, 200) + '…' : text
  }
  // Fall back to the last sentence before the quote
  const sentences = before.split(/[.!?]\s+/)
  const last = sentences[sentences.length - 1]?.trim() ?? ''
  return last.length > 200 ? last.slice(0, 200) + '…' : last
}

// Re-anchor a list of annotations against the current document content.
// Validates each annotation's from/to against its matchedText and re-searches
// when they disagree (e.g. after session restore with externally modified files).
// Annotations whose matchedText can no longer be found are dropped.
export function reanchorAnnotations(
  annotations: TextAnnotation[],
  content: string
): TextAnnotation[] {
  return annotations.flatMap(ann => {
    // Fast path: stored position still matches the original text exactly (O(1))
    if (
      ann.from >= 0 &&
      ann.to <= content.length &&
      ann.from < ann.to &&
      content.slice(ann.from, ann.to) === ann.matchedText
    ) {
      return [ann]
    }
    // Re-search using hint, full doc scan, then fuzzy fallback
    const newFrom = findMatchedTextNear(content, ann.matchedText, ann.from)
    if (newFrom === -1) return []
    return [{ ...ann, from: newFrom, to: newFrom + ann.matchedText.length }]
  })
}

function findMatchedTextNear(content: string, text: string, hint: number): number {
  // 1. Near-hint window (±500 chars) — handles minor external edits cheaply
  const windowStart = Math.max(0, hint - 500)
  const localIdx = content.indexOf(text, windowStart)
  if (localIdx !== -1 && localIdx <= hint + text.length + 500) return localIdx

  // 2. Full document — find occurrence closest to the stored hint
  let bestIdx = -1
  let bestDist = Infinity
  let searchFrom = 0
  while (true) {
    const idx = content.indexOf(text, searchFrom)
    if (idx === -1) break
    const dist = Math.abs(idx - hint)
    if (dist < bestDist) { bestDist = dist; bestIdx = idx }
    searchFrom = idx + 1
  }
  if (bestIdx !== -1) return bestIdx

  // 3. Normalized whitespace fallback
  return findNormalized(content, text.replace(/\s+/g, ' '))
}

// Find a normalized string in a document (ignores whitespace differences)
function findNormalized(document: string, normalized: string): number {
  const words = normalized.split(' ')
  if (words.length < 3) return -1

  // Search for the first few words as an anchor
  const anchor = words.slice(0, 4).join(' ')
  let searchFrom = 0

  while (searchFrom < document.length) {
    const idx = document.indexOf(words[0], searchFrom)
    if (idx === -1) break

    // Extract a comparable slice from the document
    const slice = document.slice(idx, idx + normalized.length * 2).replace(/\s+/g, ' ')
    if (slice.startsWith(normalized)) {
      return idx
    }

    // Check if the anchor matches
    const docSlice = document.slice(idx, idx + anchor.length + 20).replace(/\s+/g, ' ')
    if (docSlice.startsWith(anchor)) {
      return idx
    }

    searchFrom = idx + 1
  }

  return -1
}
