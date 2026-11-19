import { getPileIdentitySnapshot } from '@/tracker/PileIdentityLedger'
import { bindTestHand, getHandCardIDs } from '../helpers/room'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { createLocationCandidateKey } from '@/tracker/candidate/locationCandidate'
import { MOVE_TYPE } from '@/tracker/protocol/MoveEventNormalizer'
import type { Room } from '@/tracker/Room'
import { JIE_LI_SPELL_ID, recordJieLiContext, recordJieLiSelection } from '@/tracker/skill/JieLi'
import { locationKeys, playerHand, publicLocation } from '../helpers/locationCandidates'
import { createReadyControllerHarness, protocolMove } from '../helpers/trackerController'
import { hasSkillState } from '@/tracker/room/RoomBase'

const observerSeat = 2
const actorSeat = 3
const targetSeat = 4

function setupView(deckIDs: number[], handIDs: number[], viewSeat = targetSeat) {
  const { controller, room } = createReadyControllerHarness({
    players: [
      { SeatID: observerSeat, ClientID: 200 },
      { SeatID: actorSeat, ClientID: 300 },
      { SeatID: targetSeat, ClientID: 400 }
    ],
    currentUserID: viewSeat * 100,
    cardIDs: deckIDs
  })
  const pile = room.zones.get('pile')!

  bindTestHand(room, targetSeat, { knownIDs: handIDs, observeCount: handIDs.length })
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
  controller: ReturnType<typeof createReadyControllerHarness>['controller'],
  room: Room,
  pileStageIDs: number[],
  handStageIDs: number[],
  handResultIDs: number[],
  pileResultIDs: number[] = [],
  onAfterPileReturn: () => void = () => {}
): void {
  recordJieLiContext(room, {
    actorSeat,
    targetSeat,
    pileCount: pileStageIDs.length,
    hasFullInformation: false
  })

  const moves = createJieLiMoves(pileStageIDs, handStageIDs, handResultIDs, pileResultIDs)
  moves.slice(0, 3).forEach((move) => controller.syncTrackerMove(move))

  const selection = {
    actorSeat,
    targetSeat,
    handCardIDs: handStageIDs,
    pileCardIDs: handResultIDs
  }
  if (!recordJieLiSelection(room, selection)) {
    throw new Error('诫厉选择结果未写入目标视角批次')
  }

  controller.syncTrackerMove(moves[3])
  onAfterPileReturn()
  controller.syncTrackerMove(moves[4])
}

function getPileTopCards(room: Room, count: number) {
  return room.zones.get('pile')!.cards.slice(-count).reverse()
}

describe('族钟繇诫厉视角权限与交换', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', false)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
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
    expect(getHandCardIDs(room, targetSeat)).toEqual([110])
    expect(exchange.cards).toHaveLength(0)
    expect(pile.cards).toHaveLength(pileCount)
    expect(room.cards).toHaveLength(entityCount)
    expect(getPileIdentitySnapshot(room.pileIdentityLedger).knownPileIdentityIDs).toEqual([48])
    expect(room.cardIndex.get(48)!.publicCandidates).toEqual([])
    expect(hasSkillState(room, JIE_LI_SPELL_ID)).toBe(false)
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
    expect(getHandCardIDs(room, targetSeat)).toEqual([4, 124])
    expect(exchange.cards).toHaveLength(0)
    expect(pile.cards).toHaveLength(pileCount)
    expect(room.cards).toHaveLength(entityCount)
    expect(getPileIdentitySnapshot(room.pileIdentityLedger).knownPileIdentityIDs).toEqual([91, 158])
    expect(hasSkillState(room, JIE_LI_SPELL_ID)).toBe(false)
  })

  it('开发模式的目标视角可保留完整牌堆身份', () => {
    vi.stubEnv('DEV', true)
    const { controller, room, pile, exchange, entityCount, pileCount } = setupView(
      [91, 158, 4, 124, 99, 81, 401, 402, 403],
      [91, 158]
    )

    syncTargetJieLiExchange(controller, room, [4, 124, 99, 81], [91, 158], [124, 4])

    expect(getPileTopCards(room, 4).map((card) => card.id)).toEqual([81, 99, 91, 158])
    expect(getHandCardIDs(room, targetSeat)).toEqual([4, 124])
    expect(exchange.cards).toHaveLength(0)
    expect(pile.cards).toHaveLength(pileCount)
    expect(room.cards).toHaveLength(entityCount)
    expect(getPileIdentitySnapshot(room.pileIdentityLedger).knownPileIdentityIDs).toEqual([
      81, 91, 99, 158
    ])
    expect(hasSkillState(room, JIE_LI_SPELL_ID)).toBe(false)
  })

  it.each([
    { label: '发动者', viewSeat: actorSeat },
    { label: '其它', viewSeat: observerSeat }
  ])('$label视角使用已公开结果走默认移动，不建立推断批次', ({ viewSeat }) => {
    const { controller, room, pile, exchange } = setupView(
      [91, 158, 4, 124, 99, 81, 501, 502, 503],
      [91, 158],
      viewSeat
    )
    recordJieLiContext(room, { actorSeat, targetSeat, pileCount: 4, hasFullInformation: true })
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
    expect(getHandCardIDs(room, targetSeat)).toEqual([4, 124])
    expect(exchange.cards).toHaveLength(0)
    expect(
      pile.cards
        .filter((card) => card.id > 0)
        .map((card) => card.id)
        .sort((left, right) => left - right)
    ).toEqual([81, 91, 99, 158])
    expect(room.cardIndex.get(91)!.publicCandidates).toEqual([])
    expect(room.cardIndex.get(158)!.publicCandidates).toEqual([])
    expect(hasSkillState(room, JIE_LI_SPELL_ID)).toBe(false)
  })

  it.each([false, true])('同阵营队友在 DEV=%s 时按完整协议将 30 回堆、14 回手', (isDev) => {
    vi.stubEnv('DEV', isDev)
    const { controller, room } = createReadyControllerHarness({
      players: [
        { SeatID: 1, ClientID: 100 },
        { SeatID: 2, ClientID: 200 }
      ],
      currentUserID: 100,
      cardIDs: [30, 14, 75, 160, 102, 601, 602, 603]
    })
    bindTestHand(room, 2, { hiddenCount: 1, observeCount: 1 })
    room.resolveConstraints()
    const pileCount = room.getZone('pile').cards.length
    const entityCount = room.cards.length
    recordJieLiContext(room, {
      actorSeat: 2,
      targetSeat: 2,
      pileCount: 4,
      hasFullInformation: true
    })

    const moves = [
      {
        CardIDs: [14, 75, 160, 102],
        FromID: 255,
        FromZone: 1,
        FromPosition: POSITION_TOP,
        MoveType: MOVE_TYPE.SHOW,
        ToID: 255,
        ToZone: 1
      },
      { CardIDs: [102, 160, 75, 14], FromID: 255, FromZone: 1, ToID: 2, ToZone: 10 },
      { CardIDs: [30], FromID: 2, FromZone: 5, ToID: 2, ToZone: 10 },
      { CardIDs: [102, 160, 75, 30], FromID: 2, FromZone: 10, ToID: 255, ToZone: 1 },
      { CardIDs: [14], FromID: 2, FromZone: 10, ToID: 2, ToZone: 5 }
    ].map((move) =>
      protocolMove({
        FromPosition: POSITION_RANDOM,
        MoveType: MOVE_TYPE.EXCHANGE,
        SpellID: JIE_LI_SPELL_ID,
        ...move
      })
    )

    controller.syncTrackerMove(moves[0])
    controller.revealTrackerCards({ type: 'player', seatID: 2, inferFullHand: true }, [30])
    moves.slice(1).forEach((move) => controller.syncTrackerMove(move))

    expect(getHandCardIDs(room, 2)).toEqual([14])
    expect(room.getPlayer(2)!.observedHandCount).toBe(1)
    expect(getPileTopCards(room, 4).map((card) => card.id)).toEqual([30, 75, 160, 102])
    expect(room.getZone('pile').cards).toHaveLength(pileCount)
    expect(room.getZone('exchange').cards).toHaveLength(0)
    expect(room.cards).toHaveLength(entityCount)
    expect(getPileIdentitySnapshot(room.pileIdentityLedger).knownPileIdentityIDs).toEqual([
      30, 75, 102, 160
    ])
    for (const cardID of [30, 14, 75, 160, 102]) {
      expect(room.cardIndex.get(cardID)!.publicCandidates).toEqual([])
      expect(room.cardIndex.get(cardID)!.locationCandidates).toEqual([])
    }
    expect(hasSkillState(room, JIE_LI_SPELL_ID)).toBe(false)
  })

  it('其它视角按显式回堆结果收敛目标手牌的原有位置候选', () => {
    const { controller, room } = setupView([91, 4, 124, 99, 81, 701, 702, 703], [91], observerSeat)
    const candidateCard = room.cardIndex.get(91)!
    candidateCard.setLocationCandidates(
      [playerHand(targetSeat), playerHand(observerSeat)],
      'test:jieli-observer-candidate'
    )
    room.resolveConstraints()

    recordJieLiContext(room, { actorSeat, targetSeat, pileCount: 4, hasFullInformation: true })
    createJieLiMoves([4, 124, 99, 81], [91], [124], [91, 4, 99, 81]).forEach((move) =>
      controller.syncTrackerMove(move)
    )

    expect(candidateCard.location).toBe('pile')
    expect(candidateCard.publicCandidates).toEqual([])
    expect(candidateCard.locationCandidates).toEqual([])
    expect(getHandCardIDs(room, targetSeat)).toEqual([124])
  })

  it('其它视角仅收到观看消息时同步牌顶身份，不扩展目标手牌候选', () => {
    const { controller, room } = setupView([91, 4, 124, 99, 81, 801, 802, 803], [91], observerSeat)
    const handCard = room.cardIndex.get(91)!
    recordJieLiContext(room, { actorSeat, targetSeat, pileCount: 4, hasFullInformation: true })

    const [showMove] = createJieLiMoves([4, 124, 99, 81], [91], [124], [], [81, 99, 124, 4])
    controller.syncTrackerMove(showMove)

    expect(getPileTopCards(room, 4).map((card) => card.id)).toEqual([81, 99, 124, 4])
    expect(handCard.locationCandidates).toEqual([])
    expect(handCard.location).toBe('player')
    expect(handCard.subZone).toBe('hand')
    expect(Array.from(handCard.seats)).toEqual([targetSeat])
  })

  it.each([
    { isDev: false, idMode: 'empty' },
    { isDev: true, idMode: 'empty' },
    { isDev: false, idMode: 'zeros' },
    { isDev: true, idMode: 'zeros' },
    { isDev: false, idMode: 'protocol' },
    { isDev: true, idMode: 'protocol' }
  ])(
    '其它视角仅计数观看在 DEV=$isDev / CardIDs=$idMode 时保留手牌与牌顶候选',
    ({ isDev, idMode }) => {
      vi.stubEnv('DEV', isDev)
      const { controller, room, pile, exchange } = setupView(
        [91, 4, 124, 99, 81, 601, 602, 603, 604, 605],
        [91],
        observerSeat
      )
      bindTestHand(room, targetSeat, { hiddenCount: 2, observeCount: 3 })
      room.resolveConstraints()
      const handCard = room.cardIndex.get(91)!
      const pileBefore = [...pile.cards]
      recordJieLiContext(room, { actorSeat, targetSeat, pileCount: 4, hasFullInformation: false })
      const moves = createJieLiMoves(
        [4, 124, 99, 81],
        [91],
        [124],
        [91, 4, 99, 81],
        [81, 99, 124, 4]
      ).map((move) => ({
        ...move,
        CardIDs:
          idMode === 'protocol'
            ? move.CardIDs
            : idMode === 'zeros'
              ? Array(move.CardCount).fill(0)
              : []
      }))

      moves.slice(0, 4).forEach((move) => controller.syncTrackerMove(move))
      expect(handCard.locationCandidates).toEqual([])
      expect(pile.cards).toEqual(pileBefore)
      expect(exchange.cards).toHaveLength(0)

      controller.syncTrackerMove(moves[4])

      expect(locationKeys(handCard)).toEqual(
        [playerHand(targetSeat), publicLocation('pile', 'top', 4)]
          .map((candidate) => createLocationCandidateKey(candidate))
          .sort()
      )
      expect(room.getPlayer(targetSeat)!.observedHandCount).toBe(3)
      expect(pile.cards).toEqual(pileBefore)
      expect(exchange.cards).toHaveLength(0)
      expect([4, 124, 99, 81].every((cardID) => !room.cardIndex.has(cardID))).toBe(true)
      expect(hasSkillState(room, JIE_LI_SPELL_ID)).toBe(false)
    }
  )

  it('仅计数观看保留目标手牌明牌的其它原有位置分支', () => {
    const { controller, room } = setupView([91, 4, 124, 99, 81, 701, 702, 703], [91], observerSeat)
    const handCard = room.cardIndex.get(91)!
    handCard.setLocationCandidates(
      [playerHand(targetSeat), playerHand(observerSeat)],
      'test:jieli-observer-candidate'
    )
    room.resolveConstraints()

    recordJieLiContext(room, { actorSeat, targetSeat, pileCount: 4, hasFullInformation: false })
    createJieLiMoves([4, 124, 99, 81], [91], [124]).forEach((move) =>
      controller.syncTrackerMove(move)
    )

    expect(locationKeys(handCard)).toEqual(
      [playerHand(targetSeat), playerHand(observerSeat), publicLocation('pile', 'top', 4)]
        .map((candidate) => createLocationCandidateKey(candidate))
        .sort()
    )
  })

  it('交换期间已被明确移出目标手牌的明牌不再追加牌顶候选', () => {
    const { controller, room } = setupView([91, 4, 124, 99, 81, 801, 802, 803], [91], observerSeat)
    const handCard = room.cardIndex.get(91)!
    recordJieLiContext(room, { actorSeat, targetSeat, pileCount: 4, hasFullInformation: false })
    const moves = createJieLiMoves([4, 124, 99, 81], [91], [124])
    moves.slice(0, 3).forEach((move) => controller.syncTrackerMove(move))

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [91],
        FromID: targetSeat,
        FromZone: 5,
        ToID: 255,
        ToZone: 2,
        MoveType: 16
      })
    )
    moves.slice(3).forEach((move) => controller.syncTrackerMove(move))

    expect(handCard.location).toBe('discard')
    expect(handCard.publicCandidates).toEqual([])
    expect(handCard.locationCandidates).toEqual([])
    expect(hasSkillState(room, JIE_LI_SPELL_ID)).toBe(false)
  })

  it('新的完整观看上下文清理未结算的弱候选批次', () => {
    const { controller, room } = setupView([91, 4, 124, 99, 81, 901, 902, 903], [91], observerSeat)
    const handCard = room.cardIndex.get(91)!
    recordJieLiContext(room, { actorSeat, targetSeat, pileCount: 4, hasFullInformation: false })
    createJieLiMoves([4, 124, 99, 81], [91], [124])
      .slice(0, 3)
      .forEach((move) => controller.syncTrackerMove(move))

    recordJieLiContext(room, { actorSeat, targetSeat, pileCount: 4, hasFullInformation: true })
    expect(room.readSkillState(JIE_LI_SPELL_ID)).toEqual({
      context: { actorSeat, targetSeat, pileCount: 4, hasFullInformation: true }
    })
    createJieLiMoves([4, 124, 99, 81], [91], [124], [91, 4, 99, 81], [81, 99, 124, 4]).forEach(
      (move) => controller.syncTrackerMove(move)
    )

    expect(handCard.location).toBe('pile')
    expect(handCard.publicCandidates).toEqual([])
    expect(handCard.locationCandidates).toEqual([])
    expect(getHandCardIDs(room, targetSeat)).toEqual([124])
    expect(hasSkillState(room, JIE_LI_SPELL_ID)).toBe(false)
  })

  it('其它视角缺少上下文时将完整交换链安全降级为 noop', () => {
    const { controller, room, pile, exchange } = setupView(
      [91, 4, 124, 99, 81, 901, 902, 903],
      [91],
      observerSeat
    )
    const handCard = room.cardIndex.get(91)!
    const pileBefore = pile.cards.slice()
    const handBefore = getHandCardIDs(room, targetSeat)
    const handCountBefore = room.getPlayer(targetSeat)!.observedHandCount

    createJieLiMoves([4, 124, 99, 81], [91], [124]).forEach((move) =>
      controller.syncTrackerMove(move)
    )

    expect(pile.cards).toEqual(pileBefore)
    expect(getHandCardIDs(room, targetSeat)).toEqual(handBefore)
    expect(room.getPlayer(targetSeat)!.observedHandCount).toBe(handCountBefore)
    expect(exchange.cards).toHaveLength(0)
    expect(handCard.locationCandidates).toEqual([])
    expect(hasSkillState(room, JIE_LI_SPELL_ID)).toBe(false)
  })
})
