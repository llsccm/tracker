import { describe, expect, it } from 'vitest'
import { isAnonymous } from '@/tracker/Card'
import type { Room } from '@/tracker/Room'
import { normalizeMoveEvent } from '@/tracker/MoveEventNormalizer'
import { getDuoQiState, initializeDuoQiState, recordDuoQiActivation } from '@/tracker/skill/DuoQi'
import { createTrackerControllerHarness, protocolMove } from './helpers/trackerController'

function getCard(room: Room, cardID: number) {
  const existing = room.cardIndex.get(cardID)
  if (existing) return existing
  const target = room.zones.get('pile')!.cards.find(isAnonymous) ?? null
  return room.materialize(cardID, target)!
}

function bindHand(room: Room, cardIDs: number[], seatID: number, known = true): void {
  const cards = cardIDs.map((cardID) => getCard(room, cardID))
  room.clearCardsFromPublicZones(cards)
  cards.forEach((card) => {
    card.bindCandidates([seatID], 'hand', null, { known })
    card.isKnown = known
  })
  room.getPlayer(seatID).syncObservedHandCount(cardIDs.length)
  room.resolveConstraints()
  room.applyPileIdentityReveal(cardIDs, 'outside')
}

function setup(cardIDs = [1, 2, 3, 4, 5, 6, 7, 8], currentUserID = 100) {
  const { controller, gameState } = createTrackerControllerHarness()
  controller.initTrackerRoom()
  controller.registerTrackerPlayers(
    [
      { SeatID: 1, ClientID: 100 },
      { SeatID: 2, ClientID: 200 },
      { SeatID: 3, ClientID: 300 }
    ],
    currentUserID
  )
  controller.initTrackerDeck(cardIDs)
  return { controller, gameState, room: controller.getTrackerRoom()! }
}

describe('夺炁初始牌身份', () => {
  it('重复初始化按本次完整快照替换旧状态，并只绑定可见 CardID', () => {
    const cardIDs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    const { gameState, room } = setup(cardIDs)
    bindHand(room, [1, 2, 3, 4], 1)
    bindHand(room, [5, 6, 7, 8], 2, false)
    bindHand(room, [9, 10, 11, 12], 3, false)

    const state = initializeDuoQiState(gameState, cardIDs)!
    state.sequence = 7
    expect(Array.from(state.initialCardIDsBySeat.get(1) ?? []).sort()).toEqual([1, 2, 3, 4])
    expect(state.initialCardIDsBySeat.get(2)).toEqual(new Set())
    expect(state.initialCardIDsBySeat.get(3)).toEqual(new Set())
    expect(state.unresolvedCardIDs).toEqual(new Set([5, 6, 7, 8, 9, 10, 11, 12]))
    expect(
      Array.from(state.initialSeatByEntity.values()).filter((seatID) => seatID === 2)
    ).toHaveLength(4)

    const replacement = initializeDuoQiState(gameState, [...cardIDs].reverse())!

    expect(replacement).not.toBe(state)
    expect(replacement.sequence).toBe(0)
    expect(replacement.pendingDiscardGroups).toEqual([])
    expect(replacement.initialHandCountsBySeat).toEqual(
      new Map([
        [1, 4],
        [2, 4],
        [3, 4]
      ])
    )
    expect(Array.from(replacement.initialCardIDsBySeat.get(1) ?? []).sort()).toEqual([1, 2, 3, 4])
    expect(replacement.initialCardIDsBySeat.get(2)).toEqual(new Set())
    expect(replacement.initialCardIDsBySeat.get(3)).toEqual(new Set())
    expect(gameState.getSpellState(3731)).toBe(replacement)
  })

  it('3730 分别从弃牌堆和目标手牌取走确定的剩余初始牌', () => {
    const { controller, gameState, room } = setup(undefined, 300)
    bindHand(room, [1, 2, 3, 4], 1)
    bindHand(room, [5, 6, 7, 8], 2)
    initializeDuoQiState(gameState, [1, 2, 3, 4, 5, 6, 7, 8])

    room.moveCards([5, 6], 'discard', {
      fromSeatID: 2,
      fromSubZone: 'hand',
      fromZone: null,
      cardCount: 2
    })
    room.applyPileIdentityReveal([5, 6], 'discard')
    recordDuoQiActivation(gameState, {
      SpellID: 3730,
      EffectIndex: 1,
      SeatID: 2,
      SkillOwerSeatID: 1,
      DestSeatIDs: [2]
    })

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 2,
        FromZone: 2,
        FromID: 255,
        ToZone: 5,
        ToID: 1,
        MoveType: 18,
        SpellID: 3730
      })
    )
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 2,
        FromZone: 5,
        FromID: 2,
        ToZone: 5,
        ToID: 1,
        MoveType: 18,
        SpellID: 3730
      })
    )

    expect(room.zones.get('discard')!.cards).toEqual([])
    expect([5, 6, 7, 8].map((cardID) => room.cardIndex.get(cardID)?.location)).toEqual([
      'player',
      'player',
      'player',
      'player'
    ])
    expect(room.pileIdentityLedger.getSnapshot().knownDiscardIdentityIDs).toEqual([])
  })

  it('3731 从弃牌堆四选一后洗牌保留局部 4 选 3 cohort', () => {
    const { controller, gameState, room } = setup([1, 2, 3, 4, 5, 6, 7, 8, 9], 300)
    bindHand(room, [1, 2, 3, 4], 1)
    bindHand(room, [5, 6, 7, 8], 2)
    initializeDuoQiState(gameState, [1, 2, 3, 4, 5, 6, 7, 8])

    room.moveCards([5, 6, 7, 8], 'discard', {
      fromSeatID: 2,
      fromSubZone: 'hand',
      fromZone: null,
      cardCount: 4
    })
    room.applyPileIdentityReveal([5, 6, 7, 8], 'discard')
    recordDuoQiActivation(gameState, {
      SpellID: 3731,
      EffectIndex: 2,
      SeatID: 2,
      SkillOwerSeatID: 1,
      DestSeatIDs: [2]
    })

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 1,
        FromZone: 2,
        FromID: 255,
        ToZone: 5,
        ToID: 1,
        MoveType: 18,
        SpellID: 3731
      })
    )

    const state = getDuoQiState(gameState)!
    expect(state.pendingDiscardGroups).toHaveLength(1)
    expect(room.zones.get('discard')!.cards).toHaveLength(3)
    expect(room.zones.get('discard')!.cards.every(isAnonymous)).toBe(true)

    const pileCount = room.zones.get('pile')!.cards.length + room.zones.get('discard')!.cards.length
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: pileCount,
        FromZone: 2,
        ToZone: 9,
        MoveType: 255
      })
    )

    expect(getDuoQiState(gameState)!.pendingDiscardGroups).toEqual([])
    expect(room.pileIdentityLedger.getSnapshot().cohort.groups).toContainEqual({
      generation: 1,
      kind: 'partial',
      cardIDs: [5, 6, 7, 8],
      remainingPileCount: 3
    })
    expect(room.pileIdentityLedger.getSnapshot().accountedPileCount).toBe(pileCount)
  })

  it('整手未知交换保留初始化实体标记，后续展示仍归交换前座位', () => {
    const { controller, gameState, room } = setup(undefined, 300)
    bindHand(room, [1, 2, 3, 4], 1, false)
    bindHand(room, [5, 6, 7, 8], 2, false)
    const state = initializeDuoQiState(gameState, [1, 2, 3, 4, 5, 6, 7, 8])!
    const initialSeat1Card = Array.from(state.initialSeatByEntity).find(
      ([, seatID]) => seatID === 1
    )![0]

    room.moveCards([0, 0, 0, 0], 'player', {
      seatID: 2,
      fromSeatID: 1,
      fromSubZone: 'hand',
      fromZone: null,
      cardCount: 4,
      handMoveCount: 4
    })
    expect(state.initialSeatByEntity.get(initialSeat1Card)).toBe(1)

    const targetEntity = room.cards.find(
      (card) =>
        card.location === 'player' &&
        card.subZone === 'hand' &&
        card.seats.has(2) &&
        state.initialSeatByEntity.get(card) === 1
    )!
    room.anonymizeLocatedIdentity(targetEntity, 'test:duoqiExchangeReveal', {
      preservePlacement: true
    })
    controller.revealTrackerCards(
      {
        type: 'player',
        seatID: 2,
        fromSeatID: 2,
        fromSubZone: 'hand',
        handMoveCount: 0
      },
      [1]
    )

    expect(state.initialSeatByCardID.get(1)).toBe(1)
  })

  it('部分未知手牌选择撤销受影响匿名实体的确定初始化座位', () => {
    const { gameState, room } = setup(undefined, 300)
    bindHand(room, [1, 2, 3, 4], 1, false)
    bindHand(room, [5, 6, 7, 8], 2, false)
    const sourceCards = room.cards.filter(
      (card) => card.location === 'player' && card.subZone === 'hand' && card.seats.has(1)
    )
    sourceCards.forEach((card) => room.anonymizeLocatedIdentity(card, 'test:duoqiPartial'))
    const state = initializeDuoQiState(gameState, [1, 2, 3, 4, 5, 6, 7, 8])!

    const decorated = room.decorateMoveEvent(
      normalizeMoveEvent(
        protocolMove({
          CardIDs: [],
          CardCount: 1,
          FromZone: 5,
          FromID: 1,
          ToZone: 5,
          ToID: 2,
          MoveType: 18,
          SpellID: 9000
        })
      )
    )

    expect(decorated).toBeTruthy()
    sourceCards.forEach((card) => expect(state.initialSeatByEntity.has(card)).toBe(false))
  })

  it('3731 弃牌推断失败时不残留待处理模糊组', () => {
    const { gameState, room } = setup(undefined, 300)
    bindHand(room, [1, 2, 3, 4], 1)
    bindHand(room, [5, 6, 7, 8], 2)
    initializeDuoQiState(gameState, [1, 2, 3, 4, 5, 6, 7, 8])

    room.moveCards([5], 'discard', {
      fromSeatID: 2,
      fromSubZone: 'hand',
      fromZone: null,
      cardCount: 1
    })
    room.applyPileIdentityReveal([5], 'discard')
    recordDuoQiActivation(gameState, {
      SpellID: 3731,
      EffectIndex: 2,
      SeatID: 2,
      SkillOwerSeatID: 1,
      DestSeatIDs: [2]
    })

    const decorated = room.decorateMoveEvent(
      normalizeMoveEvent(
        protocolMove({
          CardIDs: [],
          CardCount: 2,
          FromZone: 2,
          FromID: 255,
          ToZone: 5,
          ToID: 1,
          MoveType: 18,
          SpellID: 3731
        })
      )
    )

    expect(decorated).toBeTruthy()
    expect(decorated?.options.duoQiDiscardGroupID).toBeUndefined()
    expect(getDuoQiState(gameState)?.pendingDiscardGroups).toEqual([])
  })

  it('3731 获取全部弃牌候选时按确定集合移动且不建立模糊组', () => {
    const { controller, gameState, room } = setup(undefined, 300)
    bindHand(room, [1, 2, 3, 4], 1)
    bindHand(room, [5, 6, 7, 8], 2)
    initializeDuoQiState(gameState, [1, 2, 3, 4, 5, 6, 7, 8])

    room.moveCards([5, 6], 'discard', {
      fromSeatID: 2,
      fromSubZone: 'hand',
      fromZone: null,
      cardCount: 2
    })
    room.applyPileIdentityReveal([5, 6], 'discard')
    recordDuoQiActivation(gameState, {
      SpellID: 3731,
      EffectIndex: 2,
      SeatID: 2,
      SkillOwerSeatID: 1,
      DestSeatIDs: [2]
    })

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 2,
        FromZone: 2,
        FromID: 255,
        ToZone: 5,
        ToID: 1,
        MoveType: 18,
        SpellID: 3731
      })
    )

    expect(room.zones.get('discard')?.cards).toEqual([])
    expect([5, 6].map((cardID) => room.cardIndex.get(cardID)?.location)).toEqual([
      'player',
      'player'
    ])
    expect(getDuoQiState(gameState)?.pendingDiscardGroups).toEqual([])
    expect(room.pileIdentityLedger.getSnapshot().knownDiscardIdentityIDs).toEqual([])
  })

  it('存在未决弃牌模糊组时不叠加第二组', () => {
    const { controller, gameState, room } = setup(undefined, 300)
    bindHand(room, [1, 2, 3, 4], 1)
    bindHand(room, [5, 6, 7, 8], 2)
    initializeDuoQiState(gameState, [1, 2, 3, 4, 5, 6, 7, 8])

    room.moveCards([5, 6, 7, 8], 'discard', {
      fromSeatID: 2,
      fromSubZone: 'hand',
      fromZone: null,
      cardCount: 4
    })
    room.applyPileIdentityReveal([5, 6, 7, 8], 'discard')
    recordDuoQiActivation(gameState, {
      SpellID: 3731,
      EffectIndex: 2,
      SeatID: 2,
      SkillOwerSeatID: 1,
      DestSeatIDs: [2]
    })

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 1,
        FromZone: 2,
        FromID: 255,
        ToZone: 5,
        ToID: 1,
        MoveType: 18,
        SpellID: 3731
      })
    )
    const firstGroup = getDuoQiState(gameState)?.pendingDiscardGroups[0]
    expect(firstGroup).toBeTruthy()

    const decorated = room.decorateMoveEvent(
      normalizeMoveEvent(
        protocolMove({
          CardIDs: [],
          CardCount: 1,
          FromZone: 2,
          FromID: 255,
          ToZone: 5,
          ToID: 1,
          MoveType: 18,
          SpellID: 3731
        })
      )
    )

    expect(decorated?.options.duoQiDiscardGroupID).toBeUndefined()
    expect(getDuoQiState(gameState)?.pendingDiscardGroups).toEqual([firstGroup])
  })
})
