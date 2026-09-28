import { isAnonymous, type Card } from '../Card'
import { POSITION_BOTTOM } from '../candidate/cardPositions'
import { createPublicCandidate } from '../candidate/publicCandidate'
import { MOVE_TYPE } from '../MoveEventNormalizer'
import type { Room } from '../Room'
import type { SeatID } from '../types'
import {
  getCount,
  getPositiveIDs,
  getRaw,
  hasPositiveID,
  type MoveEventDraft,
  patchEvent
} from './moveEventUtils'

export const XING_ZUO_SPELL_ID = 3776

interface XingZuoBatch {
  actorSeat: SeatID
  pileCards: Card[]
  handSeat: SeatID | null
  handCount: number
  exchangeBeforeHand: Set<Card> | null
  handCards: Card[] | null
  returnedToHand: boolean
}

/** 兴作：牌底整批与目标全部手牌置换，原手牌整批回牌底。 */
export default function decorateXingZuo(event: MoveEventDraft, room: Room): MoveEventDraft {
  const raw = getRaw(event)
  if (raw.SpellID !== XING_ZUO_SPELL_ID || raw.MoveType !== MOVE_TYPE.EXCHANGE) {
    return event
  }

  if (raw.FromZone === 1 && raw.ToZone === 10) {
    const pileCards = room.getPublicEndpointCards('pile', getCount(event), POSITION_BOTTOM)
    room.setSkillState<XingZuoBatch>(XING_ZUO_SPELL_ID, {
      actorSeat: raw.ToID,
      pileCards,
      handSeat: null,
      handCount: 0,
      exchangeBeforeHand: null,
      handCards: null,
      returnedToHand: false
    })
    // 该技能的 RANDOM 来源实际指牌底；显式来源同时保留端点明牌和匿名实体。
    return patchEvent(patchBatchCards(event, room, pileCards), {
      options: { fromPosition: POSITION_BOTTOM }
    })
  }

  const batch = room.readSkillState<XingZuoBatch>(XING_ZUO_SPELL_ID)
  if (!batch) return event

  if (raw.FromZone === 5 && raw.ToZone === 10 && raw.ToID === batch.actorSeat) {
    batch.handSeat = raw.FromID
    batch.handCount = getCount(event)
    batch.exchangeBeforeHand = new Set(room.zones.get('exchange')?.cards ?? [])
    const player = room.getPlayer(raw.FromID)
    // 兴作必定换出全部手牌，无需依赖本地观测张数来判断是否为整手交换。
    if (!hasPositiveID(event.cardIDs) && player) {
      return patchEvent(event, {
        cardIDs: player.knownHandCards.map((card) => card.id)
      })
    }
    return event
  }

  if (raw.FromZone !== 10 || raw.FromID !== batch.actorSeat) return event
  if (!batch.exchangeBeforeHand) return event

  // 在下一条协议到达时记录上一条实际移入的实体，包含通用移动创建的暗占位。
  batch.handCards ??= (room.zones.get('exchange')?.cards ?? []).filter(
    (card) => !batch.exchangeBeforeHand!.has(card)
  )

  if (raw.ToZone === 10 && raw.ToID === batch.actorSeat) {
    // 两条同区通知只描述交换动画，不提供重新混合两批牌的身份或顺序信息。
    return patchEvent(event, { type: 'noop' })
  }

  if (
    raw.ToZone === 5 &&
    raw.ToID === batch.handSeat &&
    getCount(event) === batch.pileCards.length &&
    !batch.returnedToHand
  ) {
    batch.returnedToHand = true
    return patchBatchCards(event, room, batch.pileCards)
  }

  if (raw.ToZone === 1 && getCount(event) === batch.handCount && batch.returnedToHand) {
    room.deleteSkillState(XING_ZUO_SPELL_ID)
    const candidate = createPublicCandidate('pile', POSITION_BOTTOM, batch.handCount)
    const hasCompleteOrder = getPositiveIDs(event.cardIDs).length === batch.handCount
    return patchEvent(patchBatchCards(event, room, batch.handCards), {
      options: {
        // 无 ID 的原手牌只确定回到底部这批，不能把实体枚举顺序当成真实牌序。
        postMovePublicCandidates: hasCompleteOrder
          ? []
          : batch.handCards
              .filter((card) => card.isKnown === true)
              .map((card) => ({ card, candidate }))
      }
    })
  }

  return event
}

function patchBatchCards(event: MoveEventDraft, room: Room, cards: Card[]): MoveEventDraft {
  const protocolIDs = getPositiveIDs(event.cardIDs)
  const anonymousCards = cards.filter(isAnonymous)
  const targets = protocolIDs.map(
    (id) => cards.find((card) => card.id === id) ?? anonymousCards.shift()
  )
  // 显式 ID 必须在本批匿名槽上物化，不能误用同处 exchange 的另一批手牌。
  // 先整批探测，失败时不对身份做半提交。
  if (
    targets.some(
      (target, index) => !target || room.probeMaterialize(protocolIDs[index], target) !== target
    )
  ) {
    room.deleteSkillState(XING_ZUO_SPELL_ID)
    return event
  }
  targets.forEach((target, index) => room.materialize(protocolIDs[index], target!))

  const knownCards = cards.filter((card) => card.id > 0 && card.isKnown === true)
  const cardIDs = [...new Set([...protocolIDs, ...knownCards.map((card) => card.id)])]
  const knownSet = new Set(knownCards)
  return patchEvent(event, {
    cardIDs,
    options: {
      sourceCards: cards.filter((card) => !knownSet.has(card)),
      // Controller 默认使用原始 CardIDs；这里补入技能已经确定移动的明牌身份。
      pileIdentityCardIDs: cardIDs
    }
  })
}
