// 类型定义和常量

// 按行拆分文本
export interface LineItem {
  id: number
  content: string
}

// 实体标注的类型
export interface AnnotationType {
  type: string
  color: string
}

// 实体标注
export interface AnnotationItem {
  id: string // 唯一标识
  lineId: number // 段落id
  start: number // 起始位置
  end: number // 结束位置
  content: string // 标注内容
  type: string // 分类
  description: string // 描述
  color?: string // 颜色
}

// 关系
export interface RelationshipItem {
  id: string // 唯一标识
  startId: string // 起点节点
  endId: string // 结束节点
  label: string // 关系描述
  color?: string // 颜色
}

// 关系路径
export interface RelationshipPath {
  id: string
  d: string
  label: string
  color: string
  labelX?: number
  labelY?: number
  labelAngle?: number
}

// 选中的文本信息
export interface SelectedTextInfo {
  lineId: number
  start: number
  end: number
  content: string
}

// 右键菜单目标
export interface ContextMenuTarget {
  type: 'annotation' | 'relationship'
  id: string
}

// 标注模拟数据
export const mockAnnotation: AnnotationItem[] = [
  { id: '1', lineId: 2, start: 3, end: 5, content: '天蚕', type: '人物', description: '', color: '#3271ae' },
  { id: '2', lineId: 7, start: 5, end: 11, content: '第1497章', type: '章节', description: '', color: '#547689' },
  { id: '3', lineId: 8, start: 12, end: 30, content: '原本拥有圣龙之命，却被敌国武王以亿万', type: '章节', description: '', color: '#547689' },
  { id: '4', lineId: 25, start: 1, end: 3, content: '此时', type: '时间', description: '', color: '#547689' },
  { id: '5', lineId: 21, start: 2, end: 5, content: '青檀石', type: '物品', description: '', color: '#5c2d91' }
]

// 关系模拟数据
export const mockRelationship: RelationshipItem[] = [
  { id: '1-2', startId: '1', endId: '2', label: '', color: '#df970b' },
  { id: '1-3', startId: '1', endId: '3', label: '关系2', color: '#53df0b' },
  { id: '3-5', startId: '3', endId: '5', label: '关系3', color: '#722ed1' }
]

// 默认标注类型
export const defaultAnnotationTypes: AnnotationType[] = [
  { type: '人物', color: '#3271ae' },
  { type: '地点', color: '#547689' },
  { type: '组织', color: '#5c2d91' },
  { type: '时间', color: '#9c27b0' },
  { type: '事件', color: '#673ab7' },
  { type: '其他', color: '#9c27b0' }
]

// 常量配置
export const VIRTUAL_LIST_CONFIG = {
  BUFFER_SIZE: 5, // 可见区域缓冲区行数
  BOTTOM_THRESHOLD: 10, // 底部检测容差（px）
  BOTTOM_EXTRA_RATIO: 1 / 3 // 底部额外空间比例
} as const

