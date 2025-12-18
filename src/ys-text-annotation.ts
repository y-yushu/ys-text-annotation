import { LitElement, css, html, svg, unsafeCSS } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { mockContent } from './mock'
import styles from './index.css?inline'
import VirtualCore from './VirtualCore'
import type { HeightUpdate } from './VirtualCore'
import {
  getShadowDOMSelection,
  calculateEditLayerPosition,
  calculateContextMenuPosition,
  calculateEditLayerPositionFromPoint,
  measureLineHeight,
  getTextOffsetInLine,
  getAnnotationsByLineId,
  calculateSBezierCurvePath,
  calculateAnnotationToAnnotationConnection,
  calculateAsidePosition,
  calculateAnnotationKeyPoints,
  ConnectionDirection,
  type ConnectionDirectionType,
  hasOverlapWithAnnotations,
  getElementCenterPosition,
  findAnnotationElement,
  getGroupTooltip,
  getBottomPadding,
  updateGroupedAnnotations,
  getGroupColor,
  getAnnotationColor
} from './utils'
import type {
  LineItem,
  AnnotationType,
  AnnotationItem,
  RelationshipItem,
  RelationshipPath,
  SelectedTextInfo,
  ContextMenuTarget,
  RelationshipType
} from './types'
import {
  mockAnnotation,
  mockRelationship,
  defaultAnnotationTypes,
  defaultRelationshipTypes,
  FunctionMode,
  LayerDisplayMode,
  type FunctionModeType,
  type LayerDisplayModeType
} from './types'

// FIXME aside滚动还是有问题

@customElement('ys-text-annotation')
export class YsTextAnnotation extends LitElement {
  static styles = css`
    ${unsafeCSS(styles)}
  `

  @property()
  content = mockContent

  // 是否启用编辑
  @property({ type: Boolean })
  editingEnabled = true

  // 是否显示行号
  @property({ type: Boolean })
  showLineNumber = true

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

  // ==================== 虚拟列表核心 ====================

  /**
   * VirtualCore 实例，用于不定高虚拟列表计算
   */
  private virtualCore?: VirtualCore

  /**
   * VirtualCore 返回的 offset，用于定位 virtual-list-content
   */
  @state()
  private virtualListOffset = 0

  /**
   * VirtualCore 计算的总高度
   */
  @state()
  private virtualTotalHeight = 0

  @state()
  private annotationType: AnnotationType[] = defaultAnnotationTypes

  @state()
  private relationshipType: RelationshipType[] = defaultRelationshipTypes

  @state()
  private annotations: AnnotationItem[] = mockAnnotation

  @state()
  private relationships: RelationshipItem[] = mockRelationship

  @state()
  private relationshipPaths: RelationshipPath[] = []

  @state()
  private visibleLayerHeight = 0

  /**
   * 分组后的标注数据（按100份分组）
   * 格式：{ segmentIndex: number, annotations: AnnotationItem[], positionPercent: number }
   */
  @state()
  private groupedAnnotations: Array<{
    segmentIndex: number
    annotations: AnnotationItem[]
    positionPercent: number
  }> = []

  /**
   * 当前选中的标注分组（用于显示标注列表）
   */
  @state()
  private selectedGroup: {
    annotations: AnnotationItem[]
    positionPercent: number
    markerPosition: { x: number; y: number }
  } | null = null

  // ==================== 控制器状态 ====================

  /**
   * 功能模式状态
   * 控制当前组件处于什么功能状态
   */
  @state()
  private functionMode: FunctionModeType = FunctionMode.DEFAULT

  /**
   * 是否正在悬停高亮元素（标注或关系）
   */
  @state()
  private isHoveringHighlight = false

  /**
   * 是否正在选择文本
   */
  @state()
  private isSelectingText = false
  private mouseDownPosition = { x: 0, y: 0 }

  /**
   * 是否刚刚完成文本选择（用于防止文本选择后的点击事件关闭编辑层）
   */
  private justSelectedText = false

  // ==================== 编辑层相关状态 ====================

  @state()
  private editLayerPosition = { x: 0, y: 0 }

  @state()
  private editInputValue = ''

  @state()
  private selectedAnnotationType: string = ''

  private selectedTextInfo: SelectedTextInfo | null = null

  private savedRange: Range | null = null

  /**
   * 正在编辑的标注ID（编辑模式时使用）
   */
  private editingAnnotationId: string | null = null

  /**
   * 正在编辑的关系ID（编辑关系时使用）
   */
  private editingRelationshipId: string | null = null

  @state()
  private selectedRelationshipType: string = ''

  // ==================== 右键菜单相关状态 ====================

  @state()
  private contextMenuPosition = { x: 0, y: 0 }

  private contextMenuTarget: ContextMenuTarget | null = null

  // ==================== 关系创建相关状态 ====================

  @state()
  private relationshipStartAnnotationId: string | null = null

  @state()
  private tempRelationshipPath: { d: string; startPos: { x: number; y: number }; endPos: { x: number; y: number } } | null = null

  @state()
  private hoveredAnnotationId: string | null = null

  // ==================== 远程标注连接相关状态 ====================

  /**
   * 远程标注ID（用于记录第一个标注，等待连接第二个标注）
   */
  @state()
  private remoteAnnotationId: string | null = null

  // ==================== 计算属性 ====================

  /**
   * 计算属性：获取当前层级显示模式
   * 根据功能模式和悬停状态决定显示效果
   */
  private get layerDisplayMode(): LayerDisplayModeType {
    // 当以下情况时，突出显示标注关系：
    // - 鼠标移入关系或标注
    // - 开启右键菜单
    // - 开启创建关系功能
    if (this.isHoveringHighlight || this.functionMode === FunctionMode.CONTEXT_MENU_OPEN || this.functionMode === FunctionMode.CREATING_RELATIONSHIP) {
      return LayerDisplayMode.HIGHLIGHT_RELATIONSHIP
    }
    return LayerDisplayMode.HIGHLIGHT_VIRTUAL_LIST
  }

  /**
   * 便捷计算属性：编辑层是否可见
   */
  private get editLayerVisible(): boolean {
    return this.functionMode === FunctionMode.CREATING_ANNOTATION
  }

  /**
   * 便捷计算属性：是否正在编辑关系
   */
  private get isEditingRelationship(): boolean {
    return !!this.editingRelationshipId
  }

  /**
   * 便捷计算属性：右键菜单是否可见
   */
  private get contextMenuVisible(): boolean {
    return this.functionMode === FunctionMode.CONTEXT_MENU_OPEN
  }

  /**
   * 便捷计算属性：是否正在创建关系
   */
  private get isCreatingRelationship(): boolean {
    return this.functionMode === FunctionMode.CREATING_RELATIONSHIP
  }

  /**
   * 便捷计算属性：关系层是否激活（用于CSS类切换）
   */
  private get isRelationshipLayerActive(): boolean {
    return this.layerDisplayMode === LayerDisplayMode.HIGHLIGHT_RELATIONSHIP
  }

  private relationshipMouseMoveHandler?: (e: MouseEvent) => void
  private relationshipClickHandler?: (e: MouseEvent) => void
  private relationshipMoveAnimationFrame?: number

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
    // 确保分组数据已初始化
    this.updateGroupedAnnotations()
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
    // 清理关系创建相关的事件监听
    this.cancelRelationshipCreation()
  }

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    super.updated(changedProperties)
    // 当 content 属性从外部改变时，更新 lines
    if (changedProperties.has('content')) {
      this.updateLines()
      this.hasInitializedLines = true
    }

    // 当编辑状态关闭时，强制 functionMode 为 DEFAULT 并清理相关状态
    if (changedProperties.has('editingEnabled')) {
      if (!this.editingEnabled) {
        this.functionMode = FunctionMode.DEFAULT
        this.resetToDefaultMode()
      }
    }

    // 如果 editingEnabled 为 false，强制保持 DEFAULT 模式
    if (!this.editingEnabled && this.functionMode !== FunctionMode.DEFAULT) {
      this.functionMode = FunctionMode.DEFAULT
      this.resetToDefaultMode()
    }

    // 当 annotations 或 lines 变化时，更新分组
    if (changedProperties.has('annotations') || changedProperties.has('lines')) {
      this.updateGroupedAnnotations()
    }

    if (
      changedProperties.has('visibleStartIndex') ||
      changedProperties.has('visibleEndIndex') ||
      changedProperties.has('annotations') ||
      changedProperties.has('relationships')
    ) {
      this.scheduleMeasureRelationships()
    }

    // 当可见范围变化时，测量并更新高度（不定高虚拟列表核心逻辑）
    if (changedProperties.has('visibleStartIndex') || changedProperties.has('visibleEndIndex')) {
      // 使用 requestAnimationFrame 确保 DOM 已渲染
      requestAnimationFrame(() => {
        this.measureAndUpdateHeights()
      })
    }
  }

  firstUpdated() {
    this.scrollContainer = this.shadowRoot?.querySelector('.scroll-container') as HTMLElement
    if (!this.scrollContainer) return

    this.scrollContainer.addEventListener('scroll', () => this.handleScroll())
    // 确保在 updateVisibleRange 之前设置 containerHeight，这样 getTotalHeight 才能正确计算底部额外空间
    const clientHeight = this.scrollContainer.clientHeight
    if (clientHeight > 0 && clientHeight !== this.containerHeight) {
      this.containerHeight = clientHeight
    }

    // 初始化 VirtualCore
    this.initVirtualCore()

    // 监听文本选择事件（只处理左键）
    this.scrollContainer.addEventListener('mousedown', (e: MouseEvent) => {
      // 如果不在默认模式，不允许文本选择
      if (this.functionMode !== FunctionMode.DEFAULT) {
        return
      }
      // 只处理左键（button === 0），忽略右键和中键
      if (e.button === 0) {
        this.isSelectingText = true
        this.mouseDownPosition = { x: e.clientX, y: e.clientY }
      }
    })

    // 监听 mouseup 事件，获取选中的文本（只处理左键）
    this.scrollContainer.addEventListener('mouseup', (e: MouseEvent) => {
      // 如果不在默认模式，不允许文本选择
      if (this.functionMode !== FunctionMode.DEFAULT) {
        return
      }
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
          // 标记刚刚完成文本选择，防止后续的 click 事件关闭编辑层
          this.justSelectedText = true
          this.handleTextSelection()
          // 在下一个事件循环中重置标志，确保 editLayer 已经渲染
          setTimeout(() => {
            this.justSelectedText = false
          }, 0)
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
        this.measureLineHeight()
        this.updateVisibleRange() // containerHeight 会在 updateVisibleRange 中更新
        this.scheduleMeasureRelationships()
      }
    })
    this.resizeObserver.observe(this.scrollContainer)

    this.measureLineHeight()
    this.updateVisibleRange()
    this.scheduleMeasureRelationships()

    // 监听全局点击事件，关闭右键菜单和编辑层（只处理左键点击）
    document.addEventListener('click', (e: MouseEvent) => {
      // 只处理左键点击（button === 0），避免影响右键菜单
      if (e.button === 0) {
        // 如果刚刚完成文本选择，忽略这次点击（防止关闭刚打开的编辑层）
        if (this.justSelectedText) {
          return
        }

        // 关闭标注列表（如果点击的不是列表内的元素或标记）
        if (this.selectedGroup) {
          const annotationListPopup = this.shadowRoot?.querySelector('.annotation-list-popup') as HTMLElement
          const annotationMarkers = this.shadowRoot?.querySelectorAll('.annotation-marker') as NodeListOf<HTMLElement>
          if (annotationListPopup) {
            const path = e.composedPath()
            const clickedInPopup = path.includes(annotationListPopup) || path.some(node => node instanceof Node && annotationListPopup.contains(node))
            const clickedInMarker = Array.from(annotationMarkers).some(
              marker => path.includes(marker) || path.some(node => node instanceof Node && marker.contains(node))
            )

            // 如果点击的不是弹窗和标记，则关闭列表
            if (!clickedInPopup && !clickedInMarker) {
              this.closeAnnotationList()
            }
          }
        }

        // 关闭右键菜单
        if (this.functionMode === FunctionMode.CONTEXT_MENU_OPEN) {
          this.resetToDefaultMode()
          return
        }

        // 关闭编辑层（如果点击的不是 edit-layer 内的元素）
        if (this.functionMode === FunctionMode.CREATING_ANNOTATION) {
          const editLayer = this.shadowRoot?.querySelector('.edit-layer') as HTMLElement
          if (editLayer) {
            // 使用 composedPath() 来正确检测 Shadow DOM 中的点击目标
            const path = e.composedPath()
            // 检查点击路径中是否包含 edit-layer 或其子元素
            const clickedInEditLayer = path.includes(editLayer) || path.some(node => node instanceof Node && editLayer.contains(node))

            if (!clickedInEditLayer) {
              this.resetToDefaultMode()
            }
          }
        }
      }
    })
  }

  private updateLines() {
    const contentLines = this.content.split('\n')
    this.lines = contentLines.map((content, index) => ({
      id: index,
      content: content
    }))

    // 同步 VirtualCore 的总数
    if (this.virtualCore) {
      this.virtualCore.setTotal(this.lines.length)
    }

    if (this.scrollContainer) {
      this.measureLineHeight()
      this.updateVisibleRange()
    }
  }

  private measureLineHeight() {
    if (!this.scrollContainer) return
    this.lineHeight = measureLineHeight(this.scrollContainer)
  }

  /**
   * 初始化 VirtualCore 实例
   */
  private initVirtualCore() {
    if (this.virtualCore) return

    this.virtualCore = new VirtualCore({
      total: this.lines.length,
      defaultHeight: this.lineHeight,
      buffer: 5,
      onTotalHeightChange: (totalHeight: number) => {
        this.virtualTotalHeight = totalHeight
      }
    })

    // 初始化后立即获取总高度
    this.virtualTotalHeight = this.virtualCore.getTotalHeight()
  }

  /**
   * 测量可见行的实际高度并更新到 VirtualCore
   * 这是不定高虚拟列表的核心方法
   */
  private measureAndUpdateHeights() {
    if (!this.virtualCore || !this.scrollContainer) return

    // 查询 virtual-list-content 内的 line 元素
    const virtualListContent = this.shadowRoot?.querySelector('.virtual-list-content') as HTMLElement
    if (!virtualListContent) return

    const lineElements = virtualListContent.querySelectorAll('.line')
    const updates: HeightUpdate[] = []

    lineElements.forEach((el, i) => {
      const actualIndex = this.visibleStartIndex + i
      const actualHeight = (el as HTMLElement).offsetHeight

      // 只有当高度与预期不同时才更新
      const currentPosition = this.virtualCore!.getItemPosition(actualIndex)
      if (currentPosition && currentPosition.height !== actualHeight) {
        updates.push({ index: actualIndex, height: actualHeight })
      }
    })

    if (updates.length > 0) {
      const currentScrollTop = this.scrollContainer.scrollTop
      const { scrollCorrection } = this.virtualCore.updateHeights(updates, currentScrollTop)

      // 应用滚动修正，防止内容跳动
      if (scrollCorrection !== 0) {
        this.scrollContainer.scrollTop = currentScrollTop + scrollCorrection
      }

      // 高度更新后，重新计算可见范围
      this.updateVisibleRange()
    }
  }

  private handleScroll() {
    this.updateTimer && cancelAnimationFrame(this.updateTimer)
    this.updateTimer = requestAnimationFrame(() => {
      this.updateVisibleRange()
      // 如果编辑层可见，重新计算位置（仅创建模式，编辑模式不重新定位）
      if (this.editLayerVisible && this.savedRange && !this.editingAnnotationId) {
        this.updateEditLayerPosition()
      }
      // 滚动时，如果处于右键菜单或创建关系模式，重置到默认模式
      if (this.functionMode === FunctionMode.CONTEXT_MENU_OPEN || this.functionMode === FunctionMode.CREATING_RELATIONSHIP) {
        this.resetToDefaultMode()
      }
    })
  }

  private updateVisibleRange() {
    if (!this.scrollContainer) return

    // 始终更新 containerHeight，确保底部额外空间能正确计算
    const clientHeight = this.scrollContainer.clientHeight
    if (clientHeight > 0 && clientHeight !== this.containerHeight) {
      this.containerHeight = clientHeight
    }

    // 使用 VirtualCore 计算可见范围
    if (this.virtualCore) {
      const scrollTop = this.scrollContainer.scrollTop
      const viewHeight = this.scrollContainer.clientHeight

      const range = this.virtualCore.getRenderRange(scrollTop, viewHeight)

      this.visibleStartIndex = range.startIndex
      this.visibleEndIndex = range.endIndex
      this.virtualListOffset = range.offset
    }
  }

  /**
   * 计算已渲染标注的相对坐标，生成关系路径
   */
  /**
   * 根据标注ID查找其在 groupedAnnotations 中的位置百分比
   */
  private getAnnotationPositionPercent(annotationId: string): number | null {
    for (const group of this.groupedAnnotations) {
      if (group.annotations.some(ann => ann.id === annotationId)) {
        return group.positionPercent
      }
    }
    return null
  }

  /**
   * 根据位置百分比查找对应的标记元素
   */
  private findMarkerByPositionPercent(positionPercent: number, asideContainer: HTMLElement): HTMLElement | null {
    const markers = asideContainer.querySelectorAll('.annotation-marker')
    for (const marker of Array.from(markers) as HTMLElement[]) {
      // 获取标记的style.top值（百分比）
      const markerStyle = window.getComputedStyle(marker)
      const markerTopPercent = parseFloat(markerStyle.top)

      // 如果标记的位置百分比接近目标位置百分比（容差0.1%）
      if (Math.abs(markerTopPercent - positionPercent) < 0.1) {
        return marker
      }
    }
    return null
  }

  private measureRelationships() {
    if (!this.scrollContainer) return

    const virtualListLayer = this.shadowRoot?.querySelector('.virtual-list-layer') as HTMLElement
    const virtualListContent = this.shadowRoot?.querySelector('.virtual-list-content') as HTMLElement
    const asideContainer = this.shadowRoot?.querySelector('.aside-container') as HTMLElement

    // 获取 virtual-list-content 的实际高度，用于同步 SVG 层高度
    if (virtualListContent) {
      const actualHeight = virtualListContent.offsetHeight
      if (actualHeight > 0 && actualHeight !== this.visibleLayerHeight) {
        this.visibleLayerHeight = actualHeight
      }
    }

    if (!this.shadowRoot || !virtualListLayer || !asideContainer) {
      this.relationshipPaths = []
      return
    }

    const paths: RelationshipPath[] = []

    // 默认颜色
    const defaultColor = '#c12c1f'

    // 遍历所有关系
    for (const relationship of this.relationships) {
      const { id, startId, endId, type, color } = relationship
      const pathColor = color || defaultColor
      // 使用 type 作为标签显示文本
      const labelText = type || ''

      // 查找起点和终点的 line-highlight 元素
      const startElement = this.shadowRoot.querySelector(`[data-anno-id="anno-${startId}"]`) as HTMLElement
      const endElement = this.shadowRoot.querySelector(`[data-anno-id="anno-${endId}"]`) as HTMLElement

      let startPos: { x: number; y: number } | null = null
      let endPos: { x: number; y: number } | null = null
      let startDirection: ConnectionDirectionType | null = null
      let endDirection: ConnectionDirectionType | null = null

      // 情况1：标注与标注绘制
      if (startElement && endElement) {
        const connection = calculateAnnotationToAnnotationConnection(startElement, endElement, virtualListLayer)
        startPos = connection.startPos
        endPos = connection.endPos
        startDirection = connection.startDirection
        endDirection = connection.endDirection
      }
      // 情况2：标注与aside绘制（只存在起点标注）
      else if (startElement && !endElement) {
        // 标注端使用右侧垂直中心点
        const annotationPoints = calculateAnnotationKeyPoints(startElement, virtualListLayer)
        startPos = annotationPoints.rightCenter
        startDirection = ConnectionDirection.LEFT_TO_RIGHT_HORIZONTAL

        // aside端位置
        const endPositionPercent = this.getAnnotationPositionPercent(endId)
        if (endPositionPercent !== null) {
          // 查找对应的标记元素
          const markerElement = this.findMarkerByPositionPercent(endPositionPercent, asideContainer)
          const asidePos = calculateAsidePosition(endPositionPercent, this.scrollContainer!, asideContainer, virtualListLayer, markerElement)
          if (asidePos) {
            endPos = asidePos
            endDirection = ConnectionDirection.LEFT_TO_RIGHT_HORIZONTAL
          }
        }
      }
      // 情况3：标注与aside绘制（只存在终点标注）
      else if (!startElement && endElement) {
        // aside端位置
        const startPositionPercent = this.getAnnotationPositionPercent(startId)
        if (startPositionPercent !== null) {
          // 查找对应的标记元素
          const markerElement = this.findMarkerByPositionPercent(startPositionPercent, asideContainer)
          const asidePos = calculateAsidePosition(startPositionPercent, this.scrollContainer!, asideContainer, virtualListLayer, markerElement)
          if (asidePos) {
            startPos = asidePos
            // aside在右侧，标注在左侧，所以从aside出发应该是从右向左
            startDirection = ConnectionDirection.RIGHT_TO_LEFT_HORIZONTAL

            // 获取标注的所有关键点
            const annotationPoints = calculateAnnotationKeyPoints(endElement, virtualListLayer)

            // 根据aside和标注的垂直位置关系，选择合适的终点
            if (asidePos.y < annotationPoints.center.y) {
              // aside在标注上侧，使用标注的顶部中心点
              endPos = annotationPoints.topCenter
              endDirection = ConnectionDirection.TOP_TO_BOTTOM_VERTICAL
            } else {
              // aside在标注下侧，使用标注的底部中心点
              endPos = annotationPoints.bottomCenter
              endDirection = ConnectionDirection.BOTTOM_TO_TOP_VERTICAL
            }
          }
        }
      }

      // 如果起点或终点位置无法确定，跳过
      if (!startPos || !endPos || !startDirection || !endDirection) continue

      // 生成S形贝塞尔曲线路径，确保在连接点垂直
      const bezierResult = calculateSBezierCurvePath(startPos, endPos, startDirection, endDirection, labelText)
      paths.push({
        id,
        d: bezierResult.d,
        label: labelText,
        color: pathColor,
        labelX: bezierResult.labelX,
        labelY: bezierResult.labelY,
        labelAngle: bezierResult.labelAngle,
        startPos,
        endPos
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
    // 如果不在默认模式，不允许文本选择
    if (this.functionMode !== FunctionMode.DEFAULT) {
      return
    }

    // 如果 editingEnabled 为 false，不允许切换模式
    if (!this.editingEnabled) {
      this.savedRange = null
      return
    }

    // 如果 savedRange 不存在，直接返回
    if (!this.savedRange) {
      return
    }

    const range = this.savedRange

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

    // 找到 line-content 元素（实际包含文本内容的元素）
    const lineContentElement = lineElement.querySelector('.line-content') as HTMLElement
    if (!lineContentElement) return

    // 找到 line 在虚拟列表中的索引
    const lineParent = lineElement.parentElement
    if (!lineParent) return

    const lineIndexInView = Array.from(lineParent.children).indexOf(lineElement)
    const actualLineIndex = this.visibleStartIndex + lineIndexInView

    // 获取 line 的原始文本内容
    const lineContent = this.lines[actualLineIndex]?.content || ''
    if (!lineContent) return

    // 计算选中文本在 line-content 文本中的位置
    // 由于 line-content 中可能包含标注元素，我们需要找到选中文本在原始 lineContent 中的位置
    let startOffset = getTextOffsetInLine(lineContentElement, range.startContainer, range.startOffset)
    let endOffset = getTextOffsetInLine(lineContentElement, range.endContainer, range.endOffset)

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

    // 检查选中的文本是否与已标注的内容重叠
    if (hasOverlapWithAnnotations(actualLineIndex, startOffset, endOffset, this.annotations)) {
      // 如果与已标注内容重叠，不显示编辑层
      return
    }

    // 再次检查 editingEnabled，防止在异步回调中状态已改变
    if (!this.editingEnabled) {
      return
    }
    // 保存选中的文本信息
    this.selectedTextInfo = selectedTextInfo
    // 更新编辑层位置
    this.updateEditLayerPosition()
    // 重置编辑层状态
    this.editInputValue = ''
    this.selectedAnnotationType = ''
    // 切换到创建标注模式
    this.functionMode = FunctionMode.CREATING_ANNOTATION
  }

  /**
   * 根据标注信息创建 Range 对象（用于编辑标注时定位）
   */
  private createRangeFromAnnotation(annotation: AnnotationItem): Range | null {
    if (!this.shadowRoot) return null

    const virtualListLayer = this.shadowRoot.querySelector('.virtual-list-layer') as HTMLElement
    if (!virtualListLayer) return null

    // 检查标注所在的行是否在可视区域内
    if (annotation.lineId < this.visibleStartIndex || annotation.lineId > this.visibleEndIndex) {
      // 如果不在可视区域内，返回 null，将使用右键菜单位置作为回退
      return null
    }

    // 找到对应的行元素
    const lineIndexInView = annotation.lineId - this.visibleStartIndex
    const lineElements = virtualListLayer.querySelectorAll('.line')
    const lineElement = lineElements[lineIndexInView] as HTMLElement
    if (!lineElement) return null

    // 找到 line-content 元素
    const lineContentElement = lineElement.querySelector('.line-content') as HTMLElement
    if (!lineContentElement) return null

    // 创建 Range 对象
    const range = document.createRange()

    // 找到标注对应的文本节点和偏移量
    // 由于 line-content 中可能包含标注元素，需要遍历文本节点来计算正确的偏移量
    const walker = document.createTreeWalker(lineContentElement, NodeFilter.SHOW_TEXT, {
      acceptNode: node => {
        // 跳过标注描述文本
        const parent = node.parentElement
        if (parent?.classList.contains('line-highlight-desc')) {
          return NodeFilter.FILTER_REJECT
        }
        return NodeFilter.FILTER_ACCEPT
      }
    })

    let currentOffset = 0
    let startNode: Node | null = null
    let startOffset = 0
    let endNode: Node | null = null
    let endOffset = 0

    let node: Node | null
    while ((node = walker.nextNode())) {
      const nodeLength = node.textContent?.length || 0
      const nodeEndOffset = currentOffset + nodeLength

      // 设置 Range 的起始位置
      if (startNode === null && currentOffset <= annotation.start && annotation.start <= nodeEndOffset) {
        startNode = node
        startOffset = annotation.start - currentOffset
      }

      // 设置 Range 的结束位置
      if (currentOffset <= annotation.end && annotation.end <= nodeEndOffset) {
        endNode = node
        endOffset = annotation.end - currentOffset
        break
      }

      currentOffset = nodeEndOffset
    }

    // 如果找到了起始和结束节点，设置 Range
    if (startNode && endNode) {
      try {
        // 确保偏移量在有效范围内
        const startNodeLength = startNode.textContent?.length || 0
        const endNodeLength = endNode.textContent?.length || 0
        const safeStartOffset = Math.max(0, Math.min(startOffset, startNodeLength))
        const safeEndOffset = Math.max(0, Math.min(endOffset, endNodeLength))

        range.setStart(startNode, safeStartOffset)
        range.setEnd(endNode, safeEndOffset)
        return range
      } catch (e) {
        // 如果设置失败，返回 null
        return null
      }
    }

    return null
  }

  /**
   * 更新编辑层位置（用于滚动时重新定位）
   */
  private updateEditLayerPosition() {
    if (!this.scrollContainer) return

    const contentWrapper = this.shadowRoot?.querySelector('.content-wrapper') as HTMLElement
    if (!contentWrapper) return

    const mainContainer = this.shadowRoot?.querySelector('.main') as HTMLElement
    if (!mainContainer) return

    // 编辑模式：不需要重新定位，编辑层位置在初始化时已设置
    // 编辑标注时，编辑层位置固定，不随滚动改变
    if (this.editingAnnotationId) {
      return
    }

    // 创建模式：使用 Range 重新定位
    if (this.savedRange) {
      this.editLayerPosition = calculateEditLayerPosition(this.savedRange, this.scrollContainer, contentWrapper, mainContainer)
    }
  }

  /**
   * 处理确认按钮点击
   */
  private handleConfirmEdit() {
    // 判断是编辑关系还是编辑/创建标注
    if (this.isEditingRelationship && this.editingRelationshipId) {
      // 编辑关系
      const relationship = this.relationships.find(rel => rel.id === this.editingRelationshipId)
      if (relationship) {
        // 查找选中的关系类型对应的颜色
        const selectedTypeObj = this.relationshipType.find(type => type.type === this.selectedRelationshipType)
        const typeColor = selectedTypeObj?.color || relationship.color || '#c12c1f'

        const updatedRelationship: RelationshipItem = {
          ...relationship,
          type: this.selectedRelationshipType,
          description: this.editInputValue.trim(),
          color: typeColor
        }

        this.relationships = this.relationships.map(rel => (rel.id === updatedRelationship.id ? updatedRelationship : rel))
      }
      this.resetToDefaultMode()
      return
    }

    // 处理标注的创建/编辑
    // 验证下拉选择框是否已选择（必填）
    if (!this.selectedAnnotationType || !this.selectedTextInfo) {
      return
    }

    // 查找选中的类型对应的颜色
    const selectedTypeObj = this.annotationType.find(type => type.type === this.selectedAnnotationType)
    const typeColor = selectedTypeObj?.color || '#2d0bdf'

    const trimmedDescription = this.editInputValue.trim()

    // 判断是创建模式还是编辑模式（通过 editingAnnotationId 判断）
    const isEditing = !!this.editingAnnotationId

    if (isEditing && this.editingAnnotationId) {
      // 编辑模式：更新已有标注
      const updatedAnnotation: AnnotationItem = {
        id: this.editingAnnotationId,
        lineId: this.selectedTextInfo.lineId,
        start: this.selectedTextInfo.start,
        end: this.selectedTextInfo.end,
        content: this.selectedTextInfo.content,
        type: this.selectedAnnotationType,
        description: trimmedDescription,
        color: typeColor
      }
      this.annotations = this.annotations.map(ann => (ann.id === updatedAnnotation.id ? updatedAnnotation : ann))
    } else {
      // 创建模式：创建新标注
      const newId = `${Date.now()}`
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
      this.annotations = [...this.annotations, newAnnotation]
    }

    // 清除文本选择（使用 Shadow DOM 的选择）
    const selection = getShadowDOMSelection(this.shadowRoot)
    if (selection) {
      selection.removeAllRanges()
    } else {
      // 回退到全局选择清除（如果 Shadow DOM 选择不可用）
      window.getSelection()?.removeAllRanges()
    }

    // 隐藏编辑图层
    // 重置到默认模式
    this.resetToDefaultMode()
  }

  /**
   * 处理下拉选择框变化
   */
  private handleTypeSelectChange(e: Event) {
    const select = e.target as HTMLSelectElement
    if (this.isEditingRelationship) {
      this.selectedRelationshipType = select.value
    } else {
      this.selectedAnnotationType = select.value
    }
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
      // 按 Escape 重置到默认模式
      this.resetToDefaultMode()
    }
  }

  /**
   * 处理标注右键菜单
   */
  private handleAnnotationContextMenu(e: MouseEvent, annotationId: string) {
    // 如果正在创建关系，不允许右键菜单
    if (this.functionMode === FunctionMode.CREATING_RELATIONSHIP) {
      return
    }

    // 如果 editingEnabled 为 false，不允许切换模式
    if (!this.editingEnabled) {
      return
    }

    e.preventDefault()
    e.stopPropagation()

    // 重置文本选择状态，确保右键菜单可以正常显示
    this.isSelectingText = false

    const mainContainer = this.shadowRoot?.querySelector('.main') as HTMLElement
    if (!mainContainer) return

    this.contextMenuPosition = calculateContextMenuPosition(e, mainContainer, this.scrollContainer)

    this.contextMenuTarget = {
      type: 'annotation',
      id: annotationId
    }

    // 切换到右键菜单模式
    this.functionMode = FunctionMode.CONTEXT_MENU_OPEN
  }

  /**
   * 处理关系右键菜单
   */
  private handleRelationshipContextMenu(e: MouseEvent, relationshipId: string) {
    // 如果正在创建关系，不允许右键菜单
    if (this.functionMode === FunctionMode.CREATING_RELATIONSHIP) {
      return
    }

    // 如果 editingEnabled 为 false，不允许切换模式
    if (!this.editingEnabled) {
      return
    }

    e.preventDefault()
    e.stopPropagation()

    // 重置文本选择状态，确保右键菜单可以正常显示
    this.isSelectingText = false

    const mainContainer = this.shadowRoot?.querySelector('.main') as HTMLElement
    if (!mainContainer) return

    this.contextMenuPosition = calculateContextMenuPosition(e, mainContainer, this.scrollContainer)

    this.contextMenuTarget = {
      type: 'relationship',
      id: relationshipId
    }

    // 切换到右键菜单模式
    this.functionMode = FunctionMode.CONTEXT_MENU_OPEN
  }

  /**
   * 处理编辑关系操作
   */
  private handleEditRelationship() {
    if (!this.contextMenuTarget || this.contextMenuTarget.type !== 'relationship') {
      return
    }

    // 如果 editingEnabled 为 false，不允许切换模式
    if (!this.editingEnabled) {
      return
    }

    // 查找要编辑的关系
    const relationship = this.relationships.find(rel => rel.id === this.contextMenuTarget!.id)
    if (!relationship) {
      return
    }

    // 设置编辑状态
    this.editingRelationshipId = relationship.id
    this.selectedRelationshipType = relationship.type || ''
    this.editInputValue = relationship.description || ''

    // 保存右键菜单位置用于定位编辑层
    const menuPosition = { ...this.contextMenuPosition }

    // 清理右键菜单目标
    this.contextMenuTarget = null

    // 切换到创建/编辑标注模式（编辑层也用于关系编辑）
    this.functionMode = FunctionMode.CREATING_ANNOTATION

    // 使用工具函数计算编辑层位置，确保在可视范围内
    if (this.scrollContainer) {
      const contentWrapper = this.shadowRoot?.querySelector('.content-wrapper') as HTMLElement
      const mainContainer = this.shadowRoot?.querySelector('.main') as HTMLElement
      if (contentWrapper && mainContainer) {
        this.editLayerPosition = calculateEditLayerPositionFromPoint(menuPosition, this.scrollContainer, contentWrapper, mainContainer)
      } else {
        this.editLayerPosition = menuPosition
      }
    } else {
      this.editLayerPosition = menuPosition
    }
  }

  /**
   * 处理创建关系操作
   */
  private handleCreateRelationship() {
    if (!this.contextMenuTarget || this.contextMenuTarget.type !== 'annotation') {
      return
    }

    // 如果 editingEnabled 为 false，不允许切换模式
    if (!this.editingEnabled) {
      return
    }

    // 开始创建关系
    this.startRelationshipCreation(this.contextMenuTarget.id)
  }

  /**
   * 处理创建远程标注操作（记录第一个标注ID）
   */
  private handleCreateRemoteAnnotation() {
    if (!this.contextMenuTarget || this.contextMenuTarget.type !== 'annotation') {
      return
    }

    // 如果 editingEnabled 为 false，不允许切换模式
    if (!this.editingEnabled) {
      return
    }

    // 记录远程标注ID（去掉 'anno-' 前缀）
    const annotationId = this.contextMenuTarget.id.replace(/^anno-/, '')
    this.remoteAnnotationId = annotationId

    // 关闭右键菜单，重置到默认模式
    this.resetToDefaultMode()
  }

  /**
   * 处理取消记录远程标注操作
   */
  private handleCancelRemoteAnnotation() {
    // 清除远程标注ID
    this.remoteAnnotationId = null

    // 关闭右键菜单，重置到默认模式
    this.resetToDefaultMode()
  }

  /**
   * 处理连接远程标注操作（连接到之前记录的标注）
   */
  private handleConnectRemoteAnnotation() {
    if (!this.contextMenuTarget || this.contextMenuTarget.type !== 'annotation' || !this.remoteAnnotationId) {
      return
    }

    // 如果 editingEnabled 为 false，不允许切换模式
    if (!this.editingEnabled) {
      return
    }

    // 获取当前标注ID（去掉 'anno-' 前缀）
    const currentAnnotationId = this.contextMenuTarget.id.replace(/^anno-/, '')

    // 确保不是连接到自己
    if (currentAnnotationId === this.remoteAnnotationId) {
      // 重置远程标注ID
      this.remoteAnnotationId = null
      this.resetToDefaultMode()
      return
    }

    // 创建关系
    const defaultRelationshipType = this.relationshipType[0]
    const newRelationship: RelationshipItem = {
      id: `rel-${Date.now()}`,
      startId: this.remoteAnnotationId,
      endId: currentAnnotationId,
      type: defaultRelationshipType?.type || '',
      description: '',
      color: defaultRelationshipType?.color || '#c12c1f'
    }

    this.relationships = [...this.relationships, newRelationship]
    console.log('🚀 ~ YsTextAnnotation ~ handleConnectRemoteAnnotation ~ newRelationship:', newRelationship)

    // 清除远程标注ID
    this.remoteAnnotationId = null

    // 重置到默认模式
    this.resetToDefaultMode()
  }

  /**
   * 处理编辑标注操作
   */
  private handleEditAnnotation() {
    if (!this.contextMenuTarget || this.contextMenuTarget.type !== 'annotation') {
      return
    }

    // 如果 editingEnabled 为 false，不允许切换模式
    if (!this.editingEnabled) {
      return
    }

    // 查找要编辑的标注
    const annotation = this.annotations.find(ann => ann.id === this.contextMenuTarget!.id)
    if (!annotation) {
      return
    }

    // 设置编辑状态
    this.editingAnnotationId = annotation.id
    this.selectedAnnotationType = annotation.type
    this.editInputValue = annotation.description || ''

    // 创建 SelectedTextInfo 用于定位编辑层
    this.selectedTextInfo = {
      lineId: annotation.lineId,
      start: annotation.start,
      end: annotation.end,
      content: annotation.content
    }

    // 清理右键菜单目标
    this.contextMenuTarget = null

    // 切换到创建/编辑标注模式（先切换模式，让编辑层渲染）
    // 通过 editingAnnotationId 区分是新增还是编辑
    this.functionMode = FunctionMode.CREATING_ANNOTATION

    // 尝试根据标注信息创建 Range 对象，使用和新建标注相同的位置计算逻辑
    if (this.scrollContainer) {
      const contentWrapper = this.shadowRoot?.querySelector('.content-wrapper') as HTMLElement
      const mainContainer = this.shadowRoot?.querySelector('.main') as HTMLElement
      if (contentWrapper && mainContainer) {
        // 尝试根据标注信息创建 Range
        const range = this.createRangeFromAnnotation(annotation)
        if (range) {
          // 如果成功创建 Range，使用和新建标注相同的位置计算逻辑
          this.editLayerPosition = calculateEditLayerPosition(range, this.scrollContainer, contentWrapper, mainContainer)
          // 保存 Range，以便后续可能需要使用
          this.savedRange = range
        } else {
          // 如果无法创建 Range（例如标注不在可视区域内），回退到使用右键菜单位置
          const menuPosition = { ...this.contextMenuPosition }
          this.editLayerPosition = calculateEditLayerPositionFromPoint(menuPosition, this.scrollContainer, contentWrapper, mainContainer)
        }
      } else {
        // 如果没有 contentWrapper 或 mainContainer，使用右键菜单位置
        this.editLayerPosition = { ...this.contextMenuPosition }
      }
    } else {
      // 如果没有 scrollContainer，使用右键菜单位置
      this.editLayerPosition = { ...this.contextMenuPosition }
    }
  }

  /**
   * 处理删除操作
   */
  private handleDelete() {
    // 如果正在创建关系，不允许删除
    if (this.functionMode === FunctionMode.CREATING_RELATIONSHIP) {
      return
    }

    if (!this.contextMenuTarget) return

    if (this.contextMenuTarget.type === 'annotation') {
      // 删除标注
      const id = this.contextMenuTarget.id
      this.annotations = this.annotations.filter(annotation => annotation.id !== id)
      // 删除该标注关联的所有关系
      this.relationships = this.relationships.filter(relationship => relationship.startId !== id && relationship.endId !== id)
    } else if (this.contextMenuTarget.type === 'relationship') {
      // 删除关系
      const id = this.contextMenuTarget.id
      this.relationships = this.relationships.filter(relationship => relationship.id !== id)
    }

    // 关闭右键菜单
    // 重置到默认模式
    this.resetToDefaultMode()
  }

  /**
   * 开始创建关系（从右键菜单触发）
   */
  private startRelationshipCreation(annotationId: string) {
    // 如果 editingEnabled 为 false，不允许切换模式
    if (!this.editingEnabled || !this.scrollContainer) return

    // 确保 annotationId 不包含 'anno-' 前缀（统一格式）
    const normalizedAnnotationId = annotationId.replace(/^anno-/, '')

    const virtualListLayer = this.shadowRoot?.querySelector('.virtual-list-layer') as HTMLElement
    if (!virtualListLayer) return

    // 查找起点标注元素
    const startElement = this.shadowRoot?.querySelector(`[data-anno-id="anno-${normalizedAnnotationId}"]`) as HTMLElement
    if (!startElement) return

    // 获取起点位置
    const startPos = getElementCenterPosition(startElement, virtualListLayer)

    // 切换到创建关系模式
    this.functionMode = FunctionMode.CREATING_RELATIONSHIP
    this.relationshipStartAnnotationId = normalizedAnnotationId
    this.tempRelationshipPath = {
      d: '',
      startPos,
      endPos: startPos
    }

    // 清理右键菜单目标
    this.contextMenuTarget = null

    // 添加全局鼠标移动和点击事件监听
    this.relationshipMouseMoveHandler = (e: MouseEvent) => {
      // 使用 requestAnimationFrame 优化性能
      if (this.relationshipMoveAnimationFrame) {
        cancelAnimationFrame(this.relationshipMoveAnimationFrame)
      }
      this.relationshipMoveAnimationFrame = requestAnimationFrame(() => {
        this.handleRelationshipMouseMove(e)
        this.relationshipMoveAnimationFrame = undefined
      })
    }
    this.relationshipClickHandler = (e: MouseEvent) => {
      this.handleRelationshipClick(e)
    }

    document.addEventListener('mousemove', this.relationshipMouseMoveHandler)
    document.addEventListener('click', this.relationshipClickHandler, true) // 使用捕获阶段确保优先处理
  }

  /**
   * 处理关系创建时的鼠标移动
   */
  private handleRelationshipMouseMove(e: MouseEvent) {
    if (!this.isCreatingRelationship || !this.tempRelationshipPath || !this.scrollContainer) return

    const virtualListLayer = this.shadowRoot?.querySelector('.virtual-list-layer') as HTMLElement
    if (!virtualListLayer) return

    const layerRect = virtualListLayer.getBoundingClientRect()
    const mouseX = e.clientX - layerRect.left
    const mouseY = e.clientY - layerRect.top

    // 更新临时路径的终点位置（创建新对象以确保 Lit 检测到变化）
    const endPos = { x: mouseX, y: mouseY }

    // 计算直线路径（简单的 M x1 y1 L x2 y2 格式）
    const { startPos } = this.tempRelationshipPath
    const linePath = `M ${startPos.x} ${startPos.y} L ${endPos.x} ${endPos.y}`

    // 创建新的临时路径对象以确保状态更新
    this.tempRelationshipPath = {
      ...this.tempRelationshipPath,
      endPos,
      d: linePath
    }

    // 检查鼠标是否在标注节点上（使用 Shadow DOM 的 elementFromPoint）
    let elementUnderMouse: Element | null = null
    if (this.shadowRoot && typeof (this.shadowRoot as any).elementFromPoint === 'function') {
      elementUnderMouse = (this.shadowRoot as any).elementFromPoint(e.clientX, e.clientY)
    } else {
      // 回退到 document.elementFromPoint，然后检查是否在 Shadow DOM 中
      elementUnderMouse = document.elementFromPoint(e.clientX, e.clientY)
      if (elementUnderMouse) {
        const root = elementUnderMouse.getRootNode()
        if (root !== this.shadowRoot && root !== document) {
          elementUnderMouse = null
        }
      }
    }

    if (elementUnderMouse) {
      const annotationElement = findAnnotationElement(elementUnderMouse)
      if (annotationElement) {
        const annotationId = annotationElement.getAttribute('data-anno-id')?.replace('anno-', '')
        if (annotationId && annotationId !== this.relationshipStartAnnotationId) {
          this.hoveredAnnotationId = annotationId
        } else {
          this.hoveredAnnotationId = null
        }
      } else {
        this.hoveredAnnotationId = null
      }
    } else {
      this.hoveredAnnotationId = null
    }
  }

  /**
   * 处理关系创建时的点击事件
   */
  private handleRelationshipClick(e: MouseEvent) {
    if (!this.isCreatingRelationship || !this.relationshipStartAnnotationId) {
      return
    }

    // 阻止事件冒泡，避免触发其他点击事件
    e.preventDefault()
    e.stopPropagation()

    // 检查点击是否在标注节点上（使用 Shadow DOM 的 elementFromPoint）
    let elementUnderMouse: Element | null = null
    if (this.shadowRoot && typeof (this.shadowRoot as any).elementFromPoint === 'function') {
      elementUnderMouse = (this.shadowRoot as any).elementFromPoint(e.clientX, e.clientY)
    } else {
      // 回退到 document.elementFromPoint，然后检查是否在 Shadow DOM 中
      elementUnderMouse = document.elementFromPoint(e.clientX, e.clientY)
      if (elementUnderMouse) {
        const root = elementUnderMouse.getRootNode()
        if (root !== this.shadowRoot && root !== document) {
          elementUnderMouse = null
        }
      }
    }

    if (elementUnderMouse) {
      const annotationElement = findAnnotationElement(elementUnderMouse)
      if (annotationElement) {
        const endAnnotationId = annotationElement.getAttribute('data-anno-id')?.replace('anno-', '')
        if (endAnnotationId && endAnnotationId !== this.relationshipStartAnnotationId) {
          // 创建成功
          this.completeRelationshipCreation(endAnnotationId)
          return
        }
      }
    }

    // 点击不在标注上，重置到默认模式
    this.resetToDefaultMode()
  }

  /**
   * 完成关系创建
   */
  private completeRelationshipCreation(endAnnotationId: string) {
    if (!this.relationshipStartAnnotationId) return

    // 确保 endAnnotationId 不包含 'anno-' 前缀（统一格式）
    // endAnnotationId 已经在 handleRelationshipClick 中去掉了前缀，但为了安全起见再次确保
    const normalizedEndId = endAnnotationId.replace(/^anno-/, '')

    // 查找默认关系类型
    const defaultRelationshipType = this.relationshipType[0]
    const newRelationship: RelationshipItem = {
      id: `rel-${Date.now()}`,
      startId: this.relationshipStartAnnotationId, // 已经在 startRelationshipCreation 中规范化
      endId: normalizedEndId,
      type: defaultRelationshipType?.type || '',
      description: '',
      color: defaultRelationshipType?.color || '#c12c1f'
    }

    this.relationships = [...this.relationships, newRelationship]
    console.log('🚀 ~ YsTextAnnotation ~ completeRelationshipCreation ~ newRelationship:', newRelationship)
    // 重置到默认模式
    this.resetToDefaultMode()
  }

  /**
   * 取消关系创建（清理关系创建相关状态和事件监听）
   */
  private cancelRelationshipCreation() {
    this.relationshipStartAnnotationId = null
    this.tempRelationshipPath = null
    this.hoveredAnnotationId = null

    if (this.relationshipMoveAnimationFrame) {
      cancelAnimationFrame(this.relationshipMoveAnimationFrame)
      this.relationshipMoveAnimationFrame = undefined
    }

    if (this.relationshipMouseMoveHandler) {
      document.removeEventListener('mousemove', this.relationshipMouseMoveHandler)
      this.relationshipMouseMoveHandler = undefined
    }

    if (this.relationshipClickHandler) {
      document.removeEventListener('click', this.relationshipClickHandler, true)
      this.relationshipClickHandler = undefined
    }
  }

  /**
   * 重置到默认模式（清理所有功能相关状态）
   */
  private resetToDefaultMode() {
    // 清理编辑层相关状态
    this.selectedTextInfo = null
    this.savedRange = null
    this.editInputValue = ''
    this.selectedAnnotationType = ''
    this.selectedRelationshipType = ''
    this.justSelectedText = false
    this.editingAnnotationId = null
    this.editingRelationshipId = null

    // 清理右键菜单相关状态
    this.contextMenuTarget = null

    // 清理关系创建相关状态和事件监听
    this.cancelRelationshipCreation()

    // 重置功能模式到默认
    this.functionMode = FunctionMode.DEFAULT
  }

  /**
   * 渲染行内容，如果有标注则高亮显示
   */
  private _renderLineContent(line: LineItem): string | ReturnType<typeof html> {
    // 只在创建标注模式（新增）时显示选中文本的高亮，编辑模式不显示（通过 editingAnnotationId 判断）
    const isEditingThisLine = !!(
      this.functionMode === FunctionMode.CREATING_ANNOTATION &&
      !this.editingAnnotationId &&
      this.selectedTextInfo &&
      this.selectedTextInfo.lineId === line.id
    )

    // 高亮项类型
    interface HighlightItem {
      start: number
      end: number
      content: string
      type: 'annotation' | 'editing'
      annotation?: AnnotationItem
    }

    const lineAnnotations = getAnnotationsByLineId(this.annotations, line.id)

    // 如果没有标注且没有正在编辑的选中文本，直接返回原文本
    if (lineAnnotations.length === 0 && !isEditingThisLine) {
      return line.content || '\u00A0'
    }

    // 按start位置排序标注，确保按顺序处理
    const sortedAnnotations = [...lineAnnotations].sort((a, b) => a.start - b.start)

    // 构建高亮后的内容片段
    const fragments: Array<string | ReturnType<typeof html>> = []
    let lastIndex = 0

    // 合并标注和正在编辑的选中文本，统一处理
    const allHighlights: HighlightItem[] = []

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

          // 判断是否需要高亮（起点标注或悬停的标注）
          const isStartAnnotation = this.relationshipStartAnnotationId === annotation.id
          const isHoveredAnnotation = this.hoveredAnnotationId === annotation.id
          const highlightClass = isStartAnnotation ? ' creating-relationship-start' : isHoveredAnnotation ? ' creating-relationship-hover' : ''

          fragments.push(
            html`<span
              class="line-highlight${editingClass}${highlightClass}"
              data-anno-id=${`anno-${annotation.id}`}
              style=${styleAttr}
              @mouseenter=${() => this.handleHighlightMouseEnter()}
              @mouseleave=${() => this.handleHighlightMouseLeave()}
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

  /**
   * 将标注按100份分组
   * 为了性能考虑，只在 lines 或 annotations 变化时调用，不在 render 中计算
   */
  private updateGroupedAnnotations() {
    this.groupedAnnotations = updateGroupedAnnotations(this.lines, this.annotations)
  }

  /**
   * 处理标注标记点击，显示标注列表
   * @param e 点击事件
   * @param annotations 标注组
   * @param positionPercent 位置百分比
   */
  private handleMarkerClick(e: MouseEvent, annotations: AnnotationItem[], positionPercent: number) {
    e.stopPropagation()
    if (annotations.length === 0) return

    // 获取标记元素的位置
    const markerElement = e.currentTarget as HTMLElement
    const asideContainer = markerElement.closest('.aside-container') as HTMLElement
    if (!asideContainer) return

    // 获取标记和容器的实际屏幕位置
    const markerRect = markerElement.getBoundingClientRect()
    const containerRect = asideContainer.getBoundingClientRect()

    // 计算弹窗位置：相对于 aside-container
    const popupWidth = 300 // 弹窗宽度
    const popupMaxHeight = 400 // 弹窗最大高度
    const gap = 8 // 标记和弹窗之间的间距

    // 计算标记中心相对于 aside-container 的位置
    const markerCenterY = markerRect.top - containerRect.top + markerRect.height / 2

    // 初始位置：显示在标记右侧
    let popupX = containerRect.width + gap
    let popupY = markerCenterY

    // 确保弹窗在可视区域内
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth

    // 计算弹窗在屏幕上的实际位置
    const popupScreenTop = containerRect.top + popupY - popupMaxHeight / 2
    const popupScreenBottom = containerRect.top + popupY + popupMaxHeight / 2
    const popupScreenRight = containerRect.left + popupX + popupWidth

    // 如果弹窗超出视口上方，调整位置
    if (popupScreenTop < 0) {
      popupY = popupMaxHeight / 2
    }

    // 如果弹窗超出视口下方，调整位置
    if (popupScreenBottom > viewportHeight) {
      popupY = containerRect.height - popupMaxHeight / 2
      // 确保不会小于最小值
      if (popupY < popupMaxHeight / 2) {
        popupY = popupMaxHeight / 2
      }
    }

    // 如果弹窗超出视口右侧，显示在标记左侧
    if (popupScreenRight > viewportWidth) {
      popupX = -popupWidth - gap // 显示在标记左侧
    }

    // 如果点击的是同一个分组，则关闭列表
    // 使用 positionPercent 比较而不是数组引用，因为 updateGroupedAnnotations 会创建新的数组实例
    if (this.selectedGroup && this.selectedGroup.positionPercent === positionPercent) {
      this.selectedGroup = null
    } else {
      // 显示标注列表
      this.selectedGroup = {
        annotations,
        positionPercent,
        markerPosition: {
          x: popupX,
          y: popupY
        }
      }
    }
  }

  /**
   * 关闭标注列表
   */
  private closeAnnotationList() {
    this.selectedGroup = null
  }

  /**
   * 跳转到指定标注的位置
   * 使用 VirtualCore.scrollToIndex 进行迭代收敛式精确跳转
   * @param annotation 标注项
   */
  private jumpToAnnotation(annotation: AnnotationItem) {
    if (!this.scrollContainer || !this.virtualCore) return

    const targetLineId = annotation.lineId

    // 使用 VirtualCore 的迭代收敛式跳转
    this.virtualCore.scrollToIndex(targetLineId, {
      onScroll: (targetTop: number) => {
        this.scrollContainer!.scrollTo({
          top: Math.max(0, targetTop),
          behavior: 'smooth'
        })
      },
      onComplete: () => {
        // 跳转完成后关闭列表
        this.closeAnnotationList()
      },
      onAbort: () => {
        // 即使跳转被中断，也关闭列表
        this.closeAnnotationList()
      }
    })
  }

  /**
   * 获取标注在虚拟列表中的相关关系
   * 只返回另一端标注在虚拟列表渲染范围内的关系
   * @param annotationId 标注ID
   * @returns 关系数组，每项包含关系和对应的标注
   */
  private getVisibleRelationships(
    annotationId: string
  ): Array<{ relationship: RelationshipItem; relatedAnnotation: AnnotationItem; direction: 'start' | 'end' }> {
    const result: Array<{ relationship: RelationshipItem; relatedAnnotation: AnnotationItem; direction: 'start' | 'end' }> = []

    // 遍历所有关系
    for (const relationship of this.relationships) {
      let relatedAnnotationId: string | null = null
      let direction: 'start' | 'end' | null = null

      // 判断当前标注在关系中的位置
      if (relationship.startId === annotationId) {
        relatedAnnotationId = relationship.endId
        direction = 'end' // 当前标注是起点，关联标注是终点
      } else if (relationship.endId === annotationId) {
        relatedAnnotationId = relationship.startId
        direction = 'start' // 当前标注是终点，关联标注是起点
      }

      // 如果当前标注不在这个关系中，跳过
      if (!relatedAnnotationId || !direction) continue

      // 查找关联的标注
      const relatedAnnotation = this.annotations.find(ann => ann.id === relatedAnnotationId)
      if (!relatedAnnotation) continue

      // 检查关联标注是否在当前虚拟列表渲染范围内
      if (relatedAnnotation.lineId >= this.visibleStartIndex && relatedAnnotation.lineId <= this.visibleEndIndex) {
        result.push({
          relationship,
          relatedAnnotation,
          direction
        })
      }
    }

    return result
  }

  render() {
    const visibleLines = this.lines.slice(this.visibleStartIndex, this.visibleEndIndex + 1)
    // 使用 VirtualCore 计算的总高度，回退到预估高度
    const totalHeight = this.virtualTotalHeight || this.lines.length * this.lineHeight
    const bottomPadding = getBottomPadding(this.containerHeight)
    // 使用 VirtualCore 返回的 offset
    const offsetTop = this.virtualListOffset
    // 使用实际测量的 virtual-list-layer 高度，初始渲染时使用计算值作为回退
    const visibleHeight = this.visibleLayerHeight > 0 ? this.visibleLayerHeight : visibleLines.length * this.lineHeight

    return html`
      <div class="main">
        <div class="scroll-container" @scroll=${this.handleScroll}>
          <div class="content-wrapper" style="height: ${totalHeight}px;">
            <!-- SVG 关系层：与 virtual-list-layer 完全重叠 -->
            <svg
              class="relationship-layer ${this.isRelationshipLayerActive ? 'highlighted' : ''} ${this.isSelectingText ? 'selecting-text' : ''}"
              style="transform: translateY(${offsetTop}px); height: ${visibleHeight}px;"
              overflow="visible"
            >
              <defs>
                ${this.relationshipPaths.map(path => {
                  // 为每个路径生成唯一的marker ID
                  const endMarkerId = `arrowhead-end-${path.id}`
                  const startMarkerId = `arrowhead-start-${path.id}`

                  return svg`
                    <marker
                      id=${endMarkerId}
                      markerWidth="6"
                      markerHeight="6"
                      refX="3"
                      refY="3"
                      orient="auto"
                    >
                      <circle 
                        cx="3" 
                        cy="3" 
                        r="2.5" 
                        fill="none" 
                        stroke=${path.color}
                        stroke-width="1.5"
                      />
                    </marker>
                    <marker
                      id=${startMarkerId}
                      markerWidth="10"
                      markerHeight="10"
                      refX="1"
                      refY="3"
                      orient="auto"
                    >
                      <circle cx="3" cy="3" r="2.5" fill=${path.color} />
                    </marker>
                  `
                })}
              </defs>
              ${this.relationshipPaths.map(path => {
                // 为每个路径生成唯一的marker ID
                const endMarkerId = `arrowhead-end-${path.id}`
                const startMarkerId = `arrowhead-start-${path.id}`

                if (path.label && path.labelX !== undefined && path.labelY !== undefined && path.labelAngle !== undefined) {
                  return svg`
                    <path
                      class="relationship-path"
                      d=${path.d}
                      data-rel-id=${path.id}
                      stroke=${path.color}
                      marker-end=${`url(#${endMarkerId})`}
                      marker-start=${`url(#${startMarkerId})`}
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
                    marker-end=${`url(#${endMarkerId})`}
                    marker-start=${`url(#${startMarkerId})`}
                    @mouseenter=${this.handleHighlightMouseEnter}
                    @mouseleave=${this.handleHighlightMouseLeave}
                    @contextmenu=${(e: MouseEvent) => this.handleRelationshipContextMenu(e, path.id)}
                  ></path>
                `
              })}
              ${this.tempRelationshipPath
                ? svg`<path
                  class="relationship-path temp-relationship-path"
                  d=${this.tempRelationshipPath.d}
                  stroke="#c12c1f"
                  stroke-dasharray="5,5"
                  opacity="0.6"
                ></path>`
                : null}
            </svg>

            <!-- 虚拟列表层 （标注节点层） -->
            <div class="virtual-list-layer ${this.isRelationshipLayerActive ? 'dimmed' : ''}">
              <!-- 内层包裹，应用 VirtualCore 返回的 offset 偏移 -->
              <div class="virtual-list-content" style="transform: translateY(${offsetTop}px); padding-bottom: ${bottomPadding}px;">
                ${visibleLines.map(
                  line => html`
                    <div class="line">
                      ${this.showLineNumber ? html`<span class="line-number">${line.id + 1}</span>` : null}
                      <span class="line-content">${this._renderLineContent(line)}</span>
                    </div>
                  `
                )}
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧aside -->
        <div class="aside-container">
          ${this.groupedAnnotations.map(
            group => html`
              <div
                class="annotation-marker ${group.annotations.length > 1 ? 'merged' : ''} ${this.selectedGroup?.positionPercent === group.positionPercent
                  ? 'selected'
                  : ''}"
                style="top: ${group.positionPercent}%; background-color: ${getGroupColor(group.annotations, this.annotationType)};"
                title="${getGroupTooltip(group.annotations)}"
                @click=${(e: MouseEvent) => this.handleMarkerClick(e, group.annotations, group.positionPercent)}
              >
                <span class="annotation-marker-count">${group.annotations.length}</span>
              </div>
            `
          )}
          ${this.selectedGroup
            ? html`
                <div class="annotation-list-popup" style="left: ${this.selectedGroup.markerPosition.x}px; top: ${this.selectedGroup.markerPosition.y}px;">
                  <div class="annotation-list-header">
                    <span class="annotation-list-title">标注列表 (${this.selectedGroup.annotations.length})</span>
                    <button class="annotation-list-close" @click=${() => this.closeAnnotationList()} title="关闭">×</button>
                  </div>
                  <div class="annotation-list-content">
                    ${this.selectedGroup.annotations
                      .sort((a, b) => a.lineId - b.lineId)
                      .map(annotation => {
                        // 获取该标注在虚拟列表中的相关关系
                        const visibleRelations = this.getVisibleRelationships(annotation.id)

                        return html`
                          <div class="annotation-list-item-wrapper">
                            <div
                              class="annotation-list-item"
                              @click=${() => this.jumpToAnnotation(annotation)}
                              title="点击跳转到行号 ${annotation.lineId + 1}"
                            >
                              <div class="annotation-list-item-line">
                                <span class="annotation-list-line-number">${annotation.lineId + 1}</span>
                                <span class="annotation-list-type" style="background-color: ${getAnnotationColor(annotation, this.annotationType)};"
                                  >${annotation.type}</span
                                >
                              </div>
                              <div class="annotation-list-item-content">${annotation.content}</div>
                              ${annotation.description ? html`<div class="annotation-list-item-desc">${annotation.description}</div>` : null}
                            </div>

                            ${visibleRelations.length > 0
                              ? html`
                                  <div class="annotation-list-relations">
                                    ${visibleRelations.map(
                                      ({ relationship, relatedAnnotation, direction }) => html`
                                        <div class="annotation-list-relation-item">
                                          <div class="annotation-list-relation-arrow" style="color: ${relationship.color || '#c12c1f'};">
                                            ${direction === 'end' ? '→' : '←'}
                                          </div>
                                          <div class="annotation-list-relation-info">
                                            ${relationship.type
                                              ? html`<span class="annotation-list-relation-type" style="color: ${relationship.color || '#c12c1f'};"
                                                  >${relationship.type}</span
                                                >`
                                              : null}
                                            <div class="annotation-list-relation-target">
                                              <span class="annotation-list-relation-line-number">${relatedAnnotation.lineId + 1}</span>
                                              <span
                                                class="annotation-list-relation-content"
                                                style="border-left-color: ${getAnnotationColor(relatedAnnotation, this.annotationType)};"
                                                >${relatedAnnotation.content}</span
                                              >
                                            </div>
                                          </div>
                                        </div>
                                      `
                                    )}
                                  </div>
                                `
                              : null}
                          </div>
                        `
                      })}
                  </div>
                </div>
              `
            : null}
        </div>

        <!-- 编辑层 -->
        ${this.editLayerVisible
          ? html`<div class="edit-layer" style="left: ${this.editLayerPosition.x}px; top: ${this.editLayerPosition.y}px;">
              ${this.isEditingRelationship
                ? html`
                    <select required .value=${this.selectedRelationshipType} @change=${this.handleTypeSelectChange} @keydown=${this.handleInputKeyDown}>
                      <option value="" disabled>选择关系类型</option>
                      ${this.relationshipType.map(type => html`<option value=${type.type} style="color: ${type.color}">${type.type}</option>`)}
                    </select>
                    <input
                      type="text"
                      .value=${this.editInputValue}
                      @input=${this.handleInputChange}
                      @keydown=${this.handleInputKeyDown}
                      placeholder="输入描述（可选）"
                    />
                    <button @click=${this.handleConfirmEdit}>确认</button>
                  `
                : html`
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
                  `}
            </div>`
          : null}

        <!-- 右键菜单层 -->
        ${this.contextMenuVisible
          ? (() => {
              // 获取当前右键的标注信息（用于显示按钮文本）
              let currentAnnotation: AnnotationItem | undefined
              let remoteAnnotation: AnnotationItem | undefined
              let isCurrentRemote = false

              if (this.contextMenuTarget?.type === 'annotation') {
                const currentId = this.contextMenuTarget.id.replace(/^anno-/, '')
                currentAnnotation = this.annotations.find(ann => ann.id === currentId)

                if (this.remoteAnnotationId) {
                  remoteAnnotation = this.annotations.find(ann => ann.id === this.remoteAnnotationId)
                  isCurrentRemote = currentId === this.remoteAnnotationId
                }
              }

              return html`<div
                class="context-menu"
                style="left: ${this.contextMenuPosition.x}px; top: ${this.contextMenuPosition.y}px;"
                @click=${(e: MouseEvent) => e.stopPropagation()}
              >
                ${this.contextMenuTarget?.type === 'annotation'
                  ? html`
                      <button class="context-menu-item create-relationship" @click=${this.handleCreateRelationship}>创建关系</button>
                      ${!this.remoteAnnotationId
                        ? html`<button class="context-menu-item create-remote-annotation" @click=${this.handleCreateRemoteAnnotation}>
                            记录<span style="color: ${currentAnnotation?.color || '#2d0bdf'}">${currentAnnotation?.content || '标注'}</span>
                          </button>`
                        : isCurrentRemote
                          ? html`<button class="context-menu-item cancel-remote-annotation" @click=${this.handleCancelRemoteAnnotation}>取消记录</button>`
                          : html`<button class="context-menu-item connect-remote-annotation" @click=${this.handleConnectRemoteAnnotation}>
                              连接<span style="color: ${remoteAnnotation?.color || '#2d0bdf'}">${remoteAnnotation?.content || '标注'}</span>
                            </button>`}
                      <button class="context-menu-item edit-annotation" @click=${this.handleEditAnnotation}>编辑标注</button>
                    `
                  : null}
                ${this.contextMenuTarget?.type === 'relationship'
                  ? html`<button class="context-menu-item edit-relationship" @click=${this.handleEditRelationship}>编辑关系</button>`
                  : null}
                <button class="context-menu-item delete" @click=${this.handleDelete}>删除</button>
              </div>`
            })()
          : null}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ys-text-annotation': YsTextAnnotation
  }
}
