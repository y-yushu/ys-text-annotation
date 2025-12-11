// 关系测量逻辑

import type { RelationshipItem, RelationshipPath } from './types'
import { calculateBezierCurvePath } from './utils'

// 测量关系的参数
export interface MeasureRelationshipsParams {
  relationships: RelationshipItem[]
  shadowRoot: ShadowRoot | null
  virtualListLayer: HTMLElement | null
}

/**
 * 获取元素相对于虚拟列表可见区域的中心位置
 */
function getElementCenterPosition(element: HTMLElement, virtualListLayer: HTMLElement): { x: number; y: number } {
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

/**
 * 计算已渲染标注的相对坐标，生成关系路径
 */
export function measureRelationships(params: MeasureRelationshipsParams): RelationshipPath[] {
  const { relationships, shadowRoot, virtualListLayer } = params

  if (!shadowRoot || !virtualListLayer) {
    return []
  }

  const paths: RelationshipPath[] = []

  // 默认颜色
  const defaultColor = '#c12c1f'

  // 遍历所有关系
  for (const relationship of relationships) {
    const { id, startId, endId, label, color } = relationship
    const pathColor = color || defaultColor

    // 查找起点和终点的 line-highlight 元素
    const startElement = shadowRoot.querySelector(`[data-anno-id="anno-${startId}"]`) as HTMLElement
    const endElement = shadowRoot.querySelector(`[data-anno-id="anno-${endId}"]`) as HTMLElement

    // 如果起点或终点元素不存在（未渲染），跳过
    if (!startElement || !endElement) continue

    const startPos = getElementCenterPosition(startElement, virtualListLayer)
    const endPos = getElementCenterPosition(endElement, virtualListLayer)

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

  return paths
}
