export function hpColor(maxHp, hp) {
  maxHp = Number(maxHp)
  hp = Number(hp)
  if (!(maxHp > 0) || !Number.isFinite(hp)) return 0
  if (hp <= Math.floor(maxHp / 3)) return 1
  if (hp <= Math.floor((maxHp / 3) * 2)) return 2
  return 3
}

const HP_COLOR_LABEL = ['', '红', '黄', '绿']

export function hpColorTipText(maxHp, events) {
  maxHp = Number(maxHp)
  if (!(maxHp > 0)) return ''
  return [
    [Math.floor((maxHp / 3) * 2), 2],
    [Math.floor(maxHp / 3), 1]
  ]
    .filter(([hp]) => hp > 0)
    .map(([hp, color]) => {
      const name = events.find(({ colors }) => colors.includes(color))?.name
      return `${hp}血${HP_COLOR_LABEL[color]}${name ? `[${name}]` : ''}`
    })
    .join('\n')
}

export function sleep(time, value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), time))
}

/**
 * 轮询等待 callback 返回真值。
 * times 为实际执行次数；默认每次执行前都会先延迟 interval。
 *
 * @template T
 * @param {() => T | Promise<T>} callback
 * @param {number} [times=10]
 * @param {number} [interval=500]
 * @param {{ immediate?: boolean }} [options]
 * @returns {Promise<T | undefined>}
 */
export async function wait(callback, times = 10, interval = 500, { immediate = false } = {}) {
  const total = Math.max(0, Math.floor(Number(times) || 0))
  let result

  for (let i = 0; i < total; i++) {
    if (!immediate || i > 0) await sleep(interval)
    result = await Promise.resolve(callback())
    if (result) return result
  }

  return result
}

/**
 * 点数编号转显示文本（1→A, 11→J, 12→Q, 13→K）
 * @param {number} n - 点数编号
 * @param {boolean} A - 是否将 1 显示为 'A'（默认 true）
 * @returns {string} 点数显示文本
 */
export function n2N(n, A = true) {
  const ranks = ['', A ? 'A' : 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K']
  return String(ranks[n] ?? '')
}

/**
 * 花色编号转花色符号
 * @param {number} n - 花色编号（1♥ 2♦ 3♠ 4♣）
 * @returns {string} 花色符号字符
 */
export function n2C(n) {
  return ['', '♥', '♦', '♠', '♣'][n] ?? ''
}

/** 生成卡牌花色+点数的 HTML（如 ♥A），含颜色样式和长文本适配 */
function getCardCnHtml(color, number) {
  const suit = n2C(color)
  const rank = n2N(number)
  const rawCnText = suit + rank
  const cnClass = rawCnText.length >= 3 ? 'card-cn card-cn-long' : 'card-cn'
  const suitClass = getSuitClass(color)
  const className = suitClass ? `${cnClass} ${suitClass}` : cnClass
  return `<span class="${className}">${getSuitGlyphHtml(suit)}<span class="rank-glyph">${rank}</span></span>`
}

/**
 * 生成卡牌正面的完整 HTML：花色点数 + 牌名（最多2字）
 * @param {object} card - allCard 中的卡牌对象
 * @returns {string} HTML 字符串
 */
export function getCardFaceHtml(card = {}) {
  return `${getCardCnHtml(card.color, card.number)}<span class="card-name">${String(card.name || '').substring(0, 2)}</span>`
}

/** 根据花色编号获取 CSS 类名 */
function getSuitClass(color) {
  return SUIT_CLASS[color] || ''
}

/** 生成花色符号的 HTML span 元素（带对应颜色类名） */
function getSuitGlyphHtml(suit, suitClass = '') {
  if (!suit) return ''
  const glyphClass = suitClass ? `suit-glyph ${suitClass}` : 'suit-glyph'
  return `<span class="${glyphClass}">${suit}</span>`
}

/** 将文本中的花色符号（♥♦♠♣）替换为带样式的 HTML span */
export function toSuitGlyphHtml(text = '') {
  return String(text || '').replace(/[♥♦♠♣]/g, (suit) =>
    getSuitGlyphHtml(suit, SUIT_CLASS_BY_TEXT[suit] || '')
  )
}

/** 花色编号 → CSS 类名映射 */
const SUIT_CLASS = ['', 'suit-heart', 'suit-diamond', 'suit-spade', 'suit-club']
/** 花色符号 → CSS 类名映射 */
const SUIT_CLASS_BY_TEXT = {
  '♥': 'suit-heart',
  '♦': 'suit-diamond',
  '♠': 'suit-spade',
  '♣': 'suit-club'
}

export function updateResult(html) {
  if (typeof document === 'undefined') return
  const result = document.getElementById('result')
  if (!result) return
  result.innerHTML = html
}

export function setSuitRecord(text = '', prefix = '') {
  if (typeof document === 'undefined') return
  const target = document.getElementById('suit')
  if (!target) return
  target.innerHTML = prefix + toSuitGlyphHtml(text)
}
