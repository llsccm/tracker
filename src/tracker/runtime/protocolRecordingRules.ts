export interface ProjectedTrackerProtocol {
  className: string
  payload: Record<string, unknown>
}

type ProtocolObject = Record<string, unknown>
type ProtocolPredicate = (message: ProtocolObject) => boolean

const ALWAYS_RECORDED_CLASSES = new Set([
  'MsgReconnectGame',
  'decodeGameRecordInitInfo',
  'decodeGsClientUserSeatFlagNtf',
  'GsCFirstPhaseRole',
  'MsgGamePlayCardNtf',
  'SmsgGameSetCharacter',
  'GsCGuoZhanSetCharacter',
  'MsgGameTurnNtf',
  'GsCGamephaseNtf',
  'MsgGameRoundNtf',
  'MsgGameOver',
  'ClientLeavetableRep',
  'MsgNtfUseCardType',
  'PubGsCUseCard',
  'PubGsCUseSpell',
  'PubGsCMoveCard'
])

// Prettier 会压缩数字列表，但项目 ESLint 要求长数组逐项换行。
// prettier-ignore
const ROLE_OPT_TARGET_SPELL_IDS = new Set([
  4,
  5,
  357,
  361,
  372,
  501,
  774,
  811,
  851,
  898,
  921,
  943,
  987,
  988,
  2900,
  3119,
  3310,
  3437,
  3483,
  3876,
  3903,
  4025
])

const ROLE_SPELL_OPT_SPELL_IDS = new Set([2022, 3336, 3659, 3744, 3868, 7009])
const TRACKER_ROLE_DATA_EX_IDS = new Set([3544, 3571])

const CONDITIONAL_RECORDING_RULES: Record<string, ProtocolPredicate> = {
  GsCUpdateRoleDataNtf: (message) => readNumberField(message, 'StateID') === 58,
  MsgGameShowFigure: (message) => readNumberField(message, 'Figure') === 1,
  GsCUpdateRoleDataExNtf: (message) =>
    TRACKER_ROLE_DATA_EX_IDS.has(readNumberField(message, 'DataID') ?? -1),
  GsCRoleOptTargetNtf: (message) =>
    ROLE_OPT_TARGET_SPELL_IDS.has(readNumberField(message, 'SpellID') ?? -1),
  CGsRoleSpellOptRep: (message) =>
    readNumberField(message, 'Type') === 72 ||
    ROLE_SPELL_OPT_SPELL_IDS.has(readNumberField(message, 'SpellID') ?? -1)
}

const ROOT_IGNORED_FIELDS = new Set([
  'ByteData',
  'CardSpell',
  'ClassName',
  'Data',
  'FItem',
  'ProtoObj',
  'Spell',
  'className',
  'data',
  'errCode',
  'errMsg',
  'fromSocket2',
  'id',
  'isResume',
  'isSend',
  'msgQueuePriority',
  'pbMsgType',
  'printIgnorList',
  'printJsonIgnorList',
  'protoName',
  'receviedStatus',
  'sendStatus',
  'timestamp',
  'userID'
])

const ROOT_FIELD_EXCEPTIONS = new Map([
  ['MsgNtfUseCardType', new Set(['isSend'])],
  ['PubGsCUseCard', new Set(['isSend'])]
])

const NESTED_IGNORED_FIELDS = new Set(['timestamp'])
const TRACKER_SEAT_INFO_FIELDS = ['SeatID', 'seat_id', 'user_temp_id', 'ClientID']
const OMITTED = Symbol('omitted')
const MAX_PROTOCOL_DEPTH = 20

export function shouldRecordTrackerProtocol(message: unknown): boolean {
  if (!isProtocolObject(message)) return false

  const className = getProtocolClassName(message)
  if (!className) return false

  const conditionalRule = CONDITIONAL_RECORDING_RULES[className]
  if (conditionalRule) return conditionalRule(message)

  return ALWAYS_RECORDED_CLASSES.has(className)
}

export function projectTrackerProtocol(message: unknown): ProjectedTrackerProtocol | null {
  if (!isProtocolObject(message)) return null

  const className = getProtocolClassName(message)
  if (!className) return null

  const payload = collectRootPayload(message, className)
  appendRequiredNestedPayload(message, className, payload)

  return { className, payload }
}

export function getProtocolClassName(message: ProtocolObject): string | null {
  const className = readProtocolField(message, 'className')
  if (typeof className === 'string' && className) return className

  const fallbackClassName = readProtocolField(message, 'ClassName')
  return typeof fallbackClassName === 'string' && fallbackClassName ? fallbackClassName : null
}

function collectRootPayload(message: ProtocolObject, className: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  const exceptions = ROOT_FIELD_EXCEPTIONS.get(className)

  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(message))) {
    if (!descriptor.enumerable || !('value' in descriptor)) continue
    if (ROOT_IGNORED_FIELDS.has(key) && !exceptions?.has(key)) continue

    const value = cloneProtocolValue(descriptor.value)
    if (value !== OMITTED) payload[key] = value
  }

  return payload
}

function appendRequiredNestedPayload(
  message: ProtocolObject,
  className: string,
  payload: Record<string, unknown>
): void {
  if (className === 'decodeGameRecordInitInfo') appendRecordInitPayload(message, payload)
  if (className === 'decodeGsClientUserSeatFlagNtf') appendSeatInfoPayload(message, payload)
}

function appendRecordInitPayload(message: ProtocolObject, payload: Record<string, unknown>): void {
  const protoObj = readProtocolField(message, 'ProtoObj')
  if (!isProtocolObject(protoObj)) return

  const matchName = cloneProtocolValue(readProtocolField(protoObj, 'matchName'))
  if (matchName === OMITTED) return

  payload.ProtoObj = { matchName }
}

function appendSeatInfoPayload(message: ProtocolObject, payload: Record<string, unknown>): void {
  const data = readProtocolField(message, 'data')
  if (!isProtocolObject(data)) return

  const protoObj = readProtocolField(data, 'protoObj')
  if (!isProtocolObject(protoObj)) return

  const seatinfo = readProtocolField(protoObj, 'seatinfo')
  if (!Array.isArray(seatinfo)) return

  payload.data = { protoObj: { seatinfo: seatinfo.map(projectSeatInfo) } }
}

function projectSeatInfo(value: unknown): Record<string, unknown> {
  if (!isProtocolObject(value)) return {}

  const result: Record<string, unknown> = {}
  TRACKER_SEAT_INFO_FIELDS.forEach((key) => {
    const fieldValue = cloneProtocolValue(readProtocolField(value, key))
    if (fieldValue !== OMITTED) result[key] = fieldValue
  })
  return result
}

function readNumberField(message: ProtocolObject, key: string): number | undefined {
  const value = Number(readProtocolField(message, key))
  return Number.isFinite(value) ? value : undefined
}

function readProtocolField(message: ProtocolObject, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(message, key)
  if (descriptor && 'value' in descriptor) return descriptor.value

  try {
    return message[key]
  } catch {
    return undefined
  }
}

function cloneProtocolValue(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0
): unknown | typeof OMITTED {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : OMITTED
  if (typeof value === 'bigint') return value.toString()
  if (typeof value !== 'object') return OMITTED
  if (depth >= MAX_PROTOCOL_DEPTH || value instanceof Date) return OMITTED
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return OMITTED
  if (seen.has(value)) return OMITTED

  seen.add(value)

  if (Array.isArray(value)) {
    const result = value.map((item) => {
      const clonedItem = cloneProtocolValue(item, seen, depth + 1)
      return clonedItem === OMITTED ? null : clonedItem
    })
    seen.delete(value)
    return result
  }

  const result: Record<string, unknown> = {}
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || !('value' in descriptor)) continue
    if (NESTED_IGNORED_FIELDS.has(key)) continue

    const clonedValue = cloneProtocolValue(descriptor.value, seen, depth + 1)
    if (clonedValue !== OMITTED) result[key] = clonedValue
  }

  seen.delete(value)
  return result
}

function isProtocolObject(value: unknown): value is ProtocolObject {
  return value !== null && typeof value === 'object'
}
