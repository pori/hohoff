import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { ChatMessage, TextAnnotation } from '../../types/editor'
import { useEditorStore } from '../../store/editorStore'
import { currentEditorView } from '../Editor/MarkdownEditor'

marked.setOptions({ breaks: true })

function attachmentIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼'
  if (mimeType === 'application/pdf') return '📄'
  return '📝'
}

function badgeColor(type: TextAnnotation['type']): string {
  switch (type) {
    case 'passive_voice': return 'rgba(255, 200, 0, 0.75)'
    case 'consistency':   return 'rgba(220, 80, 80, 0.75)'
    case 'style':         return 'rgba(80, 160, 255, 0.75)'
    case 'show_tell':     return 'rgba(255, 140, 30, 0.75)'
    case 'critique':      return 'rgba(160, 80, 220, 0.75)'
    case 'custom':        return 'rgba(30, 200, 150, 0.8)'
    case 'user_comment':  return 'rgba(240, 100, 180, 0.85)'
  }
}

interface Props {
  message: ChatMessage
  linkedAnnotations?: TextAnnotation[]
}

export function ChatMessageItem({ message, linkedAnnotations }: Props): JSX.Element {
  const { activeFilePath, markSaved } = useEditorStore()

  const html = useMemo(() => {
    if (message.role !== 'assistant' || !message.content) return null
    const raw = marked.parse(message.content) as string
    return DOMPurify.sanitize(raw)
  }, [message.role, message.content])

  const handleApplyToBible = async (): Promise<void> => {
    // writeStoryBible merges the new content into the existing bible by ## section
    // and returns the full merged document.
    const merged = await window.api.writeStoryBible(message.content)
    // If the story bible is currently open, update the editor to show the merged result.
    if (activeFilePath?.endsWith('Story Bible.md')) {
      const view = currentEditorView
      if (view) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: merged }
        })
        markSaved()
      }
    }
  }

  return (
    <div className={`chat-message chat-message-${message.role}`}>
      <div className="chat-message-label">
        {message.role === 'user' ? 'You' : 'Editor AI'}
      </div>
      {message.attachments && message.attachments.length > 0 && (
        <div className="chat-message-attachments">
          {message.attachments.map((att) => (
            <span key={att.name} className="chat-message-attachment-chip" title={att.name}>
              {attachmentIcon(att.mimeType)}{' '}
              {att.name.length > 24 ? att.name.slice(0, 22) + '…' : att.name}
            </span>
          ))}
        </div>
      )}
      <div className="chat-message-content">
        {html ? (
          <div
            className="chat-message-markdown"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          message.content || <span className="chat-streaming-cursor">▍</span>
        )}
      </div>

      {linkedAnnotations && linkedAnnotations.length > 0 && (
        <div className="chat-message-suggestions">
          <span className="chat-suggestions-label">
            {linkedAnnotations.length} suggestion{linkedAnnotations.length !== 1 ? 's' : ''} created
          </span>
          <div className="chat-suggestion-list">
            {linkedAnnotations.map(ann => (
              <div key={ann.id} className="chat-suggestion-row">
                <span
                  className="chat-suggestion-badge"
                  style={{ backgroundColor: badgeColor(ann.type) }}
                >
                  {ann.type.replace(/_/g, ' ')}
                </span>
                <span className="chat-suggestion-excerpt">
                  "{ann.matchedText.length > 40
                    ? ann.matchedText.slice(0, 38) + '…'
                    : ann.matchedText}"
                </span>
                {ann.applied && (
                  <span className="chat-suggestion-applied">Applied</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {message.bibleGeneration && message.role === 'assistant' && message.content.length > 0 && (
        <div className="chat-message-apply">
          <button
            className="chat-apply-btn"
            onClick={handleApplyToBible}
            title="Merge into Story Bible"
          >
            ↓ Apply to Story Bible
          </button>
        </div>
      )}
    </div>
  )
}
