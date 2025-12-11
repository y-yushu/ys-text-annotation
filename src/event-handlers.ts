// 事件处理逻辑

import type { AnnotationItem, AnnotationType, SelectedTextInfo } from './types'
import { getShadowDOMSelection, getTextOffsetInLine } from './utils'

// 文本选择处理参数
export interface HandleTextSelectionParams {
  editingEnabled: boolean
  savedRange: Range | null
  shadowRoot: ShadowRoot | null
  visibleStartIndex: number
  lines: Array<{ id: number; content: string }>
  onSelectionProcessed: (info: SelectedTextInfo) => void
  onEditLayerPositionUpdate: () => void
  onEditLayerShow: () => void
  onFocusSelect: () => void
}

/**
 * 处理文本选择事件
 */
export function handleTextSelection(params: HandleTextSelectionParams): void {
  const {
    editingEnabled,
    savedRange,
    shadowRoot,
    visibleStartIndex,
    lines,
    onSelectionProcessed,
    onEditLayerPositionUpdate,
    onEditLayerShow,
    onFocusSelect
  } = params

  // 如果编辑状态未开启，不允许选中文本进行编辑
  if (!editingEnabled || !savedRange) {
    return
  }

  const range = savedRange

  // 检查选择是否折叠（没有选中文本）
  if (range.collapsed) {
    return
  }

  const rawSelectedText = range.toString()
  const selectedText = rawSelectedText.trim()

  // 如果没有选中文本，隐藏编辑图层
  if (!selectedText) {
    return
  }

  // 检查选中的文本是否在虚拟列表中
  const virtualListLayer = shadowRoot?.querySelector('.virtual-list-layer') as HTMLElement
  if (!virtualListLayer) return

  const virtualListLayerRect = virtualListLayer.getBoundingClientRect()
  const rangeRect = range.getBoundingClientRect()

  // 检查选中文本是否在虚拟列表层内
  if (
    rangeRect.left < virtualListLayerRect.left ||
    rangeRect.right > virtualListLayerRect.right ||
    rangeRect.top < virtualListLayerRect.top ||
    rangeRect.bottom > virtualListLayerRect.bottom
  ) {
    return
  }

  // 找到包含选中文本的 line 元素
  // commonAncestorContainer 可能是文本节点，需要找到元素节点
  let node: Node | null = range.commonAncestorContainer
  // 如果是文本节点，获取其父元素
  if (node.nodeType === Node.TEXT_NODE) {
    node = node.parentElement
  }
  let lineElement: HTMLElement | null = node as HTMLElement
  while (lineElement && (!lineElement.classList || !lineElement.classList.contains('line'))) {
    lineElement = lineElement.parentElement
  }
  if (!lineElement) return

  // 找到 line 在虚拟列表中的索引
  const lineParent = lineElement.parentElement
  if (!lineParent) return

  const lineIndexInView = Array.from(lineParent.children).indexOf(lineElement)
  const actualLineIndex = visibleStartIndex + lineIndexInView

  // 获取 line 的原始文本内容
  const lineContent = lines[actualLineIndex]?.content || ''
  if (!lineContent) return

  // 计算选中文本在 line 文本中的位置
  // 由于 line 中可能包含标注元素，我们需要找到选中文本在原始 lineContent 中的位置
  let startOffset = getTextOffsetInLine(lineElement, range.startContainer, range.startOffset)
  let endOffset = getTextOffsetInLine(lineElement, range.endContainer, range.endOffset)

  // 如果选中的文本经过 trim，需要调整 start 和 end 来匹配 trim 后的内容
  // 找到 trim 后的文本在原始文本中的实际位置
  if (rawSelectedText !== selectedText) {
    // 获取原始范围对应的文本
    const rawRangeText = lineContent.substring(startOffset, endOffset)
    // 计算前导空格数
    const leadingSpaces = rawRangeText.length - rawRangeText.trimStart().length
    // 计算尾部空格数
    const trailingSpaces = rawRangeText.length - rawRangeText.trimEnd().length

    // 调整偏移量：去掉前导和尾部空格
    startOffset = startOffset + leadingSpaces
    endOffset = endOffset - trailingSpaces
  }

  // 保存选中的文本信息
  const selectedTextInfo: SelectedTextInfo = {
    lineId: actualLineIndex,
    start: startOffset,
    end: endOffset,
    content: selectedText
  }

  onSelectionProcessed(selectedTextInfo)
  onEditLayerPositionUpdate()
  onEditLayerShow()
  onFocusSelect()
}

// 确认编辑的参数
export interface HandleConfirmEditParams {
  selectedAnnotationType: string
  selectedTextInfo: SelectedTextInfo | null
  editInputValue: string
  annotationTypes: AnnotationType[]
  shadowRoot: ShadowRoot | null
  onAnnotationCreated: (annotation: AnnotationItem) => void
  onEditLayerHide: () => void
}

/**
 * 处理确认按钮点击
 */
export function handleConfirmEdit(params: HandleConfirmEditParams): void {
  const { selectedAnnotationType, selectedTextInfo, editInputValue, annotationTypes, shadowRoot, onAnnotationCreated, onEditLayerHide } = params

  // 验证下拉选择框是否已选择（必填）
  if (!selectedAnnotationType || !selectedTextInfo) {
    return
  }

  // 查找选中的类型对应的颜色
  const selectedTypeObj = annotationTypes.find(type => type.type === selectedAnnotationType)
  const typeColor = selectedTypeObj?.color || '#2d0bdf'

  const trimmedDescription = editInputValue.trim()

  const newId = `anno-${Date.now()}`
  const newAnnotation: AnnotationItem = {
    id: newId,
    lineId: selectedTextInfo.lineId,
    start: selectedTextInfo.start,
    end: selectedTextInfo.end,
    content: selectedTextInfo.content,
    type: selectedAnnotationType,
    description: trimmedDescription,
    color: typeColor
  }

  // 创建标注
  onAnnotationCreated(newAnnotation)

  // 清除文本选择（使用 Shadow DOM 的选择）
  const selection = getShadowDOMSelection(shadowRoot)
  if (selection) {
    selection.removeAllRanges()
  } else {
    // 回退到全局选择清除（如果 Shadow DOM 选择不可用）
    window.getSelection()?.removeAllRanges()
  }

  // 隐藏编辑图层
  onEditLayerHide()
}

// 删除操作的参数
export interface HandleDeleteParams {
  contextMenuTarget: { type: 'annotation' | 'relationship'; id: string } | null
  onAnnotationDeleted: (id: string) => void
  onRelationshipDeleted: (id: string) => void
  onContextMenuHide: () => void
}

/**
 * 处理删除操作
 */
export function handleDelete(params: HandleDeleteParams): void {
  const { contextMenuTarget, onAnnotationDeleted, onRelationshipDeleted, onContextMenuHide } = params

  if (!contextMenuTarget) return

  if (contextMenuTarget.type === 'annotation') {
    // 删除标注
    onAnnotationDeleted(contextMenuTarget.id)
  } else if (contextMenuTarget.type === 'relationship') {
    // 删除关系
    onRelationshipDeleted(contextMenuTarget.id)
  }

  // 关闭右键菜单
  onContextMenuHide()
}
