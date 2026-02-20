import { useState } from 'react'
import { useEditorStore } from '../../store/editorStore'
import type { FileNode } from '../../types/editor'

interface Props {
  node: FileNode
  depth: number
}

export function FileTreeNode({ node, depth }: Props): JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const { activeFilePath, setActiveFile } = useEditorStore()

  const openFile = async (): Promise<void> => {
    if (node.type === 'file') {
      const content = await window.api.readFile(node.path)
      setActiveFile(node.path, content)
    }
  }

  if (node.type === 'directory') {
    return (
      <div className="tree-dir">
        <button
          className="tree-dir-header"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="tree-arrow">{expanded ? '▾' : '▸'}</span>
          {node.name}
        </button>
        {expanded && node.children?.map((child) => (
          <FileTreeNode key={child.path} node={child} depth={depth + 1} />
        ))}
      </div>
    )
  }

  const isActive = activeFilePath === node.path

  return (
    <button
      className={`tree-file${isActive ? ' active' : ''}`}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
      onClick={openFile}
      title={node.name}
    >
      {node.name}
    </button>
  )
}
