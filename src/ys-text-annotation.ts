import { LitElement, css, html, svg, unsafeCSS } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { mockContent } from './mock'
import styles from './index.css?inline'
import { getShadowDOMSelection, calculateEditLayerPosition, calculateContextMenuPosition, measureLineHeight } from './utils'
import type { LineItem, AnnotationType, AnnotationItem, RelationshipItem, RelationshipPath, SelectedTextInfo, ContextMenuTarget } from './types'
import { mockAnnotation, mockRelationship, defaultAnnotationTypes } from './types'
import { renderLineContent } from './render-helpers'
import { measureRelationships } from './relationship-measurer'
import { updateVisibleRange, getTotalHeight, getOffsetTop } from './virtual-list'
import { handleTextSelection, handleConfirmEdit, handleDelete } from './event-handlers'

// FIXME 1. 选中标签时，如果选中了已存在的节点，则会出现bug
// FIXME 2. 虚拟列表的滚动有问题
// TODO 1. 增加关系创建
// TODO 2. 增加跨远程关系创建

@customElement('ys-text-annotation')
export class YsTextAnnotation extends LitElement {
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
  private annotationType: AnnotationType[] = defaultAnnotationTypes

  @state()
  private annotations: AnnotationItem[] = mockAnnotation

  @state()
  private relationships: RelationshipItem[] = mockRelationship

  @state()
  private relationshipPaths: RelationshipPath[] = []

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

  private selectedTextInfo: SelectedTextInfo | null = null

  private savedRange: Range | null = null

  @state()
  private contextMenuVisible = false

  @state()
  private contextMenuPosition = { x: 0, y: 0 }

  private contextMenuTarget: ContextMenuTarget | null = null

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
    if (!this.scrollContainer) return

    const result = updateVisibleRange({
      scrollContainer: this.scrollContainer,
      lines: this.lines,
      lineHeight: this.lineHeight,
      containerHeight: this.containerHeight
    })

    if (result) {
      this.visibleStartIndex = result.visibleStartIndex
      this.visibleEndIndex = result.visibleEndIndex
      this.containerHeight = result.containerHeight
    }
  }

  private getTotalHeight(): number {
    return getTotalHeight(this.lines.length, this.lineHeight, this.containerHeight)
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
    if (!this.editingEnabled) {
      this.editLayerVisible = false
      this.savedRange = null
      return
    }

    handleTextSelection({
      editingEnabled: this.editingEnabled,
      savedRange: this.savedRange,
      shadowRoot: this.shadowRoot,
      visibleStartIndex: this.visibleStartIndex,
      lines: this.lines,
      onSelectionProcessed: (info: SelectedTextInfo) => {
        this.selectedTextInfo = info
      },
      onEditLayerPositionUpdate: () => {
        this.updateEditLayerPosition()
      },
      onEditLayerShow: () => {
        this.editInputValue = ''
        this.selectedAnnotationType = ''
        this.editLayerVisible = true
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
    handleConfirmEdit({
      selectedAnnotationType: this.selectedAnnotationType,
      selectedTextInfo: this.selectedTextInfo,
      editInputValue: this.editInputValue,
      annotationTypes: this.annotationType,
      shadowRoot: this.shadowRoot,
      onAnnotationCreated: (annotation: AnnotationItem) => {
        this.annotations = [...this.annotations, annotation]
      },
      onEditLayerHide: () => {
        this.editLayerVisible = false
        this.selectedTextInfo = null
        this.editInputValue = ''
        this.selectedAnnotationType = ''
        this.savedRange = null
      }
    })
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
        this.contextMenuVisible = false
        this.contextMenuTarget = null
      }
    })
  }

  /**
   * 渲染行内容，如果有标注则高亮显示
   */
  private renderLineContent(line: LineItem) {
    const isEditingThisLine = !!(this.editLayerVisible && this.selectedTextInfo && this.selectedTextInfo.lineId === line.id)

    return renderLineContent({
      line,
      annotations: this.annotations,
      isEditingThisLine,
      selectedTextInfo: this.selectedTextInfo,
      onHighlightMouseEnter: () => this.handleHighlightMouseEnter(),
      onHighlightMouseLeave: () => this.handleHighlightMouseLeave(),
      onAnnotationContextMenu: (e: MouseEvent, annotationId: string) => this.handleAnnotationContextMenu(e, annotationId)
    })
  }

  render() {
    const visibleLines = this.lines.slice(this.visibleStartIndex, this.visibleEndIndex + 1)
    const totalHeight = this.getTotalHeight()
    const offsetTop = this.getOffsetTop(this.visibleStartIndex)

    return html`
      <div class="scroll-container" @scroll=${this.handleScroll}>
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
