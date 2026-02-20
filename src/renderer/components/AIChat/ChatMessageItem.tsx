import type { ChatMessage } from '../../types/editor'

interface Props {
  message: ChatMessage
}

export function ChatMessageItem({ message }: Props): JSX.Element {
  return (
    <div className={`chat-message chat-message-${message.role}`}>
      <div className="chat-message-label">
        {message.role === 'user' ? 'You' : 'Editor AI'}
      </div>
      <div className="chat-message-content">
        {message.content || <span className="chat-streaming-cursor">▍</span>}
      </div>
    </div>
  )
}
