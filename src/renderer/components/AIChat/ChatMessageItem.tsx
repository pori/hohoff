import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { ChatMessage, TextAnnotation } from '../../types/editor'

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
    case 'critique':      return 'rgba(160, 80, 220, 0.75)'
    case 'custom':        return 'rgba(30, 200, 150, 0.8)'
  }
}

interface Props {
  message: ChatMessage
  linkedAnnotations?: TextAnnotation[]
}

export function ChatMessageItem({ message, linkedAnnotations }: Props): JSX.Element {
  const html = useMemo(() => {
    if (message.role !== 'assistant' || !message.content) return null
    const raw = marked.parse(message.content) as string
    return DOMPurify.sanitize(raw)
  }, [message.role, message.content])

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
    </div>
  )
}
