import type { Card } from './Card'
import type { Zone } from './Zone'
import { insertCardsAtProtocolPosition, POSITION_TOP } from '../candidate/cardPositions'
import type { PublicPosition } from '../types'

/** 交换区命名视图：实体成员与候选引用分开，不增加物理槽位。 */
export class ExchangeBatch {
  private members: Card[] = []
  private pendingSnapshot: Set<Card> | null = null

  constructor(
    readonly key: string,
    private readonly zone: Zone
  ) {}

  get cards(): Card[] {
    if (this.pendingSnapshot) {
      const candidates = this.candidateCards
      const captured = this.zone.cards.filter((card) => !this.pendingSnapshot!.has(card))
      this.members = [...new Set([...captured, ...candidates])]
      this.pendingSnapshot = null
    }
    return this.members.filter(
      (card) => card.location === 'exchange' && this.zone.cards.includes(card)
    )
  }

  get candidateCards(): Card[] {
    return this.members.filter((card) =>
      card.locationCandidates.some(
        (candidate) =>
          candidate.type === 'outside' &&
          candidate.zone === 'exchange' &&
          candidate.batchID === this.key
      )
    )
  }

  stage(cards: Iterable<Card>): void {
    this.members = [...new Set(cards)]
    this.pendingSnapshot = null
  }

  /** 下一次读取时捕获本条协议实际新增的成员，包含通用移动补建的匿名槽。 */
  captureNextMove(): void {
    this.pendingSnapshot = new Set(this.zone.cards)
  }

  transferTo(
    target: ExchangeBatch,
    cards: Card[],
    position: PublicPosition = POSITION_TOP
  ): boolean {
    const selected = new Set(cards)
    this.members = [...new Set([...this.cards, ...this.candidateCards])].filter(
      (card) => !selected.has(card)
    )
    const targetCards = target.cards.filter((card) => !selected.has(card))
    const candidates = target.candidateCards.filter((card) => !selected.has(card))
    const inserted = insertCardsAtProtocolPosition(targetCards, cards, position)
    if (!inserted) targetCards.push(...cards)
    target.members = [...new Set([...targetCards, ...candidates])]
    return inserted
  }

  replaceCard(previous: Card, next: Card): void {
    this.members = this.members.map((card) => (card === previous ? next : card))
  }

  /** 每次物理移动结束后结算成员，避免已离区实体后来重入时复活旧批次。 */
  completeMove(): void {
    this.members = [...new Set([...this.cards, ...this.candidateCards])]
  }

  clear(): void {
    this.members = []
    this.pendingSnapshot = null
  }
}
