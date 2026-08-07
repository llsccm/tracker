import { AmbiguousKnownIndex } from '@/tracker/AmbiguousKnownIndex'
import { CardLocationIndex } from '@/tracker/CardLocationIndex'
import type { ConstraintGroup } from '@/tracker/ConstraintGroup'
import type { GameState } from '@/tracker/Game'
import type { Player } from '@/tracker/Player'
import type { Room } from '@/tracker/Room'
import type {
  TrackerReplayConstraintSnapshot,
  TrackerReplayPlayerSnapshot,
  TrackerReplaySnapshot,
  TrackerReplayZoneSnapshot
} from './types'

export function createTrackerReplaySnapshot(
  gameState: GameState,
  room: Room | null
): TrackerReplaySnapshot {
  return {
    game: {
      isGameStart: gameState.isGameStart,
      isPassed: gameState.isPassed,
      isRecord: gameState.isRecord,
      isDuanXian: gameState.isDuanXian,
      isGuoZhan: gameState.isGuoZhan,
      isDouDiZhu: gameState.isDouDiZhu,
      isShanHeTu: gameState.isShanHeTu,
      isRoguelike1v1: gameState.isRoguelike1v1,
      turn: gameState.turn,
      round: gameState.round,
      phase: gameState.phase,
      currentSeatID: gameState.currentID ?? null,
      spellState: normalizeJsonValue(gameState.spellSpace)
    },
    room: room ? createRoomSnapshot(room) : null
  }
}

export function assertTrackerReplayConsistency(room: Room, context: string): void {
  if (!room.isDeckReady) return

  const issues: unknown[] = []
  const pileCount = room.zones.get('pile')?.cards.length ?? 0
  const suspendedIdentityIDs = new Set(
    Array.from(room.suspendedKnownCards, (card) => card.id).filter((cardID) => cardID > 0)
  )

  issues.push(
    ...room.pileIdentityLedger.assertConsistency(pileCount, context, {
      deckIdentityIDs: room.deckIdentities,
      unlocatedIdentityIDs: room.unlocatedIdentities,
      suspendedIdentityIDs
    })
  )
  issues.push(...room.publicZones.getPublicZoneConsistencyIssues())
  collectIdentityIssues(room, issues)
  collectIndexIssues(room, issues)
  collectPlayerSnapshotIssues(room, issues)

  if (issues.length === 0) return
  throw new Error(`回放一致性检查失败（${context}）：${JSON.stringify(issues)}`)
}

function createRoomSnapshot(room: Room) {
  const zones: Record<string, TrackerReplayZoneSnapshot> = {}
  room.zones.forEach((zone, zoneID) => {
    zones[String(zoneID)] = {
      count: zone.cards.length,
      anonymousCount: zone.cards.filter((card) => card.id <= 0).length,
      knownCardIDs: zone.cards.filter((card) => card.isKnown && card.id > 0).map((card) => card.id),
      cardIDsBottomToTop: zone.cards.map((card) => card.id)
    }
  })

  const players = Array.from(room.players.values())
    .sort((left, right) => left.seatID - right.seatID)
    .map(createPlayerSnapshot)
  const constraints = Array.from(room.constraintGroups.values()).map(createConstraintSnapshot)
  const ambiguousKnownCards = room.cards
    .filter(
      (card) =>
        card.id > 0 &&
        (card.suspended || card.getLocationCandidates().length > 1 || card.seats.size > 1)
    )
    .map((card) => ({
      cardID: card.id,
      entityID: card.entityID,
      description: card.getLocationDescription(),
      suspended: card.suspended
    }))

  return {
    active: true as const,
    deckReady: room.isDeckReady,
    seatIDs: room.seatIDs.slice(),
    mySeatID: room.mySeatID ?? null,
    firstSeatID: room.firstID ?? null,
    totalCards: room.cards.length,
    knownCards: room.cards.filter((card) => card.id > 0 && card.isKnown).length,
    anonymousCards: room.cards.filter((card) => card.id <= 0).length,
    zones,
    players,
    constraints,
    ambiguousKnownCards,
    unlocatedIdentityIDs: sortNumbers(room.unlocatedIdentities),
    suspendedIdentityIDs: sortNumbers(
      Array.from(room.suspendedKnownCards, (card) => card.id).filter((cardID) => cardID > 0)
    ),
    pileIdentityLedger: room.isDeckReady ? room.pileIdentityLedger.getSnapshot() : null
  }
}

function createPlayerSnapshot(player: Player) {
  const markCardIDs: Record<string, number[]> = {}
  player.markCards.forEach((cards, spellID) => {
    markCardIDs[String(spellID)] = cards.map((card) => card.id)
  })

  const snapshot: TrackerReplayPlayerSnapshot = {
    seatID: player.seatID,
    observedHandCount: player.hasObservedHandCount ? player.observedHandCount : null,
    unknownHandCount: player.unknownCardCount,
    knownHandCardIDs: player.knownHandCards.map((card) => card.id),
    candidateHandCardIDs: player.candidateHandCards.map((card) => card.id),
    equipCardIDs: player.equipCards.map((card) => card.id),
    judgeCardIDs: player.judgeCards.map((card) => card.id),
    markCardIDs,
    generals: player.generals.slice()
  }
  return snapshot
}

function createConstraintSnapshot(group: ConstraintGroup) {
  const snapshot: TrackerReplayConstraintSnapshot = {
    id: String(group.id),
    cardIDs: Array.from(group.cards, (card) => card.id),
    entityIDs: Array.from(group.cards, (card) => card.entityID),
    candidateSeats: sortNumbers(group.candidateSeats),
    expectedSlotsBySeat: mapNumberEntries(group.expectedSlotsBySeat),
    expectedSlotsBySubZone: mapNumberEntries(group.expectedSlotsBySubZone),
    expectedSlotsByLocation: mapNumberEntries(group.expectedSlotsByLocation)
  }
  return snapshot
}

function collectIdentityIssues(room: Room, issues: unknown[]): void {
  const cardsSet = new Set(room.cards)
  const entities = new Map<number, number>()
  const identities = new Map<number, number>()

  room.cards.forEach((card) => {
    if (entities.has(card.entityID)) {
      issues.push({
        type: 'duplicated-entity-id',
        entityID: card.entityID,
        cardIDs: [entities.get(card.entityID), card.id]
      })
    }
    entities.set(card.entityID, card.id)

    if (card.id <= 0) {
      if (card.id !== card.entityID || card.entityID >= 0) {
        issues.push({
          type: 'anonymous-card-identity-mismatch',
          cardID: card.id,
          entityID: card.entityID
        })
      }
      return
    }

    if (identities.has(card.id)) {
      issues.push({
        type: 'duplicated-real-id',
        cardID: card.id,
        entityIDs: [identities.get(card.id), card.entityID]
      })
    }
    identities.set(card.id, card.entityID)

    if (card.entityID !== card.id || room.cardIndex.get(card.id) !== card) {
      issues.push({
        type: 'card-index-mismatch',
        cardID: card.id,
        entityID: card.entityID
      })
    }
  })

  room.cardIndex.forEach((card, cardID) => {
    if (card.id !== cardID || card.entityID !== cardID || !cardsSet.has(card)) {
      issues.push({ type: 'invalid-card-index-entry', cardID, entityID: card.entityID })
    }
  })

  room.deckIdentities.forEach((cardID) => {
    const located = room.cardIndex.has(cardID)
    const unlocated = room.unlocatedIdentities.has(cardID)
    if (located === unlocated) {
      issues.push({
        type: located ? 'identity-both-located-and-unlocated' : 'identity-missing',
        cardID
      })
    }
  })
}

function collectIndexIssues(room: Room, issues: unknown[]): void {
  const locationShadow = new CardLocationIndex()
  locationShadow.rebuild(room, { record: false })
  if (
    JSON.stringify(room.locationIndex.toComparable(room)) !==
    JSON.stringify(locationShadow.toComparable(room))
  ) {
    issues.push({ type: 'location-index-mismatch' })
  }

  const ambiguousShadow = new AmbiguousKnownIndex(room)
  ambiguousShadow.rebuild(Array.from(room.constraintGroups.values()), { record: false })
  if (
    JSON.stringify(room.ambiguousKnownIndex.toComparable(room)) !==
    JSON.stringify(ambiguousShadow.toComparable(room))
  ) {
    issues.push({ type: 'ambiguous-known-index-mismatch' })
  }
}

function collectPlayerSnapshotIssues(room: Room, issues: unknown[]): void {
  const snapshot = room.refreshPlayerSnapshot()
  const current = room.cards.filter((card) => card.location === 'player')
  const matches =
    snapshot.length === current.length && snapshot.every((card, index) => card === current[index])
  if (!matches) {
    issues.push({
      type: 'player-snapshot-mismatch',
      snapshotEntityIDs: snapshot.map((card) => card.entityID),
      currentEntityIDs: current.map((card) => card.entityID)
    })
  }
}

function mapNumberEntries(map: Map<unknown, number>): Record<string, number> {
  const entries: [string, number][] = Array.from(map.entries(), ([key, value]) => [
    String(key),
    value
  ])
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)))
}

function sortNumbers(values: Iterable<number>): number[] {
  return Array.from(values).sort((left, right) => left - right)
}

function normalizeJsonValue(value: unknown): unknown {
  if (value instanceof Set) return Array.from(value, normalizeJsonValue)
  if (value instanceof Map) {
    return Object.fromEntries(
      Array.from(value.entries(), ([key, item]) => [String(key), normalizeJsonValue(item)])
    )
  }
  if (Array.isArray(value)) return value.map(normalizeJsonValue)
  if (!isRecord(value)) return value

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, normalizeJsonValue(item)])
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
