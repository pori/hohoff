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
}

export interface ChatSession {
  id: string
  createdAt: number
  messages: ChatMessage[]
}

export type AnnotationType = 'passive_voice' | 'consistency' | 'style' | 'critique' | 'custom'

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
}

export type AnalysisMode = 'none' | 'passive_voice' | 'consistency' | 'style' | 'critique'

export type AIMode = 'chat' | 'passive_voice' | 'consistency' | 'style' | 'critique'

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
