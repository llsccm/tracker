import type { Card } from '../Card'
import type { Room } from '../Room'
import type { CardID, SeatID } from '../types'
import { getRaw, patchEvent, type MoveEventDraft } from './moveEventUtils'

export const DUO_QI_STATE_SPELL_ID = 3731
/** 狂魔 */
export const DUO_QI_GAIN_ALL_SPELL_ID = 3730
/** 夺炁 */
export const DUO_QI_RANDOM_GAIN_SPELL_ID = 3731

export type DuoQiSpellID = typeof DUO_QI_GAIN_ALL_SPELL_ID | typeof DUO_QI_RANDOM_GAIN_SPELL_ID

export interface DuoQiActivation {
  ownerSeatID: SeatID
  targetSeatID: SeatID
  effectIndex: number
  sequence: number
  skipInference: boolean
}

export interface DuoQiDiscardGroup {
  id: string
  ownerSeatID: SeatID
  targetSeatID: SeatID
  candidateIdentityIDs: Set<CardID>
  gainedCount: number
  remainingDiscardCount: number
  memberCards: Set<Card>
  movedCards: Set<Card>
  ledgerRegistered: boolean
}

export interface DuoQiRandomHandGroup {
  ownerSeatID: SeatID
  targetSeatID: SeatID
  candidateEntities: Set<Card>
  candidateCardIDs: Set<CardID>
  gainedCount: number
  sequence: number
}

export interface DuoQiAmbiguousDiscardRecycleGroup {
  candidateIdentityIDs: CardID[]
  recycledCount: number
}

export interface DuoQiState {
  active: true
  initialized: boolean
  allCardIDs: Set<CardID>
  initialHandCountsBySeat: Map<SeatID, number>
  initialCardIDsBySeat: Map<SeatID, Set<CardID>>
  initialSeatByCardID: Map<CardID, SeatID>
  initialSeatByEntity: Map<Card, SeatID>
  unresolvedCardIDs: Set<CardID>
  activations: Map<DuoQiSpellID, DuoQiActivation>
  pendingDiscardGroups: DuoQiDiscardGroup[]
  pendingRandomHandGroups: DuoQiRandomHandGroup[]
  sequence: number
}

interface DuoQiGameStateLike {
  myID?: SeatID
  room?: Room | null
  getSpellState?<T = unknown>(spellID: PropertyKey): T | undefined
  setSpellState?(spellID: PropertyKey, value: unknown): void
}

interface DuoQiUseSpellMessage {
  SeatID?: SeatID
  SkillOwerSeatID?: SeatID
  SrcSeatID?: SeatID
  SpellID?: number | string
  EffectIndex?: number | string
  DestSeatIDs?: SeatID[]
}

interface DuoQiRoleDataTargetMessage {
  DataID?: number | string
  Datas?: unknown[]
  SeatID?: SeatID
}

function normalizeCardIDs(cardIDs: readonly CardID[]): CardID[] {
  return Array.from(new Set(cardIDs.map(Number).filter((cardID) => cardID > 0)))
}

function getGame(room: Room): DuoQiGameStateLike {
  return room.game as DuoQiGameStateLike
}

export function getDuoQiState(game: DuoQiGameStateLike): DuoQiState | undefined {
  const state = game.getSpellState?.<DuoQiState>(DUO_QI_STATE_SPELL_ID)
  return state?.active === true ? state : undefined
}

function getInitialHandCards(room: Room, seatID: SeatID): Card[] {
  return room.cards.filter(
    (card) =>
      card.location === 'player' && card.subZone === 'hand' && card.seats.has(Number(seatID))
  )
}

function getKnownInitialCardsForSeat(state: DuoQiState, seatID: SeatID): Set<CardID> {
  let cardIDs = state.initialCardIDsBySeat.get(seatID)
  if (!cardIDs) {
    cardIDs = new Set()
    state.initialCardIDsBySeat.set(seatID, cardIDs)
  }
  return cardIDs
}

function bindInitialCardID(state: DuoQiState, cardID: CardID, seatID: SeatID): boolean {
  if (!state.allCardIDs.has(cardID)) return false

  const existingSeatID = state.initialSeatByCardID.get(cardID)
  if (existingSeatID !== undefined) return false

  state.initialSeatByCardID.set(cardID, seatID)
  getKnownInitialCardsForSeat(state, seatID).add(cardID)
  state.unresolvedCardIDs.delete(cardID)
  return true
}

function convergeInitialSeats(state: DuoQiState): void {
  let changed = true

  while (changed && state.unresolvedCardIDs.size > 0) {
    changed = false
    const seatsWithCapacity = Array.from(state.initialHandCountsBySeat, ([seatID, count]) => {
      const knownCount = state.initialCardIDsBySeat.get(seatID)?.size ?? 0
      return { seatID, remaining: Math.max(0, count - knownCount) }
    }).filter(({ remaining }) => remaining > 0)

    if (seatsWithCapacity.length !== 1) return
    const [{ seatID, remaining }] = seatsWithCapacity
    if (remaining !== state.unresolvedCardIDs.size) return

    Array.from(state.unresolvedCardIDs).forEach((cardID) => {
      changed = bindInitialCardID(state, cardID, seatID) || changed
    })
  }
}

export function initializeDuoQiState(
  game: DuoQiGameStateLike,
  cardIDs: readonly CardID[]
): DuoQiState | undefined {
  const room = game.room
  const normalizedCardIDs = normalizeCardIDs(cardIDs)
  if (!room || normalizedCardIDs.length === 0) return undefined
  const state: DuoQiState = {
    active: true,
    initialized: true,
    allCardIDs: new Set(normalizedCardIDs),
    initialHandCountsBySeat: new Map(),
    initialCardIDsBySeat: new Map(),
    initialSeatByCardID: new Map(),
    initialSeatByEntity: new Map(),
    unresolvedCardIDs: new Set(normalizedCardIDs),
    activations: new Map(),
    pendingDiscardGroups: [],
    pendingRandomHandGroups: [],
    sequence: 0
  }

  room.seatIDs.forEach((seatID) => {
    const handCards = getInitialHandCards(room, seatID)
    state.initialHandCountsBySeat.set(seatID, handCards.length)
    state.initialCardIDsBySeat.set(seatID, new Set())

    handCards.forEach((card) => {
      state.initialSeatByEntity.set(card, seatID)
      if (card.id > 0 && card.isKnown === true && state.allCardIDs.has(card.id)) {
        bindInitialCardID(state, card.id, seatID)
      }
    })
  })

  convergeInitialSeats(state)
  game.setSpellState?.(DUO_QI_STATE_SPELL_ID, state)
  return state
}

export function recordDuoQiActivation(
  game: DuoQiGameStateLike,
  msg: DuoQiUseSpellMessage
): DuoQiActivation | undefined {
  const spellID = Number(msg.SpellID)
  // 3731 的目标来自 PubGsCUseSpell；3730 必须等待 GsCUpdateRoleDataExNtf(DataID=8)。
  if (spellID !== DUO_QI_RANDOM_GAIN_SPELL_ID) return undefined

  const state = getDuoQiState(game)
  if (!state) return undefined

  const effectIndex = Number(msg.EffectIndex)
  if (effectIndex !== 2) return undefined

  const ownerSeatID = Number(msg.SkillOwerSeatID ?? msg.SeatID ?? msg.SrcSeatID)
  const targetSeatID = Number(msg.DestSeatIDs?.[0])
  if (
    !Number.isFinite(ownerSeatID) ||
    !Number.isFinite(targetSeatID) ||
    ownerSeatID === targetSeatID
  ) {
    return undefined
  }

  const activation: DuoQiActivation = {
    ownerSeatID,
    targetSeatID,
    effectIndex,
    sequence: ++state.sequence,
    skipInference: ownerSeatID === game.myID
  }
  state.activations.set(spellID, activation)
  return activation
}

export function recordDuoQiRoleDataTarget(
  game: DuoQiGameStateLike,
  msg: DuoQiRoleDataTargetMessage
): DuoQiActivation | undefined {
  if (Number(msg.DataID) !== 8 || !Array.isArray(msg.Datas)) return undefined
  const spellID = Number(msg.Datas[0])
  if (spellID !== DUO_QI_GAIN_ALL_SPELL_ID) return undefined

  const state = getDuoQiState(game)
  if (!state) return undefined

  const targetSeatID = Number(msg.SeatID)
  const ownerSeatID = Number(msg.Datas[1])
  if (
    !Number.isFinite(targetSeatID) ||
    !Number.isFinite(ownerSeatID) ||
    targetSeatID === ownerSeatID
  ) {
    return undefined
  }

  const activation: DuoQiActivation = {
    ownerSeatID,
    targetSeatID,
    effectIndex: 1,
    sequence: ++state.sequence,
    skipInference: ownerSeatID === game.myID
  }
  state.activations.set(DUO_QI_GAIN_ALL_SPELL_ID, activation)
  return activation
}

function activationMatchesMove(activation: DuoQiActivation, raw: Record<string, unknown>): boolean {
  const fromZone = Number(raw.FromZone)
  const fromSeatID = Number(raw.FromID)
  const toSeatID = Number(raw.ToID)
  if (toSeatID !== activation.ownerSeatID) return false
  if (fromZone === 5 && fromSeatID !== activation.targetSeatID) return false
  return fromZone === 2 || fromZone === 5
}

function getInitialCardIDsForSeat(state: DuoQiState, seatID: SeatID): CardID[] {
  return Array.from(state.initialCardIDsBySeat.get(seatID) ?? [])
}

function getInitialEntitiesForSeat(state: DuoQiState, seatID: SeatID): Card[] {
  return Array.from(state.initialSeatByEntity)
    .filter(([, initialSeatID]) => initialSeatID === seatID)
    .map(([card]) => card)
}

function isCardInOwnerHand(card: Card, ownerSeatID: SeatID): boolean {
  return (
    card.location === 'player' &&
    card.subZone === 'hand' &&
    card.seats.size === 1 &&
    card.seats.has(ownerSeatID)
  )
}

function decorateGainAll(event: MoveEventDraft, room: Room, state: DuoQiState): MoveEventDraft {
  const raw = getRaw(event)
  const activation = state.activations.get(DUO_QI_GAIN_ALL_SPELL_ID)
  if (!activation || activation.skipInference || !activationMatchesMove(activation, raw))
    return event
  if (event.cardIDs?.some?.((cardID: CardID) => cardID > 0)) return event

  const sourceZone = Number(raw.FromZone)
  resolveRandomHandCandidatesForGainAll(event, room, state, activation, sourceZone)
  const targetCardIDs = getInitialCardIDsForSeat(state, activation.targetSeatID)
  const targetCards = new Set<Card>(getInitialEntitiesForSeat(state, activation.targetSeatID))
  targetCardIDs
    .map((cardID) => room.cardIndex.get(cardID))
    .filter((card): card is Card => Boolean(card))
    .forEach((card) => targetCards.add(card))
  const sourceCards = Array.from(targetCards)
    .filter((card) => !isCardInOwnerHand(card, activation.ownerSeatID))
    .filter((card) =>
      sourceZone === 2
        ? card.location === 'discard'
        : card.location === 'player' &&
          card.subZone === 'hand' &&
          card.seats.has(activation.targetSeatID)
    )

  const cardCount = Math.max(0, Number(event.cardCount ?? raw.CardCount) || 0)
  if (sourceCards.length !== cardCount) return event

  return patchEvent(event, {
    options: {
      sourceCards,
      pileIdentityCardIDs: sourceCards.filter((card) => card.id > 0).map((card) => card.id)
    }
  })
}

function resolveRandomHandCandidatesForGainAll(
  event: MoveEventDraft,
  room: Room,
  state: DuoQiState,
  activation: DuoQiActivation,
  sourceZone: number
): void {
  const cardCount = Math.max(0, Number(event.cardCount ?? getRaw(event).CardCount) || 0)
  if (cardCount <= 0) return

  const definiteSourceCards = collectGainAllSourceCards(
    room,
    state,
    activation.targetSeatID,
    activation.ownerSeatID,
    sourceZone
  )
  const groups = state.pendingRandomHandGroups.filter(
    (group) =>
      group.ownerSeatID === activation.ownerSeatID &&
      group.targetSeatID === activation.targetSeatID &&
      group.gainedCount > 0
  )
  if (groups.length !== 1) return

  const [group] = groups
  const candidateCards = Array.from(group.candidateCardIDs)
    .map((cardID) => room.cardIndex.get(cardID))
    .filter((card): card is Card => Boolean(card))
    .filter((card) => isCardInGainAllSource(card, activation.targetSeatID, sourceZone))
  const alreadyTargetCards = candidateCards.filter(
    (card) => state.initialSeatByEntity.get(card) === activation.targetSeatID
  )
  const unresolvedCandidateCards = candidateCards
    .filter((card) => !alreadyTargetCards.includes(card))
    .filter((card) => !definiteSourceCards.includes(card))
  const missingCount = cardCount - definiteSourceCards.length
  if (missingCount < 0 || unresolvedCandidateCards.length !== missingCount) return

  const confirmedCards = [...alreadyTargetCards, ...unresolvedCandidateCards]
  if (confirmedCards.length === 0 || confirmedCards.length > group.gainedCount) return

  const reassignments = planInitialEntitySeatReassignments(
    state,
    group,
    unresolvedCandidateCards,
    activation.targetSeatID
  )
  if (!reassignments) return

  applyInitialEntitySeatReassignments(state, reassignments, activation.targetSeatID)
  confirmedCards.forEach((card) => {
    bindInitialCardID(state, card.id, activation.targetSeatID)
    group.candidateCardIDs.delete(card.id)
  })
  group.gainedCount -= confirmedCards.length
  if (group.gainedCount <= 0) {
    state.pendingRandomHandGroups = state.pendingRandomHandGroups.filter(
      (candidate) => candidate !== group
    )
  }
}

interface InitialEntitySeatReassignment {
  card: Card
  replacement: Card
  previousSeatID: SeatID | undefined
}

function planInitialEntitySeatReassignments(
  state: DuoQiState,
  group: DuoQiRandomHandGroup,
  cards: readonly Card[],
  targetSeatID: SeatID
): InitialEntitySeatReassignment[] | null {
  const replacements = Array.from(group.candidateEntities).filter(
    (candidate) =>
      candidate.id <= 0 &&
      !cards.includes(candidate) &&
      state.initialSeatByEntity.get(candidate) === targetSeatID
  )
  const reassignments: InitialEntitySeatReassignment[] = []

  for (const card of cards) {
    const previousSeatID = state.initialSeatByEntity.get(card)
    if (previousSeatID === targetSeatID) continue

    const replacement = replacements.shift()
    if (!replacement) return null
    reassignments.push({ card, replacement, previousSeatID })
  }

  return reassignments
}

function applyInitialEntitySeatReassignments(
  state: DuoQiState,
  reassignments: readonly InitialEntitySeatReassignment[],
  targetSeatID: SeatID
): void {
  reassignments.forEach(({ card, replacement, previousSeatID }) => {
    if (previousSeatID === undefined) state.initialSeatByEntity.delete(replacement)
    else state.initialSeatByEntity.set(replacement, previousSeatID)
    state.initialSeatByEntity.set(card, targetSeatID)
  })
}

function collectGainAllSourceCards(
  room: Room,
  state: DuoQiState,
  targetSeatID: SeatID,
  ownerSeatID: SeatID,
  sourceZone: number
): Card[] {
  const targetCards = new Set<Card>(getInitialEntitiesForSeat(state, targetSeatID))
  getInitialCardIDsForSeat(state, targetSeatID)
    .map((cardID) => room.cardIndex.get(cardID))
    .filter((card): card is Card => Boolean(card))
    .forEach((card) => targetCards.add(card))

  return Array.from(targetCards)
    .filter((card) => !isCardInOwnerHand(card, ownerSeatID))
    .filter((card) => isCardInGainAllSource(card, targetSeatID, sourceZone))
}

function isCardInGainAllSource(card: Card, targetSeatID: SeatID, sourceZone: number): boolean {
  if (sourceZone === 2) return card.location === 'discard'
  return (
    card.location === 'player' &&
    card.subZone === 'hand' &&
    card.seats.has(targetSeatID)
  )
}

function createDiscardGroup(
  event: MoveEventDraft,
  room: Room,
  state: DuoQiState,
  activation: DuoQiActivation
): DuoQiDiscardGroup | null {
  if (state.pendingDiscardGroups.length > 0) return null
  const initialHandCount = state.initialHandCountsBySeat.get(activation.targetSeatID) ?? 0
  const targetInitialCardIDs = getInitialCardIDsForSeat(state, activation.targetSeatID)
  if (targetInitialCardIDs.length !== initialHandCount) return null

  const candidateIdentityIDs = targetInitialCardIDs.filter(
    (cardID) => room.cardIndex.get(cardID)?.location === 'discard'
  )
  const memberCards = candidateIdentityIDs
    .map((cardID) => room.cardIndex.get(cardID))
    .filter((card): card is Card => Boolean(card))
  const gainedCount = Math.max(0, Number(event.cardCount) || 0)
  if (
    candidateIdentityIDs.length < gainedCount ||
    memberCards.length !== candidateIdentityIDs.length
  ) {
    return null
  }

  const group: DuoQiDiscardGroup = {
    id: `duoqi_discard_${activation.sequence}_${state.sequence + state.pendingDiscardGroups.length + 1}`,
    ownerSeatID: activation.ownerSeatID,
    targetSeatID: activation.targetSeatID,
    candidateIdentityIDs: new Set(candidateIdentityIDs),
    gainedCount,
    remainingDiscardCount: candidateIdentityIDs.length - gainedCount,
    memberCards: new Set(memberCards),
    movedCards: new Set(),
    ledgerRegistered: false
  }
  return group
}

function decorateRandomDiscardGain(
  event: MoveEventDraft,
  room: Room,
  state: DuoQiState
): MoveEventDraft {
  const raw = getRaw(event)
  const activation = state.activations.get(DUO_QI_RANDOM_GAIN_SPELL_ID)
  if (!activation || activation.skipInference || !activationMatchesMove(activation, raw))
    return event
  if (Number(raw.FromZone) !== 2 || event.cardIDs?.some?.((cardID: CardID) => cardID > 0))
    return event

  const group = createDiscardGroup(event, room, state, activation)
  if (!group || group.gainedCount <= 0) return event

  if (group.gainedCount === group.memberCards.size) {
    const sourceCards = Array.from(group.memberCards)
    return patchEvent(event, {
      options: {
        sourceCards,
        pileIdentityCardIDs: sourceCards.filter((card) => card.id > 0).map((card) => card.id)
      }
    })
  }

  const sourceCards = Array.from(group.memberCards).slice(0, group.gainedCount)
  sourceCards.forEach((card) => group.movedCards.add(card))
  state.pendingDiscardGroups.push(group)
  return patchEvent(event, {
    options: {
      sourceCards,
      combinationID: group.id,
      anonymizeCards: Array.from(group.memberCards),
      duoQiDiscardGroupID: group.id
    }
  })
}

export function decorateDuoQiMove(event: MoveEventDraft, room: Room): MoveEventDraft {
  const state = getDuoQiState(getGame(room))
  if (!state) return event

  const spellID = Number(getRaw(event).SpellID ?? event.options?.spellID)
  if (spellID === DUO_QI_GAIN_ALL_SPELL_ID) return decorateGainAll(event, room, state)
  if (spellID === DUO_QI_RANDOM_GAIN_SPELL_ID) {
    return decorateRandomHandGain(decorateRandomDiscardGain(event, room, state), room, state)
  }
  return event
}

function decorateRandomHandGain(
  event: MoveEventDraft,
  room: Room,
  state: DuoQiState
): MoveEventDraft {
  const raw = getRaw(event)
  const activation = state.activations.get(DUO_QI_RANDOM_GAIN_SPELL_ID)
  if (!activation || activation.skipInference || !activationMatchesMove(activation, raw)) {
    return event
  }
  if (
    Number(raw.FromZone) !== 5 ||
    event.cardIDs?.some?.((cardID: CardID) => cardID > 0) ||
    event.options?.sourceCards?.length
  ) {
    return event
  }

  const count = Math.max(0, Number(event.cardCount ?? raw.CardCount) || 0)
  const candidateEntities = new Set(
    getInitialEntitiesForSeat(state, activation.targetSeatID).filter(
      (card) =>
        card.location === 'player' &&
        card.subZone === 'hand' &&
        card.seats.has(activation.targetSeatID)
    )
  )
  if (count <= 0 || candidateEntities.size < count) return event

  const group: DuoQiRandomHandGroup = {
    ownerSeatID: activation.ownerSeatID,
    targetSeatID: activation.targetSeatID,
    candidateEntities,
    candidateCardIDs: new Set(),
    gainedCount: count,
    sequence: activation.sequence
  }
  state.pendingRandomHandGroups.push(group)
  return patchEvent(event, {
    options: {
      forceRandomHandTransferCandidates: true,
      duoQiRandomHandGroupSequence: group.sequence
    }
  })
}

export function decorateDuoQiKnownMove(event: MoveEventDraft, room: Room): MoveEventDraft {
  const state = getDuoQiState(getGame(room))
  if (!state || state.pendingRandomHandGroups.length === 0) return event

  const raw = getRaw(event)
  const fromSeatID = Number(raw.FromID)
  if (
    Number(raw.FromZone) !== 5 ||
    !event.cardIDs?.some?.((cardID: CardID) => cardID > 0)
  ) {
    return event
  }

  const group = state.pendingRandomHandGroups
    .slice()
    .reverse()
    .find((candidate) => candidate.ownerSeatID === fromSeatID && candidate.gainedCount > 0)
  if (!group) return event

  const knownIDs = event.cardIDs.filter((cardID: CardID) => cardID > 0)
  const candidateIDs = knownIDs.filter(
    (cardID: CardID) =>
      state.allCardIDs.has(cardID) && !state.initialSeatByCardID.has(cardID)
  )
  if (candidateIDs.length === 0) return event

  return patchEvent(event, {
    options: {
      duoQiRandomHandCandidateIDs: candidateIDs,
      duoQiRandomHandGroupSequence: group.sequence
    }
  })
}

export function decorateDuoQiEntitySafety(event: MoveEventDraft, room: Room): MoveEventDraft {
  const state = getDuoQiState(getGame(room))
  if (!state) return event

  const raw = getRaw(event)
  const spellID = Number(raw.SpellID ?? event.options?.spellID)
  const fromSeatID = Number(raw.FromID)
  const isUnknownHandSelection =
    Number(raw.FromZone) === 5 && !event.cardIDs?.some?.((cardID: CardID) => cardID > 0)

  if (!isUnknownHandSelection || spellID === DUO_QI_GAIN_ALL_SPELL_ID) return event

  // 3731 由技能私有局部候选组保留初始归属；此处不能清掉整组实体标签。
  if (spellID === DUO_QI_RANDOM_GAIN_SPELL_ID) return event

  const selectionCount = Math.max(0, Number(event.cardCount ?? raw.CardCount) || 0)
  const sourcePlayer = room.getPlayer(fromSeatID)
  const physicalHandCards = getInitialHandCards(room, fromSeatID)
  const sourceHandCount = sourcePlayer?.hasObservedHandCount
    ? sourcePlayer.observedHandCount
    : physicalHandCards.length
  // 整手确定迁移仍移动同一批实体；只有部分未知选择才会破坏实体与真实身份的一一对应。
  if (sourceHandCount <= 0 || selectionCount >= sourceHandCount) return event

  physicalHandCards.forEach((card) => {
    if (card.id > 0 && state.initialSeatByCardID.has(card.id)) return
    state.initialSeatByEntity.delete(card)
  })
  return event
}

function findInitialSeatByCard(state: DuoQiState, room: Room, cardID: CardID): SeatID | undefined {
  const existingSeatID = state.initialSeatByCardID.get(cardID)
  if (existingSeatID !== undefined) return existingSeatID

  const card = room.cardIndex.get(cardID)
  if (!card) return undefined

  if (state.pendingRandomHandGroups.some((group) => group.candidateCardIDs.has(cardID))) {
    return undefined
  }

  const entitySeatID = state.initialSeatByEntity.get(card)
  if (entitySeatID !== undefined) return entitySeatID

  for (const group of state.pendingDiscardGroups) {
    if (!group.candidateIdentityIDs.has(cardID)) continue
    if (group.movedCards.has(card) || group.memberCards.has(card)) return group.targetSeatID
  }

  return undefined
}

function settleDiscardGroups(state: DuoQiState, room: Room, cardID: CardID): void {
  state.pendingDiscardGroups = state.pendingDiscardGroups.filter((group) => {
    if (!group.candidateIdentityIDs.has(cardID)) return group.candidateIdentityIDs.size > 0

    const card = room.cardIndex.get(cardID)
    group.candidateIdentityIDs.delete(cardID)
    if (card?.location === 'discard') {
      group.remainingDiscardCount = Math.max(0, group.remainingDiscardCount - 1)
    } else if (group.gainedCount > 0) {
      group.gainedCount -= 1
    }

    return group.candidateIdentityIDs.size > 0
  })
}

export function observeDuoQiKnownCardIDs(room: Room, cardIDs: readonly CardID[]): void {
  const state = getDuoQiState(getGame(room))
  if (!state) return

  normalizeCardIDs(cardIDs).forEach((cardID) => {
    if (!state.allCardIDs.has(cardID)) return
    const initialSeatID = findInitialSeatByCard(state, room, cardID)
    if (initialSeatID !== undefined) bindInitialCardID(state, cardID, initialSeatID)
    settleDiscardGroups(state, room, cardID)
  })
  convergeInitialSeats(state)
}

export function collectDuoQiAmbiguousDiscardRecycleGroups(
  room: Room
): DuoQiAmbiguousDiscardRecycleGroup[] {
  const state = getDuoQiState(getGame(room))
  if (!state || state.pendingDiscardGroups.length === 0) return []

  return state.pendingDiscardGroups
    .filter(
      (group) =>
        group.ledgerRegistered &&
        group.remainingDiscardCount > 0 &&
        group.candidateIdentityIDs.size > 0
    )
    .map((group) => ({
      candidateIdentityIDs: Array.from(group.candidateIdentityIDs),
      recycledCount: Math.min(group.remainingDiscardCount, group.candidateIdentityIDs.size)
    }))
}

export function commitDuoQiMove(room: Room, event: MoveEventDraft): void {
  const state = getDuoQiState(getGame(room))
  commitRandomHandCandidates(state, event)
  finishRandomHandGroupsAfterGainAll(state, event)
  const groupID = String(event.options?.duoQiDiscardGroupID ?? '')
  if (!state || !groupID) return

  const group = state.pendingDiscardGroups.find((candidate) => candidate.id === groupID)
  if (!group || group.ledgerRegistered) return

  try {
    room.registerAmbiguousOutsideIdentityGroup(Array.from(group.candidateIdentityIDs))
    group.ledgerRegistered = true
  } catch (error) {
    state.pendingDiscardGroups = state.pendingDiscardGroups.filter(
      (candidate) => candidate !== group
    )
    throw error
  }
}

function finishRandomHandGroupsAfterGainAll(
  state: DuoQiState | undefined,
  event: MoveEventDraft
): void {
  if (!state || state.pendingRandomHandGroups.length === 0) return

  const raw = getRaw(event)
  const spellID = Number(raw.SpellID ?? event.options?.spellID)
  if (spellID !== DUO_QI_GAIN_ALL_SPELL_ID || Number(raw.FromZone) !== 5) return

  const activation = state.activations.get(DUO_QI_GAIN_ALL_SPELL_ID)
  if (!activation || !activationMatchesMove(activation, raw)) return

  // 3730 的玩家手牌分片表示目标手中剩余初始牌已全部收齐；此前同目标的 3731
  // 随机获得事实已被覆盖，继续保留只会把后续发动者明牌误记到过期目标。
  state.pendingRandomHandGroups = state.pendingRandomHandGroups.filter(
    (group) =>
      group.ownerSeatID !== activation.ownerSeatID || group.targetSeatID !== activation.targetSeatID
  )
}

function commitRandomHandCandidates(state: DuoQiState | undefined, event: MoveEventDraft): void {
  if (!state || state.pendingRandomHandGroups.length === 0) return

  const sequence = Number(event.options?.duoQiRandomHandGroupSequence)
  const group = state.pendingRandomHandGroups.find((candidate) => candidate.sequence === sequence)
  if (!group) return

  normalizeCardIDs(event.options?.duoQiRandomHandCandidateIDs ?? []).forEach((cardID) => {
    if (state.allCardIDs.has(cardID) && !state.initialSeatByCardID.has(cardID)) {
      group.candidateCardIDs.add(cardID)
    }
  })
}

export function finalizeDuoQiDiscardRecycle(room: Room): void {
  const state = getDuoQiState(getGame(room))
  if (!state || state.pendingDiscardGroups.length === 0) return
  state.pendingDiscardGroups = []
}
