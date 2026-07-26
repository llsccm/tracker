import { trackerLogger } from '@/utils/logger'
import {
  getProtocolMarkSpellID,
  getProtocolPlayerSubZone,
  getProtocolPublicZone,
  isKnownProtocolZone,
  isProtocolPlayerZone
} from './protocolZones'
import type { CardID, NormalizedMoveEvent, RawMoveCardEvent, RawMoveEventType } from './types'

// moveType
//   二元组表示：（已观测到的具体场景标签, MOVE_TYPE_LABELS 归一展示标签）。
//   0: '预操作',
//   1: '摸牌',
//   2: '使用',
//   3: '打出',
//   4: '弃置',
//   5: ('选择/洛神', '获得'),
//   6: ('判定/弹窗', '获得'),
//   7: '弹窗放回',
//   8: ('标记/移动/交给', '获得'),
//   9: '置入',
//   10: '闪电转移',
//   11: '交换',
//   12: '重铸',
//   13: '拼点',
//   14: '判定后',
//   15: ('移动到(延时锦囊/操控牌堆/场外)', '移动'),
//   16: '使用后',
//   17: '打出后',
//   18: '获得',
//   19: ('移动(拼点后/弹窗弃置/标记传递)', '移动'),
//   20: '锻造',
//   21: '展示',
//   22: '替换装备',
//   Mode_ZIRUO = 23;
//   Mode_GAMEOVER_NOTIFY = 24;
//   255: '系统'
//

export const MOVE_TYPE = {
  PRE_OPERATION: 0,
  DRAW: 1,
  USE: 2,
  PLAY: 3,
  DISCARD: 4,
  SELECT_GAIN: 5,
  JUDGE_GAIN: 6,
  POPUP_RETURN: 7,
  MARK_GAIN: 8,
  PUT_IN: 9,
  LIGHTNING_TRANSFER: 10,
  EXCHANGE: 11,
  RECAST: 12,
  PINDIAN: 13,
  AFTER_JUDGE: 14,
  MOVE: 15,
  AFTER_USE: 16,
  AFTER_PLAY: 17,
  GAIN: 18,
  GENERAL_MOVE: 19,
  CRAFT: 20,
  SHOW: 21,
  REPLACE_EQUIP: 22,
  SYSTEM: 255
} as const

/**
 * 协议 MoveType 到调试展示文案的归一化映射。
 * 多个协议场景会被折叠成同一个业务标签，Room 侧只依赖归一后的移动语义。
 */
export const MOVE_TYPE_LABELS = {
  [MOVE_TYPE.PRE_OPERATION]: '预操作',
  [MOVE_TYPE.DRAW]: '摸牌',
  [MOVE_TYPE.USE]: '使用',
  [MOVE_TYPE.PLAY]: '打出',
  [MOVE_TYPE.DISCARD]: '弃置',
  [MOVE_TYPE.SELECT_GAIN]: '获得',
  [MOVE_TYPE.JUDGE_GAIN]: '获得',
  [MOVE_TYPE.POPUP_RETURN]: '弹窗放回',
  [MOVE_TYPE.MARK_GAIN]: '获得',
  [MOVE_TYPE.PUT_IN]: '置入',
  [MOVE_TYPE.LIGHTNING_TRANSFER]: '闪电转移',
  [MOVE_TYPE.EXCHANGE]: '交换',
  [MOVE_TYPE.RECAST]: '重铸',
  [MOVE_TYPE.PINDIAN]: '拼点',
  [MOVE_TYPE.AFTER_JUDGE]: '判定后',
  [MOVE_TYPE.MOVE]: '移动',
  [MOVE_TYPE.AFTER_USE]: '使用后',
  [MOVE_TYPE.AFTER_PLAY]: '打出后',
  [MOVE_TYPE.GAIN]: '获得',
  [MOVE_TYPE.GENERAL_MOVE]: '移动',
  [MOVE_TYPE.CRAFT]: '锻造',
  [MOVE_TYPE.SHOW]: '展示',
  [MOVE_TYPE.REPLACE_EQUIP]: '替换装备',
  [MOVE_TYPE.SYSTEM]: '系统'
} as const

/**
 * 返回 MoveType 对应的可读标签；未知枚举保持 undefined，交由调用方决定展示降级。
 */
export function getMoveTypeLabel(moveType: RawMoveCardEvent['MoveType']): string | undefined {
  return MOVE_TYPE_LABELS[Number(moveType) as keyof typeof MOVE_TYPE_LABELS]
}

/**
 * 协议可能传入单张牌、数组或空值，这里统一转换为数值数组。
 * 无法转换的牌 ID 用 0 占位，后续通过 hasKnownCards 判断是否可见。
 */
function normalizeIDs(cardIDs: CardID[] | CardID = []): CardID[] {
  return (Array.isArray(cardIDs) ? cardIDs : [cardIDs]).map((id) => Number(id) || 0)
}

/**
 * 移动协议字段校验的告警类型。
 * 这些告警不阻断消息处理，只用于记录协议缺字段、未知区域或牌数不一致。
 */
export type MoveEventValidationWarningCode =
  | 'MISSING_FIELD'
  | 'UNKNOWN_PROTOCOL_ZONE'
  | 'CARD_COUNT_MISMATCH'

/**
 * 单条移动协议校验告警。
 * expected/actual 主要用于需要比对声明值和实际值的场景，例如 CardCount。
 */
export interface MoveEventValidationWarning {
  code: MoveEventValidationWarningCode
  field: keyof RawMoveCardEvent | 'CardIDs'
  value?: unknown
  expected?: unknown
  actual?: unknown
}

/**
 * 判断协议字段是否携带了有效值。
 * 空字符串在宿主协议里等价于未提供，不能直接参与 Zone 或牌数判断。
 */
function hasProtocolField(event: RawMoveCardEvent, field: keyof RawMoveCardEvent): boolean {
  return event[field] !== undefined && event[field] !== null && event[field] !== ''
}

/**
 * 读取协议声明的牌数。
 * 空字符串视为缺省；非数字值返回 null，避免把异常输入误判为 0 张牌。
 */
function getDeclaredCardCount(value: unknown): number | null {
  if (value === '') return null
  const count = Number(value)
  return Number.isFinite(count) ? count : null
}

const ZONE_FIELD = ['FromZone', 'ToZone'] as const
const REQUIRED_FIELD = ['FromZone', 'ToZone', 'CardCount'] as const

/**
 * 对原始移动事件做轻量协议校验。
 * 校验结果只产生告警，不改变事件内容，确保后续归一化仍可走降级路径。
 */
export function validateMoveEvent(
  event: RawMoveCardEvent = {},
  cardIDs: CardID[] = normalizeIDs(event.CardIDs)
): MoveEventValidationWarning[] {
  const warnings: MoveEventValidationWarning[] = []

  // 必须字段
  REQUIRED_FIELD.forEach((field) => {
    if (!hasProtocolField(event, field)) {
      warnings.push({
        code: 'MISSING_FIELD',
        field,
        value: event[field]
      })
    }
  })

  //空间字段
  ZONE_FIELD.forEach((field) => {
    if (hasProtocolField(event, field) && !isKnownProtocolZone(event[field])) {
      warnings.push({
        code: 'UNKNOWN_PROTOCOL_ZONE',
        field,
        value: event[field]
      })
    }
  })

  const declaredCardCount = getDeclaredCardCount(event.CardCount)
  if (declaredCardCount !== null && cardIDs.length > 0 && declaredCardCount !== cardIDs.length) {
    warnings.push({
      code: 'CARD_COUNT_MISMATCH',
      field: 'CardIDs',
      expected: declaredCardCount,
      actual: cardIDs.length
    })
  }

  return warnings
}

/**
 * 将移动事件校验告警写入 tracker 日志。
 * 日志保留原始协议字段，便于回溯线上宿主消息与归一化结果之间的差异。
 */
function logMoveEventValidationWarnings(
  warnings: MoveEventValidationWarning[],
  event: RawMoveCardEvent
): void {
  warnings.forEach((warning) => {
    trackerLogger.warn('移动协议字段异常，已按降级路径继续', {
      warning,
      raw: event
    })
  })
}

/**
 * 判断本次移动是否至少包含一张明确可识别的牌。
 * 协议中 0 表示未知牌，不能用于精确记牌，只能进入未知移动分支。
 */
function hasKnownCards(cardIDs: CardID[] = []): boolean {
  return cardIDs.some((id) => id > 0)
}

/**
 * 判断来源和目标是否指向同一个协议区域。
 * 这类事件通常是“展示/刷新”而非实际移动，需要再结合 MoveType 与牌可见性分类。
 */
function isSameZoneShowEvent(event: RawMoveCardEvent): boolean {
  const fromZone = Number(event.FromZone)
  const toZone = Number(event.ToZone)

  return (
    Number(event.FromID) === Number(event.ToID) &&
    fromZone === toZone &&
    (Number(event.FromPosition) === Number(event.ToPosition) || toZone !== 1) &&
    (Number(event.FromZoneParam) === Number(event.ToZoneParam) || toZone !== 4)
  )
}

function isTianhouAmbiguousPileShow(event: RawMoveCardEvent): boolean {
  return (
    Number(event.SpellID) === 3903 &&
    Number(event.MoveType) === MOVE_TYPE.SHOW &&
    Number(event.CardCount) === 1 &&
    Number(event.FromID) === 255 &&
    Number(event.FromZone) === 1 &&
    Number(event.ToID) === 255 &&
    Number(event.ToZone) === 1
  )
}

/**
 * 过滤已知的同区域展示噪声。
 * 这些协议消息不会改变牌所在位置，若继续下发会导致 Room 重复处理同一张牌。
 */
function shouldIgnoreSameZoneShow(event: RawMoveCardEvent): boolean {
  const spellID = Number(event.SpellID)
  const moveType = Number(event.MoveType)

  return (
    (spellID === 7011 && moveType === MOVE_TYPE.GENERAL_MOVE) ||
    (spellID === 3744 && moveType === MOVE_TYPE.SHOW)
  )
}

/**
 * 根据协议 Zone、MoveType 与牌可见性推断 Room 可消费的标准移动类型。
 * 分支顺序体现优先级：特殊公共区移动优先，其次同区域展示，最后按目标区域归类。
 */
function inferEventType(event: RawMoveCardEvent, cardIDs: CardID[]): RawMoveEventType {
  const { FromZone, ToZone, MoveType } = event
  const fromZone = Number(FromZone)
  const toZone = Number(ToZone)
  const moveType = Number(MoveType)
  const known = hasKnownCards(cardIDs)

  // 弃牌堆洗回牌堆会重置公共牌堆状态，必须优先从普通回牌堆事件中识别出来。
  if (fromZone === 2 && toZone === 9) return 'shuffleDiscardIntoPile'

  // 天候只公开牌顶三张中的一张，无法确定具体位置；候选模型补齐前不采信该消息。
  if (isTianhouAmbiguousPileShow(event)) return 'noop'

  // 同区域消息只有在携带可见牌且不属于噪声场景时，才作为展示事件下发。
  if (isSameZoneShowEvent(event)) {
    if (shouldIgnoreSameZoneShow(event) || !known) return 'noop'
    return 'showCards'
  }

  // 从牌堆到手牌区的协议可能携带真实 CardID，也可能只声明数量。
  if (fromZone === 1 && toZone === 5) return known ? 'drawKnown' : 'drawUnknown'
  // 进入弃牌堆且牌面可见时，Room 可以精确记录弃置的具体牌。
  if (toZone === 2 && known) return 'discardKnown'
  // 回到牌堆的来源可能是手牌、选择区或弹窗区，统一走 returnToPile。
  if (toZone === 1 && [2, 5, 10, 11].includes(fromZone)) return 'returnToPile'
  // 标记区和弹窗标记区都按标记移动处理，具体技能空间由 spellID 继续细分。
  if (toZone === 4 || toZone === 8) return 'moveToMark'
  if (toZone === 6) return 'moveToEquip'
  if (toZone === 7) return 'moveToJudge'
  // 判定获得会暴露判定牌，但目标区域可能不是展示区，需额外转成 showCards。
  if (moveType === MOVE_TYPE.JUDGE_GAIN && known) return 'showCards'
  return known ? 'moveKnown' : 'moveUnknown'
}

/**
 * 为特定协议移动补充更精确的业务标签。
 * 当前只标记“从牌堆获取牌”，用于日志或调试界面区别普通获得。
 */
export function getProtocolMoveSpecialLabel(event: RawMoveCardEvent = {}): string | undefined {
  if (
    getProtocolPublicZone(event.FromZone) === 'pile' &&
    Number(event.MoveType) === MOVE_TYPE.GAIN
  ) {
    return '从牌堆获取牌'
  }

  return undefined
}

/**
 * 将原始 PubGsCMoveCard 字段归一为 refactor Room 可消费的标准移动事件。
 * 该模块只做分类与字段映射，不直接修改 Room 状态。
 *
 */
export function normalizeMoveEvent(event: RawMoveCardEvent = {}): NormalizedMoveEvent {
  const cardIDs = normalizeIDs(event.CardIDs)
  // 协议异常只记录并降级处理，避免记牌器阻断宿主消息链。
  logMoveEventValidationWarnings(validateMoveEvent(event, cardIDs), event)
  const cardCount = Number(event.CardCount) || cardIDs.length
  const type = inferEventType(event, cardIDs)
  const fromPublicZone = getProtocolPublicZone(event.FromZone)
  const toPublicZoneName = getProtocolPublicZone(event.ToZone)
  const targetIsPlayerZone = isProtocolPlayerZone(event.ToZone)
  const sourceIsPlayerZone = isProtocolPlayerZone(event.FromZone)
  // 标记区回手牌时，目标区可能带返回技能 ID（如 3389），不能覆盖来源标记空间 ID。
  const targetSpellID = targetIsPlayerZone
    ? getProtocolMarkSpellID(
        event.ToZone,
        {
          param: event.ToZoneParam,
          toZoneParam: event.ToZoneParam,
          spellID: event.SpellID
        },
        event.SpellID ?? null
      )
    : undefined
  const fromSpellID = sourceIsPlayerZone
    ? getProtocolMarkSpellID(
        event.FromZone,
        {
          param: event.FromZoneParam,
          fromZoneParam: event.FromZoneParam,
          spellID: event.SpellID
        },
        event.SpellID ?? null
      )
    : undefined
  const spellID = targetIsPlayerZone ? targetSpellID : fromSpellID

  // FromID/ToID 的含义依赖具体 Zone，不能一律解释成玩家座位。
  // 例如 FromZone=8 弹窗标记回牌堆时，FromID 可能是技能/标记空间 ID；
  // FromZone=1 牌堆来源时，FromID=255 也只是牌堆/无座位占位。
  // 这里的 fromSeatID/seatID 是兼容 Room.moveCards() 旧 options 名称，
  // 后续移动逻辑必须结合 fromZone/fromSubZone/spellID 判断它是否真是座位。

  // 观看公共区时不应默认把 subZone 推导为 hand；公共区来源的 subZone 置为 undefined。
  return {
    type,
    cardIDs,
    cardCount,
    moveType: event.MoveType,
    toZone: targetIsPlayerZone ? 'player' : (toPublicZoneName ?? 'process'),
    options: {
      seatID: targetIsPlayerZone ? event.ToID : undefined,
      fromSeatID: sourceIsPlayerZone ? event.FromID : undefined,
      fromZone: fromPublicZone,
      subZone: targetIsPlayerZone
        ? getProtocolPlayerSubZone(event.ToZone)
        : sourceIsPlayerZone
          ? getProtocolPlayerSubZone(event.FromZone)
          : undefined,
      fromSubZone: sourceIsPlayerZone ? getProtocolPlayerSubZone(event.FromZone) : undefined,
      fromSpellID,
      spellID,
      cardCount,
      moveType: event.MoveType,
      position: event.ToPosition,
      fromPosition: event.FromPosition,
      sourceEvent: {
        type,
        label: getProtocolMoveSpecialLabel(event) ?? event.Label,
        moveType: event.MoveType,
        raw: event
      }
    },
    raw: event
  }
}
