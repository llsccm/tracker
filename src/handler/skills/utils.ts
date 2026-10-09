import { tracker } from '@/tracker/runtime/browser'
import type { CardID } from '@/tracker/types'

export function getTrackedPileCardIDs(): CardID[] {
  return tracker.getReadyTrackerRoom()?.publicZones.getPileCardIDs() ?? []
}
