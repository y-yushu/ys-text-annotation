/**
 * 每一行位置信息的接口定义
 */
interface ItemPosition {
  index: number
  height: number
  top: number
  bottom: number
}

/**
 * 更新行高请求的接口定义
 */
interface HeightUpdate {
  index: number
  height: number
}

/**
 * 渲染范围的接口定义
 */
interface RenderRange {
  startIndex: number
  endIndex: number
  offset: number
  anchorIndex: number
}

/**
 * 高度更新返回的修正值接口
 */
interface UpdateCorrection {
  scrollCorrection: number
}

/**
 * 初始化配置接口
 */
interface VirtualCoreConfig {
  total: number
  defaultHeight: number
  buffer?: number
  onTotalHeightChange?: (totalHeight: number) => void
}

/**
 * 跳转回调接口
 */
interface ScrollToCallbacks {
  /** 需要滚动到新位置时调用，返回 Promise 表示滚动动画完成 */
  onScroll: (targetTop: number) => void | Promise<void>
  /** 跳转完成时调用 */
  onComplete?: (finalTop: number, iterations: number) => void
  /** 跳转被中断或失败时调用 */
  onAbort?: (reason: string) => void
}

/**
 * 跳转配置
 */
interface ScrollToOptions {
  /** 收敛阈值，位置差小于此值认为完成（默认为 defaultHeight） */
  threshold?: number
  /** 最大迭代次数（默认 10） */
  maxIterations?: number
}

/**
 * 跳转状态
 * - idle: 空闲
 * - scrolling: 正在执行滚动动画
 * - waiting: 滚动完成，等待高度更新
 */
type ScrollToStatus = 'idle' | 'scrolling' | 'waiting'

/**
 * 跳转上下文（内部使用）
 */
interface ScrollToContext {
  targetIndex: number
  /** 上一次迭代时目标索引的 top 值 */
  lastTop: number
  /** 当前迭代次数 */
  iterations: number
  maxIterations: number
  threshold: number
  callbacks: ScrollToCallbacks
  status: ScrollToStatus
  /** 在 scrolling 状态期间是否收到了高度更新 */
  pendingHeightUpdate: boolean
}

/**
 * VirtualCore: 虚拟列表无渲染逻辑内核 (TypeScript 版)
 *
 * 功能：
 * 1. 维护每一行的位置信息 (top, bottom, height)
 * 2. 根据滚动位置计算需要渲染的行范围
 * 3. 支持动态高度更新，并提供滚动锚定
 * 4. 支持动态调整列表总数
 * 5. 迭代收敛式精确跳转
 *
 * 注意事项：
 * - onTotalHeightChange 回调中不应该调用 VirtualCore 的任何修改方法，避免重入问题
 * - 对于超大列表（> 10万行），频繁的高度更新可能会有性能影响
 */
class VirtualCore {
  private total: number
  private defaultHeight: number
  private buffer: number
  private onTotalHeightChange?: (totalHeight: number) => void

  private positions: ItemPosition[] = []

  /** 跳转上下文 */
  private scrollToCtx: ScrollToContext | null = null

  constructor(config: VirtualCoreConfig) {
    this.total = config.total
    this.defaultHeight = config.defaultHeight
    this.buffer = config.buffer ?? 5
    this.onTotalHeightChange = config.onTotalHeightChange

    this._initPositions()
  }

  // ========================
  // 基础方法
  // ========================

  /**
   * 初始化位置表，预估初始高度
   */
  private _initPositions(): void {
    this.positions = []
    this.positions.length = this.total

    for (let i = 0; i < this.total; i++) {
      this.positions[i] = {
        index: i,
        height: this.defaultHeight,
        top: i * this.defaultHeight,
        bottom: (i + 1) * this.defaultHeight
      }
    }
    this._notifyHeightChange()
  }

  /**
   * 获取当前总高度
   */
  public getTotalHeight(): number {
    if (this.total === 0 || this.positions.length === 0) {
      return 0
    }
    const lastIndex = this.total - 1
    if (lastIndex >= this.positions.length) {
      return 0
    }
    return this.positions[lastIndex].bottom
  }

  /**
   * 获取渲染区间及偏移量 (核心用于 UI 渲染)
   */
  public getRenderRange(scrollTop: number, viewHeight: number): RenderRange {
    if (this.total === 0) {
      return {
        startIndex: 0,
        endIndex: -1,
        offset: 0,
        anchorIndex: 0
      }
    }

    const anchorIndex = Math.min(this._findStartIndex(scrollTop), this.total - 1)
    const startIndex = Math.max(0, anchorIndex - this.buffer)

    const endAnchor = this._findStartIndex(scrollTop + viewHeight)
    const endIndex = Math.min(this.total - 1, endAnchor + this.buffer)

    const offset = this.positions[startIndex].top

    return {
      startIndex,
      endIndex,
      offset,
      anchorIndex
    }
  }

  /**
   * 获取指定索引的 top 值（仅查询，不触发跳转）
   */
  public getTopByIndex(index: number): number {
    if (index < 0) return 0
    if (index >= this.total) return this.getTotalHeight()
    return this.positions[index].top
  }

  // ========================
  // 高度更新
  // ========================

  /**
   * 更新行高并返回修正值
   *
   * @param updates 实测到的真实高度数据集合
   * @param currentScrollTop 容器当前的滚动位置
   */
  public updateHeights(updates: HeightUpdate[], currentScrollTop: number): UpdateCorrection {
    if (updates.length === 0) {
      return { scrollCorrection: 0 }
    }

    const validUpdates = updates.filter(({ index }) => index >= 0 && index < this.total)

    if (validUpdates.length === 0) {
      return { scrollCorrection: 0 }
    }

    validUpdates.sort((a, b) => a.index - b.index)

    let scrollCorrection = 0
    let hasHeightChanged = false
    let firstChangedIndex = this.total

    validUpdates.forEach(({ index, height }) => {
      const item = this.positions[index]
      const oldHeight = item.height
      const diff = height - oldHeight

      if (diff !== 0) {
        hasHeightChanged = true

        if (index < firstChangedIndex) {
          firstChangedIndex = index
        }

        // 改进的滚动锚定逻辑
        // 只有当元素完全在视口上方时才进行补偿
        const itemTop = item.top
        if (itemTop + oldHeight <= currentScrollTop) {
          // 元素完全在视口上方
          scrollCorrection += diff
        }
        // 元素跨越视口边界或在视口内/下方，不补偿

        item.height = height
      }
    })

    if (hasHeightChanged) {
      this._recalculatePositions(firstChangedIndex)
      this._notifyHeightChange()

      // 标记有高度更新待处理
      if (this.scrollToCtx) {
        if (this.scrollToCtx.status === 'scrolling') {
          // 滚动进行中收到高度更新，标记待处理
          this.scrollToCtx.pendingHeightUpdate = true
        } else if (this.scrollToCtx.status === 'waiting') {
          // 已经在等待状态，直接检查收敛
          this._checkScrollToConvergence()
        }
      }
    }

    return { scrollCorrection }
  }

  // ========================
  // 迭代收敛式跳转
  // ========================

  /**
   * 开始跳转到指定索引（迭代收敛式）
   *
   * @param index 目标行索引
   * @param callbacks 回调函数
   * @param options 配置选项
   */
  public scrollToIndex(index: number, callbacks: ScrollToCallbacks, options?: ScrollToOptions): void {
    // 边界处理
    if (index < 0) index = 0
    if (index >= this.total) index = Math.max(0, this.total - 1)

    // 如果列表为空，直接完成
    if (this.total === 0) {
      callbacks.onComplete?.(0, 0)
      return
    }

    // 如果已有跳转进行中，先中断
    if (this.scrollToCtx) {
      this._abortScrollTo('new scroll requested')
    }

    const threshold = options?.threshold ?? this.defaultHeight
    const maxIterations = options?.maxIterations ?? 10
    const targetTop = this.positions[index].top

    // 初始化跳转上下文
    this.scrollToCtx = {
      targetIndex: index,
      lastTop: targetTop, // 记录初始目标位置
      iterations: 0,
      maxIterations,
      threshold,
      callbacks,
      status: 'idle',
      pendingHeightUpdate: false
    }

    // 触发第一次滚动
    this._doScroll(targetTop)
  }

  /**
   * 手动中断当前跳转
   */
  public abortScrollTo(): void {
    this._abortScrollTo('manually aborted')
  }

  /**
   * 检查是否正在跳转中
   */
  public isScrolling(): boolean {
    return this.scrollToCtx !== null
  }

  /**
   * 通知滚动动画完成（外部调用）
   *
   * 当外部滚动动画完成后，应调用此方法通知 VirtualCore
   * 这样可以在下一次 updateHeights 时检查收敛
   */
  public notifyScrollComplete(): void {
    if (!this.scrollToCtx || this.scrollToCtx.status !== 'scrolling') {
      return
    }

    // 处理竞态：检查是否有待处理的高度更新
    this.scrollToCtx.pendingHeightUpdate = false
    this.scrollToCtx.status = 'waiting'

    // [修复1] 每次滚动完成后都检查收敛
    this._checkScrollToConvergence()
  }

  /**
   * 执行滚动
   */
  private _doScroll(targetTop: number): void {
    if (!this.scrollToCtx) return

    this.scrollToCtx.status = 'scrolling'
    this.scrollToCtx.iterations++
    this.scrollToCtx.pendingHeightUpdate = false // 重置待处理标记

    // 保存当前上下文引用，用于在回调中判断上下文是否已变化
    const currentCtx = this.scrollToCtx

    const result = currentCtx.callbacks.onScroll(targetTop)

    // 统一处理同步和异步情况
    if (result instanceof Promise) {
      // 异步情况：等待 Promise 完成后通知
      result
        .then(() => {
          // 只有上下文未变化时才处理，防止误操作新的跳转
          if (this.scrollToCtx === currentCtx) {
            this.notifyScrollComplete()
          }
        })
        .catch(() => {
          // 同样检查上下文
          if (this.scrollToCtx === currentCtx) {
            this._abortScrollTo('scroll failed')
          }
        })
    } else {
      // 同步情况：使用 microtask 延迟通知
      queueMicrotask(() => {
        // 检查上下文是否仍然是同一个，且状态仍为 scrolling
        if (this.scrollToCtx === currentCtx && currentCtx.status === 'scrolling') {
          this.notifyScrollComplete()
        }
      })
    }
  }

  /**
   * 检查跳转是否收敛
   */
  private _checkScrollToConvergence(): void {
    const ctx = this.scrollToCtx
    if (!ctx || ctx.status !== 'waiting') return

    const currentTop = this.positions[ctx.targetIndex].top
    const diff = Math.abs(currentTop - ctx.lastTop)

    // 检查是否收敛：位置变化小于阈值
    if (diff <= ctx.threshold) {
      // 收敛完成
      const finalTop = currentTop
      const iterations = ctx.iterations
      const callbacks = ctx.callbacks

      this.scrollToCtx = null
      callbacks.onComplete?.(finalTop, iterations)
      return
    }

    // 检查是否超过最大迭代次数
    if (ctx.iterations >= ctx.maxIterations) {
      this._abortScrollTo(`max iterations (${ctx.maxIterations}) reached`)
      return
    }

    // 继续迭代：更新 lastTop 并再次滚动
    ctx.lastTop = currentTop
    this._doScroll(currentTop)
  }

  /**
   * 中断跳转
   */
  private _abortScrollTo(reason: string): void {
    if (!this.scrollToCtx) return

    const callbacks = this.scrollToCtx.callbacks
    this.scrollToCtx = null
    callbacks.onAbort?.(reason)
  }

  // ========================
  // 列表管理
  // ========================

  /**
   * 动态设置列表总数
   */
  public setTotal(newTotal: number): void {
    if (newTotal < 0) {
      newTotal = 0
    }

    if (newTotal === this.total) return

    // 如果正在跳转，检查目标是否还有效
    if (this.scrollToCtx && this.scrollToCtx.targetIndex >= newTotal) {
      this._abortScrollTo('target index out of range after setTotal')
    }

    if (newTotal > this.total) {
      const oldTotal = this.total
      const lastBottom = oldTotal > 0 && this.positions.length > 0 ? this.positions[oldTotal - 1].bottom : 0

      // 预先扩展数组长度
      this.positions.length = newTotal

      for (let i = oldTotal; i < newTotal; i++) {
        this.positions[i] = {
          index: i,
          height: this.defaultHeight,
          top: lastBottom + (i - oldTotal) * this.defaultHeight,
          bottom: lastBottom + (i - oldTotal + 1) * this.defaultHeight
        }
      }
    } else {
      this.positions.length = newTotal
    }

    this.total = newTotal
    this._notifyHeightChange()
  }

  /**
   * 获取当前列表总数
   */
  public getTotal(): number {
    return this.total
  }

  /**
   * 获取指定索引的位置信息
   * 返回深拷贝，防止外部修改内部状态
   */
  public getItemPosition(index: number): ItemPosition | null {
    if (index < 0 || index >= this.total) return null
    return { ...this.positions[index] }
  }

  /**
   * 重置所有位置信息
   */
  public reset(newTotal?: number): void {
    // 中断进行中的跳转
    if (this.scrollToCtx) {
      this._abortScrollTo('reset called')
    }

    if (newTotal !== undefined) {
      this.total = newTotal < 0 ? 0 : newTotal
    }
    this._initPositions()
  }

  /**
   * 获取当前默认行高
   */
  public getDefaultHeight(): number {
    return this.defaultHeight
  }

  // ========================
  // 私有工具方法
  // ========================

  /**
   * 从指定索引开始，重新计算所有后续行的 top 和 bottom
   */
  private _recalculatePositions(fromIndex: number): void {
    for (let i = fromIndex; i < this.total; i++) {
      if (i === 0) {
        this.positions[i].top = 0
      } else {
        this.positions[i].top = this.positions[i - 1].bottom
      }
      this.positions[i].bottom = this.positions[i].top + this.positions[i].height
    }
  }

  /**
   * 二分查找：找到第一个 bottom > scrollTop 的索引
   * 当 scrollTop 超出范围时返回 this.total
   */
  private _findStartIndex(scrollTop: number): number {
    if (this.positions.length === 0) return 0

    const lastIndex = this.positions.length - 1

    if (scrollTop <= 0) return 0

    if (scrollTop >= this.positions[lastIndex].bottom) {
      return this.total
    }

    let low = 0
    let high = lastIndex

    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      const midBottom = this.positions[mid].bottom

      if (midBottom > scrollTop) {
        if (mid === 0 || this.positions[mid - 1].bottom <= scrollTop) {
          return mid
        }
        high = mid - 1
      } else {
        low = mid + 1
      }
    }

    return 0
  }

  /**
   * 通知外部总高度发生变化
   */
  private _notifyHeightChange(): void {
    if (this.onTotalHeightChange) {
      this.onTotalHeightChange(this.getTotalHeight())
    }
  }
}

export default VirtualCore
export type { ItemPosition, HeightUpdate, RenderRange, UpdateCorrection, VirtualCoreConfig, ScrollToCallbacks, ScrollToOptions }
