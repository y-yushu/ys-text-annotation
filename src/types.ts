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

// 实体标注类型
export interface AnnotationType {
  type: string // 类型（唯一标识）
  color: string // 颜色
}

// 关系类型
export interface RelationshipType {
  type: string // 类型（唯一标识）
  color: string // 颜色
}

// 关系选择器函数类型
export type relationshipTypeResolver = (startAnnotation: AnnotationItem, endAnnotation: AnnotationItem) => RelationshipType | string | null

// 关系类型过滤器函数类型
// 用于编辑关系时，根据当前关系信息过滤可选的关系类型列表
export type RelationshipTypeFilter = (relationship: RelationshipItem, startAnnotation: AnnotationItem, endAnnotation: AnnotationItem) => RelationshipType[]

// 标注验证器函数类型（选中文本阶段）
// 用于在选中文本后、显示编辑层前进行自定义验证
// 返回 { valid: true } 表示验证通过，允许显示编辑层
// 返回 { valid: false, message?: string } 表示验证失败，阻止显示编辑层，可选的 message 用于错误提示
export type AnnotationValidator = (
  selectedText: SelectedTextInfo,
  existingAnnotations: AnnotationItem[]
) => { valid: boolean; message?: string }

// 标注确认验证器函数类型（确认创建阶段）
// 用于在用户选择类型、输入描述后、确认创建前进行自定义验证
// 返回 { valid: true } 表示验证通过，允许创建标注
// 返回 { valid: false, message?: string } 表示验证失败，阻止创建标注，可选的 message 用于错误提示
export type AnnotationConfirmValidator = (
  annotation: Omit<AnnotationItem, 'id'>,
  existingAnnotations: AnnotationItem[]
) => { valid: boolean; message?: string }

// 关系验证器函数类型
// 用于在创建关系前进行自定义验证
// 返回 { valid: true } 表示验证通过，允许创建关系
// 返回 { valid: false, message?: string } 表示验证失败，阻止创建关系，可选的 message 用于错误提示
export type RelationshipValidator = (
  startAnnotation: AnnotationItem,
  endAnnotation: AnnotationItem,
  existingRelationships: RelationshipItem[]
) => { valid: boolean; message?: string }

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

// ==================== 自定义事件类型 ====================

/**
 * 数据变化事件详情
 */
export interface DataChangeEventDetail {
  type?: 'annotation-added' | 'annotation-updated' | 'annotation-deleted' | 'relationship-added' | 'relationship-updated' | 'relationship-deleted'
  annotations: AnnotationItem[]
  relationships: RelationshipItem[]
}

/**
 * 标注添加/更新事件详情
 */
export interface AnnotationEventDetail {
  annotation: AnnotationItem
}

/**
 * 标注删除事件详情
 */
export interface AnnotationDeleteEventDetail {
  id: string
  annotation: AnnotationItem
}

/**
 * 关系添加/更新事件详情
 */
export interface RelationshipEventDetail {
  relationship: RelationshipItem
}

/**
 * 关系删除事件详情
 */
export interface RelationshipDeleteEventDetail {
  id: string
  relationship: RelationshipItem
}

/**
 * 错误事件详情
 */
export interface ErrorEventDetail {
  message: string
  code?: string
  data?: any
}
