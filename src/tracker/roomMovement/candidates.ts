import { trackerLogger } from '@/utils/logger'
import { createLocationCandidateKey, fromPublicCandidate } from '../candidate/locationCandidate'
import {
  createPublicCandidate,
  normalizePublicPosition,
  type PublicCandidatePosition
} from '../candidate/publicCandidate'
import type { Card } from '../Card'
import type {
  PlayerLocationCandidate,
  PublicCandidate,
  PublicLocationCandidate,
  PublicPosition,
  PublicZoneName,
  SeatID
} from '../types'
import { RoomMovementSourceMethods } from './sources'
import {
  PAIDUI_POSITIONS,
  type MoveTargetZone,
  type PublicCandidatesToHandOptions,
  type RandomHandToPublicOptions,
  type RandomHandTransferCheckOptions,
  type RandomHandTransferOptions,
  type UnknownPileReturnOptions
} from './types'

export class RoomMovementCandidateMethods extends RoomMovementSourceMethods {
  shouldPropagateRandomHandTransferCandidates({
    sourceSeat,
    targetSeat,
    count,
    unknownCount,
    sourceEvent
  }: RandomHandTransferCheckOptions): boolean {
    if (!(count > 0) || sourceSeat === null || targetSeat === null || sourceSeat === targetSeat) {
      return false
    }

    if (sourceEvent?.type === 'showCards') return false

    return unknownCount > 0
  }

  /**
   * 玩家间随机获得手牌时，把来源玩家可能持有的明牌传播给目标玩家。
   */
  markRandomHandTransferCandidates({
    fromSeat,
    targetSeat,
    count,
    sourceEvent
  }: RandomHandTransferOptions): Card[] {
    if (!(count > 0) || fromSeat === null || targetSeat === null || fromSeat === targetSeat) {
      return []
    }

    const sourceCandidateCards = this.getKnownHandCardsBySeat(fromSeat)

    if (sourceCandidateCards.length === 0) return []

    const candidateSeats = Array.from(
      new Set(sourceCandidateCards.flatMap((card) => Array.from(card.seats)).concat(targetSeat))
    )

    sourceCandidateCards.forEach((card) => {
      card.addSeat(targetSeat, 'randomHandTransferCandidates')
    })

    this.expandConstraintGroupsForCards(sourceCandidateCards, targetSeat)

    const sourcePlayer = this.room.getPlayer(fromSeat)
    const sourceTotal = sourcePlayer?.hasObservedHandCount
      ? sourcePlayer.observedHandCount
      : sourceCandidateCards.length
    this.room.createConstraintGroup({
      cards: sourceCandidateCards,
      candidateSeats,
      expectedSlotsBySeat: new Map([
        [fromSeat, Math.min(sourceCandidateCards.length, sourceTotal)],
        [targetSeat, Math.min(count, sourceCandidateCards.length)]
      ]),
      known: true,
      sourceEvent: sourceEvent ?? { type: 'randomHandTransferCandidates' }
    })

    trackerLogger.info('手牌候选传播', {
      fromSeat,
      targetSeat,
      count,
      cards: sourceCandidateCards.map((card) => ({
        id: card.id,
        name: card.name,
        seats: Array.from(card.seats)
      }))
    })

    return sourceCandidateCards
  }

  /**
   * 判断是否需要把来源手牌候选传播到公共牌堆候选。
   */
  shouldMarkRandomHandToPublicCandidates(
    sourceSeat: SeatID | null,
    targetSeat: SeatID | null,
    toZone: MoveTargetZone,
    count: number
  ): boolean {
    return sourceSeat !== null && targetSeat === null && toZone === 'pile' && count > 0
  }

  /**
   * 玩家暗牌回到牌堆时，把该玩家可能持有的明牌追加为牌堆顶/底候选。
   */
  markRandomHandToPublicCandidates({
    fromSeat,
    toZone,
    position,
    count
  }: RandomHandToPublicOptions): Card[] {
    if (fromSeat === null) return []

    const sourceCandidateCards = this.getKnownHandCardsBySeat(fromSeat)
    if (sourceCandidateCards.length === 0) return []

    const candidate = this.createPublicCandidate(toZone, position, count)
    sourceCandidateCards.forEach((card) => card.addPublicCandidate(candidate))

    trackerLogger.info('手牌候选进入公共区', {
      fromSeat,
      toZone,
      position,
      count,
      cards: sourceCandidateCards.map((card) => ({
        id: card.id,
        name: card.name,
        seats: Array.from(card.seats),
        publicCandidates: card.publicCandidates
      }))
    })

    return sourceCandidateCards
  }

  /**
   * 当牌堆未知牌重新摆放顶/底时，同步更新已有公共候选的位置描述。
   */
  updatePublicCandidatesAfterUnknownPileReturn({
    toZone,
    position,
    count
  }: UnknownPileReturnOptions): void {
    if (toZone !== 'pile' || !(count > 0)) return

    const candidate = this.createPublicCandidate(toZone, position, count)
    this.room.cards
      .filter((card) =>
        card.publicCandidates?.some((item) => item.zone === 'pile' && item.position === 'top')
      )
      .forEach((card) => {
        if (candidate.position === 'top') {
          card.removePublicCandidates((item) => item.zone === 'pile' && item.position === 'top')
        }
        card.addPublicCandidate(candidate)
      })
  }

  /**
   * 创建公共区候选位置对象。
   */
  createPublicCandidate(
    zone: PublicZoneName,
    position: PublicPosition,
    count: number
  ): PublicCandidate {
    return createPublicCandidate(zone, position, count)
  }

  /**
   * 牌堆顶/底候选被摸走时，把命中的明牌候选传播到摸牌玩家手牌。
   */
  propagatePublicCandidatesToHand({
    fromZone,
    fromPosition,
    toZone,
    targetSeat,
    subZone,
    count,
    sourceEvent
  }: PublicCandidatesToHandOptions): Card[] {
    const position = this.normalizePublicPosition(fromPosition)
    // 非顶部底部
    if (
      fromZone !== 'pile' ||
      toZone !== 'player' ||
      subZone !== 'hand' ||
      targetSeat === null ||
      !(count > 0) ||
      !PAIDUI_POSITIONS.includes(position)
    ) {
      return []
    }

    const affectedCards = this.room.cards.filter((card) =>
      card.publicCandidates?.some(
        (candidate) => candidate.zone === fromZone && candidate.position === position
      )
    )

    if (affectedCards.length === 0) return []

    const targetHandCandidate: PlayerLocationCandidate = {
      type: 'player',
      seatID: Number(targetSeat),
      subZone: 'hand',
      spellID: null
    }

    affectedCards.forEach((card) => {
      const nextPublicCandidates = card.publicCandidates.flatMap((candidate) => {
        if (candidate.zone !== fromZone || candidate.position !== position) return [candidate]
        const candidateCount = candidate.count
        if (typeof candidateCount !== 'number') return [candidate]
        if (count >= candidateCount) return []

        return [this.createPublicCandidate(candidate.zone, fromPosition, candidateCount - count)]
      })

      const nextPublicLocationCandidates = nextPublicCandidates
        .map((candidate) => fromPublicCandidate(candidate))
        .filter((candidate): candidate is PublicLocationCandidate => Boolean(candidate))
      const retainedLocationCandidates = card
        .getLocationCandidates()
        .filter(
          (candidate) =>
            candidate.type !== 'public' ||
            candidate.zone !== fromZone ||
            candidate.position !== position
        )
      card.setLocationCandidates(
        [...retainedLocationCandidates, ...nextPublicLocationCandidates, targetHandCandidate],
        'publicCandidatesToHand'
      )
    })

    this.expandConstraintGroupsForCards(affectedCards, targetSeat)

    this.room.createConstraintGroup({
      cards: affectedCards,
      candidateSeats: Array.from(new Set(affectedCards.flatMap((card) => Array.from(card.seats)))),
      expectedSlotsBySeat: new Map([[Number(targetSeat), Math.min(count, affectedCards.length)]]),
      expectedSlotsByLocation: new Map([
        [createLocationCandidateKey(targetHandCandidate), Math.min(count, affectedCards.length)]
      ]),
      known: true,
      sourceEvent: sourceEvent ?? { type: 'publicCandidatesToHand' }
    })

    trackerLogger.info('公共候选进入手牌', {
      fromZone,
      position,
      targetSeat,
      count,
      cards: affectedCards.map((card) => ({
        id: card.id,
        name: card.name,
        seats: Array.from(card.seats),
        publicCandidates: card.publicCandidates
      }))
    })

    return affectedCards
  }

  /**
   * 将协议位置常量转换成公共候选位置名。
   */
  normalizePublicPosition(position: PublicPosition): PublicCandidatePosition {
    return normalizePublicPosition(position)
  }

  /**
   * 扩展包含指定卡牌的既有约束组候选席位，避免新传播座位被旧组裁掉。
   */
  expandConstraintGroupsForCards(cards: Card[], seatID: SeatID): void {
    const cardSet = new Set(cards)

    this.room.constraintGroups.forEach((group) => {
      if (group.candidateSeats.size === 0) return

      const hasCard = Array.from(group.cards as Set<Card>).some((card) => cardSet.has(card))
      if (hasCard) {
        group.candidateSeats.add(Number(seatID))
      }
    })
  }

  /**
   * 按移动包的手牌进出数量调整来源和目标玩家总手牌数。
   */
  applyHandTotalDelta(sourceSeat: SeatID | null, targetSeat: SeatID | null, count: number): void {
    if (!(count > 0) || sourceSeat === targetSeat) return

    this.adjustPlayerHandTotal(sourceSeat, -count)
    this.adjustPlayerHandTotal(targetSeat, count)
  }
}
