import { POSITION_BOTTOM, POSITION_RANDOM, POSITION_TOP } from '../candidate/cardPositions'

export const PILE_SAME_ZONE_SHOW_SPELL_IDS: ReadonlySet<number> = new Set([7011, 987, 988])
export const PILE_RANDOM_AS_TOP_SPELL_IDS: ReadonlySet<number> = new Set([3208])
export const YANXI_DRAW_SPELL_IDS: ReadonlySet<number> = new Set([7016, 7017])
export const FULL_HAND_ROLE_OPT_SPELL_IDS: ReadonlySet<number> = new Set([
  4, 5, 357, 372, 501, 811, 921, 3119, 3437, 3876, 4025
])
export const PARTIAL_HAND_ROLE_OPT_SPELL_IDS: ReadonlySet<number> = new Set([361, 774, 851, 3310])

interface PrepareTrackerMoveCardIDsInput {
  CardIDs: number[]
  CardCount: number
  MoveType: number
  ToZone: number
  SpellID: number
  isSend?: unknown
}

interface PreparedTrackerMoveCardIDs {
  CardIDs: number[]
  shouldReturn: boolean
  mixedVisibility: boolean
}

export function prepareTrackerMoveCardIDs({
  CardIDs,
  CardCount,
  MoveType,
  ToZone,
  SpellID,
  isSend
}: PrepareTrackerMoveCardIDsInput): PreparedTrackerMoveCardIDs {
  const cardIDs = CardIDs.slice()

  if (CardCount === 0 || MoveType === 0 || ToZone === 11 || isSend) {
    return { CardIDs: cardIDs, shouldReturn: true, mixedVisibility: false }
  }

  if (SpellID === 713 && MoveType === 21 && CardCount === cardIDs.length - 2) {
    const index = cardIDs.splice(0, 1)[0]
    if (!Number.isInteger(index) || index < 0 || index >= cardIDs.length) {
      throw new Error(`SpellID=713 移动协议剔除下标 ${String(index)} 越界`)
    }
    cardIDs.splice(index, 1)
  }

  const knownCount = cardIDs.filter((cardID) => cardID > 0).length
  if (knownCount !== CardCount && knownCount !== 0) {
    return { CardIDs: [], shouldReturn: false, mixedVisibility: true }
  }

  return { CardIDs: cardIDs, shouldReturn: false, mixedVisibility: false }
}

interface NormalizeTrackerMovePositionInput {
  CardIDs: number[]
  CardCount: number
  FromID: number
  FromZone: number
  FromPosition: number
  ToID: number
  ToZone: number
  ToPosition: number
  MoveType: number
  SpellID: number
  isGuoZhan: boolean
  specialEquipmentCards?: boolean
}

export function normalizeTrackerMovePosition({
  CardIDs,
  CardCount,
  FromID,
  FromZone,
  FromPosition,
  ToID,
  ToZone,
  ToPosition,
  MoveType,
  SpellID,
  isGuoZhan,
  specialEquipmentCards = false
}: NormalizeTrackerMovePositionInput) {
  let cardIDs = CardIDs.slice()
  let fromPosition = FromPosition
  let toPosition = ToPosition

  // 权变/观虚查看牌堆顶不会移动卡牌；统一端点后由同区展示分支纠正牌顶序列。
  if (
    FromID === 255 &&
    FromZone === 1 &&
    ToID === 255 &&
    ToZone === 1 &&
    MoveType === 21 &&
    PILE_SAME_ZONE_SHOW_SPELL_IDS.has(SpellID)
  ) {
    fromPosition = POSITION_TOP
    toPosition = POSITION_TOP
  }

  // 骋烈：协议标 RANDOM，实际从牌顶取。天候 3903 位置不确定，不在名单内。
  if (
    FromZone === 1 &&
    fromPosition === POSITION_RANDOM &&
    PILE_RANDOM_AS_TOP_SPELL_IDS.has(SpellID)
  ) {
    fromPosition = POSITION_TOP
  }

  // 秦宓 天辩 13 拼点
  if (FromZone === 1 && fromPosition === POSITION_RANDOM && MoveType === 13 && CardCount === 1) {
    fromPosition = POSITION_TOP
  }

  // 蔡邕 辟撰
  if (
    FromZone === 1 &&
    fromPosition === POSITION_RANDOM &&
    ToZone === 4 &&
    MoveType === 8 &&
    SpellID === 795 &&
    CardCount === 1
  ) {
    fromPosition = POSITION_TOP
  }

  // 伊籍 机捷
  if (
    FromZone === 1 &&
    fromPosition === POSITION_RANDOM &&
    ToZone === 5 &&
    SpellID === 3101 &&
    CardCount === 1
  ) {
    fromPosition = POSITION_BOTTOM
  }

  // 王元姬 宴戏 拿牌
  if (
    FromZone === 1 &&
    fromPosition === POSITION_RANDOM &&
    ToZone === 5 &&
    !isGuoZhan &&
    YANXI_DRAW_SPELL_IDS.has(SpellID) &&
    CardCount === 1
  ) {
    fromPosition = POSITION_TOP
  }

  // 游戏开始后特殊装备牌
  if (
    FromZone === 1 &&
    fromPosition === POSITION_TOP + 1 &&
    ToZone === 5 &&
    SpellID === 0 &&
    MoveType === 1 &&
    CardCount === 4 &&
    specialEquipmentCards
  ) {
    fromPosition = POSITION_RANDOM
  }

  // 回魂牌随机加入牌堆
  if (
    ToZone === 1 &&
    ToID === 255 &&
    toPosition === POSITION_TOP &&
    cardIDs.some((cardID) => cardID === 4400 || cardID === 4401)
  ) {
    toPosition = POSITION_RANDOM
  }

  // 手牌中不处理回魂
  if (ToZone === 1 && ToID === 255 && ToPosition === POSITION_TOP) {
    cardIDs = cardIDs.filter((cardID) => cardID !== 4400 && cardID !== 4401)
  }

  // 手气卡返还的牌会重新混入牌堆，不能把协议/客户端代表位置当成牌顶事实。
  if (FromZone === 5 && ToZone === 1 && SpellID === 0 && MoveType === 19) {
    toPosition = POSITION_RANDOM
  }

  return { CardIDs: cardIDs, FromPosition: fromPosition, ToPosition: toPosition }
}

interface FullHandRevealInput {
  handCount: number
  observedHandCount?: number | null
  localHandCount?: number | null
}

export function shouldRevealAsFullHand({
  handCount,
  observedHandCount,
  localHandCount
}: FullHandRevealInput): boolean {
  const count = Number(handCount) || 0
  if (count <= 0) return false

  if (observedHandCount !== undefined && observedHandCount !== null) {
    return count === Number(observedHandCount)
  }

  const fallbackCount = Number(localHandCount) || 0
  return fallbackCount > 0 && count === fallbackCount
}
