import { POSITION_RANDOM } from '../candidate/cardPositions'
import type { Card } from '../Card'
import { MOVE_TYPE } from '../MoveEventNormalizer'
import { PROTOCOL_ZONE } from '../protocolZones'
import type { Room } from '../Room'
import {
  getCount,
  getRaw,
  hasPositiveID,
  nextGroupID,
  patchEvent,
  type MoveEventDraft
} from './moveEventUtils'

const FEN_CHAO_SPELL_ID = 3752
// 杀（含属性杀）、决斗、南蛮入侵、万箭齐发、火攻。
const FEN_CHAO_CARD_SPELL_IDS = new Set([1, 8, 9, 10, 83])

export default function decorateFenChao(event: MoveEventDraft, room: Room): MoveEventDraft {
  const raw = getRaw(event)
  if (
    hasPositiveID(event.cardIDs) ||
    Number(raw.FromZone) !== PROTOCOL_ZONE.DISCARD ||
    Number(raw.ToZone) !== PROTOCOL_ZONE.HAND ||
    Number(raw.MoveType) !== MOVE_TYPE.GAIN ||
    Number(raw.FromPosition) !== POSITION_RANDOM
  ) {
    return event
  }

  const cardCount = getCount(event)
  if (cardCount === 0) return event

  const sourceCards: Card[] = []
  // 按实测结果推断焚巢优先获得最早入堆的目标牌；弃牌数组按底 -> 顶保存。
  for (const card of room.zones.get('discard')?.cards ?? []) {
    if (!FEN_CHAO_CARD_SPELL_IDS.has(card.spellId)) continue
    sourceCards.push(card)
    if (sourceCards.length === cardCount) break
  }

  if (sourceCards.length === 0) return event

  return patchEvent(event, {
    options: {
      sourceCards,
      combinationID: nextGroupID(room, FEN_CHAO_SPELL_ID, 'fenchao_discard_candidate')
    }
  })
}
