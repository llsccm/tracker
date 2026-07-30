import { tracker } from '../tracker/runtime/browser'

export function getTrackedPileCardIDs() {
  return tracker.getReadyTrackerRoom()?.publicZones.getPileCardIDs() ?? []
}
