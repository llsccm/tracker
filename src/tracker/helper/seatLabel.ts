import { CharacterConfig } from '@/config/CharacterConfig'
import type { Player } from '../Player'

/** 顺位标签使用一基索引，索引 0 保留为空字符串。 */
export const ORDER_LABELS: string[] = ['', '一', '二', '三', '四', '五', '六', '七', '八']

export interface SeatLabelOptions {
  orderLabels?: readonly string[]
  getGeneralName?: (generalID: number) => string | undefined
}

/** 将牌局顺位转换为展示用文字；超出已知标签范围时保留数字。 */
export function getDisplayIdLabel(
  displayID: number,
  orderLabels: readonly string[] = ORDER_LABELS
): string {
  return orderLabels[displayID] || String(displayID)
}

/** 生成座位覆盖层使用的“武将名|顺位”标签。 */
export function formatPlayerSeatLabel(
  player: Pick<Player, 'fixedViewId' | 'generals'>,
  options: SeatLabelOptions = {}
): string {
  const displayID = player.fixedViewId || 1
  const orderLabel = `${getDisplayIdLabel(displayID, options.orderLabels)}号位`
  const getGeneralName = options.getGeneralName ?? getConfiguredGeneralName
  const generalNames = player.generals
    .map((generalID) => getGeneralName(generalID))
    .filter((name): name is string => Boolean(name))
  const seatName = generalNames.length > 0 ? generalNames.join(' ') : orderLabel

  return `${seatName}|${orderLabel}`
}

function getConfiguredGeneralName(generalID: number): string {
  return CharacterConfig.GetInstance().getGeneralName(generalID)
}
