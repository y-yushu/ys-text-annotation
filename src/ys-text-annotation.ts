import { LitElement, css, html, svg } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { mockContent } from './mock'

// 按行拆分文本
interface LineItem {
  id: number
  content: string
}

// 实体标注
interface AnnotationItem {
  id: string // 唯一标识
  lineId: number // 段落id
  start: number // 起始位置
  end: number // 结束位置
  content: string // 标注内容
  description: string // 标注描述
  color?: string // 颜色
}

// 标注模拟数据
const mockAnnotation: AnnotationItem[] = [
  { id: '1', lineId: 2, start: 3, end: 5, content: '天蚕', description: '人物', color: '#3271ae' },
  { id: '2', lineId: 7, start: 5, end: 11, content: '第1497章', description: '章节', color: '#547689' },
  { id: '3', lineId: 8, start: 12, end: 30, content: '原本拥有圣龙之命，却被敌国武王以亿万', description: '章节' },
  { id: '4', lineId: 90, start: 0, end: 2, content: '周元', description: '人物' }
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
  { id: '1-3', startId: '1', endId: '3', label: '关系2', color: '#53df0b' }
]

@customElement('ys-text-annotation')
export class YsTextAnnotation extends LitElement {
  // 常量配置
  private static readonly BUFFER_SIZE = 5 // 可见区域缓冲区行数
  private static readonly BOTTOM_THRESHOLD = 10 // 底部检测容差（px）
  private static readonly BOTTOM_EXTRA_RATIO = 1 / 3 // 底部额外空间比例

  static styles = css`
    :host {
      font-size: 16px;
      display: flex;
      flex-direction: column;
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      max-height: 100%;
      min-height: 0;
      overflow: hidden;
      box-sizing: border-box;
    }

    .scroll-container {
      position: relative;
      flex: 1;
      min-height: 0;
      width: 100%;
      overflow-y: auto;
      overflow-x: hidden;
      position: relative;
      box-sizing: border-box;
    }

    .content-wrapper {
      position: relative;
      width: 100%;
      background: #ffffff78;
      z-index: 1;
    }

    .virtual-list-layer {
      position: relative;
      z-index: 1;
      padding-right: 40px;
    }

    .virtual-list-layer .line {
      position: relative;
    }

    /* 当 dimmed 时，使用遮罩层让 line 变暗，但 line-highlight 不受影响 */
    .virtual-list-layer.dimmed .line::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(255, 255, 255, 0.9);
      pointer-events: none;
      z-index: 0;
      transition: opacity 0.3s ease;
    }

    /* line-highlight 在遮罩层之上，保持清晰 */
    .virtual-list-layer .line-highlight {
      position: relative;
      z-index: 1;
    }

    .relationship-layer {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      overflow: visible;
      z-index: 10;
      opacity: 0.1;
      transition: opacity 0.3s ease;
    }

    .relationship-layer.highlighted {
      opacity: 1;
    }

    .relationship-path {
      stroke-width: 2;
      fill: none;
      cursor: pointer;
      pointer-events: all;
    }

    .relationship-label {
      font-size: 12px;
      dominant-baseline: middle;
      text-anchor: middle;
      font-weight: 500;
      cursor: pointer;
      pointer-events: all;
    }

    .line {
      white-space: pre-wrap;
      word-wrap: break-word;
      line-height: 2.5;
      margin: 0;
      padding: 0;
      min-height: 1.5em;
      box-sizing: border-box;
    }

    .line-highlight {
      --highlight-color: #2d0bdf;
      padding-inline: 0.5rem;
      text-align: center;
      position: relative;
      display: inline-block;
      vertical-align: baseline;
      line-height: inherit;
      color: var(--highlight-color);
      white-space: normal;
      max-width: 100%;
    }

    .line-highlight-border {
      position: absolute;
      top: 0.375rem;
      left: 0;
      right: 0;
      bottom: 0.375rem;
      border: 2px solid var(--highlight-color);
    }

    .line-highlight-desc {
      position: absolute;
      left: 0;
      right: 0;
      top: calc(100% - 0.375rem);
      height: 0.75rem;
      line-height: 0.75rem;
      font-size: 0.625rem;
      background: var(--highlight-color);
      color: #fff;
    }
  `

  @property()
  content = mockContent

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

  private scrollContainer?: HTMLElement
  private resizeObserver?: ResizeObserver
  private updateTimer?: number
  private relationshipTimer?: number

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
  }

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    super.updated(changedProperties)
    // 当 content 属性从外部改变时，更新 lines
    if (changedProperties.has('content')) {
      this.updateLines()
      this.hasInitializedLines = true
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
  }

  private updateLines() {
    const contentLines = this.content.split('\n')
    this.lines = contentLines.map((content, index) => ({
      id: index,
      content: content
    }))
    console.log('🚀 ~ YsTextAnnotation ~ updateLines ~ this.lines:', this.lines)
    if (this.scrollContainer) {
      this.measureLineHeight()
      this.updateVisibleRange()
    }
  }

  private measureLineHeight() {
    if (!this.scrollContainer) return

    // 创建临时元素测量实际行高
    const tempDiv = document.createElement('div')
    tempDiv.className = 'line'
    Object.assign(tempDiv.style, {
      position: 'absolute',
      visibility: 'hidden',
      height: 'auto'
    })
    tempDiv.textContent = 'M'
    this.scrollContainer.appendChild(tempDiv)

    const { lineHeight: lineHeightValue, fontSize } = window.getComputedStyle(tempDiv)
    const fontSizeNum = parseFloat(fontSize)

    // 计算行高：normal 使用 1.5 倍字体大小，px 直接解析，数字倍数乘以字体大小
    if (lineHeightValue === 'normal') {
      this.lineHeight = Math.ceil(fontSizeNum * 1.5)
    } else if (lineHeightValue.includes('px')) {
      this.lineHeight = parseFloat(lineHeightValue)
    } else {
      this.lineHeight = Math.ceil(fontSizeNum * parseFloat(lineHeightValue))
    }

    this.scrollContainer.removeChild(tempDiv)
  }

  private handleScroll() {
    this.updateTimer && cancelAnimationFrame(this.updateTimer)
    this.updateTimer = requestAnimationFrame(() => this.updateVisibleRange())
    this.scheduleMeasureRelationships()
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

    const contentWrapper = this.shadowRoot?.querySelector('.content-wrapper') as HTMLElement
    if (!contentWrapper) return

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

    // 遍历所有关系
    for (const relationship of this.relationships) {
      const { id, startId, endId, label, color } = relationship
      const pathColor = color || defaultColor

      // 查找起点和终点的 line-highlight 元素
      const startElement = this.shadowRoot?.querySelector(`[data-anno-id="anno-${startId}"]`) as HTMLElement
      const endElement = this.shadowRoot?.querySelector(`[data-anno-id="anno-${endId}"]`) as HTMLElement

      // 如果起点或终点元素不存在（未渲染），跳过
      if (!startElement || !endElement) continue

      // 获取元素相对于 content-wrapper 的中心位置
      const getElementCenterPosition = (element: HTMLElement) => {
        // 找到包含该元素的 line 元素
        let lineElement: HTMLElement | null = element
        while (lineElement && !lineElement.classList.contains('line')) {
          lineElement = lineElement.parentElement
        }
        if (!lineElement) return null

        // 找到 line 在虚拟列表中的实际索引
        const lineParent = lineElement.parentElement
        if (!lineParent) return null

        const lineIndexInView = Array.from(lineParent.children).indexOf(lineElement)
        const actualLineIndex = this.visibleStartIndex + lineIndexInView

        // 计算 line 的顶部位置（相对于 content-wrapper 的绝对位置）
        const lineTop = actualLineIndex * this.lineHeight

        // 获取元素和 line 的 getBoundingClientRect（相对于视口）
        const elementRect = element.getBoundingClientRect()
        const lineRect = lineElement.getBoundingClientRect()

        // 计算元素相对于 line 的偏移（已经考虑了 transform）
        const relativeTop = elementRect.top - lineRect.top
        const relativeLeft = elementRect.left - lineRect.left

        // 计算元素相对于 content-wrapper 的绝对位置
        const absoluteTop = lineTop + relativeTop
        const absoluteLeft = relativeLeft

        // 返回中心点坐标（相对于 content-wrapper）
        return {
          x: absoluteLeft + elementRect.width / 2,
          y: absoluteTop + elementRect.height / 2
        }
      }

      const startPos = getElementCenterPosition(startElement)
      const endPos = getElementCenterPosition(endElement)

      if (!startPos || !endPos) continue

      // 生成贝塞尔曲线路径（从起点中心到终点中心）
      const controlOffset = Math.abs(endPos.y - startPos.y) / 2
      const startX = startPos.x
      const startY = startPos.y
      const endX = endPos.x
      const endY = endPos.y
      const control1X = startX
      const control1Y = startY + controlOffset
      const control2X = endX
      const control2Y = endY - controlOffset

      const d = `M ${startX} ${startY} C ${control1X} ${control1Y}, ${control2X} ${control2Y}, ${endX} ${endY}`

      // 如果有标签，计算路径中间点的位置和角度
      let labelX: number | undefined
      let labelY: number | undefined
      let labelAngle: number | undefined

      if (label) {
        // 计算三次贝塞尔曲线在 t=0.5 时的点（中间点）
        // B(t) = (1-t)³P₀ + 3(1-t)²tP₁ + 3(1-t)t²P₂ + t³P₃
        // 对于 t=0.5: B(0.5) = 0.125P₀ + 0.375P₁ + 0.375P₂ + 0.125P₃
        labelX = 0.125 * startX + 0.375 * control1X + 0.375 * control2X + 0.125 * endX
        labelY = 0.125 * startY + 0.375 * control1Y + 0.375 * control2Y + 0.125 * endY

        // 计算切向量（导数）用于确定角度
        // 三次贝塞尔曲线导数公式：B'(t) = 3(1-t)²(P₁-P₀) + 6(1-t)t(P₂-P₁) + 3t²(P₃-P₂)
        // 对于 t=0.5: B'(0.5) = 0.75(P₁-P₀) + 1.5(P₂-P₁) + 0.75(P₃-P₂)
        // 简化: B'(0.5) = 0.75(P₁-P₀) + 1.5(P₂-P₁) + 0.75(P₃-P₂)
        //            = 0.75P₁ - 0.75P₀ + 1.5P₂ - 1.5P₁ + 0.75P₃ - 0.75P₂
        //            = -0.75P₀ - 0.75P₁ + 0.75P₂ + 0.75P₃
        //            = 0.75(-P₀ - P₁ + P₂ + P₃)
        const tangentX = 0.75 * (-startX - control1X + control2X + endX)
        const tangentY = 0.75 * (-startY - control1Y + control2Y + endY)

        // 计算角度（弧度转角度），注意 SVG 坐标系 y 向下，所以角度需要调整
        // Math.atan2 返回的是从 x 轴正方向到向量的角度，范围是 -π 到 π
        labelAngle = (Math.atan2(tangentY, tangentX) * 180) / Math.PI

        // 如果角度超过 90 度，翻转文本（避免倒置）
        if (Math.abs(labelAngle) > 90) {
          labelAngle += 180
        }

        // 计算法向量（垂直于切向量，用于向上偏移标签）
        // 法向量可以是 (-tangentY, tangentX) 或 (tangentY, -tangentX)
        // 我们需要选择一个指向"上方"的法向量（在SVG坐标系中，y减小表示向上）
        let normalX = -tangentY
        let normalY = tangentX

        // 如果法向量的y分量是正数（指向下方），则反转方向
        // 因为SVG坐标系y向下，所以normalY为负表示向上
        if (normalY > 0) {
          normalX = tangentY
          normalY = -tangentX
        }

        // 归一化法向量
        const normalLength = Math.sqrt(normalX * normalX + normalY * normalY)
        if (normalLength > 0) {
          normalX = normalX / normalLength
          normalY = normalY / normalLength
        }

        // 沿着法向量方向向上偏移标签位置（偏移距离设为 15px）
        const offsetDistance = 10
        labelX = labelX + normalX * offsetDistance
        labelY = labelY + normalY * offsetDistance
      }

      paths.push({ id, d, label, color: pathColor, labelX, labelY, labelAngle })
    }

    this.relationshipPaths = paths
  }

  private scheduleMeasureRelationships() {
    this.relationshipTimer && cancelAnimationFrame(this.relationshipTimer)
    this.relationshipTimer = requestAnimationFrame(() => this.measureRelationships())
  }

  /**
   * 根据lineId查找对应的标注数据
   */
  private getAnnotationsByLineId(lineId: number): AnnotationItem[] {
    return this.annotations.filter(annotation => annotation.lineId === lineId)
  }

  /**
   * 处理鼠标移入高亮节点
   */
  private handleHighlightMouseEnter() {
    this.isHoveringHighlight = true
  }

  /**
   * 处理鼠标移出高亮节点
   */
  private handleHighlightMouseLeave() {
    this.isHoveringHighlight = false
  }

  /**
   * 渲染行内容，如果有标注则高亮显示
   */
  private renderLineContent(line: LineItem) {
    const annotations = this.getAnnotationsByLineId(line.id)

    // 如果没有标注，直接返回原文本
    if (annotations.length === 0) {
      return line.content || '\u00A0'
    }

    // 按start位置排序标注，确保按顺序处理
    const sortedAnnotations = [...annotations].sort((a, b) => a.start - b.start)

    // 构建高亮后的内容片段
    const fragments: Array<string | ReturnType<typeof html>> = []
    let lastIndex = 0

    sortedAnnotations.forEach(annotation => {
      const { start, end, content, description, color } = annotation

      // 跳过已经处理过的标注（处理重叠情况）
      if (start < lastIndex) {
        return
      }

      // 添加标注前的文本
      if (start > lastIndex) {
        fragments.push(line.content.substring(lastIndex, start))
      }

      // 验证标注内容是否匹配
      const actualContent = line.content.substring(start, end)
      if (actualContent === content) {
        // 添加高亮的标注文本
        // 如果存在 color，通过 CSS 变量设置，否则使用默认值
        const styleAttr = color ? `--highlight-color: ${color};` : ''

        fragments.push(
          html`<span
            class="line-highlight"
            data-anno-id=${`anno-${annotation.id}`}
            style=${styleAttr}
            @mouseenter=${this.handleHighlightMouseEnter}
            @mouseleave=${this.handleHighlightMouseLeave}
            >${content}<span class="line-highlight-border"></span><span class="line-highlight-desc">${description}</span></span
          >`
        )
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
        <div class="content-wrapper" style="height: ${totalHeight}px;">
          <svg
            class="relationship-layer ${this.isHoveringHighlight ? 'highlighted' : ''}"
            width="${this.containerWidth}"
            height="${totalHeight}"
            viewBox="0 0 ${this.containerWidth} ${totalHeight}"
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
                  ></path>
                  <text
                    class="relationship-label"
                    x=${path.labelX}
                    y=${path.labelY}
                    fill=${path.color}
                    transform=${`rotate(${path.labelAngle} ${path.labelX} ${path.labelY})`}
                    @mouseenter=${this.handleHighlightMouseEnter}
                    @mouseleave=${this.handleHighlightMouseLeave}
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
                ></path>
              `
            })}
          </svg>
          <div class="virtual-list-layer ${this.isHoveringHighlight ? 'dimmed' : ''}" style="transform: translateY(${offsetTop}px);">
            ${visibleLines.map(line => html`<div class="line">${this.renderLineContent(line)}</div>`)}
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
