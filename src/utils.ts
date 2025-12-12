// 工具函数集合

/**
 * 获取 Shadow DOM 内的选择
 * 优先使用 shadowRoot.getSelection()（Chromium 浏览器支持）
 * 如果不支持，回退到 window.getSelection() 并检查是否在 Shadow DOM 内
 */
export function getShadowDOMSelection(shadowRoot: ShadowRoot | null): Selection | null {
  // 优先尝试使用 shadowRoot.getSelection()（Chromium 浏览器支持）
  if (shadowRoot && typeof (shadowRoot as any).getSelection === 'function') {
    const selection = (shadowRoot as any).getSelection()
    if (selection && selection.rangeCount > 0) {
      return selection
    }
  }

  // 回退到 window.getSelection()，但需要检查是否在 Shadow DOM 内
  const selection = window.getSelection()
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0)
    const startRoot = range.startContainer.getRootNode()
    const endRoot = range.endContainer.getRootNode()
    // 如果不在 Shadow DOM 内，返回 null
    if (startRoot === shadowRoot || endRoot === shadowRoot) {
      return selection
    }
  }

  return null
}

/**
 * 计算文本在 line 中的偏移量（考虑标注元素，排除标注描述文本）
 */
export function getTextOffsetInLine(lineElement: HTMLElement, textNode: Node, offset: number): number {
  // 创建一个范围，从 line 开始到 textNode 的 offset 位置
  const range = document.createRange()
  range.setStart(lineElement, 0)

  try {
    range.setEnd(textNode, offset)
  } catch (e) {
    // 如果设置失败，尝试找到 textNode 的父元素
    return 0
  }

  // 获取范围内的所有文本节点（排除标注描述）
  let offsetCount = 0
  const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, {
    acceptNode: node => {
      // 跳过标注描述文本
      const parent = node.parentElement
      if (parent?.classList.contains('line-highlight-desc')) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    }
  })

  let node: Node | null
  while ((node = walker.nextNode())) {
    const nodeLength = node.textContent?.length || 0
    if (node === textNode) {
      // 如果是目标节点，只计算 offset 部分
      offsetCount += offset
      break
    } else {
      // 检查节点是否在范围内
      try {
        const nodeRange = document.createRange()
        nodeRange.selectNodeContents(node)
        if (range.compareBoundaryPoints(Range.START_TO_END, nodeRange) >= 0) {
          offsetCount += nodeLength
        }
      } catch (e) {
        // 忽略错误，继续处理下一个节点
      }
    }
  }

  return offsetCount
}

/**
 * 计算贝塞尔曲线路径和标签位置
 */
export interface BezierCurveResult {
  d: string
  labelX?: number
  labelY?: number
  labelAngle?: number
}

export function calculateBezierCurvePath(startPos: { x: number; y: number }, endPos: { x: number; y: number }, label?: string): BezierCurveResult {
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
    // 简化: B'(0.5) = 0.75(-P₀ - P₁ + P₂ + P₃)
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

    // 沿着法向量方向向上偏移标签位置（偏移距离设为 10px）
    const offsetDistance = 10
    labelX = labelX + normalX * offsetDistance
    labelY = labelY + normalY * offsetDistance
  }

  return { d, labelX, labelY, labelAngle }
}

/**
 * 计算编辑层位置
 */
export interface EditLayerPosition {
  x: number
  y: number
}

export function calculateEditLayerPosition(range: Range, scrollContainer: HTMLElement, contentWrapper: HTMLElement): EditLayerPosition {
  const rangeRect = range.getBoundingClientRect()
  const contentWrapperRect = contentWrapper.getBoundingClientRect()
  const scrollContainerRect = scrollContainer.getBoundingClientRect()

  // 计算编辑层相对于 content-wrapper 的位置
  const editLayerX = rangeRect.left - contentWrapperRect.left
  const editLayerY = rangeRect.bottom - contentWrapperRect.top + 5

  // 获取编辑层的尺寸（估算）
  // 下拉框(120px) + 输入框(200px) + 按钮(80px) + 间距(20px) ≈ 420px
  const editLayerHeight = 50
  const editLayerWidth = 420

  // 检查并调整位置，确保编辑层不超出可视范围
  let finalX = editLayerX
  let finalY = editLayerY

  // 检查右边界
  const maxX = contentWrapperRect.width - editLayerWidth
  if (finalX > maxX) {
    finalX = maxX
  }
  // 检查左边界
  if (finalX < 0) {
    finalX = 0
  }

  // 检查下边界（相对于滚动容器的可视区域）
  const scrollViewportBottom = scrollContainerRect.bottom - contentWrapperRect.top
  if (finalY + editLayerHeight > scrollViewportBottom) {
    // 如果下方空间不足，尝试显示在选中文本上方
    const editLayerYAbove = rangeRect.top - contentWrapperRect.top - editLayerHeight - 5
    if (editLayerYAbove >= scrollContainerRect.top - contentWrapperRect.top) {
      // 上方有足够空间
      finalY = editLayerYAbove
    } else {
      // 上下都没有足够空间，调整到可视区域内
      finalY = Math.max(0, scrollViewportBottom - editLayerHeight)
    }
  }
  // 检查上边界
  const scrollViewportTop = scrollContainerRect.top - contentWrapperRect.top
  if (finalY < scrollViewportTop) {
    finalY = scrollViewportTop + 5
  }

  return { x: finalX, y: finalY }
}

/**
 * 计算右键菜单位置
 */
export interface ContextMenuPosition {
  x: number
  y: number
}

export function calculateContextMenuPosition(
  e: MouseEvent,
  contentWrapper: HTMLElement,
  scrollContainer?: HTMLElement,
  menuWidth: number = 120,
  menuHeight: number = 40
): ContextMenuPosition {
  const contentWrapperRect = contentWrapper.getBoundingClientRect()
  const scrollContainerRect = scrollContainer?.getBoundingClientRect() || contentWrapperRect
  
  // 计算菜单相对于 contentWrapper 的位置
  // 使用鼠标事件的 clientX/clientY 和 contentWrapper 的 getBoundingClientRect
  let menuX = e.clientX - contentWrapperRect.left
  let menuY = e.clientY - contentWrapperRect.top

  // 调整菜单位置，确保不超出滚动容器的可视区域
  // 计算滚动容器的可视区域相对于 contentWrapper 的位置
  const scrollViewportTop = scrollContainerRect.top - contentWrapperRect.top
  const scrollViewportBottom = scrollViewportTop + scrollContainerRect.height
  const scrollViewportLeft = scrollContainerRect.left - contentWrapperRect.left
  const scrollViewportRight = scrollViewportLeft + scrollContainerRect.width

  // 检查右边界（相对于滚动容器可视区域）
  if (menuX + menuWidth > scrollViewportRight) {
    menuX = scrollViewportRight - menuWidth
  }
  // 检查左边界
  if (menuX < scrollViewportLeft) {
    menuX = scrollViewportLeft
  }
  // 检查下边界（相对于滚动容器可视区域）
  if (menuY + menuHeight > scrollViewportBottom) {
    menuY = scrollViewportBottom - menuHeight
  }
  // 检查上边界
  if (menuY < scrollViewportTop) {
    menuY = scrollViewportTop
  }

  return { x: menuX, y: menuY }
}

/**
 * 从点坐标计算编辑层位置（用于关系编辑等场景）
 */
export function calculateEditLayerPositionFromPoint(
  point: { x: number; y: number },
  scrollContainer: HTMLElement,
  contentWrapper: HTMLElement
): EditLayerPosition {
  const contentWrapperRect = contentWrapper.getBoundingClientRect()
  const scrollContainerRect = scrollContainer.getBoundingClientRect()

  // 计算编辑层相对于 content-wrapper 的位置
  let editLayerX = point.x
  let editLayerY = point.y

  // 获取编辑层的尺寸（估算）
  // 下拉框(120px) + 输入框(200px) + 按钮(80px) + 间距(20px) ≈ 420px
  const editLayerHeight = 50
  const editLayerWidth = 420

  // 检查并调整位置，确保编辑层不超出可视范围
  let finalX = editLayerX
  let finalY = editLayerY

  // 检查右边界
  const maxX = contentWrapperRect.width - editLayerWidth
  if (finalX > maxX) {
    finalX = maxX
  }
  // 检查左边界
  if (finalX < 0) {
    finalX = 0
  }

  // 检查下边界（相对于滚动容器的可视区域）
  const scrollViewportBottom = scrollContainerRect.bottom - contentWrapperRect.top
  if (finalY + editLayerHeight > scrollViewportBottom) {
    // 如果下方空间不足，尝试显示在上方
    const editLayerYAbove = point.y - editLayerHeight - 5
    const scrollViewportTop = scrollContainerRect.top - contentWrapperRect.top
    if (editLayerYAbove >= scrollViewportTop) {
      // 上方有足够空间
      finalY = editLayerYAbove
    } else {
      // 上下都没有足够空间，调整到可视区域内
      finalY = Math.max(scrollViewportTop, scrollViewportBottom - editLayerHeight)
    }
  }
  // 检查上边界
  const scrollViewportTop = scrollContainerRect.top - contentWrapperRect.top
  if (finalY < scrollViewportTop) {
    finalY = scrollViewportTop + 5
  }

  return { x: finalX, y: finalY }
}

/**
 * 测量行高
 */
export function measureLineHeight(container: HTMLElement): number {
  // 创建临时元素测量实际行高
  const tempDiv = document.createElement('div')
  tempDiv.className = 'line'
  Object.assign(tempDiv.style, {
    position: 'absolute',
    visibility: 'hidden',
    height: 'auto'
  })
  tempDiv.textContent = 'M'
  container.appendChild(tempDiv)

  // 使用 document.defaultView 或直接使用 getComputedStyle（更安全）
  const computedStyle = (document.defaultView || window).getComputedStyle(tempDiv)
  const { lineHeight: lineHeightValue, fontSize } = computedStyle
  const fontSizeNum = parseFloat(fontSize)

  // 计算行高：normal 使用 1.5 倍字体大小，px 直接解析，数字倍数乘以字体大小
  let lineHeight: number
  if (lineHeightValue === 'normal') {
    lineHeight = Math.ceil(fontSizeNum * 1.5)
  } else if (lineHeightValue.includes('px')) {
    lineHeight = parseFloat(lineHeightValue)
  } else {
    lineHeight = Math.ceil(fontSizeNum * parseFloat(lineHeightValue))
  }

  container.removeChild(tempDiv)
  return lineHeight
}

/**
 * 根据lineId查找对应的标注数据
 */
export function getAnnotationsByLineId<T extends { lineId: number }>(annotations: T[], lineId: number): T[] {
  return annotations.filter(annotation => annotation.lineId === lineId)
}
