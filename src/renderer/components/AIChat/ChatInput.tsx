import { useState, useRef, type KeyboardEvent } from 'react'
import type { Attachment } from '../../types/editor'

interface Props {
  onSend: (text: string, attachments: Attachment[]) => void
  disabled: boolean
}

function attachmentIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼'
  if (mimeType === 'application/pdf') return '📄'
  return '📝'
}

export function ChatInput({ onSend, disabled }: Props): JSX.Element {
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const submit = (): void => {
    const trimmed = value.trim()
    if ((!trimmed && attachments.length === 0) || disabled) return
    onSend(trimmed, attachments)
    setValue('')
    setAttachments([])
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const handleInput = (): void => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`
    }
  }

  const handleAttach = async (): Promise<void> => {
    const picked = await window.api.pickAttachments()
    if (picked.length === 0) return
    // Deduplicate by name
    setAttachments((prev) => {
      const existingNames = new Set(prev.map((a) => a.name))
      const fresh = picked.filter((a) => !existingNames.has(a.name))
      return [...prev, ...fresh]
    })
  }

  const removeAttachment = (name: string): void => {
    setAttachments((prev) => prev.filter((a) => a.name !== name))
  }

  const canSend = !disabled && (value.trim().length > 0 || attachments.length > 0)

  return (
    <div className="chat-input-area">
      {attachments.length > 0 && (
        <div className="chat-attachments-bar">
          {attachments.map((att) => (
            <div key={att.name} className="chat-attachment-chip">
              {att.mimeType.startsWith('image/') ? (
                <img
                  className="chat-attachment-thumb"
                  src={`data:${att.mimeType};base64,${att.data}`}
                  alt={att.name}
                />
              ) : (
                <span className="chat-attachment-icon">{attachmentIcon(att.mimeType)}</span>
              )}
              <span className="chat-attachment-name" title={att.name}>
                {att.name.length > 22 ? att.name.slice(0, 20) + '…' : att.name}
              </span>
              <button
                className="chat-attachment-remove"
                onClick={() => removeAttachment(att.name)}
                aria-label={`Remove ${att.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="chat-input-row">
        <button
          className="chat-paperclip-btn"
          onClick={handleAttach}
          disabled={disabled}
          title="Attach file (image, text, PDF)"
          aria-label="Attach file"
        >
          ⌁
        </button>
        <textarea
          ref={textareaRef}
          className="chat-textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={disabled ? 'Open a chapter first…' : 'Ask about this chapter… (Enter to send)'}
          disabled={disabled}
          rows={1}
        />
        <button
          className="chat-send-btn"
          onClick={submit}
          disabled={!canSend}
          aria-label="Send"
        >
          ↑
        </button>
      </div>
    </div>
  )
}
