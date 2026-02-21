import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { ChatMessage } from '../../types/editor'

marked.setOptions({ breaks: true })

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
