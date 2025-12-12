// 虚拟列表逻辑

import { VIRTUAL_LIST_CONFIG } from './types'

// 更新可见范围的参数
export interface UpdateVisibleRangeParams {
  scrollContainer: HTMLElement
  lines: Array<unknown>
  lineHeight: number
  containerHeight: number
}

// 更新可见范围的结果
export interface UpdateVisibleRangeResult {
  visibleStartIndex: number
  visibleEndIndex: number
  containerHeight: number
}

/**
 * 更新可见范围
 */
export function updateVisibleRange(params: UpdateVisibleRangeParams): UpdateVisibleRangeResult | null {
  const { scrollContainer, lines, lineHeight, containerHeight: currentContainerHeight } = params

  if (!scrollContainer || lines.length === 0) {
    return null
  }

  const { scrollTop, clientHeight } = scrollContainer
  const containerHeight = clientHeight || currentContainerHeight
  const buffer = VIRTUAL_LIST_CONFIG.BUFFER_SIZE

  // 计算内容实际高度（不包含底部额外空间）
  const contentHeight = lines.length * lineHeight

  // 计算当前滚动位置距离底部内容的距离
  // 当 scrollTop + containerHeight 接近 contentHeight 时，认为接近底部
  const distanceToContentBottom = contentHeight - (scrollTop + containerHeight)
  const isNearBottom = distanceToContentBottom <= VIRTUAL_LIST_CONFIG.BOTTOM_THRESHOLD

  // 计算可见区域的行索引范围
  let startIndex = Math.max(0, Math.floor(scrollTop / lineHeight) - buffer)
  let endIndex = Math.ceil((scrollTop + containerHeight) / lineHeight) + buffer

  // 接近底部时，确保包含最后一行，并且确保最后一行有足够的缓冲区
  if (isNearBottom) {
    // 确保 endIndex 包含最后一行
    endIndex = lines.length - 1
    // 确保 startIndex 不会太大，这样最后一行就能在可视区域内
    // 计算要显示最后一行所需的最小 startIndex
    const minStartForLastLine = Math.max(0, lines.length - 1 - Math.ceil(containerHeight / lineHeight) - buffer)
    startIndex = Math.max(0, Math.min(startIndex, minStartForLastLine + buffer))
  } else {
    endIndex = Math.min(lines.length - 1, endIndex)
  }

  // 确保索引范围有效
  startIndex = Math.min(startIndex, endIndex)
  endIndex = Math.max(startIndex, endIndex)

  return {
    visibleStartIndex: startIndex,
    visibleEndIndex: endIndex,
    containerHeight
  }
}

/**
 * 计算总高度（纯内容高度，底部留白通过 CSS padding-bottom 实现）
 */
export function getTotalHeight(linesCount: number, lineHeight: number): number {
  return linesCount * lineHeight
}

/**
 * 计算偏移量
 */
export function getOffsetTop(index: number, lineHeight: number): number {
  return index * lineHeight
}
