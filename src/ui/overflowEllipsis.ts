/**
 * 统一的 `show-ellipsis` 溢出省略号管理。
 *
 * 解决的核心竞态：清空容器后，之前排队的 `requestAnimationFrame` 回调
 * 可能用旧的（或隐藏容器的）高度把 `show-ellipsis` 重新加回来。
 *
 * 用法：
 *   - 渲染/resize 后调用 `checkEllipsisOverflow(el, threshold?)`
 *   - 清空内容前调用 `invalidateEllipsisOverflow(el)`
 */

/**
 * 单行卡牌占位 40px，与溢出阈值零余量；卡内 `.card-name` 的 2px 文字阴影内边距
 * 会外扩到卡片盒之外并计入 scrollHeight，不留容差会把一张明牌误判为溢出。
 *
 * shortcut: 固定像素容差，卡牌行高或文字阴影尺寸变化时需重新校准。
 */
const OVERFLOW_TOLERANCE_PX = 4

const tokens = new WeakMap<object, number>()

/** 鸭子类型守卫：兼容浏览器 HTMLElement 和测试环境中的 mock 对象。 */
function isEllipsisHost(el: unknown): el is HTMLElement {
  if (!el || typeof el !== 'object') return false
  const obj = el as Record<string, unknown>
  const cl = obj.classList as Record<string, unknown> | undefined
  return (
    typeof cl?.add === 'function' &&
    typeof cl?.remove === 'function' &&
    typeof obj.clientHeight === 'number' &&
    typeof obj.scrollHeight === 'number'
  )
}

function nextToken(el: object): number {
  const t = (tokens.get(el) ?? 0) + 1
  tokens.set(el, t)
  return t
}

/**
 * 异步（rAF）检查容器是否溢出，溢出则添加 `show-ellipsis`，否则移除。
 *
 * @param threshold 溢出阈值，默认等于 `clientHeight`（即 `scrollHeight > clientHeight`）。
 *   传入固定值（如 40）时使用该值而非 `clientHeight`。判定统一附加
 *   `OVERFLOW_TOLERANCE_PX` 容差，吸收单行卡牌的内边距外扩。
 */
export function checkEllipsisOverflow(el: unknown, threshold?: number): void {
  if (!isEllipsisHost(el)) return

  const token = nextToken(el)

  requestAnimationFrame(() => {
    if (tokens.get(el) !== token) return
    const limit = threshold ?? el.clientHeight
    if (el.clientHeight > 0 && el.scrollHeight > limit + OVERFLOW_TOLERANCE_PX) {
      el.classList.add('show-ellipsis')
    } else {
      el.classList.remove('show-ellipsis')
    }
  })
}

/**
 * 使所有挂起的溢出检查失效，并同步移除 `show-ellipsis`。
 * 应在清空容器卡牌内容 **之前** 调用。
 */
export function invalidateEllipsisOverflow(el: unknown): void {
  if (!isEllipsisHost(el)) return
  nextToken(el)
  el.classList.remove('show-ellipsis')
}
