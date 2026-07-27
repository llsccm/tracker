import { describe, expect, it } from 'vitest'
import { isAnonymous, type Card } from '@/tracker/Card'
import { createLocationCandidateKey } from '@/tracker/candidate/locationCandidate'
import { TIAN_HOU_STATE_KEY } from '@/tracker/skill/TianHou'
import { locationKeys, playerHand, publicLocation } from './helpers/locationCandidates'
import { getCard } from './helpers/room'
import { createTrackerControllerHarness, protocolMove } from './helpers/trackerController'

describe('周群天候其他视角换牌候选', () => {
  const viewerSeat = 1
  const actorSeat = 5

  function setupHand({
    knownIDs,
    hiddenCount,
    extraIDs = []
  }: {
    knownIDs: number[]
    hiddenCount: number
    extraIDs?: number[]
  }) {
    const { controller, view } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: viewerSeat, ClientID: 100 },
        { SeatID: actorSeat, ClientID: 500 }
      ],
      100
    )
    controller.initTrackerDeck([
      ...knownIDs,
      ...extraIDs,
      ...Array.from({ length: 16 }, (_, index) => 300 + index)
    ])

    const room = controller.getTrackerRoom()!
    const knownCards = knownIDs.map((id) => getCard(room, id)!)
    const hiddenCards = room.zones.get('pile')!.cards.filter(isAnonymous).slice(0, hiddenCount)

    room.clearCardsFromPublicZones([...knownCards, ...hiddenCards])
    knownCards.forEach((card) => card.bindCandidates([actorSeat], 'hand', null, { known: true }))
    hiddenCards.forEach((card) => card.bindCandidates([actorSeat], 'hand', null, { known: false }))
    room.getPlayer(actorSeat)!.syncObservedHandCount(knownCards.length + hiddenCards.length)
    room.resolveConstraints()

    return { controller, knownCards, room, view }
  }

  function runExchange(
    controller: ReturnType<typeof createTrackerControllerHarness>['controller'],
    count: number
  ): void {
    const moves = [
      {
        FromID: 255,
        FromZone: 1,
        ToID: actorSeat,
        ToZone: 10
      },
      {
        FromID: actorSeat,
        FromZone: 5,
        ToID: actorSeat,
        ToZone: 10
      },
      {
        FromID: actorSeat,
        FromZone: 10,
        ToID: actorSeat,
        ToZone: 10
      },
      {
        FromID: actorSeat,
        FromZone: 10,
        ToID: actorSeat,
        ToZone: 10
      },
      {
        FromID: actorSeat,
        FromZone: 10,
        ToID: actorSeat,
        ToZone: 5
      },
      {
        FromID: actorSeat,
        FromZone: 10,
        ToID: 255,
        ToZone: 1
      }
    ]

    moves.forEach((move) => {
      controller.syncTrackerMove(
        protocolMove({
          CardCount: count,
          CardIDs: [],
          MoveType: 11,
          SpellID: 3903,
          ...move
        })
      )
    })
  }

  function showFinalCard(
    controller: ReturnType<typeof createTrackerControllerHarness>['controller'],
    cardID: number
  ): void {
    controller.syncTrackerMove(
      protocolMove({
        CardCount: 1,
        CardIDs: [cardID],
        FromID: 255,
        FromZone: 1,
        MoveType: 21,
        SpellID: 3903,
        ToID: 255,
        ToZone: 1
      })
    )
  }

  function expectHandOrPileTop(card: Card, count: number): void {
    expect(locationKeys(card)).toEqual(
      [playerHand(actorSeat), publicLocation('pile', 'top', count)]
        .map((candidate) => createLocationCandidateKey(candidate))
        .sort()
    )
  }

  it('交换两张且原手牌全明时，两张都收敛为牌堆顶前两张', () => {
    const { controller, knownCards, room } = setupHand({
      knownIDs: [88, 146],
      hiddenCount: 0
    })

    runExchange(controller, 2)

    knownCards.forEach((card) => {
      expect(card.publicCandidates).toEqual([
        expect.objectContaining({
          zone: 'pile',
          position: 'top',
          count: 2
        })
      ])
      expect(
        card
          .getLocationCandidates()
          .some((candidate) => candidate.type === 'player' && candidate.seatID === actorSeat)
      ).toBe(false)
    })
    expect(room.zones.get('exchange')!.cards).toHaveLength(0)
    expect(room.getPlayer(actorSeat)!.observedHandCount).toBe(2)
  })

  it('明暗混合交换两张时保留逐牌弱候选，展示命中后确认该明牌换出', () => {
    const { controller, knownCards, room } = setupHand({
      knownIDs: [88, 146],
      hiddenCount: 2
    })

    runExchange(controller, 2)
    knownCards.forEach((card) => expectHandOrPileTop(card, 2))

    const pileBeforeShow = room.zones.get('pile')!.cards.map((card) => card.id)
    showFinalCard(controller, 88)

    expect(locationKeys(knownCards[0])).toEqual([
      createLocationCandidateKey(publicLocation('pile', 'top', 2))
    ])
    expectHandOrPileTop(knownCards[1], 2)
    expect(room.zones.get('pile')!.cards.map((card) => card.id)).toEqual(pileBeforeShow)
    expect(room.skillState.has(TIAN_HOU_STATE_KEY)).toBe(false)
  })

  it('交换一张且展示命中原手牌时，该牌确定为牌顶并排除其余换出候选', () => {
    const { controller, knownCards, room } = setupHand({
      knownIDs: [88, 146],
      hiddenCount: 1
    })

    runExchange(controller, 1)
    showFinalCard(controller, 88)

    expect(knownCards[0].publicCandidates).toEqual([
      expect.objectContaining({
        zone: 'pile',
        position: 'top',
        count: 1,
        label: '牌堆顶前1张'
      })
    ])
    expect(knownCards[1].publicCandidates).toEqual([])
    expect(knownCards[1].location).toBe('player')
    expect(knownCards[1].subZone).toBe('hand')
    expect(Array.from(knownCards[1].seats)).toEqual([actorSeat])
    expect(room.getPlayer(actorSeat)!.observedHandCount).toBe(3)
  })

  it('最终展示未命中原手牌候选时，只建立牌顶前三范围且不重排牌堆', () => {
    const shownID = 18
    const { controller, knownCards, room, view } = setupHand({
      knownIDs: [88, 146],
      hiddenCount: 2,
      extraIDs: [shownID]
    })

    runExchange(controller, 2)
    const pileBeforeShow = room.zones.get('pile')!.cards.map((card) => card.id)
    const renderCountBefore = view.calls.scheduleRender

    showFinalCard(controller, shownID)

    const shownCard = room.cardIndex.get(shownID)!
    expect(shownCard.publicCandidates).toEqual([
      expect.objectContaining({
        zone: 'pile',
        position: 'top',
        count: 3,
        label: '牌堆顶前3张'
      })
    ])
    expect(room.zones.get('pile')!.cards.map((card) => card.id)).toEqual(pileBeforeShow)
    expect(room.zones.get('pile')!.cards).not.toContain(shownCard)
    knownCards.forEach((card) => expectHandOrPileTop(card, 2))
    expect(view.calls.scheduleRender).toBe(renderCountBefore + 1)
  })
})
