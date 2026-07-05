import { GameState } from '@/tracker/gameState'

export function createNoopGameState(): GameState {
  return new GameState()
}

export function createNoopRuntime() {
  return {
    init() {},
    reset() {},
    start() {},
    end() {},
    enter() {},
    setTurn() {},
    record() {},
    clear() {},
    updateSeatLabel() {},
    syncRoomSeats() {}
  }
}
