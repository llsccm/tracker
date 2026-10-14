import { POSITION_BOTTOM, POSITION_RANDOM, POSITION_TOP } from '../candidate/cardPositions'
import type { RawMoveCardEvent } from '../types'

export const GUI_FU_ROLE_DATA_ID = 3709
export const YANXI_DRAW_SPELL_IDS: ReadonlySet<number> = new Set([7016, 7017])
/** 展示全部手牌 */
export const FULL_HAND_ROLE_OPT_SPELL_IDS: ReadonlySet<number> = new Set([
  4, 5, 357, 372, 501, 811, 921, 3119, 3437, 3876, 4025
])
/** 展示部分手牌 */
export const PARTIAL_HAND_ROLE_OPT_SPELL_IDS: ReadonlySet<number> = new Set([774, 851, 3310])

export function shouldIgnoreTrackerMove({
  CardCount,
  MoveType,
  ToZone,
  isSend
}: Pick<RawMoveCardEvent, 'CardCount' | 'MoveType' | 'ToZone' | 'isSend'>): boolean {
  return CardCount === 0 || MoveType === 0 || ToZone === 11 || !!isSend
}

/** 技能补丁完成后才能检查：原始 CardIDs 可能还包含下标等非牌数据。 */
export function hasMixedTrackerMoveVisibility({
  CardIDs,
  CardCount
}: Pick<RawMoveCardEvent, 'CardIDs' | 'CardCount'>): boolean {
  const knownCount = CardIDs.filter((cardID) => cardID > 0).length
  return knownCount !== CardCount && knownCount !== 0
}

interface NormalizeTrackerMovePositionInput {
  CardIDs: readonly number[]
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
  FromZone,
  FromPosition,
  ToID,
  ToZone,
  ToPosition,
  MoveType,
  SpellID,
  specialEquipmentCards = false
}: NormalizeTrackerMovePositionInput) {
  let fromPosition = FromPosition
  let toPosition = ToPosition

  // 权变查看牌堆顶不会移动卡牌；统一端点后由同区展示分支纠正牌顶序列。
  // if (
  //   FromID === 255 &&
  //   FromZone === 1 &&
  //   ToID === 255 &&
  //   ToZone === 1 &&
  //   MoveType === 21 &&
  //   SpellID === 7011
  // ) {
  //   fromPosition = POSITION_TOP
  //   toPosition = POSITION_TOP
  // }

  // 骋烈：协议标 RANDOM，实际从牌顶取
  if (FromZone === 1 && fromPosition === POSITION_RANDOM && SpellID === 3208) {
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
  // 目前废弃
  // if (
  //   FromZone === 1 &&
  //   fromPosition === POSITION_RANDOM &&
  //   ToZone === 5 &&
  //   !isGuoZhan &&
  //   YANXI_DRAW_SPELL_IDS.has(SpellID) &&
  //   CardCount === 1
  // ) {
  //   fromPosition = POSITION_TOP
  // }

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

  // 浑天仪：协议的特殊位置实际表示随机入堆。
  if (
    SpellID === 3694 &&
    FromZone === 0 &&
    ToZone === 1 &&
    toPosition === POSITION_TOP + 1 &&
    MoveType === 19
  ) {
    toPosition = POSITION_RANDOM
  }

  // 回魂牌随机加入牌堆
  if (
    ToZone === 1 &&
    ToID === 255 &&
    toPosition === POSITION_TOP &&
    CardIDs.some((cardID) => cardID === 4400 || cardID === 4401)
  ) {
    toPosition = POSITION_RANDOM
  }

  // todo 回魂通过其他技能返回牌堆呢?

  // 手气卡返还的牌会重新混入牌堆，不能把协议/客户端代表位置当成牌顶事实。
  if (FromZone === 5 && ToZone === 1 && SpellID === 0 && MoveType === 19) {
    toPosition = POSITION_RANDOM
  }

  return { FromPosition: fromPosition, ToPosition: toPosition }
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
