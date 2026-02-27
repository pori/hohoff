import Anthropic from '@anthropic-ai/sdk'
import type { AIPayload, Attachment } from '../renderer/types/editor'

let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey || apiKey === 'your-api-key-here') {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. Add it to app/.env.local'
      )
    }
    _client = new Anthropic({ apiKey })
  }
  return _client
}

function buildSystemPrompt(payload: AIPayload): string {
  const chapterName =
    payload.documentPath.split('/').pop()?.replace(/\.md$/, '') ?? 'Unknown chapter'

  const chapterContext = `You are a literary editor assistant helping with a gothic/historical fiction novel set in the Basque Country. The current chapter is: "${chapterName}".

Key characters: Esti, Marko, Garbi, Irati, Cardinal Nikolai, Amaya, Izotz, Sua, Señor Jiménez, the Genboa family.

The chapter text is provided below. When identifying specific passages, quote the EXACT text from the document so it can be located and highlighted in the editor.

--- CHAPTER ---
${payload.documentContent}
--- END CHAPTER ---`

  const modeInstructions: Record<AIPayload['mode'], string> = {
    chat: 'Answer questions about the chapter, characters, plot, or craft. Be specific and cite passages where relevant.',

    passive_voice: `Identify ALL instances of passive voice in this chapter.

For each instance, respond in this exact format:
PASSIVE: "[exact quoted sentence]"
WHY: [brief explanation]
SUGGESTION: "[rewritten in active voice]"

List every instance you find, then give a brief overall summary.`,

    consistency: `Check this chapter carefully for consistency issues:
- Character names spelled or used inconsistently
- Timeline contradictions or impossibilities
- Repeated words or phrases appearing too close together (within a page)
- Setting details that seem contradictory
- Character behaviour inconsistent with their established personality

For each issue found:
ISSUE: [type of issue]
PASSAGE: "[exact quoted text]"
PROBLEM: [explanation]
SUGGESTION: [how to fix it]`,

    style: `Analyze the writing style and provide specific improvement suggestions:
- Pacing: identify slow passages or rushed moments
- Sentence variety: flag runs of similar length or structure
- Show don't tell: identify passages that tell emotion/state rather than showing it
- Gothic atmosphere: passages where the atmospheric tone is inconsistent
- Dialogue: any dialogue that feels stilted or unnatural

For each suggestion:
ISSUE: [type: Pacing / Sentence Variety / Show-Don't-Tell / Atmosphere / Dialogue]
PASSAGE: "[exact quoted text]"
PROBLEM: [specific explanation]
SUGGESTION: [concrete rewrite or approach]`,

    critique: `Give an honest, detailed critique of this chapter as a whole. Structure your response as follows:

**Overall impression** (2–3 sentences on what the chapter achieves and its most significant weakness)

**What works well**
Identify 2–4 specific strengths — scenes, lines, or moments that land effectively. Quote the passage and explain why it works.

STRENGTH: "[exact quoted passage]"
WHY: [explanation]

**What needs work**
Identify 2–4 areas where the chapter falls short. Be direct. Quote the passage and give a concrete direction for improvement.

ISSUE: "[exact quoted passage]"
PROBLEM: [explanation]
SUGGESTION: [concrete direction]

**One priority**
Name the single most important thing to fix in a revision of this chapter.`
  }

  let prompt = `${chapterContext}\n\n${modeInstructions[payload.mode]}`

  if (payload.attachments && payload.attachments.length > 0) {
    const names = payload.attachments.map((a) => a.name).join(', ')
    prompt += `\n\n---
ATTACHED REFERENCE MATERIAL: ${names}

The user has provided reference file(s) above. Based on these references and the user's instruction, identify specific passages in the chapter that should be changed.

You MUST output every suggested edit in this exact structured format — no other format will create highlights in the editor:

ISSUE: [short category label, e.g. "Tone", "Vocabulary", "Style Match", "Pacing"]
PASSAGE: "[copy the exact verbatim text from the chapter — at least 10 characters, unique enough to be found]"
PROBLEM: [one sentence explaining why this passage needs changing in light of the reference material]
SUGGESTION: "[the revised replacement text]"

Rules:
- PASSAGE must be a verbatim copy of text that exists in the chapter above. Do not paraphrase.
- Include as many ISSUE/PASSAGE/PROBLEM/SUGGESTION blocks as are genuinely warranted.
- After all structured blocks, you may add a brief overall summary.
---`
  }

  return prompt
}

type UserContentBlock = Anthropic.ImageBlockParam | Anthropic.TextBlockParam

function buildUserContent(
  userMessage: string,
  attachments: Attachment[] | undefined
): string | UserContentBlock[] {
  if (!attachments || attachments.length === 0) {
    return userMessage
  }

  const content: UserContentBlock[] = []

  for (const att of attachments) {
    if (att.mimeType.startsWith('image/')) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: att.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: att.data
        }
      })
    } else {
      // Text or PDF — include as a fenced text block
      content.push({
        type: 'text',
        text: `--- Attached: ${att.name} ---\n${att.data}\n--- End of ${att.name} ---`
      })
    }
  }

  content.push({ type: 'text', text: userMessage })
  return content
}

export async function streamMessage(
  payload: AIPayload,
  onChunk: (chunk: string) => void
): Promise<void> {
  const client = getClient()

  const messages: Anthropic.MessageParam[] = [
    ...payload.conversationHistory.slice(-10),
    {
      role: 'user' as const,
      content: buildUserContent(payload.userMessage, payload.attachments)
    }
  ]

  const stream = client.messages.stream({
    model: 'claude-sonnet-4-5',
    max_tokens: 4096,
    system: buildSystemPrompt(payload),
    messages
  })

  for await (const chunk of stream) {
    if (
      chunk.type === 'content_block_delta' &&
      chunk.delta.type === 'text_delta'
    ) {
      onChunk(chunk.delta.text)
    }
  }
}
