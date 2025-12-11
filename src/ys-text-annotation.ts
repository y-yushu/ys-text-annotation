import { LitElement, css, html, svg, unsafeCSS } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { mockContent } from './mock'
import styles from './index.css?inline'
import {
  getShadowDOMSelection,
  getTextOffsetInLine,
  calculateBezierCurvePath,
  calculateEditLayerPosition,
  calculateContextMenuPosition,
  measureLineHeight,
  getAnnotationsByLineId
} from './utils'

// 按行拆分文本
interface LineItem {
  id: number
  content: string
}

// 实体标注的类型
interface AnnotationType {
  type: string
  color: string
}

// 实体标注
interface AnnotationItem {
  id: string // 唯一标识
  lineId: number // 段落id
  start: number // 起始位置
  end: number // 结束位置
  content: string // 标注内容
  type: string // 分类
  description: string // 描述
  color?: string // 颜色
}

// 标注模拟数据
const mockAnnotation: AnnotationItem[] = [
  { id: '1', lineId: 2, start: 3, end: 5, content: '天蚕', type: '人物', description: '', color: '#3271ae' },
  { id: '2', lineId: 7, start: 5, end: 11, content: '第1497章', type: '章节', description: '', color: '#547689' },
  { id: '3', lineId: 8, start: 12, end: 30, content: '原本拥有圣龙之命，却被敌国武王以亿万', type: '章节', description: '', color: '#547689' },
  { id: '4', lineId: 25, start: 1, end: 3, content: '此时', type: '时间', description: '', color: '#547689' },
  { id: '5', lineId: 21, start: 2, end: 5, content: '青檀石', type: '物品', description: '', color: '#5c2d91' }
]

// 关系
interface RelationshipItem {
  id: string // 唯一标识
  startId: string // 起点节点
  endId: string // 结束节点
  label: string // 关系描述
  color?: string // 颜色
}

// 模拟数据
const mockRelationship: RelationshipItem[] = [
  { id: '1-2', startId: '1', endId: '2', label: '', color: '#df970b' },
  { id: '1-3', startId: '1', endId: '3', label: '关系2', color: '#53df0b' },
  { id: '3-5', startId: '3', endId: '5', label: '关系3', color: '#722ed1' }
]

@customElement('ys-text-annotation')
export class YsTextAnnotation extends LitElement {
  // 常量配置
  private static readonly BUFFER_SIZE = 5 // 可见区域缓冲区行数
  private static readonly BOTTOM_THRESHOLD = 10 // 底部检测容差（px）
  private static readonly BOTTOM_EXTRA_RATIO = 1 / 3 // 底部额外空间比例

  static styles = css`
    ${unsafeCSS(styles)}
  `

  @property()
  content = mockContent

  @property({ type: Boolean })
  editingEnabled = true

  @state()
  private lines: LineItem[] = []

  private hasInitializedLines = false

  @state()
  private visibleStartIndex = 0

  @state()
  private visibleEndIndex = 0

  @state()
  private lineHeight = 24

  @state()
  private containerHeight = 0

  @state()
  private annotationType: AnnotationType[] = [
    { type: '人物', color: '#3271ae' },
    { type: '地点', color: '#547689' },
    { type: '组织', color: '#5c2d91' },
    { type: '时间', color: '#9c27b0' },
    { type: '事件', color: '#673ab7' },
    { type: '其他', color: '#9c27b0' }
  ]

  @state()
  private annotations: AnnotationItem[] = mockAnnotation

  @state()
  private relationships: RelationshipItem[] = mockRelationship

  @state()
  private relationshipPaths: Array<{
    id: string
    d: string
    label: string
    color: string
    labelX?: number
    labelY?: number
    labelAngle?: number
  }> = []

  @state()
  private containerWidth = 0

  @state()
  private isHoveringHighlight = false

  @state()
  private isSelectingText = false
  private mouseDownPosition = { x: 0, y: 0 }

  @state()
  private editLayerVisible = false

  @state()
  private editLayerPosition = { x: 0, y: 0 }

  @state()
  private editInputValue = ''

  @state()
  private selectedAnnotationType: string = ''

  private selectedTextInfo: {
    lineId: number
    start: number
    end: number
    content: string
  } | null = null

  private savedRange: Range | null = null

  @state()
  private contextMenuVisible = false

  @state()
  private contextMenuPosition = { x: 0, y: 0 }

  private contextMenuTarget: {
    type: 'annotation' | 'relationship'
    id: string
  } | null = null

  private scrollContainer?: HTMLElement
  private resizeObserver?: ResizeObserver
  private updateTimer?: number
  private relationshipTimer?: number
  private globalMouseUpHandler?: () => void

  connectedCallback() {
    super.connectedCallback()
    // 首次连接时初始化，避免与 updated 中的调用重复
    if (!this.hasInitializedLines) {
      this.updateLines()
      this.hasInitializedLines = true
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.updateTimer && cancelAnimationFrame(this.updateTimer)
    this.relationshipTimer && cancelAnimationFrame(this.relationshipTimer)
    this.resizeObserver?.disconnect()
    if (this.globalMouseUpHandler) {
      document.removeEventListener('mouseup', this.globalMouseUpHandler)
      this.globalMouseUpHandler = undefined
    }
  }

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    super.updated(changedProperties)
    // 当 content 属性从外部改变时，更新 lines
    if (changedProperties.has('content')) {
      this.updateLines()
      this.hasInitializedLines = true
    }

    // 当编辑状态关闭时，隐藏编辑层
    if (changedProperties.has('editingEnabled') && !this.editingEnabled) {
      this.editLayerVisible = false
      this.selectedTextInfo = null
      this.savedRange = null
      this.editInputValue = ''
      this.selectedAnnotationType = ''
    }

    if (
      changedProperties.has('visibleStartIndex') ||
      changedProperties.has('visibleEndIndex') ||
      changedProperties.has('annotations') ||
      changedProperties.has('relationships')
    ) {
      this.scheduleMeasureRelationships()
    }
  }

  firstUpdated() {
    this.scrollContainer = this.shadowRoot?.querySelector('.scroll-container') as HTMLElement
    if (!this.scrollContainer) return

    this.scrollContainer.addEventListener('scroll', () => this.handleScroll())
    this.containerHeight = this.scrollContainer.clientHeight
    this.containerWidth = this.scrollContainer.clientWidth

    // 监听文本选择事件（只处理左键）
    this.scrollContainer.addEventListener('mousedown', (e: MouseEvent) => {
      // 只处理左键（button === 0），忽略右键和中键
      if (e.button === 0) {
        this.isSelectingText = true
        this.mouseDownPosition = { x: e.clientX, y: e.clientY }
      }
    })

    // 监听 mouseup 事件，获取选中的文本（只处理左键）
    this.scrollContainer.addEventListener('mouseup', (e: MouseEvent) => {
      // 只处理左键（button === 0）
      if (e.button !== 0) {
        return
      }

      // 检查鼠标是否移动过（即是否真的选择了文本）
      const mouseMoved = Math.abs(e.clientX - this.mouseDownPosition.x) > 2 || Math.abs(e.clientY - this.mouseDownPosition.y) > 2

      if (!mouseMoved) {
        // 如果鼠标没有移动，只是点击，不处理
        setTimeout(() => {
          this.isSelectingText = false
        }, 100)
        return
      }

      // 直接获取选择
      const selection = getShadowDOMSelection(this.shadowRoot)
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0)
        if (!range.collapsed && range.toString().trim()) {
          // 保存 Range 并处理选择
          this.savedRange = range.cloneRange()
          this.handleTextSelection()
        }
      }

      this.isSelectingText = false
    })

    // 监听全局 mouseup 事件，确保即使鼠标在容器外松开也能重置状态
    this.globalMouseUpHandler = () => {
      if (this.isSelectingText) {
        this.isSelectingText = false
      }
    }
    document.addEventListener('mouseup', this.globalMouseUpHandler)

    // 监听容器大小变化
    this.resizeObserver = new ResizeObserver(() => {
      if (this.scrollContainer) {
        this.containerHeight = this.scrollContainer.clientHeight
        this.containerWidth = this.scrollContainer.clientWidth
        this.measureLineHeight()
        this.updateVisibleRange()
        this.scheduleMeasureRelationships()
      }
    })
    this.resizeObserver.observe(this.scrollContainer)

    this.measureLineHeight()
    this.updateVisibleRange()
    this.scheduleMeasureRelationships()

    // 监听全局点击事件，关闭右键菜单（只处理左键点击）
    document.addEventListener('click', (e: MouseEvent) => {
      // 只处理左键点击（button === 0），避免影响右键菜单
      if (e.button === 0) {
        this.contextMenuVisible = false
        this.contextMenuTarget = null
      }
    })
  }

  private updateLines() {
    const contentLines = this.content.split('\n')
    this.lines = contentLines.map((content, index) => ({
      id: index,
      content: content
    }))
    if (this.scrollContainer) {
      this.measureLineHeight()
      this.updateVisibleRange()
    }
  }

  private measureLineHeight() {
    if (!this.scrollContainer) return
    this.lineHeight = measureLineHeight(this.scrollContainer)
  }

  private handleScroll() {
    this.updateTimer && cancelAnimationFrame(this.updateTimer)
    this.updateTimer = requestAnimationFrame(() => {
      this.updateVisibleRange()
      // 如果编辑层可见，重新计算位置
      if (this.editLayerVisible && this.savedRange) {
        this.updateEditLayerPosition()
      }
      // 滚动时关闭右键菜单
      if (this.contextMenuVisible) {
        this.contextMenuVisible = false
        this.contextMenuTarget = null
      }
    })
  }

  private updateVisibleRange() {
    if (!this.scrollContainer || this.lines.length === 0) return

    const { scrollTop, clientHeight } = this.scrollContainer
    const containerHeight = clientHeight || this.containerHeight
    const totalHeight = this.getTotalHeight()
    const buffer = YsTextAnnotation.BUFFER_SIZE

    // 计算可见区域的行索引范围
    let startIndex = Math.max(0, Math.floor(scrollTop / this.lineHeight) - buffer)
    let endIndex = Math.ceil((scrollTop + containerHeight) / this.lineHeight) + buffer

    // 接近底部时，确保包含最后一行
    const isNearBottom = scrollTop + containerHeight >= totalHeight - YsTextAnnotation.BOTTOM_THRESHOLD
    endIndex = isNearBottom ? this.lines.length - 1 : Math.min(this.lines.length - 1, endIndex)

    // 确保索引范围有效
    startIndex = Math.min(startIndex, endIndex)
    endIndex = Math.max(startIndex, endIndex)

    this.visibleStartIndex = startIndex
    this.visibleEndIndex = endIndex
    this.containerHeight = containerHeight
  }

  private getTotalHeight(): number {
    const contentHeight = this.lines.length * this.lineHeight
    const extraBottomSpace = this.containerHeight * YsTextAnnotation.BOTTOM_EXTRA_RATIO
    return contentHeight + extraBottomSpace
  }

  private getOffsetTop(index: number): number {
    return index * this.lineHeight
  }

  /**
   * 计算已渲染标注的相对坐标，生成关系路径
   */
  private measureRelationships() {
    if (!this.scrollContainer) return

    const paths: Array<{
      id: string
      d: string
      label: string
      color: string
      labelX?: number
      labelY?: number
      labelAngle?: number
    }> = []

    // 默认颜色
    const defaultColor = '#c12c1f'

    // 获取虚拟列表层元素
    const virtualListLayer = this.shadowRoot?.querySelector('.virtual-list-layer') as HTMLElement
    if (!virtualListLayer) return

    // 遍历所有关系
    for (const relationship of this.relationships) {
      const { id, startId, endId, label, color } = relationship
      const pathColor = color || defaultColor

      // 查找起点和终点的 line-highlight 元素
      const startElement = this.shadowRoot?.querySelector(`[data-anno-id="anno-${startId}"]`) as HTMLElement
      const endElement = this.shadowRoot?.querySelector(`[data-anno-id="anno-${endId}"]`) as HTMLElement

      // 如果起点或终点元素不存在（未渲染），跳过
      if (!startElement || !endElement) continue

      // 获取元素相对于虚拟列表可见区域的中心位置
      // 这样计算出的坐标是相对于虚拟列表可见区域的，SVG 使用相同的 transform 后就能正确对齐
      const getElementCenterPosition = (element: HTMLElement) => {
        // 获取元素和虚拟列表层的 getBoundingClientRect（相对于视口）
        const elementRect = element.getBoundingClientRect()
        const virtualListLayerRect = virtualListLayer.getBoundingClientRect()

        // 计算元素相对于虚拟列表可见区域的坐标
        // x 坐标：元素相对于虚拟列表层的 x 坐标
        const relativeLeft = elementRect.left - virtualListLayerRect.left

        // y 坐标：元素相对于虚拟列表层的 y 坐标
        // 由于虚拟列表层使用了 transform: translateY(offsetTop)，getBoundingClientRect() 已经考虑了 transform
        // 所以直接计算差值即可得到相对于虚拟列表可见区域的坐标
        const relativeTop = elementRect.top - virtualListLayerRect.top

        // 返回中心点坐标（相对于虚拟列表可见区域）
        return {
          x: relativeLeft + elementRect.width / 2,
          y: relativeTop + elementRect.height / 2
        }
      }

      const startPos = getElementCenterPosition(startElement)
      const endPos = getElementCenterPosition(endElement)

      if (!startPos || !endPos) continue

      // 生成贝塞尔曲线路径（从起点中心到终点中心）
      const bezierResult = calculateBezierCurvePath(startPos, endPos, label)
      paths.push({
        id,
        d: bezierResult.d,
        label,
        color: pathColor,
        labelX: bezierResult.labelX,
        labelY: bezierResult.labelY,
        labelAngle: bezierResult.labelAngle
      })
    }

    this.relationshipPaths = paths
  }

  private scheduleMeasureRelationships() {
    this.relationshipTimer && cancelAnimationFrame(this.relationshipTimer)
    this.relationshipTimer = requestAnimationFrame(() => this.measureRelationships())
  }

  /**
   * 处理鼠标移入高亮节点
   */
  private handleHighlightMouseEnter() {
    // 如果正在选择文本，不触发高亮
    if (this.isSelectingText) {
      return
    }
    this.isHoveringHighlight = true
  }

  /**
   * 处理鼠标移出高亮节点
   */
  private handleHighlightMouseLeave() {
    this.isHoveringHighlight = false
  }

  /**
   * 处理文本选择事件
   */
  private handleTextSelection() {
    // 如果编辑状态未开启，不允许选中文本进行编辑
    if (!this.editingEnabled) {
      this.editLayerVisible = false
      this.savedRange = null
      return
    }

    // 使用保存的 Range 对象，而不是从 selection 获取
    const range = this.savedRange

    if (!range) {
      this.editLayerVisible = false
      return
    }

    // 检查选择是否折叠（没有选中文本）
    if (range.collapsed) {
      this.editLayerVisible = false
      this.savedRange = null
      return
    }

    const rawSelectedText = range.toString()
    const selectedText = rawSelectedText.trim()

    // 如果没有选中文本，隐藏编辑图层
    if (!selectedText) {
      this.editLayerVisible = false
      this.savedRange = null
      return
    }

    // 检查选中的文本是否在虚拟列表中
    const virtualListLayer = this.shadowRoot?.querySelector('.virtual-list-layer') as HTMLElement
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
    const actualLineIndex = this.visibleStartIndex + lineIndexInView

    // 获取 line 的原始文本内容
    const lineContent = this.lines[actualLineIndex]?.content || ''
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
    this.selectedTextInfo = {
      lineId: actualLineIndex,
      start: startOffset,
      end: endOffset,
      content: selectedText
    }

    // 计算编辑图层的位置
    this.updateEditLayerPosition()
    this.editInputValue = ''
    this.selectedAnnotationType = ''
    this.editLayerVisible = true

    // 聚焦下拉选择框
    this.updateComplete.then(() => {
      const select = this.shadowRoot?.querySelector('.edit-layer select') as HTMLSelectElement
      if (select) {
        select.focus()
      }
    })
  }

  /**
   * 更新编辑层位置（用于滚动时重新定位）
   */
  private updateEditLayerPosition() {
    if (!this.savedRange || !this.scrollContainer) return

    const contentWrapper = this.shadowRoot?.querySelector('.content-wrapper') as HTMLElement
    if (!contentWrapper) return

    this.editLayerPosition = calculateEditLayerPosition(this.savedRange, this.scrollContainer, contentWrapper)
  }

  /**
   * 处理确认按钮点击
   */
  private handleConfirmEdit() {
    // 验证下拉选择框是否已选择（必填）
    if (!this.selectedAnnotationType) {
      return
    }

    // 如果已选择类型，创建节点
    if (this.selectedTextInfo) {
      // 查找选中的类型对应的颜色
      const selectedTypeObj = this.annotationType.find(type => type.type === this.selectedAnnotationType)
      const typeColor = selectedTypeObj?.color || '#2d0bdf'

      const trimmedDescription = this.editInputValue.trim()

      const newId = `anno-${Date.now()}`
      const newAnnotation: AnnotationItem = {
        id: newId,
        lineId: this.selectedTextInfo.lineId,
        start: this.selectedTextInfo.start,
        end: this.selectedTextInfo.end,
        content: this.selectedTextInfo.content,
        type: this.selectedAnnotationType,
        description: trimmedDescription,
        color: typeColor
      }

      // 添加到标注列表
      this.annotations = [...this.annotations, newAnnotation]

      // 清除文本选择（使用 Shadow DOM 的选择）
      const selection = getShadowDOMSelection(this.shadowRoot)
      if (selection) {
        selection.removeAllRanges()
      } else {
        // 回退到全局选择清除（如果 Shadow DOM 选择不可用）
        window.getSelection()?.removeAllRanges()
      }
    }

    // 隐藏编辑图层
    this.editLayerVisible = false
    this.selectedTextInfo = null
    this.editInputValue = ''
    this.selectedAnnotationType = ''
    this.savedRange = null
  }

  /**
   * 处理下拉选择框变化
   */
  private handleTypeSelectChange(e: Event) {
    const select = e.target as HTMLSelectElement
    this.selectedAnnotationType = select.value
  }

  /**
   * 处理输入框输入
   */
  private handleInputChange(e: Event) {
    const input = e.target as HTMLInputElement
    this.editInputValue = input.value
  }

  /**
   * 处理输入框回车键
   */
  private handleInputKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      this.handleConfirmEdit()
    } else if (e.key === 'Escape') {
      this.editLayerVisible = false
      this.selectedTextInfo = null
      this.editInputValue = ''
      this.selectedAnnotationType = ''
      this.savedRange = null
    }
  }

  /**
   * 处理标注右键菜单
   */
  private handleAnnotationContextMenu(e: MouseEvent, annotationId: string) {
    e.preventDefault()
    e.stopPropagation()

    // 重置文本选择状态，确保右键菜单可以正常显示
    this.isSelectingText = false

    const contentWrapper = this.shadowRoot?.querySelector('.content-wrapper') as HTMLElement
    if (!contentWrapper) return

    this.contextMenuPosition = calculateContextMenuPosition(e, contentWrapper)

    this.contextMenuTarget = {
      type: 'annotation',
      id: annotationId
    }

    this.contextMenuVisible = true
  }

  /**
   * 处理关系右键菜单
   */
  private handleRelationshipContextMenu(e: MouseEvent, relationshipId: string) {
    e.preventDefault()
    e.stopPropagation()

    // 重置文本选择状态，确保右键菜单可以正常显示
    this.isSelectingText = false

    const contentWrapper = this.shadowRoot?.querySelector('.content-wrapper') as HTMLElement
    if (!contentWrapper) return

    this.contextMenuPosition = calculateContextMenuPosition(e, contentWrapper)

    this.contextMenuTarget = {
      type: 'relationship',
      id: relationshipId
    }

    this.contextMenuVisible = true
  }

  /**
   * 处理删除操作
   */
  private handleDelete() {
    if (!this.contextMenuTarget) return

    if (this.contextMenuTarget.type === 'annotation') {
      // 删除标注
      const annotationId = this.contextMenuTarget.id
      // 删除标注
      this.annotations = this.annotations.filter(annotation => annotation.id !== annotationId)
      // 删除该标注关联的所有关系
      this.relationships = this.relationships.filter(relationship => relationship.startId !== annotationId && relationship.endId !== annotationId)
    } else if (this.contextMenuTarget.type === 'relationship') {
      // 删除关系
      const relationshipId = this.contextMenuTarget.id
      this.relationships = this.relationships.filter(relationship => relationship.id !== relationshipId)
    }

    // 关闭右键菜单
    this.contextMenuVisible = false
    this.contextMenuTarget = null
  }

  /**
   * 渲染行内容，如果有标注则高亮显示
   */
  private renderLineContent(line: LineItem) {
    const annotations = getAnnotationsByLineId(this.annotations, line.id)

    // 检查是否有正在编辑的选中文本在当前行
    const isEditingThisLine = this.editLayerVisible && this.selectedTextInfo && this.selectedTextInfo.lineId === line.id

    // 如果没有标注且没有正在编辑的选中文本，直接返回原文本
    if (annotations.length === 0 && !isEditingThisLine) {
      return line.content || '\u00A0'
    }

    // 按start位置排序标注，确保按顺序处理
    const sortedAnnotations = [...annotations].sort((a, b) => a.start - b.start)

    // 构建高亮后的内容片段
    const fragments: Array<string | ReturnType<typeof html>> = []
    let lastIndex = 0

    // 合并标注和正在编辑的选中文本，统一处理
    const allHighlights: Array<{
      start: number
      end: number
      content: string
      type: 'annotation' | 'editing'
      annotation?: AnnotationItem
    }> = []

    // 检查正在编辑的选中文本是否与某个标注完全重叠
    let editingOverlapsAnnotation = false
    let overlappedAnnotation: AnnotationItem | null = null
    if (isEditingThisLine && this.selectedTextInfo) {
      const { start, end } = this.selectedTextInfo
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
    if (isEditingThisLine && this.selectedTextInfo) {
      const { start, end, content } = this.selectedTextInfo
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
          const editingClass =
            isEditingThisLine && this.selectedTextInfo && start === this.selectedTextInfo.start && end === this.selectedTextInfo.end ? ' editing' : ''

          fragments.push(
            html`<span
              class="line-highlight${editingClass}"
              data-anno-id=${`anno-${annotation.id}`}
              style=${styleAttr}
              @mouseenter=${this.handleHighlightMouseEnter}
              @mouseleave=${this.handleHighlightMouseLeave}
              @contextmenu=${(e: MouseEvent) => this.handleAnnotationContextMenu(e, annotation.id)}
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

  render() {
    const visibleLines = this.lines.slice(this.visibleStartIndex, this.visibleEndIndex + 1)
    const totalHeight = this.getTotalHeight()
    const offsetTop = this.getOffsetTop(this.visibleStartIndex)

    return html`
      <div class="scroll-container" @scroll=${this.handleScroll}>
        <!-- <svg width="100" height="100" view="0 0 100 100">
          <path
            id="myRedPath"
            d="M 0 0 L 100 100"
            fill="transparent"
            stroke="red"
            stroke-width="5"
            @contextmenu=${(e: MouseEvent) => this.handleRelationshipContextMenu(e, '1-2')}
          ></path>
        </svg> -->
        <div class="content-wrapper" style="height: ${totalHeight}px;">
          <!-- SVG 关系层 -->
          <svg
            class="relationship-layer ${this.isHoveringHighlight || this.contextMenuVisible ? 'highlighted' : ''} ${this.isSelectingText
              ? 'selecting-text'
              : ''}"
            width="${this.containerWidth}"
            height="${totalHeight}"
            viewBox="0 0 ${this.containerWidth} ${totalHeight}"
            style="transform: translateY(${offsetTop}px);"
          >
            ${this.relationshipPaths.map(path => {
              if (path.label && path.labelX !== undefined && path.labelY !== undefined && path.labelAngle !== undefined) {
                return svg`
                  <path 
                    class="relationship-path" 
                    d=${path.d} 
                    data-rel-id=${path.id} 
                    stroke=${path.color}
                    @mouseenter=${this.handleHighlightMouseEnter}
                    @mouseleave=${this.handleHighlightMouseLeave}
                    @contextmenu=${(e: MouseEvent) => this.handleRelationshipContextMenu(e, path.id)}
                  ></path>
                  <text
                    class="relationship-label"
                    x=${path.labelX}
                    y=${path.labelY}
                    fill=${path.color}
                    transform=${`rotate(${path.labelAngle} ${path.labelX} ${path.labelY})`}
                    @mouseenter=${this.handleHighlightMouseEnter}
                    @mouseleave=${this.handleHighlightMouseLeave}
                    @contextmenu=${(e: MouseEvent) => this.handleRelationshipContextMenu(e, path.id)}
                  >${path.label}</text>
                `
              }
              return svg`
                <path 
                  class="relationship-path" 
                  d=${path.d} 
                  data-rel-id=${path.id} 
                  stroke=${path.color}
                  @mouseenter=${this.handleHighlightMouseEnter}
                  @mouseleave=${this.handleHighlightMouseLeave}
                  @contextmenu=${(e: MouseEvent) => this.handleRelationshipContextMenu(e, path.id)}
                ></path>
              `
            })}
          </svg>

          <!-- 虚拟列表层 （标注节点层） -->
          <div
            class="virtual-list-layer ${this.isHoveringHighlight || this.contextMenuVisible ? 'dimmed' : ''}"
            style="transform: translateY(${offsetTop}px);"
          >
            ${visibleLines.map(line => html`<div class="line">${this.renderLineContent(line)}</div>`)}
          </div>

          <!-- 编辑层 -->
          <div
            class="edit-layer ${this.editLayerVisible ? '' : 'hidden'}"
            style="left: ${this.editLayerPosition.x}px; top: ${this.editLayerPosition.y}px;"
          >
            <select required .value=${this.selectedAnnotationType} @change=${this.handleTypeSelectChange} @keydown=${this.handleInputKeyDown}>
              <option value="" disabled>选择类型</option>
              ${this.annotationType.map(type => html`<option value=${type.type} style="color: ${type.color}">${type.type}</option>`)}
            </select>
            <input
              type="text"
              .value=${this.editInputValue}
              @input=${this.handleInputChange}
              @keydown=${this.handleInputKeyDown}
              placeholder="输入描述（可选）"
            />
            <button @click=${this.handleConfirmEdit}>确认</button>
          </div>

          <!-- 右键菜单层 -->
          <div
            class="context-menu ${this.contextMenuVisible ? '' : 'hidden'}"
            style="left: ${this.contextMenuPosition.x}px; top: ${this.contextMenuPosition.y}px;"
            @click=${(e: MouseEvent) => e.stopPropagation()}
          >
            <button class="context-menu-item delete" @click=${this.handleDelete}>删除</button>
          </div>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ys-text-annotation': YsTextAnnotation
  }
}
