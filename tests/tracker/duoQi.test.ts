import { describe, expect, it, vi } from 'vitest'
import { trackerLogger } from '@/utils/logger'
import { isAnonymous } from '@/tracker/Card'
import { POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import type { Room } from '@/tracker/Room'
import { normalizeMoveEvent } from '@/tracker/MoveEventNormalizer'
import {
  commitDuoQiMove,
  initializeDuoQiState,
  recordDuoQiActivation,
  recordDuoQiRoleDataTarget
} from '@/tracker/skill/DuoQi'
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

function dealAnonymousHand(room: Room, seatID: number, count: number): void {
  room.moveCards([], 'player', {
    fromZone: 'pile',
    seatID,
    subZone: 'hand',
    cardCount: count
  })
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
      SeatID: 3,
      SkillOwerSeatID: 1,
      DestSeatIDs: [3]
    })
    expect(
      recordDuoQiRoleDataTarget(gameState, {
        DataID: 8,
        Datas: [3730, 1],
        SeatID: 2
      })
    ).toMatchObject({ ownerSeatID: 1, targetSeatID: 2 })

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

  it('3731 其它视角从弃牌堆暗取时确认后进入的目标夺炁牌', () => {
    const { controller, gameState, room } = setup(undefined, 300)
    dealAnonymousHand(room, 1, 4)
    dealAnonymousHand(room, 2, 4)
    const state = initializeDuoQiState(gameState, [1, 2, 3, 4, 5, 6, 7, 8])!

    const discardMoves = [
      { cardID: 5, seatID: 2 },
      { cardID: 6, seatID: 2 },
      { cardID: 1, seatID: 1 }
    ]
    discardMoves.forEach(({ cardID, seatID }) => {
      controller.syncTrackerMove(
        protocolMove({
          CardIDs: [cardID],
          CardCount: 1,
          FromZone: 5,
          FromID: seatID,
          ToZone: 2,
          ToID: 255,
          MoveType: 4
        })
      )
    })
    expect(state.initialCardIDsBySeat.get(2)).toEqual(new Set([5, 6]))
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
        FromZoneParam: 0,
        FromPosition: POSITION_RANDOM,
        ToZone: 5,
        ToID: 1,
        ToZoneParam: 0,
        ToPosition: POSITION_TOP,
        MoveType: 18,
        SpellID: 3731
      })
    )

    expect(room.cardIndex.get(6)).toMatchObject({
      isKnown: true,
      location: 'player',
      owner: 1
    })
    expect(room.cardIndex.get(5)?.location).toBe('discard')
    expect(room.cardIndex.get(1)?.location).toBe('discard')
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

  it('3731 手牌暗取保持 N 选 K，直到 3730 来源数量闭合才确认初始归属', () => {
    const { controller, gameState, room } = setup(undefined, 300)
    bindHand(room, [1, 2, 3, 4], 1, false)
    bindHand(room, [5, 6, 7, 8], 2, false)
    const state = initializeDuoQiState(gameState, [1, 2, 3, 4, 5, 6, 7, 8])!
    recordDuoQiActivation(gameState, {
      SpellID: 3731,
      EffectIndex: 2,
      SeatID: 1,
      SkillOwerSeatID: 1,
      DestSeatIDs: [2]
    })

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 1,
        FromZone: 5,
        FromID: 2,
        ToZone: 5,
        ToID: 1,
        MoveType: 18,
        SpellID: 3731
      })
    )
    const [group] = state.pendingRandomHandGroups
    expect(group.candidateEntities.size).toBe(4)
    expect(group.gainedCount).toBe(1)
    expect(
      Array.from(group.candidateEntities).every((card) => card.seats.has(1) && card.seats.has(2))
    ).toBe(true)

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [5],
        CardCount: 1,
        FromZone: 5,
        FromID: 1,
        ToZone: 2,
        ToID: 255,
        MoveType: 4,
        SpellID: 0
      })
    )

    expect(state.initialSeatByCardID.get(5)).toBeUndefined()
    expect(group.candidateCardIDs).toEqual(new Set([5]))
    expect(state.pendingRandomHandGroups).toEqual([group])

    room.moveCards([6], 'discard', {
      fromSeatID: 2,
      fromSubZone: 'hand',
      fromZone: null,
      cardCount: 1
    })
    room.applyPileIdentityReveal([6], 'discard')
    recordDuoQiRoleDataTarget(gameState, {
      DataID: 8,
      Datas: [3730, 1],
      SeatID: 2
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

    expect(state.initialSeatByCardID.get(5)).toBe(2)
    expect(state.pendingRandomHandGroups).toEqual([])
    expect([5, 6].map((cardID) => room.cardIndex.get(cardID)?.location)).toEqual([
      'player',
      'player'
    ])
  })

  it('匿名初始手牌经 3731 与 3730 分片后整手弃置不补建实体', () => {
    const { controller, gameState, room } = setup(undefined, 300)
    dealAnonymousHand(room, 1, 4)
    dealAnonymousHand(room, 2, 4)
    const initialEntityCount = room.cards.length
    const state = initializeDuoQiState(gameState, [1, 2, 3, 4, 5, 6, 7, 8])!

    recordDuoQiActivation(gameState, {
      SpellID: 3731,
      EffectIndex: 2,
      SeatID: 1,
      SkillOwerSeatID: 1,
      DestSeatIDs: [2]
    })
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 1,
        FromZone: 5,
        FromID: 2,
        ToZone: 5,
        ToID: 1,
        MoveType: 18,
        SpellID: 3731
      })
    )
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [5],
        CardCount: 1,
        FromZone: 5,
        FromID: 1,
        ToZone: 2,
        ToID: 255,
        MoveType: 4,
        SpellID: 0
      })
    )
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [6],
        CardCount: 1,
        FromZone: 5,
        FromID: 2,
        ToZone: 2,
        ToID: 255,
        MoveType: 4,
        SpellID: 0
      })
    )

    recordDuoQiRoleDataTarget(gameState, {
      DataID: 8,
      Datas: [3730, 1],
      SeatID: 2
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
    const warnSpy = vi.spyOn(trackerLogger, 'warn').mockImplementation(() => {})
    try {
      controller.syncTrackerMove(
        protocolMove({
          CardIDs: [1, 2, 3, 4, 5, 6, 7, 8],
          CardCount: 8,
          FromZone: 5,
          FromID: 1,
          ToZone: 2,
          ToID: 255,
          MoveType: 4,
          SpellID: 0
        })
      )

      expect(warnSpy).not.toHaveBeenCalledWith(
        '玩家来源 known 路径实体缺口，将 createExternal',
        expect.anything()
      )
    } finally {
      warnSpy.mockRestore()
    }

    expect(room.cards).toHaveLength(initialEntityCount)
    const targetInitialCardIDs = state.initialCardIDsBySeat.get(2) ?? new Set()
    expect(targetInitialCardIDs.size).toBe(4)
    expect(targetInitialCardIDs.has(5)).toBe(true)
    expect(targetInitialCardIDs.has(6)).toBe(true)
    expect(state.unresolvedCardIDs).toEqual(new Set())
    expect(state.pendingRandomHandGroups).toEqual([])
  })

  it('3730 候选替换槽不足时不部分提交初始归属', () => {
    const { controller, gameState, room } = setup(undefined, 300)
    bindHand(room, [1, 2, 3, 4], 1, false)
    bindHand(room, [5, 6, 7, 8], 2, false)
    const state = initializeDuoQiState(gameState, [1, 2, 3, 4, 5, 6, 7, 8])!

    recordDuoQiActivation(gameState, {
      SpellID: 3731,
      EffectIndex: 2,
      SeatID: 1,
      SkillOwerSeatID: 1,
      DestSeatIDs: [2]
    })
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 2,
        FromZone: 5,
        FromID: 2,
        ToZone: 5,
        ToID: 1,
        MoveType: 18,
        SpellID: 3731
      })
    )

    const [group] = state.pendingRandomHandGroups
    const candidateCards = [5, 6].map((cardID) => room.cardIndex.get(cardID)!)
    room.moveCards([5, 6], 'discard', {
      fromSeatID: 1,
      fromSubZone: 'hand',
      fromZone: null,
      cardCount: 2
    })
    group.candidateCardIDs = new Set([5, 6])
    group.candidateEntities.forEach((card) => state.initialSeatByEntity.set(card, 1))
    candidateCards.forEach((card) => state.initialSeatByEntity.set(card, 1))
    const replacement = Array.from(group.candidateEntities).find((card) => card.id <= 0)!
    state.initialSeatByEntity.set(replacement, 2)
    const initialSeatByEntityBefore = new Map(state.initialSeatByEntity)

    recordDuoQiRoleDataTarget(gameState, {
      DataID: 8,
      Datas: [3730, 1],
      SeatID: 2
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
          SpellID: 3730
        })
      )
    )

    expect(decorated?.options.sourceCards).toBeUndefined()
    expect(state.initialSeatByEntity).toEqual(initialSeatByEntityBefore)
    expect(state.initialSeatByCardID.has(5)).toBe(false)
    expect(state.initialSeatByCardID.has(6)).toBe(false)
    expect(group.candidateCardIDs).toEqual(new Set([5, 6]))
    expect(group.gainedCount).toBe(2)
  })

  it('3731 目标夺炁牌数量不足时不伪造确定来源', () => {
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
    expect(decorated?.options.sourceCards).toBeUndefined()
  })

  it('3731 只取得后入的一张，不沿用 3730 的全取规则', () => {
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
        CardCount: 1,
        FromZone: 2,
        FromID: 255,
        ToZone: 5,
        ToID: 1,
        MoveType: 18,
        SpellID: 3731
      })
    )

    expect(room.cardIndex.get(6)).toMatchObject({ location: 'player', owner: 1 })
    expect(room.cardIndex.get(5)?.location).toBe('discard')
    expect([7, 8].map((cardID) => room.cardIndex.get(cardID)?.owner)).toEqual([2, 2])
  })

  it('同 SpellID 的非手牌目标移动不触发夺炁推断', () => {
    const { gameState, room } = setup(undefined, 300)
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

    const decorated = room.decorateMoveEvent(
      normalizeMoveEvent(
        protocolMove({
          CardIDs: [],
          CardCount: 1,
          FromZone: 2,
          FromID: 255,
          ToZone: 6,
          ToID: 1,
          MoveType: 18,
          SpellID: 3731
        })
      )
    )

    expect(decorated?.options.sourceCards).toBeUndefined()
  })

  it('仅有规范化 options 时仍识别展示来源并结束 3730 手牌组', () => {
    const { gameState, room } = setup(undefined, 300)
    bindHand(room, [1, 2, 3, 4], 1, false)
    bindHand(room, [5, 6, 7, 8], 2, false)
    const state = initializeDuoQiState(gameState, [1, 2, 3, 4, 5, 6, 7, 8])!

    state.pendingRandomHandGroups.push({
      ownerSeatID: 1,
      targetSeatID: 2,
      candidateEntities: new Set(),
      candidateCardIDs: new Set(),
      gainedCount: 1,
      sequence: 11
    })

    const knownMove = room.decorateMoveEvent({
      cardIDs: [5],
      cardCount: 1,
      toZone: 'discard',
      options: {
        fromSeatID: 1,
        fromSubZone: 'hand'
      }
    })
    expect(knownMove.options).toMatchObject({
      duoQiRandomHandCandidateIDs: [5],
      duoQiRandomHandGroupSequence: 11
    })

    recordDuoQiRoleDataTarget(gameState, {
      DataID: 8,
      Datas: [3730, 1],
      SeatID: 2
    })
    const gainAllMove = room.decorateMoveEvent({
      cardIDs: [],
      cardCount: 1,
      toZone: 'player',
      options: {
        spellID: 3730,
        fromSeatID: 2,
        fromSubZone: 'hand',
        seatID: 1,
        subZone: 'hand'
      }
    })
    commitDuoQiMove(room, gainAllMove)

    expect(state.pendingRandomHandGroups).toEqual([])
  })

  it('3731 连续暗取时依次取得后进入弃牌区的目标夺炁牌', () => {
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

    expect([8, 7].map((cardID) => room.cardIndex.get(cardID))).toEqual([
      expect.objectContaining({ isKnown: true, location: 'player', owner: 1 }),
      expect.objectContaining({ isKnown: true, location: 'player', owner: 1 })
    ])
    expect(room.zones.get('discard')?.cards.map((card) => card.id)).toEqual([5, 6])
  })
})
