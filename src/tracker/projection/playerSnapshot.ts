import type { Card } from '../model/Card'
import type { Room } from '../Room'
import { recordTraversal } from '../traversalStats'

/** 玩家区派生快照的唯一缓存；顺序始终与 Room.cards 一致。 */
export class PlayerSnapshot {
  cards: Card[] = []
  private readonly members = new Set<Card>()
  private readonly order = new Map<Card, number>()
  private lastConsumedSeq = -1

  constructor(private readonly room: Room) {}

  reset(): void {
    this.cards = []
    this.members.clear()
    this.order.clear()
    this.lastConsumedSeq = -1
  }

  /** 由 Room 在实体追加时登记；身份变化不影响物理实体的创建顺序。 */
  registerCard(card: Card, index: number): void {
    this.order.set(card, index)
    if (this.members.has(card)) {
      this.cards.splice(this.cards.indexOf(card), 1)
      this.insertOrdered(card)
    }
  }

  rebuild(): Card[] {
    const room = this.room
    recordTraversal('resolveConstraints:playerSnapshot', room.trackedCards.length)
    this.reset()
    room.trackedCards.forEach((card, index) => {
      this.registerCard(card, room.getDetachedCardOrder(card) ?? index)
      if (card.location === 'player') {
        this.cards.push(card)
        this.members.add(card)
      }
    })
    this.lastConsumedSeq = room.dirtyCardSeq
    return this.cards
  }

  refresh(): Card[] {
    const room = this.room
    if (this.lastConsumedSeq < 0) return this.rebuild()

    const events = room.dirtyCardEvents
    if (events.length > 0 && events[0].seq > this.lastConsumedSeq + 1) {
      return this.rebuild()
    }

    const affectedCards = new Set<Card>()
    // 只消费未处理的连续后缀，重复事件按实体去重。
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index].seq <= this.lastConsumedSeq) break
      affectedCards.add(events[index].card)
    }

    affectedCards.forEach((card) => {
      const isPlayer = card.location === 'player'
      const inSnapshot = this.members.has(card)
      if (isPlayer && !inSnapshot) {
        this.members.add(card)
        this.insertOrdered(card)
      } else if (!isPlayer && inSnapshot) {
        this.members.delete(card)
        const index = this.cards.indexOf(card)
        if (index >= 0) this.cards.splice(index, 1)
      }
    })

    recordTraversal('resolveConstraints:playerSnapshotIncremental', affectedCards.size)
    this.lastConsumedSeq = room.dirtyCardSeq
    return this.cards
  }

  private insertOrdered(card: Card): void {
    const key = this.order.get(card)!
    let index = this.cards.length
    while (index > 0 && this.order.get(this.cards[index - 1])! > key) index -= 1
    this.cards.splice(index, 0, card)
  }
}

/** 玩家区快照的兼容只读入口；缓存仅由 PlayerSnapshot 维护。 */
export function getPlayerCardsSnapshot(room: Room): readonly Card[] {
  return room.playerSnapshot.cards
}
