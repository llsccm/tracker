import type { Card } from '@/tracker/model/Card'
import type { Room } from '@/tracker/Room'
import type {
  CardID,
  ReconnectGameHandSnapshot,
  ReconnectGameSnapshot,
  ReconnectSeatInfo,
  SeatID
} from '@/tracker/types'

/** 重连残局的绝对快照；不补造移动协议，也不把牌堆数量校准当作洗牌。 */
export class RoomReconnect {
  private pendingSnapshot: ReconnectGameSnapshot | null = null
  private readonly pendingHandSnapshots = new Map<SeatID, ReconnectGameHandSnapshot>()

  constructor(private readonly room: Room) {}

  restore(snapshot: ReconnectGameSnapshot): void {
    if (!this.room.isDeckReady) {
      this.pendingSnapshot = snapshot
      return
    }

    const revealedIDs: CardID[] = []
    for (const info of snapshot.SeatInfos ?? []) {
      const player = this.room.getPlayer(info.SeatID)
      if (!player) continue
      this.retireStalePlayerCards(info)
      revealedIDs.push(...this.restorePlayerZone(info, 'equip'))
      revealedIDs.push(...this.restorePlayerZone(info, 'judge'))
      this.room.syncObservedPlayerHandCount(info.SeatID, info.HandCardCount, { resolve: false })
      if (info.CharacterID !== undefined) this.room.game.setGeneral(info.SeatID, info.CharacterID)
      if (info.Figure !== undefined) player.figure = info.Figure
    }

    this.room.applyPileIdentityReveal(revealedIDs)
    if (snapshot.CardPileCount !== undefined) this.room.restorePileCount(snapshot.CardPileCount)
    this.room.resolveConstraints()
    this.room.notifyCardsRevealed(revealedIDs)
    this.room.markViewDirty('reconnect:snapshot')
  }

  restoreHand(snapshot: ReconnectGameHandSnapshot): void {
    if (!this.room.isDeckReady) {
      this.pendingHandSnapshots.set(snapshot.SeatIndex, snapshot)
      return
    }
    if (!this.room.getPlayer(snapshot.SeatIndex)) return

    const knownIDs = snapshot.CardIDs.filter((cardID) => cardID > 0)
    this.retireStaleHandCards(snapshot.SeatIndex, new Set(knownIDs))
    for (const cardID of knownIDs) {
      const card = this.resolveKnownCard(cardID)
      if (!card) continue
      this.room.clearCardsFromPublicZones([card])
      this.room.removeCardsFromConstraintGroups([card])
      card.bindCandidates([snapshot.SeatIndex], 'hand', null, { known: true })
    }
    this.room.syncObservedPlayerHandCount(snapshot.SeatIndex, snapshot.Count, { resolve: false })
    this.room.applyPileIdentityReveal(knownIDs)
    this.room.resolveConstraints()
    this.room.notifyCardsRevealed(knownIDs)
    this.room.markViewDirty('reconnect:hand-snapshot')
  }

  onDeckInitialized(): void {
    if (this.pendingSnapshot) {
      const snapshot = this.pendingSnapshot
      this.pendingSnapshot = null
      this.restore(snapshot)
    }
    // 座位快照只包含手牌总数，随后再恢复手牌通知提供的具体身份。
    for (const snapshot of this.pendingHandSnapshots.values()) this.restoreHand(snapshot)
    this.pendingHandSnapshots.clear()
  }

  clear(): void {
    this.pendingSnapshot = null
    this.pendingHandSnapshots.clear()
  }

  private retireStaleHandCards(seatID: SeatID, knownIDs: ReadonlySet<CardID>): void {
    const knownHandCards = this.room.getPlayer(seatID)?.knownHandCards ?? []
    for (const card of knownHandCards) {
      if (knownIDs.has(card.id)) continue
      this.room.constraints.suspendKnownCard(card, 'reconnect:staleHand')
    }
  }

  private retireStalePlayerCards(info: ReconnectSeatInfo): void {
    const equipIDs = new Set(info.EquipCards.map((card) => card.CardId))
    const judgeIDs = new Set(info.JudgeCards.map((card) => card.CardId))
    const cards = this.room.trackedCards.filter(
      (card) => card.location === 'player' && card.seats.has(info.SeatID)
    )
    for (const card of cards) {
      const staleZone =
        (card.subZone === 'equip' && !equipIDs.has(card.id)) ||
        (card.subZone === 'judge' && !judgeIDs.has(card.id))
      // 快照只给手牌总数，不能确认断线前记录的具体手牌身份仍被持有。
      const staleHand =
        card.subZone === 'hand' &&
        card.isKnown &&
        card.seats.size === 1 &&
        !card.hasLocationCandidates()
      if (!staleZone && !staleHand) continue
      if (card.id > 0 && card.isKnown) {
        this.room.constraints.suspendKnownCard(card, 'reconnect:stalePlayerZone')
        continue
      }
      this.room.removeCardsFromConstraintGroups([card])
      const releasedID = this.room.releaseUnknownPlaceholderToOutside(
        card,
        'reconnect:stalePlayerZone'
      )
      if (releasedID !== null)
        this.room.pileIdentityLedger.registerAmbiguousOutsideGroup([releasedID])
    }
  }

  private restorePlayerZone(info: ReconnectSeatInfo, subZone: 'equip' | 'judge'): CardID[] {
    const cards = subZone === 'equip' ? info.EquipCards : info.JudgeCards
    const count = subZone === 'equip' ? info.EquipCardCount : info.JudgeCardCount
    const knownIDs: CardID[] = []
    for (const data of cards) {
      if (!(data.CardId > 0)) continue
      const card = this.resolveKnownCard(data.CardId)
      if (!card) continue
      this.room.clearCardsFromPublicZones([card])
      this.room.removeCardsFromConstraintGroups([card])
      card.bindCandidates([info.SeatID], subZone, 'SpellId' in data ? data.SpellId : null, {
        known: true
      })
      knownIDs.push(data.CardId)
    }
    this.room.createExternalCards([], Math.max(0, count - knownIDs.length)).forEach((card) => {
      card.bindCandidates([info.SeatID], subZone)
    })
    return knownIDs
  }

  private resolveKnownCard(cardID: CardID): Card | null {
    const existing = this.room.cardIndex.get(cardID)
    const target =
      !existing || this.room.detachedKnownCards.has(existing)
        ? this.room.createExternalCards([], 1)[0]
        : null
    return this.room.materialize(cardID, target)
  }
}
