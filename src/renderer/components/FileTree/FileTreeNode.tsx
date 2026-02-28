import { useState } from 'react'
import { useEditorStore } from '../../store/editorStore'
import type { FileNode } from '../../types/editor'
import { ContextMenu } from './ContextMenu'
import type { MenuItem } from './ContextMenu'

interface DndPayload {
  name: string
  dirPath: string
  sourcePath: string
  nodeType: 'file' | 'directory'
}

interface Props {
  node: FileNode
  depth: number
  dirPath: string
  siblings: FileNode[]
}

export function FileTreeNode({ node, depth, dirPath, siblings }: Props): JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [creatingChild, setCreatingChild] = useState<'file' | 'dir' | null>(null)
  const [createValue, setCreateValue] = useState('')

  const { activeFilePath, setActiveFile, moveNode, setFileTree, clearActiveFile } = useEditorStore()

  const openFile = async (): Promise<void> => {
    if (node.type === 'file') {
      const content = await window.api.readFile(node.path)
      setActiveFile(node.path, content)
    }
  }

  function handleDragStart(e: React.DragEvent<HTMLElement>): void {
    e.stopPropagation()
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(
      'dnd',
      JSON.stringify({ name: node.name, dirPath, sourcePath: node.path, nodeType: node.type } satisfies DndPayload)
    )
    e.currentTarget.classList.add('dragging')
  }

  function handleDragEnd(e: React.DragEvent<HTMLElement>): void {
    e.currentTarget.classList.remove('dragging')
  }

  function handleDragOver(e: React.DragEvent<HTMLElement>): void {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    e.currentTarget.classList.add('drag-over')
  }

  function handleDragLeave(e: React.DragEvent<HTMLElement>): void {
    e.currentTarget.classList.remove('drag-over')
  }

  async function handleMoveIntoDir(sourcePath: string, targetDirPath: string): Promise<void> {
    try {
      const newPath = await window.api.moveFile(sourcePath, targetDirPath)
      if (activeFilePath === sourcePath) {
        const content = await window.api.readFile(newPath)
        setActiveFile(newPath, content)
      }
      await refreshTree()
    } catch (err) {
      console.error('Move failed:', err)
    }
  }

  function handleDrop(e: React.DragEvent<HTMLElement>): void {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.classList.remove('drag-over')
    const raw = e.dataTransfer.getData('dnd')
    if (!raw) return
    const payload: DndPayload = JSON.parse(raw)

    if (node.type === 'directory') {
      // Drop ON a directory = move INTO it
      if (payload.sourcePath === node.path) return
      if (payload.dirPath === node.path) return
      if (payload.nodeType === 'directory' && node.path.startsWith(payload.sourcePath + '/')) return
      void handleMoveIntoDir(payload.sourcePath, node.path)
    } else {
      if (payload.dirPath === dirPath) {
        // Same parent — reorder
        const fromIdx = siblings.findIndex((n) => n.name === payload.name)
        const toIdx = siblings.findIndex((n) => n.name === node.name)
        if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
          moveNode(dirPath, fromIdx, toIdx)
        }
      } else {
        // Different parent — move to this file's parent directory
        void handleMoveIntoDir(payload.sourcePath, dirPath)
      }
    }
  }

  function handleContextMenu(e: React.MouseEvent): void {
    e.preventDefault()
    e.stopPropagation()
    setMenuPos({ x: e.clientX, y: e.clientY })
  }

  async function refreshTree(): Promise<void> {
    const tree = await window.api.listFiles()
    setFileTree(tree)
  }

  function startRename(): void {
    setRenameValue(node.name)
    setRenaming(true)
  }

  async function submitRename(): Promise<void> {
    const trimmed = renameValue.trim()
    setRenaming(false)
    if (!trimmed || trimmed === node.name) return
    try {
      const newPath = await window.api.renameNode(node.path, trimmed)
      if (activeFilePath === node.path) {
        const content = await window.api.readFile(newPath)
        setActiveFile(newPath, content)
      }
      await refreshTree()
    } catch (err) {
      console.error('Rename failed:', err)
    }
  }

  async function submitDelete(): Promise<void> {
    const label = node.type === 'directory' ? `folder "${node.name}"` : `"${node.name}"`
    if (!confirm(`Delete ${label}? This cannot be undone.`)) return
    try {
      if (activeFilePath && (activeFilePath === node.path || activeFilePath.startsWith(node.path + '/'))) {
        clearActiveFile()
      }
      await window.api.deleteNode(node.path)
      await refreshTree()
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  async function submitCreateChild(): Promise<void> {
    const trimmed = createValue.trim()
    setCreatingChild(null)
    setCreateValue('')
    if (!trimmed) return
    try {
      if (creatingChild === 'file') {
        await window.api.createFile(node.path, trimmed)
      } else {
        await window.api.createDir(node.path, trimmed)
      }
      await refreshTree()
    } catch (err) {
      console.error('Create failed:', err)
    }
  }

  const menuItems: (MenuItem | 'separator')[] =
    node.type === 'directory'
      ? [
          {
            label: 'New File',
            action: () => {
              setExpanded(true)
              setCreatingChild('file')
              setCreateValue('')
            }
          },
          {
            label: 'New Folder',
            action: () => {
              setExpanded(true)
              setCreatingChild('dir')
              setCreateValue('')
            }
          },
          'separator',
          { label: 'Rename', action: startRename },
          { label: 'Delete', action: submitDelete, danger: true }
        ]
      : [
          { label: 'Rename', action: startRename },
          { label: 'Delete', action: submitDelete, danger: true }
        ]

  if (node.type === 'directory') {
    return (
      <div className="tree-dir">
        {renaming ? (
          <input
            className="tree-rename-input"
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename()
              if (e.key === 'Escape') setRenaming(false)
            }}
            onBlur={submitRename}
            autoFocus
          />
        ) : (
          <button
            className="tree-dir-header"
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            onClick={() => setExpanded(!expanded)}
            onContextMenu={handleContextMenu}
            draggable={true}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <span className="tree-arrow">{expanded ? '▾' : '▸'}</span>
            {node.name}
          </button>
        )}
        {expanded && (
          <>
            {creatingChild && (
              <input
                className="tree-rename-input"
                style={{ paddingLeft: `${(depth + 1) * 12 + 20}px` }}
                value={createValue}
                onChange={(e) => setCreateValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitCreateChild()
                  if (e.key === 'Escape') {
                    setCreatingChild(null)
                    setCreateValue('')
                  }
                }}
                onBlur={() => {
                  setCreatingChild(null)
                  setCreateValue('')
                }}
                placeholder={creatingChild === 'file' ? 'file name' : 'folder name'}
                autoFocus
              />
            )}
            {node.children?.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                dirPath={node.path}
                siblings={node.children!}
              />
            ))}
          </>
        )}
        {menuPos && (
          <ContextMenu
            x={menuPos.x}
            y={menuPos.y}
            items={menuItems}
            onClose={() => setMenuPos(null)}
          />
        )}
      </div>
    )
  }

  const isActive = activeFilePath === node.path

  if (renaming) {
    return (
      <input
        className="tree-rename-input"
        style={{ paddingLeft: `${depth * 12 + 20}px` }}
        value={renameValue}
        onChange={(e) => setRenameValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submitRename()
          if (e.key === 'Escape') setRenaming(false)
        }}
        onBlur={submitRename}
        autoFocus
      />
    )
  }

  return (
    <>
      <button
        className={`tree-file${isActive ? ' active' : ''}`}
        style={{ paddingLeft: `${depth * 12 + 20}px` }}
        onClick={openFile}
        onContextMenu={handleContextMenu}
        title={node.name}
        draggable={true}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {node.name}
      </button>
      {menuPos && (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          items={menuItems}
          onClose={() => setMenuPos(null)}
        />
      )}
    </>
  )
}
