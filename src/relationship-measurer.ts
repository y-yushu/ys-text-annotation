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
 * 获取元素中心相对于 virtualListLayer 左上角的坐标
 *
 * 由于 SVG 和 virtualListLayer 完全重叠（都使用相同的 transform: translateY(offsetTop)），
 * 标注元素相对于 virtualListLayer 左上角的坐标，就是 path 在 SVG 坐标系统中的坐标。
 *
 * 使用 getBoundingClientRect() 获取元素在视口中的位置（已包含 transform 的影响），
 * 然后计算相对于 virtualListLayer 的偏移。
 */
function getElementCenterPosition(element: HTMLElement, virtualListLayer: HTMLElement): { x: number; y: number } {
  const elementRect = element.getBoundingClientRect()
  const layerRect = virtualListLayer.getBoundingClientRect()

  // 计算元素中心点相对于 virtualListLayer 左上角的坐标
  // 这个坐标直接用于 SVG 的 path，因为 SVG 和 virtualListLayer 完全重叠
  const centerX = elementRect.left + elementRect.width / 2 - layerRect.left
  const centerY = elementRect.top + elementRect.height / 2 - layerRect.top

  return { x: centerX, y: centerY }
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
    const { id, startId, endId, type, color } = relationship
    const pathColor = color || defaultColor
    // 使用 type 作为标签显示文本
    const labelText = type || ''

    // 查找起点和终点的 line-highlight 元素
    const startElement = shadowRoot.querySelector(`[data-anno-id="anno-${startId}"]`) as HTMLElement
    const endElement = shadowRoot.querySelector(`[data-anno-id="anno-${endId}"]`) as HTMLElement

    // 如果起点或终点元素不存在（未渲染），跳过
    if (!startElement || !endElement) continue

    const startPos = getElementCenterPosition(startElement, virtualListLayer)
    const endPos = getElementCenterPosition(endElement, virtualListLayer)

    // 生成贝塞尔曲线路径（从起点中心到终点中心）
    const bezierResult = calculateBezierCurvePath(startPos, endPos, labelText)
    paths.push({
      id,
      d: bezierResult.d,
      label: labelText,
      color: pathColor,
      labelX: bezierResult.labelX,
      labelY: bezierResult.labelY,
      labelAngle: bezierResult.labelAngle
    })
  }

  return paths
}
