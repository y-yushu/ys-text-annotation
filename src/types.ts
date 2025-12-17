// 类型定义和常量

// ==================== 控制器常量 ====================

/**
 * 功能模式常量
 * 用于控制当前组件处于什么功能状态
 */
export const FunctionMode = {
  /** 默认展示模式 - 可以正常浏览、选择文本 */
  DEFAULT: 'default',
  /** 创建/编辑标注模式 - 正在创建或编辑标注，编辑层已显示（通过 editingAnnotationId 区分新增/编辑） */
  CREATING_ANNOTATION: 'creating_annotation',
  /** 创建关系模式 - 正在创建关系，需要选择目标标注 */
  CREATING_RELATIONSHIP: 'creating_relationship',
  /** 右键菜单模式 - 右键菜单已打开 */
  CONTEXT_MENU_OPEN: 'context_menu_open'
} as const

export type FunctionModeType = (typeof FunctionMode)[keyof typeof FunctionMode]

/**
 * 层级显示模式常量
 * 用于控制层级的视觉突出显示
 */
export const LayerDisplayMode = {
  /** 突出虚拟列表（默认状态）- 关系层半透明 */
  HIGHLIGHT_VIRTUAL_LIST: 'highlight_virtual_list',
  /** 突出显示标注关系 - 关系层完全显示，虚拟列表层变暗 */
  HIGHLIGHT_RELATIONSHIP: 'highlight_relationship'
} as const

export type LayerDisplayModeType = (typeof LayerDisplayMode)[keyof typeof LayerDisplayMode]

// ==================== 数据类型 ====================

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

export interface RelationshipType {
  type: string
  color: string
}

// 关系
export interface RelationshipItem {
  id: string // 唯一标识
  startId: string // 起点节点
  endId: string // 结束节点
  type: string // 关系描述
  description: string // 关系描述
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
  startPos: { x: number; y: number }
  endPos: { x: number; y: number }
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
  { id: '1765954019048', lineId: 0, start: 9, end: 11, content: '年底', type: '时间', description: '', color: '#9c27b0' },
  { id: '1765954058058', lineId: 0, start: 169, end: 171, content: '四叔', type: '人物', description: '', color: '#3271ae' },
  { id: '1765954040241', lineId: 0, start: 266, end: 269, content: '康有为', type: '人物', description: '', color: '#3271ae' },
  { id: '1765954112451', lineId: 24, start: 1, end: 6, content: '阿!地狱?', type: '事件', description: '', color: '#673ab7' },
  { id: '1765954154117', lineId: 60, start: 121, end: 130, content: '鬼神者二气之良能也', type: '事件', description: '', color: '#673ab7' },
  { id: '1765954176990', lineId: 88, start: 18, end: 21, content: '白篷船', type: '地点', description: '', color: '#547689' },
  { id: '1765954195982', lineId: 194, start: 45, end: 48, content: '祥林嫂', type: '人物', description: '', color: '#3271ae' },
  { id: '1765954219631', lineId: 224, start: 0, end: 10, content: '一九二四年二月七日。', type: '时间', description: '', color: '#9c27b0' }
]

// 关系模拟数据
export const mockRelationship: RelationshipItem[] = [
  { id: 'rel-1765954296761', startId: '1765954058058', endId: '1765954040241', type: '关联/社交', description: '人物之间的社交联系', color: '#E91E63' },
  { id: 'rel-1765954317682', startId: '1765954019048', endId: '1765954058058', type: '隶属/职位', description: '', color: '#2196F3' },
  { id: 'rel-1765954350003', startId: '1765954040241', endId: '1765954195982', type: '参与/执行', description: '', color: '#4CAF50' },
  { id: 'rel-1765954376228', startId: '1765954195982', endId: '1765954219631', type: '发生于', description: '事件发生的时间点', color: '#FF9800' },
  { id: 'rel-1765954396334', startId: '1765954219631', endId: '1765954154117', type: '地点位于', description: '事件发生的地理位置', color: '#00BCD4' },
  { id: 'rel-1765954415565', startId: '1765954154117', endId: '1765954176990', type: '因果关系', description: '两个事件之间的逻辑因果', color: '#F44336' }
]

// 默认标注类型
export const defaultAnnotationTypes: AnnotationType[] = [
  { type: '人物', color: '#3271ae' },
  { type: '地点', color: '#547689' },
  { type: '时间', color: '#9c27b0' },
  { type: '事件', color: '#673ab7' }
]

export const defaultRelationshipTypes: RelationshipType[] = [
  // 社交与归属
  { type: '关联/社交', color: '#E91E63' }, // 人物-人物
  { type: '隶属/职位', color: '#2196F3' }, // 人物-组织/地点
  // 行为与参与
  { type: '参与/执行', color: '#4CAF50' }, // 人物-事件
  { type: '目击/报道', color: '#8BC34A' }, // 人物-事件
  // 时空定位
  { type: '发生于', color: '#FF9800' }, // 事件-时间 或 人物-时间
  { type: '地点位于', color: '#00BCD4' }, // 事件-地点 或 人物-地点
  // 逻辑关联
  { type: '因果关系', color: '#F44336' }, // 事件-事件
  { type: '构成/包含', color: '#9E9E9E' } // 实体间的组成关系
]

// 常量配置
export const VIRTUAL_LIST_CONFIG = {
  BUFFER_SIZE: 5, // 可见区域缓冲区行数
  BOTTOM_THRESHOLD: 100, // 底部检测容差（px），增大此值以确保在接近底部时能正确识别
  BOTTOM_EXTRA_RATIO: 1 / 3 // 底部额外空间比例
} as const
