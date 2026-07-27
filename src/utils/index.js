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
 * times 为实际执行次数；每次执行前都会先延迟 interval，因此首次也不会立即执行。
 *
 * @template T
 * @param {() => T | Promise<T>} callback
 * @param {number} [times=10]
 * @param {number} [interval=500]
 * @returns {Promise<T | undefined>}
 */
export async function wait(callback, times = 10, interval = 500) {
  const total = Math.max(0, Math.floor(Number(times) || 0))
  let result

  for (let i = 0; i < total; i++) {
    await sleep(interval)
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
  return A && parseInt(n) == 1
    ? 'A'
    : ({
        1: '1',
        2: '2',
        3: '3',
        4: '4',
        5: '5',
        6: '6',
        7: '7',
        8: '8',
        9: '9',
        10: '10',
        11: 'J',
        12: 'Q',
        13: 'K'
      }[n] ?? '')
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

/** 卡牌名称缩写映射表：全名 → 短名，用于记牌器按钮等空间有限的 UI 展示 */
export const shortName = {
  乐不思蜀: '乐',
  兵粮寸断: '兵',
  八卦阵: '八卦',
  爪黄飞电: '爪黄+1',
  的卢: '的卢+1',
  绝影: '绝影+1',
  骅骝: '骅骝+1',
  赤兔: '赤兔-1',
  大宛: '大宛-1',
  紫骍: '紫骍-1',
  紫騂: '紫骍-1',
  诸葛连弩: '连弩',
  木牛流马: '木马',
  顺手牵羊: '顺手',
  万箭齐发: '万箭',
  五谷丰登: '五谷',
  无中生有: '无中',
  过河拆桥: '过拆',
  桃园结义: '桃园',
  无懈可击: '无懈',
  南蛮入侵: '南蛮',
  借刀杀人: '借刀',
  铁索连环: '铁索',
  随机应变: '随机',
  远交近攻: '远交',
  以逸待劳: '逸劳',
  知己知彼: '知己',
  逐近弃远: '逐近',
  洞烛先机: '洞烛',
  出其不意: '出其',
  水淹七军: '水淹',
  '无懈可击·国': '国无',
  挟天子以令诸侯: '挟令',
  方天画戟: '方天戟',
  雌雄双股剑: '雌雄剑',
  青龙偃月刀: '青龙刀',
  丈八蛇矛: '丈八矛',
  朱雀羽扇: '朱雀扇',
  白银狮子: '白银',
  三尖两刃刀: '三尖刀',
  乌铁锁链: '乌铁链',
  五行鹤翎扇: '五行扇',
  太公阴符: '太公符',
  无双方天戟: '无双戟',
  束发紫金冠: '紫金冠',
  玲珑狮蛮带: '玲珑带',
  红棉百花袍: '百花袍',
  红锦百花袍: '百花袍',
  四乘粮舆: '四乘舆',
  铁蒺玄舆: '铁蒺舆',
  飞轮战舆: '飞轮舆',
  鬼龙斩月刀: '鬼龙刀',
  国风玉袍: '国风袍',
  赤炎镇魂琴: '赤炎琴',
  奇门八阵: '奇门阵',
  绝尘金戈: '绝尘+1',
  修罗炼狱戟: '修罗戟',
  虚妄之冕: '虚妄冕',
  赤血青峰: '赤青锋',
  赤血青锋: '赤青锋',
  鸾凤和鸣剑: '鸾凤剑',
  七彩神鹿: '神鹿-1',
  金乌落日弓: '金乌弓',
  刑天破军斧: '刑天斧',
  长安大舰: '长安-2',
  禅让诏书: '诏书',
  镔铁双戟: '镔铁戟',
  继往开来: '继往',
  攻守兼备: '攻守',
  进退自如: '进退',
  洪荒之力: '洪荒',
  同舟共济: '同舟',
  力争上游: '力争',
  逆水行舟: '逆水',
  撒豆成兵: '撒豆',
  移花接木: '移花',
  联军盛宴: '联军',
  调虎离山: '调虎',
  火烧连营: '火烧',
  勠力同心: '勠力',
  调剂盐梅: '调剂',
  声东击西: '声东',
  增兵减灶: '增兵',
  草木皆兵: '草木',
  唯我独尊: '独尊',
  弃甲曳兵: '弃甲',
  金蝉脱壳: '金蝉',
  故步自封: '自封',
  金鼓笙旗: '金鼓',
  党同伐异: '伐异',
  燎原之火: '燎原',
  '八卦阵(复制)': '八卦',
  '仁王盾(复制)': '仁王盾',
  '藤甲(复制)': '藤甲',
  '白银狮子(复制)': '白银狮',
  商鞅变法: '变法',
  真龙长剑: '真龙剑',
  传国玉玺: '玉玺',
  厚积形: '厚积',
  桎梏形: '桎梏',
  盈冲形: '盈冲',
  背水形: '背水',
  整肃形: '整肃',
  寸兵形: '寸兵',
  雄黄酒: '酒',
  生死与共: '生死',
  红运当头: '红运',
  有难同当: '同当',
  落井下石: '落井',
  雷公助我: '雷公',
  两肋插刀: '两肋',
  兄弟齐心: '齐心',
  无天无界: '无界',
  你死我活: '死活',
  浑天仪: '浑天仪'
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
