import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { createLocationCandidateKey } from '@/tracker/candidate/locationCandidate'
import { MOVE_TYPE } from '@/tracker/MoveEventNormalizer'
import type { Room } from '@/tracker/Room'
import {
  JIE_LI_SPELL_ID,
  parseJieLiSelectionData,
  recordJieLiContext,
  recordJieLiSelection
} from '@/tracker/skill/JieLi'
import { locationKeys, playerHand, publicLocation } from './helpers/locationCandidates'
import { createTrackerControllerHarness, protocolMove } from './helpers/trackerController'

const observerSeat = 2
const actorSeat = 3
const targetSeat = 4

function setupView(deckIDs: number[], handIDs: number[], viewSeat = targetSeat) {
  const { controller } = createTrackerControllerHarness()
  controller.initTrackerRoom()
  controller.registerTrackerPlayers(
    [
      { SeatID: observerSeat, ClientID: 200 },
      { SeatID: actorSeat, ClientID: 300 },
      { SeatID: targetSeat, ClientID: 400 }
    ],
    viewSeat * 100
  )
  controller.initTrackerDeck(deckIDs)

  const room = controller.getTrackerRoom()!
  const pile = room.zones.get('pile')!

  handIDs.forEach((cardID) => {
    const card = room.materialize(cardID, pile.cards[0])!
    room.clearCardsFromPublicZones([card])
    card.bindCandidates([targetSeat], 'hand', null, { known: true })
  })
  room.getPlayer(targetSeat)!.syncObservedHandCount(handIDs.length)
  room.resolveConstraints()

  return {
    controller,
    room,
    pile,
    exchange: room.zones.get('exchange')!,
    entityCount: room.cards.length,
    pileCount: pile.cards.length
  }
}

function createJieLiMoves(
  pileStageIDs: number[],
  handStageIDs: number[],
  handResultIDs: number[],
  pileResultIDs: number[] = [],
  pileShowIDs: number[] = []
) {
  return [
    protocolMove({
      CardCount: pileStageIDs.length,
      CardIDs: pileShowIDs,
      FromID: 255,
      FromZone: 1,
      FromPosition: POSITION_TOP,
      MoveType: MOVE_TYPE.SHOW,
      SpellID: JIE_LI_SPELL_ID,
      ToID: 255,
      ToZone: 1,
      ToPosition: POSITION_TOP
    }),
    protocolMove({
      CardCount: pileStageIDs.length,
      CardIDs: pileStageIDs,
      FromID: 255,
      FromZone: 1,
      FromPosition: POSITION_RANDOM,
      MoveType: MOVE_TYPE.EXCHANGE,
      SpellID: JIE_LI_SPELL_ID,
      ToID: actorSeat,
      ToZone: 10,
      ToPosition: POSITION_TOP
    }),
    protocolMove({
      CardCount: handStageIDs.length,
      CardIDs: handStageIDs,
      FromID: targetSeat,
      FromZone: 5,
      FromPosition: POSITION_RANDOM,
      MoveType: MOVE_TYPE.EXCHANGE,
      SpellID: JIE_LI_SPELL_ID,
      ToID: actorSeat,
      ToZone: 10,
      ToPosition: POSITION_TOP
    }),
    protocolMove({
      CardCount: pileStageIDs.length,
      CardIDs: pileResultIDs,
      FromID: actorSeat,
      FromZone: 10,
      FromPosition: POSITION_RANDOM,
      MoveType: MOVE_TYPE.EXCHANGE,
      SpellID: JIE_LI_SPELL_ID,
      ToID: 255,
      ToZone: 1,
      ToPosition: POSITION_TOP
    }),
    protocolMove({
      CardCount: handResultIDs.length,
      CardIDs: handResultIDs,
      FromID: actorSeat,
      FromZone: 10,
      FromPosition: POSITION_RANDOM,
      MoveType: MOVE_TYPE.EXCHANGE,
      SpellID: JIE_LI_SPELL_ID,
      ToID: targetSeat,
      ToZone: 5,
      ToPosition: POSITION_TOP
    })
  ]
}

function syncTargetJieLiExchange(
  controller: ReturnType<typeof createTrackerControllerHarness>['controller'],
  room: Room,
  pileStageIDs: number[],
  handStageIDs: number[],
  handResultIDs: number[],
  pileResultIDs: number[] = [],
  onAfterPileReturn: () => void = () => {}
): void {
  if (
    !recordJieLiContext(room, {
      actorSeat,
      targetSeat,
      pileCount: pileStageIDs.length
    })
  ) {
    throw new Error('诫厉视角上下文未写入')
  }

  const moves = createJieLiMoves(pileStageIDs, handStageIDs, handResultIDs, pileResultIDs)
  moves.slice(0, 3).forEach((move) => controller.syncTrackerMove(move))

  const selection = parseJieLiSelectionData([
    actorSeat,
    targetSeat,
    handStageIDs.length,
    ...handStageIDs,
    handResultIDs.length,
    ...handResultIDs
  ])
  if (!selection || !recordJieLiSelection(room, selection)) {
    throw new Error('诫厉 Type=53 选择结果未写入目标视角批次')
  }

  controller.syncTrackerMove(moves[3])
  onAfterPileReturn()
  controller.syncTrackerMove(moves[4])
}

function getPileTopCards(room: Room, count: number) {
  return room.zones.get('pile')!.cards.slice(-count).reverse()
}

function getTargetHandIDs(room: Room): number[] {
  return room
    .refreshPlayerSnapshot()
    .filter((card) => card.subZone === 'hand' && card.seats.has(targetSeat))
    .map((card) => card.id)
    .sort((left, right) => left - right)
}

describe('族钟繇诫厉视角权限与交换', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', false)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('解析 Type 53 时允许 0 号座位', () => {
    expect(parseJieLiSelectionData([0, 6, 1, 48, 1, 110])).toEqual({
      actorSeat: 0,
      targetSeat: 6,
      handCardIDs: [48],
      pileCardIDs: [110]
    })
    expect(parseJieLiSelectionData([7, 0, 1, 48, 1, 110])).toEqual({
      actorSeat: 7,
      targetSeat: 0,
      handCardIDs: [48],
      pileCardIDs: [110]
    })
  })

  it('生产目标视角只记录手牌 48 被换到牌顶，其余槽位保持匿名', () => {
    const { controller, room, pile, exchange, entityCount, pileCount } = setupView(
      [48, 39, 156, 118, 110, 201, 202, 203],
      [48]
    )

    syncTargetJieLiExchange(controller, room, [118, 156, 39, 110], [48], [110], [], () => {
      const pileTop = getPileTopCards(room, 4)
      expect(pileTop[0].id).toBe(48)
      expect(pileTop.slice(1).every((card) => card.id < 0 && card.isKnown !== true)).toBe(true)
      expect(exchange.cards).toHaveLength(1)
      expect(exchange.cards[0].id).toBeLessThan(0)
    })

    const pileTop = getPileTopCards(room, 4)
    expect(pileTop[0].id).toBe(48)
    expect(pileTop.slice(1).every((card) => card.id < 0 && card.isKnown !== true)).toBe(true)
    expect(getTargetHandIDs(room)).toEqual([110])
    expect(exchange.cards).toHaveLength(0)
    expect(pile.cards).toHaveLength(pileCount)
    expect(room.cards).toHaveLength(entityCount)
    expect(room.pileIdentityLedger.getSnapshot().knownPileIdentityIDs).toEqual([48])
    expect(room.cardIndex.get(48)!.publicCandidates).toEqual([])
    expect(room.hasSkillState(JIE_LI_SPELL_ID)).toBe(false)
  })

  it('生产目标视角按 Type 53 配对定位 91/158，不公开 81/99', () => {
    const { controller, room, pile, exchange, entityCount, pileCount } = setupView(
      [91, 158, 4, 124, 99, 81, 301, 302, 303],
      [91, 158]
    )

    syncTargetJieLiExchange(controller, room, [4, 124, 99, 81], [91, 158], [124, 4], [], () => {
      const pileTop = getPileTopCards(room, 4)
      expect(pileTop.slice(0, 2).every((card) => card.id < 0 && card.isKnown !== true)).toBe(true)
      expect(pileTop.slice(2).map((card) => card.id)).toEqual([91, 158])
      expect(exchange.cards).toHaveLength(2)
      expect(exchange.cards.every((card) => card.id < 0)).toBe(true)
    })

    const pileTop = getPileTopCards(room, 4)
    expect(pileTop.slice(0, 2).every((card) => card.id < 0 && card.isKnown !== true)).toBe(true)
    expect(pileTop.slice(2).map((card) => card.id)).toEqual([91, 158])
    expect(getTargetHandIDs(room)).toEqual([4, 124])
    expect(exchange.cards).toHaveLength(0)
    expect(pile.cards).toHaveLength(pileCount)
    expect(room.cards).toHaveLength(entityCount)
    expect(room.pileIdentityLedger.getSnapshot().knownPileIdentityIDs).toEqual([91, 158])
    expect(room.hasSkillState(JIE_LI_SPELL_ID)).toBe(false)
  })

  it('开发模式的目标视角可保留完整牌堆身份', () => {
    vi.stubEnv('DEV', true)
    const { controller, room, pile, exchange, entityCount, pileCount } = setupView(
      [91, 158, 4, 124, 99, 81, 401, 402, 403],
      [91, 158]
    )

    syncTargetJieLiExchange(controller, room, [4, 124, 99, 81], [91, 158], [124, 4])

    expect(getPileTopCards(room, 4).map((card) => card.id)).toEqual([81, 99, 91, 158])
    expect(getTargetHandIDs(room)).toEqual([4, 124])
    expect(exchange.cards).toHaveLength(0)
    expect(pile.cards).toHaveLength(pileCount)
    expect(room.cards).toHaveLength(entityCount)
    expect(room.pileIdentityLedger.getSnapshot().knownPileIdentityIDs).toEqual([81, 91, 99, 158])
    expect(room.hasSkillState(JIE_LI_SPELL_ID)).toBe(false)
  })

  it('发动者视角使用已公开结果走默认移动，不建立推断批次', () => {
    const { controller, room, pile, exchange } = setupView(
      [91, 158, 4, 124, 99, 81, 501, 502, 503],
      [91, 158],
      actorSeat
    )
    expect(recordJieLiContext(room, { actorSeat, targetSeat, pileCount: 4 })).toBe(true)
    const moves = createJieLiMoves(
      [4, 124, 99, 81],
      [91, 158],
      [124, 4],
      [158, 91, 99, 81],
      [81, 99, 124, 4]
    )

    moves.slice(0, 3).forEach((move) => controller.syncTrackerMove(move))
    expect((room.readSkillState(JIE_LI_SPELL_ID) as any)?.batch).toBeUndefined()
    moves.slice(3).forEach((move) => controller.syncTrackerMove(move))

    expect(getPileTopCards(room, 4).map((card) => card.id)).toEqual([81, 99, 91, 158])
    expect(getTargetHandIDs(room)).toEqual([4, 124])
    expect(exchange.cards).toHaveLength(0)
    expect(
      pile.cards
        .filter((card) => card.id > 0)
        .map((card) => card.id)
        .sort((left, right) => left - right)
    ).toEqual([81, 91, 99, 158])
    expect(room.cardIndex.get(91)!.publicCandidates).toEqual([])
    expect(room.cardIndex.get(158)!.publicCandidates).toEqual([])
    expect(room.hasSkillState(JIE_LI_SPELL_ID)).toBe(false)
  })

  it.each([false, true])('其它视角在 DEV=%s 时只建立目标手牌/牌顶范围弱候选', (isDev) => {
    vi.stubEnv('DEV', isDev)
    const { controller, room, pile, exchange } = setupView(
      [91, 158, 4, 124, 99, 81, 601, 602, 603],
      [91, 158],
      observerSeat
    )
    const trackedHandCards = [91, 158].map((cardID) => room.cardIndex.get(cardID)!)
    expect(recordJieLiContext(room, { actorSeat, targetSeat, pileCount: 4 })).toBe(true)
    const pileBefore = pile.cards.slice()
    const handBefore = getTargetHandIDs(room)
    const moves = createJieLiMoves([4, 124, 99, 81], [91, 158], [124, 4])

    moves.forEach((move) => controller.syncTrackerMove(move))

    expect(pile.cards).toEqual(pileBefore)
    expect(getTargetHandIDs(room)).toEqual(handBefore)
    expect(exchange.cards).toHaveLength(0)
    trackedHandCards.forEach((card) => {
      expect(locationKeys(card)).toEqual(
        [playerHand(targetSeat), publicLocation('pile', 'top', 4)]
          .map((candidate) => createLocationCandidateKey(candidate))
          .sort()
      )
    })
    expect(room.hasSkillState(JIE_LI_SPELL_ID)).toBe(false)
  })

  it('其它视角保留目标手牌候选的原有位置分支', () => {
    const { controller, room } = setupView([91, 4, 124, 99, 81, 701, 702, 703], [91], observerSeat)
    const candidateCard = room.cardIndex.get(91)!
    candidateCard.setLocationCandidates(
      [playerHand(targetSeat), playerHand(observerSeat)],
      'test:jieli-observer-candidate'
    )
    room.resolveConstraints()

    expect(recordJieLiContext(room, { actorSeat, targetSeat, pileCount: 4 })).toBe(true)
    createJieLiMoves([4, 124, 99, 81], [91], [124]).forEach((move) =>
      controller.syncTrackerMove(move)
    )

    expect(locationKeys(candidateCard)).toEqual(
      [playerHand(targetSeat), playerHand(observerSeat), publicLocation('pile', 'top', 4)]
        .map((candidate) => createLocationCandidateKey(candidate))
        .sort()
    )
  })

  it('其它视角仅收到观看消息且没有发生交换时不扩展候选', () => {
    const { controller, room } = setupView([91, 4, 124, 99, 81, 801, 802, 803], [91], observerSeat)
    const handCard = room.cardIndex.get(91)!
    expect(recordJieLiContext(room, { actorSeat, targetSeat, pileCount: 4 })).toBe(true)

    const [showMove] = createJieLiMoves([4, 124, 99, 81], [91], [124])
    controller.syncTrackerMove(showMove)

    expect(handCard.getLocationCandidates()).toEqual([])
    expect(handCard.location).toBe('player')
    expect(handCard.subZone).toBe('hand')
    expect(Array.from(handCard.seats)).toEqual([targetSeat])
  })

  it('其它视角缺少上下文时将完整交换链安全降级为 noop', () => {
    const { controller, room, pile, exchange } = setupView(
      [91, 4, 124, 99, 81, 901, 902, 903],
      [91],
      observerSeat
    )
    const handCard = room.cardIndex.get(91)!
    const pileBefore = pile.cards.slice()
    const handBefore = getTargetHandIDs(room)
    const handCountBefore = room.getPlayer(targetSeat)!.observedHandCount

    createJieLiMoves([4, 124, 99, 81], [91], [124]).forEach((move) =>
      controller.syncTrackerMove(move)
    )

    expect(pile.cards).toEqual(pileBefore)
    expect(getTargetHandIDs(room)).toEqual(handBefore)
    expect(room.getPlayer(targetSeat)!.observedHandCount).toBe(handCountBefore)
    expect(exchange.cards).toHaveLength(0)
    expect(handCard.getLocationCandidates()).toEqual([])
    expect(room.hasSkillState(JIE_LI_SPELL_ID)).toBe(false)
  })

  it('其它视角的半链状态由下一次上下文覆盖且不会污染新批次', () => {
    const { controller, room } = setupView(
      [91, 10, 11, 12, 4, 124, 99, 81, 1001, 1002, 1003],
      [91],
      observerSeat
    )
    const handCard = room.cardIndex.get(91)!
    expect(recordJieLiContext(room, { actorSeat, targetSeat, pileCount: 4 })).toBe(true)

    const firstMoves = createJieLiMoves([4, 124, 99, 81], [91], [124])
    firstMoves.slice(0, 3).forEach((move) => controller.syncTrackerMove(move))

    expect(room.readSkillState(JIE_LI_SPELL_ID)).toEqual(
      expect.objectContaining({
        context: { actorSeat, targetSeat, pileCount: 4 },
        observerBatch: expect.objectContaining({
          actorSeat,
          targetSeat,
          pileCount: 4,
          exchangeCount: 1,
          phase: 'hand-staged'
        })
      })
    )

    expect(recordJieLiContext(room, { actorSeat, targetSeat, pileCount: 3 })).toBe(true)
    expect(room.readSkillState(JIE_LI_SPELL_ID)).toEqual({
      context: { actorSeat, targetSeat, pileCount: 3 }
    })

    createJieLiMoves([12, 11, 10], [91], [10]).forEach((move) => controller.syncTrackerMove(move))

    expect(locationKeys(handCard)).toEqual(
      [playerHand(targetSeat), publicLocation('pile', 'top', 3)]
        .map((candidate) => createLocationCandidateKey(candidate))
        .sort()
    )
    expect(room.hasSkillState(JIE_LI_SPELL_ID)).toBe(false)
  })
})
