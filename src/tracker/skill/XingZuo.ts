import type { Card } from '@/tracker/model/Card'
import { POSITION_BOTTOM } from '../candidate/cardPositions'
import { createPublicCandidate } from '../candidate/publicCandidate'
import { MOVE_TYPE } from '../protocol/MoveEventNormalizer'
import type { Room } from '../Room'
import type { SeatID } from '../types'
import { getPositiveIDs } from '../helper/cardIDs'
import { getCount, hasPositiveID, type MoveEventDraft, patchEvent } from './moveEventUtils'

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

/** 兴作：牌底整批与目标全部手牌置换，原手牌整批回牌底。 */
export default function decorateXingZuo(event: MoveEventDraft, room: Room): MoveEventDraft {
  const move = event.protocol
  if (move.SpellID !== XING_ZUO_SPELL_ID || move.MoveType !== MOVE_TYPE.EXCHANGE) {
    return event
  }

  if (move.FromZone === 1 && move.ToZone === 10) {
    const pileCards = room.getPublicEndpointCards('pile', getCount(event), POSITION_BOTTOM)
    clearBatch(room)
    const pileBatchKey = `${XING_ZUO_SPELL_ID}:pile:${move.ToID}`
    room.publicZones.getExchangeBatch(pileBatchKey).stage(pileCards)
    room.setSkillState<XingZuoBatch>(XING_ZUO_SPELL_ID, {
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
      options: { fromPosition: POSITION_BOTTOM }
    })
  }

  const batch = room.readSkillState<XingZuoBatch>(XING_ZUO_SPELL_ID)
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
    clearBatch(room)
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

function clearBatch(room: Room): void {
  const batch = room.readSkillState<XingZuoBatch>(XING_ZUO_SPELL_ID)
  if (batch) {
    room.publicZones.deleteExchangeBatch(batch.pileBatchKey)
    if (batch.handBatchKey) room.publicZones.deleteExchangeBatch(batch.handBatchKey)
  }
  room.deleteSkillState(XING_ZUO_SPELL_ID)
}

function patchBatchCards(event: MoveEventDraft, room: Room, cards: Card[]): MoveEventDraft {
  const protocolIDs = getPositiveIDs(event.cardIDs)
  const anonymousCards = cards.filter((card) => card.isAnonymous)
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
    clearBatch(room)
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
