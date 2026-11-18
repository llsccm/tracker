import type { Card } from '@/tracker/model/Card'
import { POSITION_BOTTOM } from '../candidate/cardPositions'
import { createPublicCandidate } from '../candidate/publicCandidate'
import { MOVE_TYPE } from '../protocol/MoveEventNormalizer'
import type { Room } from '../Room'
import type { SeatID } from '../types'
import { getPositiveIDs } from '../helper/cardIDs'
import { getCount, hasPositiveID, type MoveEventDraft, patchEvent } from './moveEventUtils'
import { defineSkillState } from './skillState'
import {
  clearExchangeBatches,
  commitExchangeKnownCards,
  planExchangeKnownCards,
  splitExchangeCards
} from './exchangeCards'

const XING_ZUO_SPELL_ID = 3776

interface XingZuoBatch {
  actorSeat: SeatID
  pileBatchKey: string
  pileCount: number
  handSeat: SeatID | null
  handCount: number
  handBatchKey: string | null
  returnedToHand: boolean
}

const xingZuoState = defineSkillState<XingZuoBatch>(XING_ZUO_SPELL_ID, (room, batch) => {
  clearExchangeBatches(room, [batch.pileBatchKey, batch.handBatchKey])
})

/** 兴作：牌底整批与目标全部手牌置换，原手牌整批回牌底。 */
export default function decorateXingZuo(event: MoveEventDraft, room: Room): MoveEventDraft {
  const move = event.protocol
  if (move.SpellID !== XING_ZUO_SPELL_ID || move.MoveType !== MOVE_TYPE.EXCHANGE) {
    return event
  }

  if (move.FromZone === 1 && move.ToZone === 10) {
    // 看牌前牌堆不足会先自动洗牌，此处的牌底张数已由协议时序保证。
    const pileCards = room.getPublicEndpointCards('pile', getCount(event), POSITION_BOTTOM)
    xingZuoState.clear(room)
    const pileBatchKey = `${XING_ZUO_SPELL_ID}:pile:${move.ToID}`
    room.publicZones.getExchangeBatch(pileBatchKey).stage(pileCards)
    xingZuoState.set(room, {
      actorSeat: move.ToID,
      pileBatchKey,
      pileCount: pileCards.length,
      handSeat: null,
      handCount: 0,
      handBatchKey: null,
      returnedToHand: false
    })
    // 该技能的 RANDOM 来源实际指牌底；显式来源同时保留端点明牌和匿名实体。
    return patchEvent(patchBatchCards(event, room, pileCards), {
      from: event.from.type === 'public' ? { ...event.from, position: POSITION_BOTTOM } : event.from
    })
  }

  const batch = xingZuoState.read(room)
  if (!batch) return event

  if (move.FromZone === 5 && move.ToZone === 10 && move.ToID === batch.actorSeat) {
    batch.handSeat = move.FromID
    batch.handCount = getCount(event)
    batch.handBatchKey = `${XING_ZUO_SPELL_ID}:seat:${move.FromID}`
    room.publicZones.getExchangeBatch(batch.handBatchKey).captureNextMove()
    const player = room.getPlayer(move.FromID)
    // 兴作必定换出全部手牌，无需依赖本地观测张数来判断是否为整手交换。
    if (!hasPositiveID(event.cardIDs) && player) {
      return patchEvent(event, {
        cardIDs: player.knownHandCards.map((card) => card.id)
      })
    }
    return event
  }

  if (move.FromZone !== 10 || move.FromID !== batch.actorSeat) return event
  if (!batch.handBatchKey) return event

  // 在下一条协议到达时记录上一条实际移入的实体，包含通用移动创建的暗占位。
  const handCards = room.publicZones.getExchangeBatch(batch.handBatchKey).cards

  if (move.ToZone === 10 && move.ToID === batch.actorSeat) {
    // 两条同区通知只描述交换动画，不提供重新混合两批牌的身份或顺序信息。
    return patchEvent(event, { type: 'noop' })
  }

  if (
    move.ToZone === 5 &&
    move.ToID === batch.handSeat &&
    getCount(event) === batch.pileCount &&
    !batch.returnedToHand
  ) {
    batch.returnedToHand = true
    return patchBatchCards(event, room, room.publicZones.getExchangeBatch(batch.pileBatchKey).cards)
  }

  if (move.ToZone === 1 && getCount(event) === batch.handCount && batch.returnedToHand) {
    xingZuoState.clear(room)
    const candidate = createPublicCandidate('pile', POSITION_BOTTOM, batch.handCount)
    const hasCompleteOrder = getPositiveIDs(event.cardIDs).length === batch.handCount
    return patchEvent(patchBatchCards(event, room, handCards), {
      options: {
        // 无 ID 的原手牌只确定回到底部这批，不能把实体枚举顺序当成真实牌序。
        postMovePublicCandidates: hasCompleteOrder
          ? []
          : handCards.filter((card) => card.isKnown === true).map((card) => ({ card, candidate }))
      }
    })
  }

  return event
}

function patchBatchCards(event: MoveEventDraft, room: Room, cards: Card[]): MoveEventDraft {
  const protocolIDs = getPositiveIDs(event.cardIDs)
  // 显式 ID 必须在本批匿名槽上物化，不能误用同处 exchange 的另一批手牌。
  const plan = planExchangeKnownCards(room, protocolIDs, cards)
  if (plan.cards.length !== protocolIDs.length || !commitExchangeKnownCards(room, plan)) {
    xingZuoState.clear(room)
    return event
  }

  const { knownIDs, unknownCards } = splitExchangeCards(cards)
  const cardIDs = [...new Set([...protocolIDs, ...knownIDs])]
  const returnsToHand = event.to.type === 'player' && event.to.subZone === 'hand'
  return patchEvent(event, {
    cardIDs,
    options: {
      sourceCards: unknownCards,
      // 回手只移动本批现存实体，协议张数差额交给手牌数量对账。
      ...(returnsToHand ? { cardCount: cards.length, handMoveCount: getCount(event) } : {}),
      // Controller 默认使用原始 CardIDs；这里补入技能已经确定移动的明牌身份。
      pileIdentityCardIDs: cardIDs
    }
  })
}
