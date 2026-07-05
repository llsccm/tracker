import { Game } from '../Game'
import { Room } from '../Room'
import { TrackerController } from './trackerController'
import * as view from '../view'
import { trackerLogger } from '@/utils/logger'
import type { TrackerRuntime, TrackerView } from '../types'

let readSeatUIs: () => unknown = () => {}

export function setTrackerSeatUIReader(reader: () => unknown): void {
  readSeatUIs = reader
}

export const tracker = new TrackerController({
  view: view as TrackerView,
  gameState: Game as TrackerRuntime,
  runtime: Game as TrackerRuntime,
  roomFactory: ({ gameState }) => new Room({ gameState } as any),
  getSeatUIs: () => readSeatUIs(),
  logger: trackerLogger
})
