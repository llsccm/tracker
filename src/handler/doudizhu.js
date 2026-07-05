import { laya } from '@/runtime/gameAdapter'

export function hasRuntime() {
  if (isDoudizhuRuntimeReady()) return true

  const runtimeCode = laya.__RUNTIME__
  if (!runtimeCode) return false

  getDoudizhuRuntimeContext()

  const runtime = (0, eval)(runtimeCode)
  if (!installDoudizhuRuntime(runtime)) return false

  return true
}

const TRACKER_ID = 'sgs-ddz-tracker'
const STYLE_ID = 'sgs-ddz-tracker-style'
const RANK_ORDER = ['BJ', 'SJ', '2', 'A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3']
const RANK_LABELS = {
  A: 'A',
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  J: 'J',
  Q: 'Q',
  K: 'K',
  SJ: '小王',
  BJ: '大王'
}
const SPELL_LABELS = {
  1: '仁德',
  2: '武圣',
  3: '观星',
  4: '冲阵',
  5: '铁骑',
  6: '奇才',
  7: '制衡',
  8: '奇袭',
  9: '克己',
  10: '苦肉',
  11: '英姿',
  12: '国色',
  13: '连营',
  14: '奸雄',
  15: '反馈',
  16: '刚烈',
  17: '突袭',
  18: '遗计',
  19: '洛神',
  20: '急救',
  21: '无双',
  22: '闭月',
  23: '烈弓',
  24: '奇谋',
  25: '严整',
  26: '红颜',
  27: '不屈',
  28: '鬼道',
  29: '蛊惑',
  30: '伪帝',
  31: '妄尊',
  32: '天义',
  33: '猛进',
  34: '双雄',
  35: '血裔',
  36: '断粮',
  37: '暴虐',
  38: '缔盟',
  39: '享乐',
  40: '激昂',
  41: '化身',
  42: '丰姿',
  43: '伏骑',
  44: '节命',
  45: '挑衅',
  46: '破军',
  47: '权计',
  100: '强易'
}
function createSeat(seat) {
  return {
    seat,
    order: null,
    role: 'unknown',
    knownIds: new Set(),
    spellAreas: {}
  }
}

const tracker = {
  bottomDom: null,
  seatDoms: {
    0: null,
    1: null,
    2: null
  },
  mountTimer: 0,
  landlordSeat: null,
  myid: null,
  seenIds: new Set(),
  seats: {
    0: createSeat(0),
    1: createSeat(1),
    2: createSeat(2)
  }
}

const doudizhuRuntime = {
  handleMove: null
}

function suit(color) {
  return { 1: '♠', 2: '♥', 3: '♣', 4: '♦' }[Number(color)] || ''
}

function rank(point) {
  point = Number(point)
  return { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[point] || (point ? String(point) : '')
}

function parseJoker(name) {
  const text = String(name || '').toLowerCase()
  if (!text) return null
  if (/big|red|color|大王|joker2|joker_b|bjoker/.test(text)) return 'BJ'
  if (/small|black|小王|joker1|joker_a|sjoker/.test(text)) return 'SJ'
  if (/joker|king|王/.test(text)) return 'BJ'
  return null
}

function normalizeRank(card) {
  if (!card) return null
  const joker = parseJoker(card.Name || card.CardName || card.cardName || card.name || '')
  if (joker) return joker

  const point =
    Number(
      card.CardNumber ??
        card.cardNumber ??
        card.Number ??
        card.number ??
        card.Point ??
        card.point ??
        0
    ) || 0

  if (point === 14) return 'A'
  if (point === 15) return '2'
  if (point === 16) return 'SJ'
  if (point === 17) return 'BJ'

  const value = rank(point)
  return RANK_ORDER.includes(value) ? value : null
}

class DoudizhuMoveCard {
  static ZONE_INVALID = 0
  static ZONE_CARDPILE_START = 100
  static ZONE_CARDPILE = 101
  static ZONE_DISCARDPILE = 103
  static ZONE_THREECRAD = 104
  static ZONE_HAND = 201
  static ZONE_EQUIP = 202
  static ZONE_SPELL = 203
  static ZONE_STACK = 204
  static ZONE_RECYCLE = 7
  static Mode_Invalid = 0
  static move_type_system = 1
  static Mode_Deal = 2
  static Mode_DisCard = 3
  static Mode_Take = 4
  static Mode_MoveTo = 5
  static Mode_Exchange = 6
  static move_type_give = 7
  static Mode_Equip_Replace = 8
  static move_type_equip = 9
  static Mode_Get = 10
  static move_type_distroy = 11
  static move_type_create = 12
  static Mode_Back = 13
  static Mode_Play = 14
  static Mode_Only_Show = 15
  static Mode_Show = 16
  static Mode_Recast = 17
  static Mode_GAMEOVER_NOTIFY = 18
}

function toCard(card, index = 0) {
  if (!card) return null
  const normalizedRank = normalizeRank(card)
  if (!normalizedRank) return null
  const color = card.Color ?? card.color ?? null
  const cardId = card.cardId ?? card.CardId ?? card.card_id ?? card.id ?? card.ID ?? null
  const cardSuit = normalizedRank === 'SJ' || normalizedRank === 'BJ' ? '' : suit(color)
  return {
    index: index + 1,
    cardId,
    color,
    rank: normalizedRank,
    suit: cardSuit,
    text: `${RANK_LABELS[normalizedRank]}${cardSuit}`
  }
}

function decodeCardMetaFromId(cardId) {
  const value = Number(cardId)
  if (!(value > 0)) return null
  const color = Math.floor(value / 10000) || null
  const point = Math.floor(value / 100) % 100 || null
  if (!point) return null
  return {
    CardId: value,
    CardNumber: point,
    Color: color
  }
}

function toCardFromId(cardId, index = 0) {
  return toCard(decodeCardMetaFromId(cardId), index)
}

function getCardId(card) {
  return Number(card?.cardId ?? card?.CardId ?? card?.card_id) || 0
}

function getMessage(arg) {
  if (!arg || typeof arg !== 'object') return null
  if (arg.ProtoObj && typeof arg.ProtoObj === 'object') return arg.ProtoObj
  return arg
}

function sortCardIds(cardIds) {
  return [...cardIds].sort((leftId, rightId) => {
    const left = toCardFromId(leftId)
    const right = toCardFromId(rightId)
    if (!left && !right) return leftId - rightId
    if (!left) return 1
    if (!right) return -1
    const rankDiff = RANK_ORDER.indexOf(left.rank) - RANK_ORDER.indexOf(right.rank)
    if (rankDiff !== 0) return rankDiff
    const suitOrder = { 4: 0, 1: 1, 3: 2, 2: 3 }
    const colorDiff = (suitOrder[left.color] ?? 99) - (suitOrder[right.color] ?? 99)
    if (colorDiff !== 0) return colorDiff
    return leftId - rightId
  })
}

function getSeatCardsText(seat) {
  if (!seat) return []
  return sortCardIds(seat.knownIds)
    .map((cardId) => toCardFromId(cardId))
    .filter(Boolean)
    .map((card) => card.text)
}

function getSpellAreasText(seat) {
  if (!seat) return []
  return Object.keys(seat.spellAreas)
    .map((areaId) => Number(areaId))
    .filter((areaId) => areaId > 0)
    .sort((left, right) => left - right)
    .map((areaId) => {
      const cards = sortCardIds(seat.spellAreas[areaId])
        .map((cardId) => toCardFromId(cardId))
        .filter(Boolean)
        .map((card) => card.text)
      return {
        areaId,
        cards
      }
    })
    .filter((area) => area.cards.length)
}

function isStandardRemainingKey(cardId) {
  const value = Number(cardId)
  return value > 0 && value % 100 === 0
}

function getRemainingRankCounts() {
  const rankCounts = Object.fromEntries(
    RANK_ORDER.map((rankName) => [rankName, rankName === 'SJ' || rankName === 'BJ' ? 1 : 4])
  )
  tracker.seenIds.forEach((cardId) => {
    if (!isStandardRemainingKey(cardId)) return
    const card = toCardFromId(cardId)
    if (!card) return
    rankCounts[card.rank] = Math.max(0, (rankCounts[card.rank] || 0) - 1)
  })
  return rankCounts
}

function getBottomCardRoot() {
  return globalThis.CS?.UnityEngine?.GameObject?.Find?.('dizhuCard') || null
}

// function getAnchorTarget(gameObject) {
//   if (!gameObject) return null
//   if (gameObject.name === 'dizhuCard') return gameObject
//   return (
//     gameObject.transform?.Find?.('seatTipLayer')?.gameObject ||
//     gameObject.transform?.Find?.('SeatTopContainer')?.gameObject ||
//     gameObject.transform?.Find?.('SeatBottomContainer')?.gameObject ||
//     gameObject
//   )
// }

function getCanvasMetrics() {
  const canvas = document.querySelector('canvas')
  const rect = canvas?.getBoundingClientRect?.()
  if (!rect) return null
  const width = Number(canvas?.width) || rect.width || 1
  const height = Number(canvas?.height) || rect.height || 1
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    scaleX: rect.width / width,
    scaleY: rect.height / height
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function updateResponsiveVars() {
  const canvas = getCanvasMetrics()
  if (!canvas) return
  const root = document.documentElement
  const bottomWidth = clamp(canvas.width * 0.42, 420, 560)
  const seatWidth = clamp(canvas.width * 0.1, 108, 180)
  const panelPadY = clamp(canvas.height * 0.004, 2, 4)
  const panelPadX = clamp(canvas.width * 0.006, 6, 10)
  const titleSize = clamp(canvas.width * 0.009, 10, 12)
  const textSize = clamp(canvas.width * 0.0085, 10, 12)
  const gap = clamp(canvas.width * 0.0035, 2, 4)
  const topGap = clamp(canvas.height * 0.015, 8, 16)
  const sideGap = clamp(canvas.width * 0.008, 8, 16)
  const sideY = clamp(canvas.height * 0.46, canvas.height * 0.38, canvas.height * 0.52)

  root.style.setProperty('--ddz-bottom-width', `${bottomWidth}px`)
  root.style.setProperty('--ddz-seat-width', `${seatWidth}px`)
  root.style.setProperty('--ddz-panel-pad-y', `${panelPadY}px`)
  root.style.setProperty('--ddz-panel-pad-x', `${panelPadX}px`)
  root.style.setProperty('--ddz-title-size', `${titleSize}px`)
  root.style.setProperty('--ddz-text-size', `${textSize}px`)
  root.style.setProperty('--ddz-gap', `${gap}px`)
  root.style.setProperty('--ddz-top-gap', `${topGap}px`)
  root.style.setProperty('--ddz-side-gap', `${sideGap}px`)
  root.style.setProperty('--ddz-side-y', `${sideY}px`)
}

function getBottomAnchor() {
  const canvas = getCanvasMetrics()
  if (!canvas) return null
  return {
    left: canvas.left + canvas.width / 2,
    top: canvas.top + clamp(canvas.height * 0.005, 3, 5)
  }
}

function getSeatSide(seat) {
  const mySeat = tracker.seats[tracker.myid]
  if (!seat || !mySeat || seat.seat === tracker.myid) return null
  if (seat.order == null || mySeat.order == null) return null
  const rightOrder = mySeat.order === 3 ? 1 : mySeat.order + 1
  const leftOrder = mySeat.order === 1 ? 3 : mySeat.order - 1
  if (seat.order === leftOrder) return 'left'
  if (seat.order === rightOrder) return 'right'
  return null
}

function getOpponentAnchor(side, dom = null) {
  const canvas = getCanvasMetrics()
  if (!canvas) return null
  if (side !== 'left' && side !== 'right') return null
  const gap = clamp(canvas.width * 0.008, 8, 16)
  const halfWidth = (dom?.offsetWidth || 0) / 2
  const sideX =
    side === 'left' ? canvas.left + halfWidth + gap : canvas.left + canvas.width - halfWidth - gap
  const centerY =
    canvas.top + clamp(canvas.height * 0.46, canvas.height * 0.38, canvas.height * 0.52)
  return {
    left: sideX,
    top: centerY
  }
}

// function getRectTransformOffset(tf) {
//   let x = 0
//   let y = 0
//   let cur = tf

//   while (cur?.parent) {
//     x += Number(cur.anchoredPosition?.x ?? 0)
//     y += Number(cur.anchoredPosition?.y ?? 0)
//     if (cur.parent?.name === 'Canvas') break
//     cur = cur.parent
//   }

//   return { x, y }
// }

// function getScreenAnchor(gameObject, offsetY = 0) {
//   if (!gameObject) return null
//   const target = getAnchorTarget(gameObject)
//   const tf = target?.transform
//   const canvas = getCanvasMetrics()
//   if (!tf || !canvas) return null
//   const pos = getRectTransformOffset(tf)
//   const height = Number(tf.rect?.height ?? 0)
//   return {
//     left: canvas.left + canvas.width / 2 + pos.x * canvas.scaleX,
//     top:
//       canvas.top +
//       canvas.height / 2 -
//       pos.y * canvas.scaleY +
//       (height * canvas.scaleY) / 2 +
//       offsetY
//   }
// }

function clearDom(key, seat = null) {
  if (key === 'bottom') {
    tracker.bottomDom?.remove?.()
    tracker.bottomDom = null
    return
  }
  tracker.seatDoms[seat]?.remove?.()
  tracker.seatDoms[seat] = null
}

function hasMountedDom() {
  return Boolean(
    tracker.bottomDom?.isConnected ||
    Object.values(tracker.seatDoms).some((dom) => dom?.isConnected)
  )
}

function syncMountedDom() {
  updateResponsiveVars()
  const bottomRoot = getBottomCardRoot()
  if (!bottomRoot) {
    clearDom('bottom')
    clearDom('seat', 0)
    clearDom('seat', 1)
    clearDom('seat', 2)
    if (tracker.mountTimer && !hasMountedDom()) {
      window.clearInterval(tracker.mountTimer)
      tracker.mountTimer = 0
    }
    return
  }

  if (tracker.bottomDom) {
    const anchor = getBottomAnchor()
    if (!anchor) {
      clearDom('bottom')
    } else {
      tracker.bottomDom.style.left = `${anchor.left}px`
      tracker.bottomDom.style.top = `${anchor.top}px`
    }
  }

  Object.keys(tracker.seatDoms).forEach((seat) => {
    const dom = tracker.seatDoms[seat]
    if (!dom) return
    const seatData = tracker.seats[seat]
    const anchor = getOpponentAnchor(getSeatSide(seatData), dom)
    if (!anchor) {
      clearDom('seat', Number(seat))
      return
    }
    dom.style.left = `${anchor.left}px`
    dom.style.top = `${anchor.top}px`
  })

  if (tracker.mountTimer && !hasMountedDom()) {
    window.clearInterval(tracker.mountTimer)
    tracker.mountTimer = 0
  }
}

function ensureMountTimer() {
  if (tracker.mountTimer || typeof window === 'undefined') return
  tracker.mountTimer = window.setInterval(syncMountedDom, 200)
}

function ensureStyle() {
  const style = document.getElementById(STYLE_ID) || document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
		[id^="${TRACKER_ID}"] {
			position: fixed;
			z-index: 2147483647;
			transform: translateX(-50%);
			padding: var(--ddz-panel-pad-y, 6px) var(--ddz-panel-pad-x, 8px);
			border-radius: 12px;
			background: linear-gradient(180deg, rgba(16, 22, 28, 0.94), rgba(29, 40, 48, 0.94));
			color: #f5efe4;
			border: 1px solid rgba(255, 219, 160, 0.35);
			box-shadow: 0 12px 36px rgba(0, 0, 0, 0.35);
			font: var(--ddz-text-size, 11px)/1.4 "Helvetica Neue", "PingFang SC", sans-serif;
			pointer-events: none;
		}
		#${TRACKER_ID} {
			width: var(--ddz-bottom-width, 152px);
			display: flex;
			align-items: center;
			gap: var(--ddz-gap, 3px);
			padding-top: 1px;
			padding-bottom: 1px;
		}
		[id^="${TRACKER_ID}-seat-"] {
			width: var(--ddz-seat-width, 132px);
		}
		[id^="${TRACKER_ID}"] * {
			box-sizing: border-box;
		}
		[id^="${TRACKER_ID}"] .ddz-title {
			font-weight: 700;
			margin-bottom: 0;
			font-size: var(--ddz-title-size, 11px);
			color: rgba(255, 219, 160, 0.92);
			white-space: nowrap;
		}
		[id^="${TRACKER_ID}"] .ddz-grid {
			display: grid;
			grid-template-columns: repeat(15, minmax(0, 1fr));
			flex: 1 1 auto;
			gap: var(--ddz-gap, 3px);
		}
		[id^="${TRACKER_ID}"] .ddz-cell {
			padding: calc(var(--ddz-gap, 3px) + 1px) 2px;
			border-radius: 6px;
			text-align: center;
			background: rgba(255, 255, 255, 0.06);
		}
		[id^="${TRACKER_ID}"] .ddz-rank {
			font-weight: 700;
			font-size: var(--ddz-text-size, 11px);
		}
		[id^="${TRACKER_ID}"] .ddz-count {
			margin-top: 1px;
			font-size: var(--ddz-text-size, 11px);
			color: rgba(255, 219, 160, 0.92);
		}
		[id^="${TRACKER_ID}"] .ddz-count-warn {
			color: #ff6b6b;
			font-weight: 700;
		}
		[id^="${TRACKER_ID}"] .ddz-seat {
			min-width: 0;
		}
		[id^="${TRACKER_ID}"] .ddz-seat-head {
			display: flex;
			justify-content: space-between;
			margin-bottom: 4px;
			font-weight: 700;
		}
		[id^="${TRACKER_ID}"] .ddz-seat-role {
			font-size: 11px;
			color: rgba(245, 239, 228, 0.72);
		}
		[id^="${TRACKER_ID}"] .ddz-seat-cards {
			line-height: 1.55;
			word-break: break-all;
		}
		[id^="${TRACKER_ID}"] .ddz-seat-spells {
			margin-top: 6px;
			display: flex;
			flex-direction: column;
			gap: 4px;
		}
		[id^="${TRACKER_ID}"] .ddz-spell-row {
			line-height: 1.55;
			word-break: break-all;
			color: rgba(255, 219, 160, 0.92);
		}
		[id^="${TRACKER_ID}"] .ddz-empty {
			color: rgba(245, 239, 228, 0.5);
		}
	`
  if (!style.isConnected) document.head.appendChild(style)
}

function ensureBottomDom() {
  if (tracker.bottomDom?.isConnected) return tracker.bottomDom
  ensureStyle()
  const root = document.createElement('div')
  root.id = TRACKER_ID
  root.innerHTML = `
		<div class="ddz-title">暗牌</div>
		<div class="ddz-grid" data-remaining-grid></div>
	`
  document.body.appendChild(root)
  tracker.bottomDom = root
  ensureMountTimer()
  return root
}

function ensureSeatDom(seat) {
  if (tracker.seatDoms[seat]?.isConnected) return tracker.seatDoms[seat]
  ensureStyle()
  const root = document.createElement('div')
  root.id = `${TRACKER_ID}-seat-${seat}`
  root.className = 'ddz-seat'
  document.body.appendChild(root)
  tracker.seatDoms[seat] = root
  ensureMountTimer()
  return root
}

function renderBottomTracker() {
  updateResponsiveVars()
  const bottomRoot = getBottomCardRoot()
  if (!bottomRoot) {
    clearDom('bottom')
    return
  }

  const root = ensureBottomDom()
  const rankCounts = getRemainingRankCounts()
  root.querySelector('[data-remaining-grid]').innerHTML = RANK_ORDER.map(
    (rankName) => `
		<div class="ddz-cell">
			<div class="ddz-rank">${RANK_LABELS[rankName]}</div>
			<div class="ddz-count ${(rankCounts[rankName] || 0) === 4 ? 'ddz-count-warn' : ''}">${rankCounts[rankName] || 0}</div>
		</div>
	`
  ).join('')
  const anchor = getBottomAnchor()
  if (!anchor) {
    clearDom('bottom')
    return
  }
  root.style.left = `${anchor.left}px`
  root.style.top = `${anchor.top}px`
}

function renderSeatTracker(seat) {
  updateResponsiveVars()
  const root = ensureSeatDom(seat.seat)
  const cards = getSeatCardsText(seat)
  const spellAreas = getSpellAreasText(seat)
  const role = seat.role === 'landlord' ? '地主' : seat.role === 'farmer' ? '农民' : '身份未定'
  root.innerHTML = `
		<div class="ddz-title">${seat.order ?? seat.seat}号位明牌</div>
		<div class="ddz-seat-head">
			<span>${role}</span>
			<span class="ddz-seat-role">${cards.length}张</span>
		</div>
		<div class="ddz-seat-cards ${cards.length ? '' : 'ddz-empty'}">${cards.length ? cards.join(' ') : '暂无已知手牌'}</div>
		<div class="ddz-seat-spells ${spellAreas.length ? '' : 'ddz-empty'}">${spellAreas.length ? spellAreas.map((area) => `<div class="ddz-spell-row">${SPELL_LABELS[area.areaId] || `spell ${area.areaId}`}: ${area.cards.join(' ')}</div>`).join('') : '暂无已知技能牌'}</div>
	`
  const anchor = getOpponentAnchor(getSeatSide(seat), root)
  if (!anchor) {
    clearDom('seat', seat.seat)
    return
  }
  root.style.left = `${anchor.left}px`
  root.style.top = `${anchor.top}px`
}

function renderTracker() {
  if (!getBottomCardRoot()) {
    clearDom('bottom')
    clearDom('seat', 0)
    clearDom('seat', 1)
    clearDom('seat', 2)
    return
  }

  renderBottomTracker()
  Object.values(tracker.seats).forEach((seat) => {
    if (tracker.myid == null || seat.seat === tracker.myid || seat.order == null) {
      clearDom('seat', seat.seat)
      return
    }
    const cards = getSeatCardsText(seat)
    const spellAreas = getSpellAreasText(seat)
    if (!cards.length && !spellAreas.length && seat.role === 'unknown') {
      clearDom('seat', seat.seat)
      return
    }
    renderSeatTracker(seat)
  })
}

function addCard(cardId, seat) {
  const seatData = tracker.seats[seat]
  if (!seatData || !(cardId > 0)) return
  seatData.knownIds.add(cardId)
  if (seatData.knownIds.size === 17) tracker.myid = seat
  tracker.seenIds.add(cardId)
}

function removeCard(cardId, seat) {
  const seatData = tracker.seats[seat]
  if (!seatData || !(cardId > 0)) return
  seatData.knownIds.delete(cardId)
  tracker.seenIds.add(cardId)
}

function ensureSpellArea(seat, spellAreaId) {
  if (!seat || !(spellAreaId > 0)) return null
  seat.spellAreas[spellAreaId] ??= new Set()
  return seat.spellAreas[spellAreaId]
}

function addSpellCard(cardId, seat, spellAreaId) {
  const seatData = tracker.seats[seat]
  if (!seatData || !(cardId > 0)) return
  const area = ensureSpellArea(seatData, spellAreaId)
  if (!area) return
  area.add(cardId)
  tracker.seenIds.add(cardId)
}

function removeSpellCard(cardId, seat, spellAreaId) {
  const seatData = tracker.seats[seat]
  if (!seatData || !(cardId > 0) || !(spellAreaId > 0)) return
  const area = seatData.spellAreas[spellAreaId]
  if (!area) return
  area.delete(cardId)
  if (!area.size) delete seatData.spellAreas[spellAreaId]
  tracker.seenIds.add(cardId)
}

function removeCardFromAllSeats(cardId) {
  Object.keys(tracker.seats).forEach((seat) => {
    removeCard(cardId, Number(seat))
  })
}

function syncNoticeOpKnownCards(targetSeat, cardIds) {
  const seat = tracker.seats[targetSeat]
  if (!seat || !Array.isArray(cardIds) || !cardIds.length) return
  cardIds.forEach((cardId) => {
    if (!(cardId > 0)) return
    addCard(cardId, targetSeat)
  })
}

function syncSeatRole() {
  Object.values(tracker.seats).forEach((seat) => {
    seat.role =
      tracker.landlordSeat == null
        ? 'unknown'
        : seat.seat === tracker.landlordSeat
          ? 'landlord'
          : 'farmer'
    seat.order = null
  })

  if (tracker.landlordSeat == null) return

  const seatIds = Object.keys(tracker.seats)
    .map((seat) => Number(seat))
    .sort((left, right) => left - right)
  const landlordIndex = seatIds.indexOf(tracker.landlordSeat)
  if (landlordIndex < 0) return

  seatIds.forEach((_, index) => {
    const seatId = seatIds[(landlordIndex + index) % seatIds.length]
    const seat = tracker.seats[seatId]
    if (!seat) return
    seat.order = index + 1
  })
}

function getSeatSnapshot() {
  return Object.fromEntries(
    Object.entries(tracker.seats).map(([seatId, seat]) => [
      seatId,
      {
        seat: seat.seat,
        order: seat.order,
        role: seat.role,
        knownIds: [...seat.knownIds],
        knownCards: getSeatCardsText(seat),
        spellAreas: Object.fromEntries(
          getSpellAreasText(seat).map((area) => [area.areaId, area.cards])
        )
      }
    ])
  )
}

function clearAllDom() {
  clearDom('bottom')
  clearDom('seat', 0)
  clearDom('seat', 1)
  clearDom('seat', 2)
}

function stopMountTimer() {
  if (!tracker.mountTimer || typeof window === 'undefined') return
  window.clearInterval(tracker.mountTimer)
  tracker.mountTimer = 0
}

function syncLandlordSeat(moveType, fromSeat, fromZone, toSeat, toZone) {
  if (
    moveType !== DoudizhuMoveCard.Mode_Deal ||
    fromSeat !== 255 ||
    fromZone !== DoudizhuMoveCard.ZONE_THREECRAD ||
    toZone !== DoudizhuMoveCard.ZONE_HAND
  )
    return
  tracker.landlordSeat = toSeat
  syncSeatRole()
}

function syncRemoveFromZone(cardIds, fromSeat, fromZone, spellId, moveType, toSeat, toZone) {
  if (fromZone === DoudizhuMoveCard.ZONE_HAND) {
    cardIds.forEach((item) => removeCard(getCardId(item), fromSeat))
  }

  if (fromZone === DoudizhuMoveCard.ZONE_SPELL) {
    cardIds.forEach((item) => removeSpellCard(getCardId(item), fromSeat, spellId))
  }

  if (
    moveType !== DoudizhuMoveCard.move_type_distroy ||
    fromZone !== DoudizhuMoveCard.ZONE_STACK ||
    toSeat !== 255 ||
    toZone !== DoudizhuMoveCard.ZONE_DISCARDPILE
  )
    return

  cardIds.forEach((item) => removeCardFromAllSeats(getCardId(item)))
}

function syncAddToZone(cardIds, toSeat, toZone, spellId) {
  if (toZone === DoudizhuMoveCard.ZONE_HAND) {
    cardIds.forEach((item) => addCard(getCardId(item), toSeat))
  }

  if (toZone === DoudizhuMoveCard.ZONE_SPELL) {
    cardIds.forEach((item) => addSpellCard(getCardId(item), toSeat, spellId))
  }
}

export function getDoudizhuRuntimeContext() {
  return {
    DoudizhuMoveCard,
    syncLandlordSeat,
    syncRemoveFromZone,
    syncAddToZone
  }
}

export function installDoudizhuRuntime(runtime) {
  if (typeof runtime?.handleMove !== 'function') return false
  doudizhuRuntime.handleMove = runtime.handleMove
  return true
}

export function isDoudizhuRuntimeReady() {
  return typeof doudizhuRuntime.handleMove === 'function'
}

export function resetDoudizhuTracker() {
  clearAllDom()
  stopMountTimer()
  tracker.landlordSeat = null
  tracker.myid = null
  tracker.seenIds = new Set()
  tracker.seats = {
    0: createSeat(0),
    1: createSeat(1),
    2: createSeat(2)
  }
}

export function getDoudizhuSnapshot() {
  return {
    landlordSeat: tracker.landlordSeat,
    myid: tracker.myid,
    remainingRankCounts: getRemainingRankCounts(),
    seats: getSeatSnapshot()
  }
}

export function handleDoudizhuMessage(arg) {
  const className = arg.className
  if (className === 'decodeMsgGameStart' || className === 'MsgGameOver') {
    resetDoudizhuTracker()
    return
  }

  const message = getMessage(arg)
  if (!message) {
    renderTracker()
    return
  }

  if (className === 'decodeSNoticeOp') {
    const targetSeat = Number(message.spell_targets?.[0])
    const cardIds = Array.isArray(message.data_cards)
      ? message.data_cards.map((card) => getCardId(card)).filter((cardId) => cardId > 0)
      : []
    syncNoticeOpKnownCards(targetSeat, cardIds)
    renderTracker()
    return
  }

  if (!isDoudizhuRuntimeReady()) return

  doudizhuRuntime.handleMove(message, getDoudizhuRuntimeContext())
  renderTracker()
}
