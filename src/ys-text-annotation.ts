import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { mockContent } from './mock'

@customElement('ys-text-annotation')
export class YsTextAnnotation extends LitElement {
  // 常量配置
  private static readonly BUFFER_SIZE = 5 // 可见区域缓冲区行数
  private static readonly BOTTOM_THRESHOLD = 10 // 底部检测容差（px）
  private static readonly BOTTOM_EXTRA_RATIO = 1 / 3 // 底部额外空间比例

  static styles = css`
    :host {
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
    }

    .line {
      white-space: pre-wrap;
      word-wrap: break-word;
      line-height: 1.5;
      margin: 0;
      padding: 0;
      min-height: 1.5em;
      box-sizing: border-box;
    }
  `

  @property()
  content = mockContent

  @state()
  private lines: string[] = []

  @state()
  private visibleStartIndex = 0

  @state()
  private visibleEndIndex = 0

  @state()
  private lineHeight = 24

  @state()
  private containerHeight = 0

  private scrollContainer?: HTMLElement
  private resizeObserver?: ResizeObserver
  private updateTimer?: number

  connectedCallback() {
    super.connectedCallback()
    this.updateLines()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.updateTimer && cancelAnimationFrame(this.updateTimer)
    this.resizeObserver?.disconnect()
  }

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    super.updated(changedProperties)
    if (changedProperties.has('content')) {
      this.updateLines()
    }
  }

  firstUpdated() {
    this.scrollContainer = this.shadowRoot?.querySelector('.scroll-container') as HTMLElement
    if (!this.scrollContainer) return

    this.scrollContainer.addEventListener('scroll', () => this.handleScroll())
    this.containerHeight = this.scrollContainer.clientHeight

    // 监听容器大小变化
    this.resizeObserver = new ResizeObserver(() => {
      if (this.scrollContainer) {
        this.containerHeight = this.scrollContainer.clientHeight
        this.measureLineHeight()
        this.updateVisibleRange()
      }
    })
    this.resizeObserver.observe(this.scrollContainer)

    this.measureLineHeight()
    this.updateVisibleRange()
  }

  private updateLines() {
    this.lines = this.content.split('\n')
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

  render() {
    const visibleLines = this.lines.slice(this.visibleStartIndex, this.visibleEndIndex + 1)
    const totalHeight = this.getTotalHeight()
    const offsetTop = this.getOffsetTop(this.visibleStartIndex)

    return html`
      <div class="scroll-container" @scroll=${this.handleScroll}>
        <div class="content-wrapper" style="height: ${totalHeight}px;">
          <div style="transform: translateY(${offsetTop}px);">${visibleLines.map(line => html`<div class="line">${line || '\u00A0'}</div>`)}</div>
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
