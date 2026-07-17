import { describe, expect, it } from 'vitest'
import { HAND_EXCHANGE_STATE_KEY } from '@/tracker/skill/HandExchange'
import type { Room } from '@/tracker/Room'
import { createTrackerControllerHarness, protocolMove } from './helpers/trackerController'

describe('整手牌经交换区互易（通用协议模式）', () => {
  const seatA = 4
  const seatB = 5
  const knownFromB = [106, 14, 68, 67]
  const hiddenFromA = [201, 202, 203, 204]
  const hiddenFromB = [301, 302, 303, 304]
  const allIDs = [...knownFromB, ...hiddenFromA, ...hiddenFromB]

  function getCard(room: Room, id: number) {
    return room.cardIndex.get(id)!
  }

  function handCards(room: Room, seatID: number) {
    return room.cards.filter(
      (card) => card.location === 'player' && card.subZone === 'hand' && card.seats.has(seatID)
    )
  }

  function handIDs(room: Room, seatID: number): number[] {
    return handCards(room, seatID)
      .map((card) => card.id)
      .sort((a, b) => a - b)
  }

  function bindHiddenHand(room: Room, ids: number[], seatID: number) {
    const cards = ids.map((id) => getCard(room, id))
    room.clearCardsFromPublicZones(cards)
    cards.forEach((card) => {
      card.bindCandidates([seatID], 'hand', null, { known: false })
      card.isKnown = false
      room.notifyCardChanged(card, { type: 'test:hidden-hand' })
    })
  }

  function setupController() {
    const { controller } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: seatA, ClientID: 400 },
        { SeatID: seatB, ClientID: 500 },
        { SeatID: 3, ClientID: 300 }
      ],
      400
    )
    controller.initTrackerDeck(allIDs)

    const room = controller.getTrackerRoom()!

    bindHiddenHand(room, hiddenFromA, seatA)
    room.getPlayer(seatA).syncObservedHandCount(4)

    bindHiddenHand(room, hiddenFromB, seatB)
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: knownFromB,
        CardCount: 4,
        FromZone: 1,
        FromID: 255,
        ToZone: 5,
        ToID: seatB,
        MoveType: 1,
        SpellID: 0
      })
    )
    room.getPlayer(seatB).syncObservedHandCount(8)
    ;[...hiddenFromA, ...hiddenFromB].forEach((id) => {
      const card = getCard(room, id)
      expect(card.isKnown).toBe(false)
    })

    return { controller, room }
  }

  function runWholeHandExchange(spellID: number) {
    const { controller, room } = setupController()

    const steps = [
      protocolMove({
        CardIDs: [],
        CardCount: 4,
        FromID: seatA,
        FromZone: 5,
        ToID: seatA,
        ToZone: 10,
        MoveType: 11,
        SpellID: spellID
      }),
      protocolMove({
        CardIDs: [],
        CardCount: 8,
        FromID: seatB,
        FromZone: 5,
        ToID: seatB,
        ToZone: 10,
        MoveType: 11,
        SpellID: spellID
      }),
      protocolMove({
        CardIDs: [],
        CardCount: 8,
        FromID: seatB,
        FromZone: 10,
        ToID: seatA,
        ToZone: 5,
        MoveType: 11,
        SpellID: spellID
      }),
      protocolMove({
        CardIDs: [],
        CardCount: 4,
        FromID: seatA,
        FromZone: 10,
        ToID: seatB,
        ToZone: 5,
        MoveType: 11,
        SpellID: spellID
      })
    ]

    steps.forEach((msg) => controller.syncTrackerMove(msg))
    return room
  }

  it('装饰器：手牌进交换区时登记批次并拆明暗 sourceCards', () => {
    const { room } = setupController()
    const event = {
      type: 'moveCards',
      cardIDs: [],
      cardCount: 8,
      toZone: 'exchange',
      options: {
        fromSeatID: seatB,
        fromSubZone: 'hand',
        fromZone: null,
        cardCount: 8
      },
      raw: {
        CardIDs: [],
        CardCount: 8,
        FromID: seatB,
        FromZone: 5,
        ToID: seatB,
        ToZone: 10,
        MoveType: 11,
        SpellID: 121
      }
    }

    const decorated = room.decorateMoveEvent(event)
    expect([...decorated.cardIDs].sort((a: number, b: number) => a - b)).toEqual(
      [...knownFromB].sort((a, b) => a - b)
    )
    expect(decorated.options.sourceCards).toHaveLength(4)
    expect(
      decorated.options.sourceCards.every((card: { isKnown: boolean; id: number }) => {
        return card.isKnown !== true && hiddenFromB.includes(card.id)
      })
    ).toBe(true)
    expect(decorated.options.cardCount).toBe(8)

    const state = room.getSkillState(HAND_EXCHANGE_STATE_KEY)
    expect(state.bySpell['121'].batches[String(seatB)].cards).toHaveLength(8)
  })

  it('技能 121：完整协议序列后双方手牌互换，明牌保持公开、暗牌不被误公开', () => {
    const room = runWholeHandExchange(121)

    expect(handIDs(room, seatA)).toEqual([...knownFromB, ...hiddenFromB].sort((a, b) => a - b))
    expect(handIDs(room, seatB)).toEqual([...hiddenFromA].sort((a, b) => a - b))
    expect(room.zones.get('exchange')?.cards.length ?? 0).toBe(0)

    knownFromB.forEach((id) => {
      const card = getCard(room, id)
      expect(card.location).toBe('player')
      expect(card.seats.has(seatA)).toBe(true)
      expect(card.isKnown).toBe(true)
    })

    hiddenFromA.forEach((id) => {
      const card = getCard(room, id)
      expect(card.location).toBe('player')
      expect(card.seats.has(seatB)).toBe(true)
      expect(card.isKnown).toBe(false)
    })

    hiddenFromB.forEach((id) => {
      const card = getCard(room, id)
      expect(card.location).toBe('player')
      expect(card.seats.has(seatA)).toBe(true)
      expect(card.isKnown).toBe(false)
    })

    expect(room.getPlayer(seatA).observedHandCount).toBe(8)
    expect(room.getPlayer(seatB).observedHandCount).toBe(4)
    expect(room.skillState.has(HAND_EXCHANGE_STATE_KEY)).toBe(false)
  })

  it('任意 SpellID 复用同一整手交换协议模式', () => {
    const room = runWholeHandExchange(9999)

    expect(handIDs(room, seatA)).toEqual([...knownFromB, ...hiddenFromB].sort((a, b) => a - b))
    expect(handIDs(room, seatB)).toEqual([...hiddenFromA].sort((a, b) => a - b))
    expect(room.zones.get('exchange')?.cards.length ?? 0).toBe(0)
    expect(room.skillState.has(HAND_EXCHANGE_STATE_KEY)).toBe(false)
  })

  it('非整手的 5->10 交换不接管（避免误伤佐练类路径）', () => {
    const { room } = setupController()
    const event = {
      type: 'moveCards',
      cardIDs: [106],
      cardCount: 1,
      toZone: 'exchange',
      options: {
        fromSeatID: seatB,
        fromSubZone: 'hand',
        fromZone: null,
        cardCount: 1
      },
      raw: {
        CardIDs: [106],
        CardCount: 1,
        FromID: seatB,
        FromZone: 5,
        ToID: seatB,
        ToZone: 10,
        MoveType: 11,
        SpellID: 3488
      }
    }

    const decorated = room.decorateMoveEvent(event)
    expect(decorated.cardIDs).toEqual([106])
    expect(decorated.options?.sourceCards).toBeUndefined()
    expect(room.skillState.has(HAND_EXCHANGE_STATE_KEY)).toBe(false)
  })

  it('己方整手正 CardIDs 也会接管，并与对侧全暗批次完成互换', () => {
    const { controller, room } = setupController()

    // 模拟视角在 5 号：本机已知自己整手 8 张正 ID（4 明 + 4 暗实体 ID 也暴露给本机）
    const selfHandIDs = [...knownFromB, ...hiddenFromB]
    hiddenFromB.forEach((id) => {
      const card = getCard(room, id)
      // 协议给正 ID 前本地可能仍标暗；进区时装饰器会 confirmKnown
      expect(card.isKnown).toBe(false)
    })

    const steps = [
      // 4 号对侧：协议全暗整手
      protocolMove({
        CardIDs: [],
        CardCount: 4,
        FromID: seatA,
        FromZone: 5,
        ToID: seatA,
        ToZone: 10,
        MoveType: 11,
        SpellID: 121
      }),
      // 5 号己方：协议给整手正 ID
      protocolMove({
        CardIDs: selfHandIDs,
        CardCount: 8,
        FromID: seatB,
        FromZone: 5,
        ToID: seatB,
        ToZone: 10,
        MoveType: 11,
        SpellID: 121
      }),
      // 原 5 号批次回 4 号：协议也可继续给正 ID
      protocolMove({
        CardIDs: selfHandIDs,
        CardCount: 8,
        FromID: seatB,
        FromZone: 10,
        ToID: seatA,
        ToZone: 5,
        MoveType: 11,
        SpellID: 121
      }),
      // 原 4 号批次回 5 号：对侧仍全暗
      protocolMove({
        CardIDs: [],
        CardCount: 4,
        FromID: seatA,
        FromZone: 10,
        ToID: seatB,
        ToZone: 5,
        MoveType: 11,
        SpellID: 121
      })
    ]

    steps.forEach((msg) => controller.syncTrackerMove(msg))

    expect(handIDs(room, seatA)).toEqual([...selfHandIDs].sort((a, b) => a - b))
    expect(handIDs(room, seatB)).toEqual([...hiddenFromA].sort((a, b) => a - b))
    expect(room.zones.get('exchange')?.cards.length ?? 0).toBe(0)

    // 协议正 ID 的己方整手在到 4 号后仍保持公开
    selfHandIDs.forEach((id) => {
      const card = getCard(room, id)
      expect(card.location).toBe('player')
      expect(card.seats.has(seatA)).toBe(true)
      expect(card.isKnown).toBe(true)
    })

    // 对侧原暗牌到己方后仍不公开
    hiddenFromA.forEach((id) => {
      const card = getCard(room, id)
      expect(card.location).toBe('player')
      expect(card.seats.has(seatB)).toBe(true)
      expect(card.isKnown).toBe(false)
    })

    expect(room.skillState.has(HAND_EXCHANGE_STATE_KEY)).toBe(false)
  })
})
