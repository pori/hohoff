import { useState } from 'react'
import { useEditorStore } from '../../store/editorStore'
import { currentEditorView } from '../Editor/MarkdownEditor'
import { FileTreeNode } from './FileTreeNode'
import { ContextMenu } from './ContextMenu'
import type { MenuItem } from './ContextMenu'
import './FileTree.css'

export function FileTree(): JSX.Element {
  const { fileTree, activeFilePath, setActiveFile, markSaved, setFileTree } = useEditorStore()
  const [creatingRoot, setCreatingRoot] = useState<'file' | 'dir' | null>(null)
  const [createRootValue, setCreateRootValue] = useState('')
  const [rootMenuPos, setRootMenuPos] = useState<{ x: number; y: number } | null>(null)

  const rootMenuItems: MenuItem[] = [
    { label: 'New File',   action: () => { setCreatingRoot('file'); setCreateRootValue('') } },
    { label: 'New Folder', action: () => { setCreatingRoot('dir');  setCreateRootValue('') } },
  ]

  async function refreshTree(): Promise<void> {
    const tree = await window.api.listFiles()
    setFileTree(tree)
  }

  async function submitCreateRoot(): Promise<void> {
    const trimmed = createRootValue.trim()
    setCreatingRoot(null)
    setCreateRootValue('')
    if (!trimmed) return
    try {
      if (creatingRoot === 'file') {
        await window.api.createFile('__root__', trimmed)
      } else {
        await window.api.createDir('__root__', trimmed)
      }
      await refreshTree()
    } catch (err) {
      console.error('Create at root failed:', err)
    }
  }

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
      <div
        className="file-tree-list"
        onContextMenu={(e) => { e.preventDefault(); setRootMenuPos({ x: e.clientX, y: e.clientY }) }}
      >
        {creatingRoot && (
          <input
            className="tree-rename-input"
            value={createRootValue}
            onChange={(e) => setCreateRootValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitCreateRoot()
              if (e.key === 'Escape') { setCreatingRoot(null); setCreateRootValue('') }
            }}
            onBlur={() => { setCreatingRoot(null); setCreateRootValue('') }}
            placeholder={creatingRoot === 'file' ? 'file name' : 'folder name'}
            autoFocus
          />
        )}
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
      {rootMenuPos && (
        <ContextMenu
          x={rootMenuPos.x}
          y={rootMenuPos.y}
          items={rootMenuItems}
          onClose={() => setRootMenuPos(null)}
        />
      )}
    </nav>
  )
}
