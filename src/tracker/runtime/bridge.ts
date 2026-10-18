import { Game } from '../Game'
import { TrackerController } from './trackerController'
import * as view from '../view'
import { updateSeatLabel } from '../view/PlayerHandView'
import { trackerLogger } from '@/utils/logger'
import type { TrackerView } from '../types'

let readSeatUIs: () => unknown = () => {}

export function setTrackerSeatUIReader(reader: () => unknown): void {
  readSeatUIs = reader
}

Game.setGeneralChangeListener((player, orderLabels) => {
  if (typeof document === 'undefined') return
  updateSeatLabel(document, player, orderLabels)
})

export const tracker = new TrackerController({
  view: view as TrackerView,
  gameState: Game,
  getSeatUIs: () => readSeatUIs(),
  logger: trackerLogger
})
