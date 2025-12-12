import { LitElement, css, html, svg, unsafeCSS } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { mockContent } from './mock'
import styles from './index.css?inline'
import {
  getShadowDOMSelection,
  calculateEditLayerPosition,
  calculateContextMenuPosition,
  calculateEditLayerPositionFromPoint,
  measureLineHeight
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
  VIRTUAL_LIST_CONFIG,
  FunctionMode,
  LayerDisplayMode,
  type FunctionModeType,
  type LayerDisplayModeType
} from './types'
import { renderLineContent } from './render-helpers'
import { measureRelationships } from './relationship-measurer'
import { updateVisibleRange, getTotalHeight, getOffsetTop } from './virtual-list'
import { handleTextSelection, handleConfirmEdit, handleDelete } from './event-handlers'

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
    // 确保在 updateVisibleRange 之前设置 containerHeight，这样 getTotalHeight 才能正确计算底部额外空间
    const clientHeight = this.scrollContainer.clientHeight
    if (clientHeight > 0 && clientHeight !== this.containerHeight) {
      this.containerHeight = clientHeight
    }

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

    const result = updateVisibleRange({
      scrollContainer: this.scrollContainer,
      lines: this.lines,
      lineHeight: this.lineHeight,
      containerHeight: this.containerHeight
    })

    if (result) {
      this.visibleStartIndex = result.visibleStartIndex
      this.visibleEndIndex = result.visibleEndIndex
    }
  }

  private getTotalHeight(): number {
    return getTotalHeight(this.lines.length, this.lineHeight)
  }

  private getBottomPadding(): number {
    return this.containerHeight * VIRTUAL_LIST_CONFIG.BOTTOM_EXTRA_RATIO
  }

  private getOffsetTop(index: number): number {
    return getOffsetTop(index, this.lineHeight)
  }

  /**
   * 计算已渲染标注的相对坐标，生成关系路径
   */
  private measureRelationships() {
    if (!this.scrollContainer) return

    const virtualListLayer = this.shadowRoot?.querySelector('.virtual-list-layer') as HTMLElement

    // 获取 virtual-list-layer 的实际高度，用于同步 SVG 层高度
    if (virtualListLayer) {
      const actualHeight = virtualListLayer.offsetHeight
      if (actualHeight > 0 && actualHeight !== this.visibleLayerHeight) {
        this.visibleLayerHeight = actualHeight
      }
    }

    const paths = measureRelationships({
      relationships: this.relationships,
      shadowRoot: this.shadowRoot,
      virtualListLayer
    })

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

    handleTextSelection({
      savedRange: this.savedRange,
      shadowRoot: this.shadowRoot,
      visibleStartIndex: this.visibleStartIndex,
      lines: this.lines,
      annotations: this.annotations,
      onSelectionProcessed: (info: SelectedTextInfo) => {
        this.selectedTextInfo = info
      },
      onEditLayerPositionUpdate: () => {
        this.updateEditLayerPosition()
      },
      onEditLayerShow: () => {
        // 再次检查 editingEnabled，防止在异步回调中状态已改变
        if (!this.editingEnabled) {
          return
        }
        this.editInputValue = ''
        this.selectedAnnotationType = ''
        // 切换到创建标注模式
        this.functionMode = FunctionMode.CREATING_ANNOTATION
      },
      onFocusSelect: () => {
        this.updateComplete.then(() => {
          const select = this.shadowRoot?.querySelector('.edit-layer select') as HTMLSelectElement
          if (select) {
            select.focus()
          }
        })
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
    // 判断是创建模式还是编辑模式（通过 editingAnnotationId 判断）
    const isEditing = !!this.editingAnnotationId

    handleConfirmEdit({
      selectedAnnotationType: this.selectedAnnotationType,
      selectedTextInfo: this.selectedTextInfo,
      editInputValue: this.editInputValue,
      annotationTypes: this.annotationType,
      shadowRoot: this.shadowRoot,
      isEditing: !!isEditing,
      editingAnnotationId: this.editingAnnotationId || undefined,
      onAnnotationCreated: (annotation: AnnotationItem) => {
        this.annotations = [...this.annotations, annotation]
      },
      onAnnotationUpdated: (updatedAnnotation: AnnotationItem) => {
        this.annotations = this.annotations.map(ann => (ann.id === updatedAnnotation.id ? updatedAnnotation : ann))
      },
      onEditLayerHide: () => {
        // 重置到默认模式
        this.resetToDefaultMode()
      }
    })
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

    const contentWrapper = this.shadowRoot?.querySelector('.content-wrapper') as HTMLElement
    if (!contentWrapper) return

    this.contextMenuPosition = calculateContextMenuPosition(e, contentWrapper, this.scrollContainer)

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

    const contentWrapper = this.shadowRoot?.querySelector('.content-wrapper') as HTMLElement
    if (!contentWrapper) return

    this.contextMenuPosition = calculateContextMenuPosition(e, contentWrapper, this.scrollContainer)

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
      if (contentWrapper) {
        this.editLayerPosition = calculateEditLayerPositionFromPoint(menuPosition, this.scrollContainer, contentWrapper)
      } else {
        this.editLayerPosition = menuPosition
      }
    } else {
      this.editLayerPosition = menuPosition
    }

    // 聚焦到选择框
    this.updateComplete.then(() => {
      const select = this.shadowRoot?.querySelector('.edit-layer select') as HTMLSelectElement
      if (select) {
        select.focus()
      }
    })
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

    // 清理右键菜单目标（先清理，避免影响后续查找）
    const annotationIdToEdit = this.contextMenuTarget.id
    this.contextMenuTarget = null

    // 切换到创建/编辑标注模式（先切换模式，让编辑层渲染）
    // 通过 editingAnnotationId 区分是新增还是编辑
    this.functionMode = FunctionMode.CREATING_ANNOTATION

    // 等待 DOM 更新后定位编辑层
    this.updateComplete.then(() => {
      // 使用 requestAnimationFrame 确保 DOM 完全渲染
      requestAnimationFrame(() => {
        // 查找对应的标注元素来定位编辑层
        const annotationElement = this.shadowRoot?.querySelector(`[data-anno-id="anno-${annotationIdToEdit}"]`) as HTMLElement
        if (!annotationElement || !this.scrollContainer) {
          console.warn('无法找到标注元素或滚动容器')
          return
        }

        const contentWrapper = this.shadowRoot?.querySelector('.content-wrapper') as HTMLElement
        if (!contentWrapper) {
          console.warn('无法找到内容包装器')
          return
        }

        // 创建一个 Range 用于定位编辑层
        let rangeCreated = false
        const range = document.createRange()
        try {
          // 尝试选择标注元素的文本节点
          // 标注元素的结构可能是：<span class="line-highlight">文本</span>
          // 或者：<span class="line-highlight"><span class="line-highlight-border"></span>文本</span>
          const walker = document.createTreeWalker(annotationElement, NodeFilter.SHOW_TEXT, null)
          const firstTextNode = walker.nextNode()

          if (firstTextNode) {
            range.setStart(firstTextNode, 0)
            range.setEnd(firstTextNode, firstTextNode.textContent?.length || 0)
            rangeCreated = true
          } else {
            // 如果没有文本节点，选择整个元素
            range.selectNodeContents(annotationElement)
            rangeCreated = true
          }
        } catch (e) {
          console.warn('创建 Range 失败:', e)
          rangeCreated = false
        }

        if (rangeCreated) {
          this.savedRange = range
          this.updateEditLayerPosition()
        } else {
          // 如果创建 Range 失败，使用标注元素的边界框直接计算位置
          const rect = annotationElement.getBoundingClientRect()
          const contentWrapperRect = contentWrapper.getBoundingClientRect()
          const scrollContainerRect = this.scrollContainer.getBoundingClientRect()

          let editLayerX = rect.left - contentWrapperRect.left
          let editLayerY = rect.bottom - contentWrapperRect.top + 5

          // 边界检查和调整（与 calculateEditLayerPosition 逻辑一致）
          const editLayerHeight = 50
          const editLayerWidth = 420

          // 检查右边界
          const maxX = contentWrapperRect.width - editLayerWidth
          if (editLayerX > maxX) {
            editLayerX = maxX
          }
          // 检查左边界
          if (editLayerX < 0) {
            editLayerX = 0
          }

          // 检查下边界
          const scrollViewportBottom = scrollContainerRect.bottom - contentWrapperRect.top
          if (editLayerY + editLayerHeight > scrollViewportBottom) {
            const editLayerYAbove = rect.top - contentWrapperRect.top - editLayerHeight - 5
            if (editLayerYAbove >= scrollContainerRect.top - contentWrapperRect.top) {
              editLayerY = editLayerYAbove
            } else {
              editLayerY = Math.max(0, scrollViewportBottom - editLayerHeight)
            }
          }
          // 检查上边界
          const scrollViewportTop = scrollContainerRect.top - contentWrapperRect.top
          if (editLayerY < scrollViewportTop) {
            editLayerY = scrollViewportTop + 5
          }

          this.editLayerPosition = { x: editLayerX, y: editLayerY }
        }

        // 聚焦到选择框
        const select = this.shadowRoot?.querySelector('.edit-layer select') as HTMLSelectElement
        if (select) {
          select.focus()
        }
      })
    })
  }

  /**
   * 处理删除操作
   */
  private handleDelete() {
    // 如果正在创建关系，不允许删除
    if (this.functionMode === FunctionMode.CREATING_RELATIONSHIP) {
      return
    }

    handleDelete({
      contextMenuTarget: this.contextMenuTarget,
      onAnnotationDeleted: (id: string) => {
        this.annotations = this.annotations.filter(annotation => annotation.id !== id)
        // 删除该标注关联的所有关系
        this.relationships = this.relationships.filter(relationship => relationship.startId !== id && relationship.endId !== id)
      },
      onRelationshipDeleted: (id: string) => {
        this.relationships = this.relationships.filter(relationship => relationship.id !== id)
      },
      onContextMenuHide: () => {
        // 重置到默认模式
        this.resetToDefaultMode()
      }
    })
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
    const startPos = this.getElementCenterPosition(startElement, virtualListLayer)

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
   * 获取元素中心相对于 virtualListLayer 的坐标
   */
  private getElementCenterPosition(element: HTMLElement, virtualListLayer: HTMLElement): { x: number; y: number } {
    const elementRect = element.getBoundingClientRect()
    const layerRect = virtualListLayer.getBoundingClientRect()

    const centerX = elementRect.left + elementRect.width / 2 - layerRect.left
    const centerY = elementRect.top + elementRect.height / 2 - layerRect.top

    return { x: centerX, y: centerY }
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
      const annotationElement = this.findAnnotationElement(elementUnderMouse)
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
   * 查找包含标注的元素
   */
  private findAnnotationElement(element: Element | null): HTMLElement | null {
    if (!element) return null
    if (element.classList.contains('line-highlight')) {
      return element as HTMLElement
    }
    return this.findAnnotationElement(element.parentElement)
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
      const annotationElement = this.findAnnotationElement(elementUnderMouse)
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
  private renderLineContent(line: LineItem) {
    // 只在创建标注模式（新增）时显示选中文本的高亮，编辑模式不显示（通过 editingAnnotationId 判断）
    const isEditingThisLine = !!(
      this.functionMode === FunctionMode.CREATING_ANNOTATION &&
      !this.editingAnnotationId &&
      this.selectedTextInfo &&
      this.selectedTextInfo.lineId === line.id
    )

    return renderLineContent({
      line,
      annotations: this.annotations,
      isEditingThisLine,
      selectedTextInfo: this.selectedTextInfo,
      onHighlightMouseEnter: () => this.handleHighlightMouseEnter(),
      onHighlightMouseLeave: () => this.handleHighlightMouseLeave(),
      onAnnotationContextMenu: (e: MouseEvent, annotationId: string) => this.handleAnnotationContextMenu(e, annotationId),
      relationshipStartAnnotationId: this.relationshipStartAnnotationId,
      hoveredAnnotationId: this.hoveredAnnotationId
    })
  }

  render() {
    const visibleLines = this.lines.slice(this.visibleStartIndex, this.visibleEndIndex + 1)
    const totalHeight = this.getTotalHeight()
    const bottomPadding = this.getBottomPadding()
    const offsetTop = this.getOffsetTop(this.visibleStartIndex)
    // 使用实际测量的 virtual-list-layer 高度，初始渲染时使用计算值作为回退
    const visibleHeight = this.visibleLayerHeight > 0 ? this.visibleLayerHeight : visibleLines.length * this.lineHeight

    return html`
      <div class="scroll-container" @scroll=${this.handleScroll}>
        <div class="content-wrapper" style="height: ${totalHeight}px;">
          <!-- SVG 关系层：与 virtual-list-layer 完全重叠 -->
          <svg
            class="relationship-layer ${this.isRelationshipLayerActive ? 'highlighted' : ''} ${this.isSelectingText ? 'selecting-text' : ''}"
            style="transform: translateY(${offsetTop}px); height: ${visibleHeight}px;"
            overflow="visible"
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
          <div
            class="virtual-list-layer ${this.isRelationshipLayerActive ? 'dimmed' : ''}"
            style="transform: translateY(${offsetTop}px); padding-bottom: ${bottomPadding}px;"
          >
            <!-- ${visibleLines.map(line => html`<div class="line">${this.renderLineContent(line)}</div>`)} -->
            ${visibleLines.map(
              line => html`
                <div class="line">
                  ${this.showLineNumber ? html`<span class="line-number">${line.id + 1}</span>` : null}
                  <span class="line-content">${this.renderLineContent(line)}</span>
                </div>
              `
            )}
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
            ? html`<div
                class="context-menu"
                style="left: ${this.contextMenuPosition.x}px; top: ${this.contextMenuPosition.y}px;"
                @click=${(e: MouseEvent) => e.stopPropagation()}
              >
                ${this.contextMenuTarget?.type === 'annotation'
                  ? html`
                      <button class="context-menu-item create-relationship" @click=${this.handleCreateRelationship}>创建关系</button>
                      <button class="context-menu-item edit-annotation" @click=${this.handleEditAnnotation}>编辑标注</button>
                    `
                  : null}
                ${this.contextMenuTarget?.type === 'relationship'
                  ? html`<button class="context-menu-item edit-relationship" @click=${this.handleEditRelationship}>编辑关系</button> `
                  : null}
                <button class="context-menu-item delete" @click=${this.handleDelete}>删除</button>
              </div>`
            : null}
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
