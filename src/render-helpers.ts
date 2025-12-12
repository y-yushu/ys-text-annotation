// 渲染辅助函数

import { html, type TemplateResult } from 'lit'
import type { AnnotationItem, LineItem, SelectedTextInfo } from './types'
import { getAnnotationsByLineId } from './utils'

// 高亮项类型
interface HighlightItem {
  start: number
  end: number
  content: string
  type: 'annotation' | 'editing'
  annotation?: AnnotationItem
}

// 渲染行内容的参数
export interface RenderLineContentParams {
  line: LineItem
  annotations: AnnotationItem[]
  isEditingThisLine: boolean
  selectedTextInfo: SelectedTextInfo | null
  onHighlightMouseEnter: () => void
  onHighlightMouseLeave: () => void
  onAnnotationContextMenu: (e: MouseEvent, annotationId: string) => void
  relationshipStartAnnotationId: string | null
  hoveredAnnotationId: string | null
}

/**
 * 渲染行内容，如果有标注则高亮显示
 */
export function renderLineContent(params: RenderLineContentParams): string | TemplateResult {
  const { line, annotations, isEditingThisLine, selectedTextInfo, onHighlightMouseEnter, onHighlightMouseLeave, onAnnotationContextMenu, relationshipStartAnnotationId, hoveredAnnotationId } = params

  const lineAnnotations = getAnnotationsByLineId(annotations, line.id)

  // 如果没有标注且没有正在编辑的选中文本，直接返回原文本
  if (lineAnnotations.length === 0 && !isEditingThisLine) {
    return line.content || '\u00A0'
  }

  // 按start位置排序标注，确保按顺序处理
  const sortedAnnotations = [...lineAnnotations].sort((a, b) => a.start - b.start)

  // 构建高亮后的内容片段
  const fragments: Array<string | TemplateResult> = []
  let lastIndex = 0

  // 合并标注和正在编辑的选中文本，统一处理
  const allHighlights: HighlightItem[] = []

  // 检查正在编辑的选中文本是否与某个标注完全重叠
  let editingOverlapsAnnotation = false
  let overlappedAnnotation: AnnotationItem | null = null
  if (isEditingThisLine && selectedTextInfo) {
    const { start, end } = selectedTextInfo
    // 查找是否有标注与正在编辑的选中文本完全重叠
    overlappedAnnotation = sortedAnnotations.find(annotation => annotation.start === start && annotation.end === end) || null
    editingOverlapsAnnotation = !!overlappedAnnotation
  }

  // 添加标注（如果正在编辑的选中文本与某个标注完全重叠，跳过该标注）
  sortedAnnotations.forEach(annotation => {
    // 如果正在编辑的选中文本与这个标注完全重叠，跳过这个标注
    if (editingOverlapsAnnotation && overlappedAnnotation && annotation.id === overlappedAnnotation.id) {
      return
    }
    allHighlights.push({
      start: annotation.start,
      end: annotation.end,
      content: annotation.content,
      type: 'annotation',
      annotation
    })
  })

  // 添加正在编辑的选中文本
  if (isEditingThisLine && selectedTextInfo) {
    const { start, end, content } = selectedTextInfo
    allHighlights.push({
      start,
      end,
      content,
      type: 'editing'
    })
  }

  // 按start位置排序所有高亮
  allHighlights.sort((a, b) => a.start - b.start)

  allHighlights.forEach(highlight => {
    const { start, end, content, type, annotation } = highlight

    // 跳过已经处理过的标注（处理重叠情况）
    if (start < lastIndex) {
      return
    }

    // 添加标注前的文本
    if (start > lastIndex) {
      fragments.push(line.content.substring(lastIndex, start))
    }

    // 验证内容是否匹配
    const actualContent = line.content.substring(start, end)
    if (actualContent === content) {
      if (type === 'editing') {
        // 正在编辑的选中文本，使用特殊样式
        fragments.push(html`<span class="line-selection-highlight">${content}<span class="line-selection-highlight-border"></span></span>`)
      } else if (annotation) {
        // 添加高亮的标注文本
        // 如果存在 color，通过 CSS 变量设置，否则使用默认值
        const styleAttr = annotation.color ? `--highlight-color: ${annotation.color};` : ''
        // 如果这个标注区域与正在编辑的选中文本重叠，添加 editing 类
        const editingClass = isEditingThisLine && selectedTextInfo && start === selectedTextInfo.start && end === selectedTextInfo.end ? ' editing' : ''

        // 判断是否需要高亮（起点标注或悬停的标注）
        const isStartAnnotation = relationshipStartAnnotationId === annotation.id
        const isHoveredAnnotation = hoveredAnnotationId === annotation.id
        const highlightClass = isStartAnnotation ? ' creating-relationship-start' : isHoveredAnnotation ? ' creating-relationship-hover' : ''

        fragments.push(
          html`<span
            class="line-highlight${editingClass}${highlightClass}"
            data-anno-id=${`anno-${annotation.id}`}
            style=${styleAttr}
            @mouseenter=${onHighlightMouseEnter}
            @mouseleave=${onHighlightMouseLeave}
            @contextmenu=${(e: MouseEvent) => onAnnotationContextMenu(e, annotation.id)}
            >${content}<span class="line-highlight-border"></span><span class="line-highlight-desc">${annotation.type}</span></span
          >`
        )
      }
      lastIndex = end
    } else {
      // 如果内容不匹配，跳过这个标注，不更新lastIndex
      return
    }
  })

  // 添加剩余的文本
  if (lastIndex < line.content.length) {
    fragments.push(line.content.substring(lastIndex))
  }

  // 如果没有内容，返回空格
  if (fragments.length === 0) {
    return '\u00A0'
  }

  // 使用html模板渲染所有片段
  return html`${fragments}`
}
