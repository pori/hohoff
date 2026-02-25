import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { ChatMessage } from '../../types/editor'

marked.setOptions({ breaks: true })

function attachmentIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼'
  if (mimeType === 'application/pdf') return '📄'
  return '📝'
}

interface Props {
  message: ChatMessage
}

export function ChatMessageItem({ message }: Props): JSX.Element {
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
    </div>
  )
}
