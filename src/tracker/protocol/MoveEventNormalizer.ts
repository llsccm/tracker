import { trackerLogger } from '@/utils/logger'
import {
  getProtocolMarkSpellID,
  getProtocolPlayerSubZone,
  getProtocolPublicZone,
  isKnownProtocolZone,
  isProtocolPlayerZone
} from './protocolZones'
import type {
  CardID,
  MoveOptions,
  NormalizedMoveCardFields,
  NormalizedMoveEvent,
  RawMoveCardEvent,
  RawMoveEventType
} from '../types'

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
//   27: '主动交给'（跨技能通用，牌面可见性仍由 CardIDs 决定）,
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
  GIVE: 27,
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
  [MOVE_TYPE.GIVE]: '主动交给',
  [MOVE_TYPE.SYSTEM]: '系统'
} as const

/**
 * 返回 MoveType 对应的可读标签；未知枚举保持 undefined，交由调用方决定展示降级。
 */
export function getMoveTypeLabel(moveType: RawMoveCardEvent['MoveType']): string | undefined {
  return MOVE_TYPE_LABELS[moveType as keyof typeof MOVE_TYPE_LABELS]
}

/**
 * 移动协议字段校验的告警类型。
 * 这些告警不阻断消息处理，只用于记录未知区域或牌数不一致。
 */
export type MoveEventValidationWarningCode = 'UNKNOWN_PROTOCOL_ZONE' | 'CARD_COUNT_MISMATCH'

/**
 * 单条移动协议校验告警。
 * expected/actual 主要用于需要比对声明值和实际值的场景，例如 CardCount。
 */
export interface MoveEventValidationWarning {
  code: MoveEventValidationWarningCode
  field: 'FromZone' | 'ToZone' | 'CardIDs'
  value?: unknown
  expected?: unknown
  actual?: unknown
}

const ZONE_FIELD = ['FromZone', 'ToZone'] as const

/**
 * 对原始移动事件做轻量协议校验。
 * 校验结果只产生告警，不改变事件内容，确保后续归一化仍可走降级路径。
 */
export function validateMoveEvent(
  event: RawMoveCardEvent,
  cardIDs: readonly CardID[] = event.CardIDs
): MoveEventValidationWarning[] {
  const warnings: MoveEventValidationWarning[] = []

  ZONE_FIELD.forEach((field) => {
    if (!isKnownProtocolZone(event[field])) {
      warnings.push({
        code: 'UNKNOWN_PROTOCOL_ZONE',
        field,
        value: event[field]
      })
    }
  })

  if (cardIDs.length > 0 && event.CardCount !== cardIDs.length) {
    warnings.push({
      code: 'CARD_COUNT_MISMATCH',
      field: 'CardIDs',
      expected: event.CardCount,
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
  event: Readonly<RawMoveCardEvent>
): void {
  warnings.forEach((warning) => {
    trackerLogger.warn('移动协议字段异常，已按降级路径继续', {
      warning,
      raw: event
    })
  })
}

/**
 * 判断来源和目标是否指向同一个协议区域。
 * 这类事件通常是“展示/刷新”而非实际移动，需要再结合 MoveType 与牌可见性分类。
 */
function isSameZoneShowEvent(event: RawMoveCardEvent): boolean {
  const { FromZone: fromZone, ToZone: toZone } = event

  return (
    event.FromID === event.ToID &&
    fromZone === toZone &&
    (toZone !== 1 || event.FromPosition === event.ToPosition) &&
    (toZone !== 4 || event.FromZoneParam === event.ToZoneParam)
  )
}

/**
 * 判断是否为牌堆两端均为 255 的单牌同区展示。
 * 这类消息只公开一张牌面，不携带它在牌堆中的序号，具体语义由 SpellID 决定。
 */
export function isPileSingleCardShow(
  event: Pick<
    NormalizedMoveCardFields,
    'MoveType' | 'CardCount' | 'FromID' | 'FromZone' | 'ToID' | 'ToZone'
  >
): boolean {
  return (
    event.MoveType === MOVE_TYPE.SHOW &&
    event.CardCount === 1 &&
    event.FromID === 255 &&
    event.FromZone === 1 &&
    event.ToID === 255 &&
    event.ToZone === 1
  )
}

// 天候
function isTianhouAmbiguousPileShow(event: RawMoveCardEvent): boolean {
  return event.SpellID === 3903 && isPileSingleCardShow(event)
}

/**
 * 过滤已知的同区域展示噪声。
 * 这些协议消息不会改变牌所在位置，若继续下发会导致 Room 重复处理同一张牌。
 */
function shouldIgnoreSameZoneShow(event: RawMoveCardEvent): boolean {
  // 知天
  return (
    (event.SpellID === 7011 && event.MoveType === MOVE_TYPE.GENERAL_MOVE) ||
    (event.SpellID === 3744 && event.MoveType === MOVE_TYPE.SHOW)
  )
}

/**
 * 根据协议 Zone、MoveType 与牌可见性推断 Room 可消费的标准移动类型。
 * 分支顺序体现优先级：特殊公共区移动优先，其次同区域展示，最后按目标区域归类。
 */
function inferEventType(event: RawMoveCardEvent, cardIDs: readonly CardID[]): RawMoveEventType {
  const { FromZone: fromZone, ToZone: toZone, MoveType: moveType } = event
  const known = cardIDs.some((id) => id > 0)

  // 弃牌堆洗回牌堆会重置公共牌堆状态，必须优先从普通回牌堆事件中识别出来。
  if (fromZone === 2 && toZone === 9) return 'shuffleDiscardIntoPile'

  // 天候只公开牌顶三张中的一张，基础归一不按端点展示处理；
  // SpellID 装饰器会结合本轮交换批次将其转换为公共区范围候选。
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
 * 按牌堆或弃牌堆来源标记获取事件，供日志或调试界面使用。
 */
export function getProtocolMoveSpecialLabel(
  event: Pick<RawMoveCardEvent, 'MoveType' | 'FromZone'>
): string | undefined {
  if (event.MoveType !== MOVE_TYPE.GAIN) return undefined

  const fromZone = getProtocolPublicZone(event.FromZone)
  if (fromZone === 'pile') return '从牌堆获取牌'
  if (fromZone === 'discard') return '从弃牌堆获取牌'

  return undefined
}

/** 仅在最终事件构造时解析区域、座位和标记空间。 */
function normalizeMoveEndpoints(
  move: RawMoveCardEvent
): Pick<
  MoveOptions,
  'toSeatID' | 'fromSeatID' | 'fromZone' | 'subZone' | 'fromSubZone' | 'fromSpellID' | 'spellID'
> {
  const fromPublicZone = getProtocolPublicZone(move.FromZone)
  const targetIsPlayerZone = isProtocolPlayerZone(move.ToZone)
  const sourceIsPlayerZone = isProtocolPlayerZone(move.FromZone)
  // 标记区回手牌时，目标区可能带返回技能 ID（如 3389），不能覆盖来源标记空间 ID。
  const targetSpellID = targetIsPlayerZone
    ? getProtocolMarkSpellID(
        move.ToZone,
        {
          param: move.ToZoneParam,
          toZoneParam: move.ToZoneParam,
          spellID: move.SpellID
        },
        move.SpellID
      )
    : undefined
  const fromSpellID = sourceIsPlayerZone
    ? getProtocolMarkSpellID(
        move.FromZone,
        {
          param: move.FromZoneParam,
          fromZoneParam: move.FromZoneParam,
          spellID: move.SpellID
        },
        move.SpellID
      )
    : undefined
  // 纯公共区移动没有标记端点，仍需保留触发移动的协议技能 ID。
  const spellID = targetIsPlayerZone ? targetSpellID : (fromSpellID ?? move.SpellID)

  // FromID/ToID 的含义依赖具体 Zone，不能一律解释成玩家座位。
  // 例如 FromZone=8 弹窗标记回牌堆时，FromID 可能是技能/标记空间 ID；
  // FromZone=1 牌堆来源时，FromID=255 也只是牌堆/无座位占位。
  // fromSeatID/toSeatID 分别描述来源和目标玩家区端点，
  // 后续移动逻辑必须结合 fromZone/fromSubZone/spellID 判断它是否真是座位。

  // 观看公共区时不应默认把 subZone 推导为 hand；公共区来源的 subZone 置为 undefined。
  return {
    toSeatID: targetIsPlayerZone ? move.ToID : undefined,
    fromSeatID: sourceIsPlayerZone ? move.FromID : undefined,
    fromZone: fromPublicZone,
    subZone: targetIsPlayerZone
      ? getProtocolPlayerSubZone(move.ToZone)
      : sourceIsPlayerZone
        ? getProtocolPlayerSubZone(move.FromZone)
        : undefined,
    fromSubZone: sourceIsPlayerZone ? getProtocolPlayerSubZone(move.FromZone) : undefined,
    fromSpellID,
    spellID
  }
}

/** 直接映射最终只读 patched，不再复制协议对象或身份数组。 */
export function normalizeMoveEvent(
  patched: NormalizedMoveCardFields,
  raw: Readonly<RawMoveCardEvent> = patched
): NormalizedMoveEvent {
  const cardIDs = patched.CardIDs
  // 协议异常只记录并降级处理，避免记牌器阻断宿主消息链。
  logMoveEventValidationWarnings(validateMoveEvent(patched, cardIDs), raw)
  // 暗牌移动的 CardIDs 可以为空，移动张数以协议 CardCount 为准。
  const cardCount = patched.CardCount
  const type = inferEventType(patched, cardIDs)
  const toPublicZoneName = getProtocolPublicZone(patched.ToZone)
  const targetIsPlayerZone = isProtocolPlayerZone(patched.ToZone)

  return {
    type,
    cardIDs,
    cardCount,
    protocol: patched,
    moveType: patched.MoveType,
    toZone: targetIsPlayerZone ? 'player' : (toPublicZoneName ?? 'process'),
    options: {
      ...normalizeMoveEndpoints(patched),
      cardCount,
      moveType: patched.MoveType,
      position: patched.ToPosition,
      fromPosition: patched.FromPosition,
      sourceEvent: {
        type,
        label: getProtocolMoveSpecialLabel(patched) ?? patched.Label,
        moveType: patched.MoveType,
        raw
      }
    },
    raw
  }
}
