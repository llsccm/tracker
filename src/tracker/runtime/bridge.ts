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

// Phase 1 对局验证入口：开发构建（pnpm build / pnpm dev）下在控制台执行
//   __trackerBeliefReport()
// 即可取出本局 belief epoch 采集报告。生产构建不注册该全局，且 observer 本身
// 已被 import.meta.env.DEV 剔除。
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__trackerBeliefReport = () =>
    tracker.getBeliefEpochReport()
}
