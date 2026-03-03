import { useEditorStore } from '../../store/editorStore'
import { currentEditorView } from '../Editor/MarkdownEditor'
import { FileTreeNode } from './FileTreeNode'
import './FileTree.css'

export function FileTree(): JSX.Element {
  const { fileTree, activeFilePath, setActiveFile, markSaved } = useEditorStore()

  const handleOpenStoryBible = async (): Promise<void> => {
    try {
      const { path, content } = await window.api.openStoryBible()
      setActiveFile(path, content)
      // If the path didn't change (already on Story Bible), the MarkdownEditor's
      // activeFilePath-keyed effect won't fire. Push content directly, same
      // pattern as RevisionPanel.restore().
      if (path === activeFilePath) {
        const view = currentEditorView
        if (view) {
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: content }
          })
          markSaved()
        }
      }
    } catch (err) {
      console.error('[FileTree] openStoryBible failed:', err)
    }
  }

  return (
    <nav className="file-tree">
      <div className="file-tree-header">
        <span>HOHOFF</span>
        <button
          className="file-tree-bible-btn"
          onClick={handleOpenStoryBible}
          title="Open Story Bible"
        >
          📖
        </button>
      </div>
      <div className="file-tree-list">
        {fileTree.map((node) => (
          <FileTreeNode
            key={node.path}
            node={node}
            depth={0}
            dirPath="__root__"
            siblings={fileTree}
          />
        ))}
      </div>
    </nav>
  )
}
