import { POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { TrackerController } from '@/tracker/runtime/trackerController'
import type { RawMoveCardEvent, TrackerControllerOptions, TrackerView } from '@/tracker/types'
import { createNoopGameState } from './noopRuntime'

interface ViewSpy extends TrackerView {
  calls: {
    mount: number
    unmount: number
    scheduleRender: number
  }
}

export function createViewSpy(): ViewSpy {
  const calls = {
    mount: 0,
    unmount: 0,
    scheduleRender: 0
  }

  return {
    calls,
    mount() {
      calls.mount++
    },
    unmount() {
      calls.unmount++
    },
    scheduleRender() {
      calls.scheduleRender++
    }
  }
}

export function createTrackerControllerHarness(options: TrackerControllerOptions = {}) {
  const gameState = (options.gameState ?? createNoopGameState()) as ReturnType<
    typeof createNoopGameState
  >
  const runtime = options.runtime ?? gameState
  const view = (options.view ?? createViewSpy()) as ViewSpy
  const controller = new TrackerController({
    ...options,
    gameState,
    runtime,
    view
  })

  return {
    controller,
    gameState,
    view
  }
}

export function protocolMove(overrides: RawMoveCardEvent = {}): RawMoveCardEvent {
  const cardIDs = overrides.CardIDs ?? [1]
  const normalizedCardIDs = Array.isArray(cardIDs) ? cardIDs : [cardIDs]

  return {
    CardIDs: cardIDs,
    CardCount: normalizedCardIDs.length,
    FromZone: 1,
    FromID: 255,
    FromZoneParam: 0,
    FromPosition: POSITION_TOP,
    ToZone: 5,
    ToID: 1,
    ToZoneParam: 0,
    ToPosition: POSITION_TOP,
    MoveType: 1,
    SpellID: 0,
    ...overrides
  }
}

export function returnToPileMove(overrides: RawMoveCardEvent = {}): RawMoveCardEvent {
  return protocolMove({
    FromZone: 5,
    ToZone: 1,
    ToID: 255,
    ToPosition: POSITION_RANDOM,
    MoveType: 19,
    ...overrides
  })
}
