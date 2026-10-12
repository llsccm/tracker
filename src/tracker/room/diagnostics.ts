import { AmbiguousKnownIndex } from '../AmbiguousKnownIndex'
import { hasRealIdentity, type Card } from '../Card'
import { CardLocationIndex } from '../CardLocationIndex'
import type { PileIdentityConsistencyIssue } from '../PileIdentityLedger'
import type { Room } from '../Room'
import type { CardID } from '../types'
import { trackerLogger } from '@/utils/logger'

// 正常收敛 ≤2 轮，超过阈值即疑似某处虚报 changed 的非终止回归。
const CONVERGENCE_ROUNDS_WARN = 8
const SHADOW_INDEX_ASSERT_INTERVAL = 32

type ShadowIndexAssertionMode = 'disabled' | 'sampled' | 'always'

function readShadowIndexAssertionMode(): ShadowIndexAssertionMode {
  try {
    const debugAssert = new URLSearchParams(globalThis.location?.search ?? '').get('debugAssert')
    if (debugAssert === '1') return 'always'
    if (debugAssert === '0') return 'disabled'
  } catch {
    // 宿主 location 不可读时退回默认抽样，不让诊断配置影响记牌主流程。
  }

  return 'sampled'
}

/**
 * Room 的开发期只读诊断。由 Room 在 DEV 分支中创建和调用，生产构建不挂载。
 * 仅持有诊断抽样状态，不参与牌局事实写入或约束推断。
 */
export class RoomDiagnostics {
  private readonly shadowIndexAssertionMode = readShadowIndexAssertionMode()
  private shadowIndexAssertionCount = 0

  constructor(private readonly room: Room) {}

  reset(): void {
    this.shadowIndexAssertionCount = 0
  }

  shouldAssertShadowIndexConsistency(): boolean {
    if (this.shadowIndexAssertionMode === 'disabled') return false

    this.shadowIndexAssertionCount += 1
    if (this.shadowIndexAssertionMode === 'always') return true

    return (
      this.shadowIndexAssertionCount === 1 ||
      this.shadowIndexAssertionCount % SHADOW_INDEX_ASSERT_INTERVAL === 0
    )
  }

  assertConvergenceRounds(rounds: number): void {
    if (rounds <= CONVERGENCE_ROUNDS_WARN) return

    trackerLogger.warn('resolveConstraints 收敛轮数异常偏高，疑似虚报 changed 的非终止回归', {
      rounds,
      constraintGroupCount: this.room.constraintGroups.size
    })
  }

  assertPileIdentityLedgerConsistency(context = ''): PileIdentityConsistencyIssue[] {
    const room = this.room
    const pile = room.zones.get('pile')
    const suspendedIdentityIDs = new Set(
      Array.from(room.suspendedKnownCards, (card) => card.id).filter((cardID) => cardID > 0)
    )
    const issues = room.pileIdentityLedger.assertConsistency(pile?.cards.length ?? 0, context, {
      deckIdentityIDs: room.deckIdentities,
      unlocatedIdentityIDs: room.unlocatedIdentities,
      suspendedIdentityIDs
    })
    const hiddenPileIdentityIDs = (pile?.cards ?? [])
      .filter((card) => card.id > 0 && card.isKnown !== true)
      .map((card) => card.id)

    hiddenPileIdentityIDs.forEach((cardID) => {
      issues.push({ context, reason: 'hidden-pile-identity', cardID })
    })

    if (hiddenPileIdentityIDs.length > 0) {
      trackerLogger.warn('牌堆仍存在正 ID 暗实体', {
        context,
        cardIDs: hiddenPileIdentityIDs
      })
    }

    return issues
  }

  assertIdentityReleased(cardID: CardID, reason: string): void {
    const room = this.room
    const issues: string[] = []
    if (room.cardIndex.has(cardID)) issues.push('still-in-card-index')
    if (!room.unlocatedIdentities.has(cardID)) issues.push('missing-from-unlocated')
    if (!room.deckIdentities.has(cardID)) issues.push('missing-from-deck-identities')

    if (issues.length > 0) {
      trackerLogger.warn('身份解绑后分区守恒被破坏', {
        reason,
        cardID,
        issues
      })
    }
  }

  assertConservation(context = ''): void {
    const room = this.room
    const cardsSet = new Set(room.cards)
    const entityOwnerByID = new Map<number, Card>()
    const realCardsByID = new Map<number, Card[]>()
    const identityIssues: Record<string, unknown>[] = []

    room.cards.forEach((card) => {
      const previousEntity = entityOwnerByID.get(card.entityID)
      if (previousEntity) {
        identityIssues.push({
          type: 'duplicated-entity-id',
          entityID: card.entityID,
          cardIDs: [previousEntity.id, card.id]
        })
      } else {
        entityOwnerByID.set(card.entityID, card)
      }

      if (hasRealIdentity(card)) {
        const realCards = realCardsByID.get(card.id) ?? []
        realCards.push(card)
        realCardsByID.set(card.id, realCards)

        if (card.entityID !== card.id) {
          identityIssues.push({
            type: 'real-card-entity-mismatch',
            cardID: card.id,
            entityID: card.entityID
          })
        }

        if (room.cardIndex.get(card.id) !== card) {
          identityIssues.push({
            type: 'card-index-mismatch',
            cardID: card.id,
            cardEntityID: card.entityID
          })
        }
        return
      }

      if (card.id !== card.entityID || card.entityID >= 0) {
        identityIssues.push({
          type: 'anonymous-card-identity-mismatch',
          cardID: card.id,
          entityID: card.entityID
        })
      }
    })

    realCardsByID.forEach((cards, cardID) => {
      if (cards.length <= 1) return
      identityIssues.push({
        type: 'duplicated-real-id',
        cardID,
        entityIDs: cards.map((card) => card.entityID)
      })
    })

    room.cardIndex.forEach((card, cardID) => {
      if (
        !hasRealIdentity(card) ||
        card.id !== cardID ||
        !cardsSet.has(card) ||
        card.entityID !== cardID
      ) {
        identityIssues.push({
          type: 'invalid-card-index-entry',
          cardID,
          entityID: card.entityID,
          cardIsTracked: cardsSet.has(card)
        })
      }
    })

    room.deckIdentities.forEach((cardID) => {
      const located = room.cardIndex.has(cardID)
      const unlocated = room.unlocatedIdentities.has(cardID)
      if (located === unlocated) {
        identityIssues.push({
          type: located ? 'identity-both-located-and-unlocated' : 'identity-missing',
          cardID
        })
      }
    })

    room.unlocatedIdentities.forEach((cardID) => {
      if (cardID <= 0 || !room.deckIdentities.has(cardID)) {
        identityIssues.push({
          type: 'invalid-unlocated-identity',
          cardID
        })
      }
    })

    const slotIssues = room.publicZones.getPublicZoneConsistencyIssues()
    const issues = [
      ...identityIssues.map((issue) => ({ domain: 'identity', ...issue })),
      ...slotIssues.map((issue) => ({ domain: 'slot', ...issue }))
    ]

    if (issues.length > 0) {
      trackerLogger.warn('Room 身份/槽位守恒观测发现不一致', {
        context,
        issues
      })
    }
  }

  assertPlayerSnapshotConsistency(playerCards: Card[]): void {
    const room = this.room
    const freshPlayerCards = room.cards.filter((card) => card.location === 'player')
    const consistent =
      freshPlayerCards.length === playerCards.length &&
      freshPlayerCards.every((card, index) => playerCards[index] === card)

    if (!consistent) {
      trackerLogger.warn('resolveConstraints player 快照与全量过滤结果不一致', {
        snapshotCardIDs: playerCards.map((card) => card.id),
        freshCardIDs: freshPlayerCards.map((card) => card.id)
      })
    }
  }

  assertLocationIndexConsistency(): void {
    const room = this.room
    const shadow = new CardLocationIndex()
    shadow.rebuild(room, { record: false })

    const live = JSON.stringify(room.locationIndex.toComparable(room))
    const expected = JSON.stringify(shadow.toComparable(room))

    if (live !== expected) {
      /* prettier-ignore */
      trackerLogger.warn('locationIndex 增量结果与全量 rebuild 不一致', { reason: 'resolveConstraints:incrementalLocationIndex' })
    }
  }

  assertAmbiguousKnownIndexConsistency(): void {
    const room = this.room
    const groups = Array.from(room.constraintGroups.values())
    const shadow = new AmbiguousKnownIndex(room)
    shadow.rebuild(groups, { record: false })

    const live = JSON.stringify(room.ambiguousKnownIndex.toComparable(room))
    const expected = JSON.stringify(shadow.toComparable(room))

    if (live !== expected) {
      /* prettier-ignore */
      trackerLogger.warn('ambiguousKnownIndex 增量结果与全量 rebuild 不一致', { reason: 'resolveConstraints:incrementalAmbiguousKnownIndex' })
    }
  }
}
