import { useRef, useEffect } from 'react'
import { useEditorStore } from '../../store/editorStore'
import { ChatMessageItem } from './ChatMessageItem'
import { ChatInput } from './ChatInput'
import { parseAnnotationsFromAIResponse } from '../../utils/annotationParser'
import './Chat.css'

export function ChatPanel(): JSX.Element {
  const {
    chatHistory,
    isAILoading,
    aiError,
    activeFileContent,
    activeFilePath,
    analysisMode,
    addUserMessage,
    startAssistantMessage,
    appendToLastAssistantMessage,
    setAILoading,
    setAIError,
    setAnnotations,
    clearChat
  } = useEditorStore()

  const scrollRef = useRef<HTMLDivElement>(null)

  const sendMessage = async (text: string): Promise<void> => {
    if (!activeFilePath || isAILoading) return

    setAIError(null)
    addUserMessage(text)
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
          userMessage: text
        },
        (chunk: string) => {
          appendToLastAssistantMessage(chunk)
        }
      )

      // After streaming, parse AI response for annotations
      const currentHistory = useEditorStore.getState().chatHistory
      const lastMsg = currentHistory[currentHistory.length - 1]
      if (lastMsg?.role === 'assistant' && lastMsg.content.length > 0) {
        const annotations = parseAnnotationsFromAIResponse(lastMsg.content, activeFileContent)
        if (annotations.length > 0) {
          setAnnotations(annotations)
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
      <div className="chat-header">
        <span>AI Editor</span>
        {chatHistory.length > 0 && (
          <button className="chat-clear-btn" onClick={clearChat} title="Clear conversation">
            Clear
          </button>
        )}
      </div>

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

      <ChatInput onSend={sendMessage} disabled={!hasFile || isAILoading} />
    </div>
  )
}
