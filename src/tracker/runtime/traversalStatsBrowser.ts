import {
  resetTraversalStatsSession,
  snapshotTraversalStatsSession,
  startTraversalStatsSession,
  stopTraversalStatsSession
} from '../traversalStats'
import type { TraversalStatsSnapshot } from '../traversalStats'

export interface TraversalStatsBrowserControl {
  start: () => TraversalStatsSnapshot
  snapshot: () => TraversalStatsSnapshot
  stop: () => TraversalStatsSnapshot
  reset: () => TraversalStatsSnapshot
}

export const traversalStatsBrowserControl: TraversalStatsBrowserControl = {
  start: startTraversalStatsSession,
  snapshot: snapshotTraversalStatsSession,
  stop: stopTraversalStatsSession,
  reset: resetTraversalStatsSession
}

export function installTraversalStatsBrowserControl(target: Window = window): void {
  if (!import.meta.env.DEV) return
  target.__DXC_TRAVERSAL__ = traversalStatsBrowserControl
}

export function uninstallTraversalStatsBrowserControl(target: Window = window): void {
  if (target.__DXC_TRAVERSAL__ === traversalStatsBrowserControl) {
    delete target.__DXC_TRAVERSAL__
  }
}
