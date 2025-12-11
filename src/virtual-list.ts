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
  const totalHeight = getTotalHeight(lines.length, lineHeight, containerHeight)
  const buffer = VIRTUAL_LIST_CONFIG.BUFFER_SIZE

  // 计算可见区域的行索引范围
  let startIndex = Math.max(0, Math.floor(scrollTop / lineHeight) - buffer)
  let endIndex = Math.ceil((scrollTop + containerHeight) / lineHeight) + buffer

  // 接近底部时，确保包含最后一行
  const isNearBottom = scrollTop + containerHeight >= totalHeight - VIRTUAL_LIST_CONFIG.BOTTOM_THRESHOLD
  endIndex = isNearBottom ? lines.length - 1 : Math.min(lines.length - 1, endIndex)

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
 * 计算总高度
 */
export function getTotalHeight(linesCount: number, lineHeight: number, containerHeight: number): number {
  const contentHeight = linesCount * lineHeight
  const extraBottomSpace = containerHeight * VIRTUAL_LIST_CONFIG.BOTTOM_EXTRA_RATIO
  return contentHeight + extraBottomSpace
}

/**
 * 计算偏移量
 */
export function getOffsetTop(index: number, lineHeight: number): number {
  return index * lineHeight
}

