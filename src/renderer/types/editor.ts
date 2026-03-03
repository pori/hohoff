export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

export interface AttachmentMeta {
  name: string
  mimeType: string
}

export interface Attachment extends AttachmentMeta {
  data: string // base64 for images, extracted text for text/PDF
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  attachments?: AttachmentMeta[] // metadata only — stored in history for display
  annotationIds?: string[] // IDs of suggestions this message produced
  bibleGeneration?: boolean // when true, show "Apply to Story Bible" button on assistant message
}

export interface ChatSession {
  id: string
  createdAt: number
  messages: ChatMessage[]
}

export type AnnotationType = 'passive_voice' | 'consistency' | 'style' | 'show_tell' | 'critique' | 'custom' | 'user_comment'

export interface TextAnnotation {
  id: string
  type: AnnotationType
  from: number
  to: number
  matchedText: string
  message: string
  suggestion?: string
  applied?: boolean // true when the suggestion has been applied to the document
  dismissed?: boolean // true when the user dismissed this annotation (archived)
  autoAnalyse?: boolean // true when created via context menu — FeedbackCard starts AI analysis immediately
  analysisCache?: { text: string; suggestion: string | null } // persisted AI analysis result
  comment?: string // user-written note text (only set for user_comment type)
}

export type AnalysisMode = 'none' | 'passive_voice' | 'consistency' | 'style' | 'show_tell' | 'critique'

export type AIMode = 'chat' | 'passive_voice' | 'consistency' | 'style' | 'show_tell' | 'critique'

export interface AIPayload {
  mode: AIMode
  documentContent: string
  documentPath: string
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
  userMessage: string
  attachments?: Attachment[] // full data for current API call only
}

export interface RevisionMeta {
  id: string
  timestamp: number
  wordCount: number
}
