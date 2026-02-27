import { useRef, useEffect, useState } from 'react'
import { useEditorStore } from '../../store/editorStore'
import { ChatMessageItem } from './ChatMessageItem'
import { ChatInput } from './ChatInput'
import { FeedbackPanel } from '../Feedback/FeedbackPanel'
import { parseAnnotationsFromAIResponse } from '../../utils/annotationParser'
import type { Attachment } from '../../types/editor'
import './Chat.css'

type TabId = 'chat' | 'feedback'

export function ChatPanel(): JSX.Element {
  const {
    chatHistory,
    isAILoading,
    aiError,
    activeFileContent,
    activeFilePath,
    analysisMode,
    annotations,
    addUserMessage,
    startAssistantMessage,
    appendToLastAssistantMessage,
    setAILoading,
    setAIError,
    setAnnotations,
    clearChat
  } = useEditorStore()

  const [tab, setTab] = useState<TabId>('chat')
  const [pendingAttachmentCount, setPendingAttachmentCount] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevAnnotationCountRef = useRef(annotations.length)

  // Auto-switch to Feedback tab the first time annotations appear (0 → >0)
  useEffect(() => {
    const prev = prevAnnotationCountRef.current
    const curr = annotations.length
    if (prev === 0 && curr > 0) {
      setTab('feedback')
    }
    prevAnnotationCountRef.current = curr
  }, [annotations])

  const sendMessage = async (text: string, attachments: Attachment[]): Promise<void> => {
    if (!activeFilePath || isAILoading) return

    setAIError(null)
    addUserMessage(text, attachments.map(({ name, mimeType }) => ({ name, mimeType })))
    startAssistantMessage()
    setAILoading(true)

    try {
      const mode = analysisMode === 'none' ? 'chat' : analysisMode
      await window.api.streamAIMessage(
        {
          mode,
          documentContent: activeFileContent,
          documentPath: activeFilePath,
          conversationHistory: chatHistory
            .slice(-10)
            .map((m) => ({ role: m.role, content: m.content })),
          userMessage: text,
          attachments: attachments.length > 0 ? attachments : undefined
        },
        (chunk: string) => {
          appendToLastAssistantMessage(chunk)
        }
      )

      // After streaming, parse AI response for annotations
      const currentHistory = useEditorStore.getState().chatHistory
      const lastMsg = currentHistory[currentHistory.length - 1]
      if (lastMsg?.role === 'assistant' && lastMsg.content.length > 0) {
        const parsed = parseAnnotationsFromAIResponse(lastMsg.content, activeFileContent)
        if (parsed.length > 0) {
          setAnnotations(parsed)
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setAIError(message)
    } finally {
      setAILoading(false)
    }
  }

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [chatHistory])

  const hasFile = Boolean(activeFilePath)

  return (
    <div className="chat-panel">
      {/* ── Tab bar ── */}
      <div className="chat-tabs">
        <button
          className={`chat-tab${tab === 'chat' ? ' chat-tab-active' : ''}`}
          onClick={() => setTab('chat')}
        >
          Chat
        </button>
        <button
          className={`chat-tab${tab === 'feedback' ? ' chat-tab-active' : ''}`}
          onClick={() => setTab('feedback')}
        >
          Feedback
          {annotations.length > 0 && (
            <span className="chat-tab-badge">{annotations.length}</span>
          )}
        </button>

        {/* Clear button floated right, only visible in Chat tab */}
        {tab === 'chat' && chatHistory.length > 0 && (
          <button className="chat-clear-btn" onClick={clearChat} title="Clear conversation">
            Clear
          </button>
        )}
      </div>

      {/* ── Pending-attachment indicator ── */}
      {pendingAttachmentCount > 0 && (
        <div className="chat-attachment-indicator">
          <span className="chat-attachment-indicator-icon">⌁</span>
          {pendingAttachmentCount} file{pendingAttachmentCount !== 1 ? 's' : ''} attached to next message
        </div>
      )}

      {/* ── Panel content ── */}
      {tab === 'feedback' ? (
        <FeedbackPanel />
      ) : (
        <>
          <div className="chat-messages" ref={scrollRef}>
            {!hasFile && (
              <p className="chat-placeholder">Open a chapter to start a conversation about it.</p>
            )}
            {hasFile && chatHistory.length === 0 && (
              <p className="chat-placeholder">
                Ask anything about the current chapter — passive voice, plot, character, style...
              </p>
            )}
            {chatHistory.map((msg) => (
              <ChatMessageItem key={msg.id} message={msg} />
            ))}
            {isAILoading && chatHistory[chatHistory.length - 1]?.content === '' && (
              <div className="chat-typing">
                <span />
                <span />
                <span />
              </div>
            )}
            {aiError && (
              <div className="chat-error">{aiError}</div>
            )}
          </div>

          <ChatInput
            onSend={sendMessage}
            onAttachmentsChange={setPendingAttachmentCount}
            disabled={!hasFile || isAILoading}
          />
        </>
      )}
    </div>
  )
}
