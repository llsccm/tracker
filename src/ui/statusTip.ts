import { TOOLTIP_BG } from '../utils/notification'

/**
 * 常驻状态提示（HUD）：面向**高频推送**数据的渲染通道。
 *
 * 与 `utils/notification` 的队列通知分工：
 * - `addTooltip`：一次性事件提示，按 duration 依次播放。高频调用会把队列堆满，
 *   既反复播放已经过期的旧值，也会把后面的重要提示挤到几十秒之后。
 * - `showStatusTip`：同一 key 只保留**最新**值。节点复用不销毁、帧内合并、文本脏检查，
 *   高频刷新既不排队也不闪烁；停止推送 duration 毫秒后自动淡出。
 *
 * 文本按纯文本渲染（`textContent`），不接受 HTML。
 */

const CONTAINER_ID = 'xcStatusTips'
/** 停止推送多久后自动淡出（非“显示时长”，每次推送都会续期） */
const DEFAULT_DURATION = 4000
const FADE_MS = 200

const CONTAINER_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'fixed',
  // 让开 acTooltip 的横幅位置（top 20px），避免两类提示互相遮挡
  top: '78px',
  left: '50%',
  transform: 'translateX(-50%)',
  // 比 acTooltip 低一层：重要的一次性提示重叠时应当压在状态提示之上
  zIndex: '2147483646',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '6px',
  pointerEvents: 'none'
}

const TIP_STYLE: Partial<CSSStyleDeclaration> = {
  display: 'none',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '10px 24px',
  backgroundColor: 'transparent',
  backgroundImage: TOOLTIP_BG,
  backgroundSize: '100% 100%',
  color: '#f2de9c',
  fontSize: '15px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Tahoma, Arial, sans-serif',
  whiteSpace: 'nowrap',
  textShadow: '0 0 4px rgba(0,0,0,0.6)',
  pointerEvents: 'auto',
  cursor: 'pointer',
  opacity: '0',
  transition: `opacity ${FADE_MS}ms ease`
}

type Timer = ReturnType<typeof setTimeout>

interface StatusTipEntry {
  element: HTMLElement
  /** 最新一次推送的文本 */
  text: string
  /** 已经写进 DOM 的文本，用于跳过无变化的重绘 */
  renderedText: string
  visible: boolean
  hideTimer: Timer | null
  fadeTimer: Timer | null
}

const entries = new Map<string, StatusTipEntry>()
const dirtyKeys = new Set<string>()
let rafScheduled = false

/**
 * 推送一条状态提示；同一 key 的旧值会被直接覆盖，不排队。
 *
 * @param key 状态槽标识，不同 key 在容器内纵向堆叠
 * @param text 纯文本内容，传空串等价于 `hideStatusTip(key)`
 * @param duration 停止推送后的自动淡出延迟，传 0 表示常驻直到手动隐藏
 */
export function showStatusTip(key: string, text: string, duration = DEFAULT_DURATION): void {
  if (!key) return

  const nextText = text == null ? '' : String(text)
  if (!nextText) {
    hideStatusTip(key)
    return
  }

  const entry = ensureEntry(key)
  if (!entry) return
  entry.text = nextText

  // 定时器只改内存状态，同步续期即可；DOM 写入统一推迟到下一帧。
  clearTimer(entry, 'hideTimer')
  if (duration > 0) entry.hideTimer = setTimeout(() => hideStatusTip(key), duration)

  // 文本没变且仍在显示中：本次推送不产生任何 DOM 操作，只是续期。
  if (entry.visible && entry.renderedText === nextText) return

  dirtyKeys.add(key)
  scheduleFlush()
}

/** 立即淡出指定状态槽；节点保留以便下次复用。 */
export function hideStatusTip(key: string): void {
  const entry = entries.get(key)
  if (!entry) return

  clearTimer(entry, 'hideTimer')
  dirtyKeys.delete(key)
  if (!entry.visible) return

  entry.visible = false
  entry.element.style.opacity = '0'
  clearTimer(entry, 'fadeTimer')
  entry.fadeTimer = setTimeout(() => {
    entry.fadeTimer = null
    // 淡出期间可能又来了新推送，此时不能把节点收起来
    if (!entry.visible) entry.element.style.display = 'none'
  }, FADE_MS)
}

/** 隐藏全部状态槽，用于对局结束等场景的统一收尾。 */
export function hideAllStatusTips(): void {
  entries.forEach((_entry, key) => hideStatusTip(key))
}

function scheduleFlush(): void {
  if (rafScheduled) return
  rafScheduled = true
  requestAnimationFrame(flush)
}

/** 一帧内合并所有推送，只对真正变化的槽位写 DOM。 */
function flush(): void {
  rafScheduled = false
  dirtyKeys.forEach((key) => {
    const entry = entries.get(key)
    if (!entry) return

    if (entry.renderedText !== entry.text) {
      entry.element.textContent = entry.text
      entry.renderedText = entry.text
    }
    if (!entry.visible) showEntry(entry)
  })
  dirtyKeys.clear()
}

function showEntry(entry: StatusTipEntry): void {
  clearTimer(entry, 'fadeTimer')
  entry.visible = true
  entry.element.style.display = 'flex'
  // display 生效后再改 opacity，否则浏览器不会产生淡入过渡
  requestAnimationFrame(() => {
    if (entry.visible) entry.element.style.opacity = '1'
  })
}

function ensureEntry(key: string): StatusTipEntry | null {
  const existing = entries.get(key)
  if (existing) {
    // 宿主页面可能整体重建 body，节点掉线时重新挂回容器
    if (!existing.element.isConnected) ensureContainer()?.appendChild(existing.element)
    return existing
  }

  const container = ensureContainer()
  if (!container) return null

  const element = document.createElement('div')
  element.className = 'ac-status-tip'
  element.dataset.statusTipKey = key
  Object.assign(element.style, TIP_STYLE)
  element.addEventListener('click', () => hideStatusTip(key))
  container.appendChild(element)

  const entry: StatusTipEntry = {
    element,
    text: '',
    renderedText: '',
    visible: false,
    hideTimer: null,
    fadeTimer: null
  }
  entries.set(key, entry)
  return entry
}

function ensureContainer(): HTMLElement | null {
  if (!document?.body) return null

  let container = document.getElementById(CONTAINER_ID)
  if (!container) {
    container = document.createElement('div')
    container.id = CONTAINER_ID
    Object.assign(container.style, CONTAINER_STYLE)
    document.body.appendChild(container)
  }
  return container
}

function clearTimer(entry: StatusTipEntry, field: 'hideTimer' | 'fadeTimer'): void {
  const timer = entry[field]
  if (timer === null) return
  clearTimeout(timer)
  entry[field] = null
}
