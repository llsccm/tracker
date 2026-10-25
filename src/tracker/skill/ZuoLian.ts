/**
 * 蔡瑁【佐练】（SpellID=3488）的弃牌堆来源修正。
 *
 * 技能会先展示一张手牌，再将它与牌堆或弃牌堆中的一张牌经由 exchange(10)
 * 交换。其中两条 `10 -> 10` 消息只是交换动画，不承载额外的身份信息。
 *
 * 本装饰器只处理“弃牌堆(2) -> 交换区(10)”的单张匿名随机移动：
 * - 优先选择最后进入弃牌堆的火杀；
 * - 弃牌堆没有火杀时，选择最后进入的雷杀；
 * - 不识别冰杀，也不介入牌堆或其他来源区域；
 * - 协议已给出正 CardID，或没有符合的火杀/雷杀时，保留默认移动路径。
 */
import { POSITION_RANDOM } from '../candidate/cardPositions'
import type { Card } from '@/tracker/model'
import { MOVE_TYPE } from '../protocol/MoveEventNormalizer'
import { PROTOCOL_ZONE } from '../protocol/protocolZones'
import type { Room } from '../Room'
import type { CardID, PatchedMoveCardFields, SeatID } from '../types'
import {
  getCount,
  hasPositiveID,
  nextGroupID,
  patchEvent,
  type MoveEventDraft
} from './moveEventUtils'

const ZUO_LIAN_SPELL_ID = 3488

interface ZuoLianState {
  [seatID: SeatID]: CardID
  stack?: CardID
}

export function prepareZuoLianMove(patched: PatchedMoveCardFields, room: Room): void {
  if (patched.FromZone === 5 && patched.ToZone === 5 && patched.MoveType === 21) {
    const positiveIDs = patched.CardIDs.filter((id) => id > 0)
    if (positiveIDs.length === 1) {
      const state = room.ensureSkillState<ZuoLianState>(ZUO_LIAN_SPELL_ID, () => ({}))
      state[patched.FromID] = positiveIDs[0]
    }
    return
  }

  if (patched.FromZone === 5 && patched.ToZone === 10 && patched.MoveType === 11) {
    const state = room.ensureSkillState<ZuoLianState>(ZUO_LIAN_SPELL_ID, () => ({}))
    const knownCardID = patched.CardIDs.find((id) => id > 0)
    const cardID = knownCardID || state[patched.FromID]
    delete state[patched.FromID]
    if (!(cardID > 0)) {
      delete state.stack
      return
    }
    if (!knownCardID) patched.CardIDs[0] = cardID
    state.stack = cardID
    return
  }

  if (patched.FromZone === 10 && [1, 2].includes(patched.ToZone) && patched.MoveType === 11) {
    const state = room.readSkillState<ZuoLianState>(ZUO_LIAN_SPELL_ID)
    const cardID = state?.stack
    if (!patched.CardIDs.some((id) => id > 0) && cardID !== undefined && cardID > 0)
      patched.CardIDs[0] = cardID
    if (state) delete state.stack
  }
}

export default function decorateZuoLian(event: MoveEventDraft, room: Room): MoveEventDraft {
  const move = event.protocol

  if (
    hasPositiveID(event.cardIDs) ||
    move.FromZone !== PROTOCOL_ZONE.DISCARD ||
    move.ToZone !== PROTOCOL_ZONE.EXCHANGE ||
    move.MoveType !== MOVE_TYPE.EXCHANGE ||
    move.FromPosition !== POSITION_RANDOM ||
    getCount(event) !== 1
  ) {
    return event
  }

  const discardCards = room.getZone('discard').cards
  // 公共区按底 -> 顶保存，逆序查找即优先后入弃牌堆的牌。
  const selectedCard =
    findLastCardByName(discardCards, '火杀') ?? findLastCardByName(discardCards, '雷杀')

  if (!selectedCard) return event

  return patchEvent(event, {
    options: {
      sourceCards: [selectedCard],
      combinationID: nextGroupID(room, ZUO_LIAN_SPELL_ID, 'zuolian_discard_candidate')
    }
  })
}

function findLastCardByName(cards: readonly Card[], name: string): Card | undefined {
  for (let index = cards.length - 1; index >= 0; index--) {
    if (cards[index]?.name === name) return cards[index]
  }

  return undefined
}
