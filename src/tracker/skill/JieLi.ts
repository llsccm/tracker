/**
 * 族钟繇【诫厉】（SpellID=3483）交换适配。
 *
 * 公平性边界：
 * - 发动者本来就拥有完整操作信息，仅走协议默认移动，不运行本地推断。
 * - 开发模式允许目标视角保留协议中的完整牌堆身份，便于调试。
 * - 生产模式的目标视角只利用 Type=53 确定“自己被换走的手牌落在哪个
 *   牌堆槽位”；其它牌堆槽位保持匿名，不把协议泄露的 CardID 物化到牌堆。
 * - 其它视角不消费协议牌 ID，也不移动任何物理实体；只有观察到完整交换链后，
 *   才把目标手牌明牌扩展为“原候选位置 / 牌堆顶前 pileCount 张”的弱候选。
 *   该分支不反推原牌堆顶身份，也不利用交换张数建立精确 N 选 K 约束。
 *
 * 目标视角的生产路径会短暂保存“协议牌 ID -> 匿名物理槽”映射，它只用于计算
 * 目标手牌的回堆位置，不进入 Card/cardIndex/PileIdentityLedger，结算后立即清理。
 */
import type { Card } from '../Card'
import { POSITION_TOP } from '../candidate/cardPositions'
import { createPublicCandidate } from '../candidate/publicCandidate'
import { MOVE_TYPE } from '../MoveEventNormalizer'
import type { Room } from '../Room'
import {
  getCount,
  getEventSourceCards,
  getPositiveIDs,
  getRaw,
  patchEvent,
  type MoveEventDraft
} from './moveEventUtils'

export const JIE_LI_SPELL_ID = 3483

export type JieLiContextData = {
  actorSeat: number
  targetSeat: number
  pileCount: number
}

export type JieLiSelectionData = {
  actorSeat: number
  targetSeat: number
  handCardIDs: number[]
  pileCardIDs: number[]
}

type JieLiInformationMode = 'full' | 'limited'

type JieLiSelection = {
  handToPileCards: Card[]
  pileToHandCardIDs: number[]
  pileToHandSlots: Card[]
}

type JieLiBatch = {
  actorSeat: number
  targetSeat: number
  informationMode: JieLiInformationMode
  pileProtocolCardIDs: number[]
  pileSlots: Card[]
  handCards: Card[]
  selection: JieLiSelection | null
  returnedToPile: boolean
}

type JieLiObserverPhase = 'pile-staged' | 'hand-staged' | 'pile-returned'

/**
 * 第三方视角只保存协议公开的张数事实和目标手牌候选实体引用。
 * 四条物理移动全部保持 noop，因此批次中的 Card 引用不会进入 exchange 区。
 */
type JieLiObserverBatch = {
  actorSeat: number
  targetSeat: number
  /** GsCRoleOptTargetNtf.Params[0]，也是最终公共候选的牌顶范围。 */
  pileCount: number
  /** 目标手牌进入交换区消息的 CardCount；只用于校验结算链完整。 */
  exchangeCount: number
  /** 交换开始时确定或可能位于目标手牌的已知牌；匿名牌不参与身份候选。 */
  targetHandCards: Card[]
  phase: JieLiObserverPhase
}

type JieLiState = {
  context?: JieLiContextData
  batch?: JieLiBatch
  observerBatch?: JieLiObserverBatch
}

type JieLiViewMode = 'default' | 'target-full' | 'target-limited' | 'observer-limited' | 'skip'

function ensureJieLiState(room: Room): JieLiState {
  return room.ensureSkillState<JieLiState>(JIE_LI_SPELL_ID, () => ({}))
}

function getJieLiState(room: Room): JieLiState | undefined {
  return room.readSkillState<JieLiState>(JIE_LI_SPELL_ID)
}

function getBatch(room: Room): JieLiBatch | undefined {
  return getJieLiState(room)?.batch
}

function clearJieLiState(room: Room): void {
  room.deleteSkillState(JIE_LI_SPELL_ID)
}

function readPositiveInteger(value: unknown): number | null {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function readSeatID(value: unknown): number | null {
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 && number < 255 ? number : null
}

/**
 * 由 GsCRoleOptTargetNtf 记录发动者/目标座位。
 * 这里不保存任何牌 ID，只为后续移动选择正确的视角策略。
 */
export function recordJieLiContext(room: Room, data: JieLiContextData): boolean {
  const actorSeat = readSeatID(data.actorSeat)
  const targetSeat = readSeatID(data.targetSeat)
  const pileCount = readPositiveInteger(data.pileCount)
  if (actorSeat === null || targetSeat === null || pileCount === null) {
    clearJieLiState(room)
    return false
  }

  const state = ensureJieLiState(room)
  state.context = { actorSeat, targetSeat, pileCount }
  delete state.batch
  delete state.observerBatch
  return true
}

export function parseJieLiSelectionData(datas: unknown): JieLiSelectionData | null {
  if (!Array.isArray(datas) || datas.length < 6) return null

  const actorSeat = readSeatID(datas[0])
  const targetSeat = readSeatID(datas[1])
  const handCount = readPositiveInteger(datas[2])
  if (actorSeat === null || targetSeat === null || handCount === null) return null

  const handStart = 3
  const handEnd = handStart + handCount
  const pileCount = readPositiveInteger(datas[handEnd])
  if (pileCount === null || pileCount !== handCount) return null

  const pileStart = handEnd + 1
  const pileEnd = pileStart + pileCount
  if (pileEnd !== datas.length) return null

  const handCardIDs = datas.slice(handStart, handEnd).map(readPositiveInteger)
  const pileCardIDs = datas.slice(pileStart, pileEnd).map(readPositiveInteger)
  if (handCardIDs.includes(null) || pileCardIDs.includes(null)) return null

  const normalizedHandCardIDs = handCardIDs as number[]
  const normalizedPileCardIDs = pileCardIDs as number[]
  const allCardIDs = [...normalizedHandCardIDs, ...normalizedPileCardIDs]
  if (new Set(allCardIDs).size !== allCardIDs.length) return null

  return {
    actorSeat,
    targetSeat,
    handCardIDs: normalizedHandCardIDs,
    pileCardIDs: normalizedPileCardIDs
  }
}

/**
 * Type=53 的两组 ID 按下标配对。生产目标视角中，pileCardIDs 只查找前一条
 * 牌堆进交换区消息所对应的匿名槽，不把这些 ID 写入卡牌实体。
 */
export function recordJieLiSelection(room: Room, data: JieLiSelectionData): boolean {
  const batch = getBatch(room)
  if (
    !batch ||
    room.mySeatID !== data.targetSeat ||
    batch.actorSeat !== data.actorSeat ||
    batch.targetSeat !== data.targetSeat ||
    batch.handCards.length !== data.handCardIDs.length ||
    data.handCardIDs.length !== data.pileCardIDs.length
  ) {
    return false
  }

  const handCardByID = new Map(batch.handCards.map((card) => [card.id, card]))
  const pileSlotByProtocolID = new Map(
    batch.pileProtocolCardIDs.map((cardID, index) => [cardID, batch.pileSlots[index]])
  )
  const handToPileCards = data.handCardIDs
    .map((cardID) => handCardByID.get(cardID))
    .filter((card): card is Card => Boolean(card))
  const pileToHandSlots = data.pileCardIDs
    .map((cardID) => pileSlotByProtocolID.get(cardID))
    .filter((card): card is Card => Boolean(card))

  if (
    handToPileCards.length !== data.handCardIDs.length ||
    pileToHandSlots.length !== data.pileCardIDs.length ||
    new Set(handToPileCards).size !== handToPileCards.length ||
    new Set(pileToHandSlots).size !== pileToHandSlots.length
  ) {
    return false
  }

  batch.selection = {
    handToPileCards,
    pileToHandCardIDs: data.pileCardIDs.slice(),
    pileToHandSlots
  }
  return true
}

function resolveViewMode(room: Room, eventActorSeat?: unknown): JieLiViewMode {
  const context = getJieLiState(room)?.context
  const actorSeat = readSeatID(eventActorSeat) ?? context?.actorSeat ?? null

  // 发动者有自身完整信息，不需要任何 JieLi 推断。
  if (actorSeat !== null && room.mySeatID === actorSeat) return 'default'

  if (context && actorSeat === context.actorSeat && room.mySeatID === context.targetSeat) {
    return import.meta.env.DEV ? 'target-full' : 'target-limited'
  }

  if (
    context &&
    actorSeat === context.actorSeat &&
    room.mySeatID !== undefined &&
    room.mySeatID !== context.actorSeat &&
    room.mySeatID !== context.targetSeat
  ) {
    // 只有既非发动者、也非目标角色的明确本地座位才运行弱候选推断。
    return 'observer-limited'
  }

  return 'skip'
}

function noOp(event: MoveEventDraft): MoveEventDraft {
  return patchEvent(event, { type: 'noop' })
}

/**
 * 候选已经在装饰阶段写入 Card，但普通 noop 会让 Controller 提前返回，
 * 无法执行 resolveConstraints 和视图刷新。将最终消息改成零张移动，可以只触发
 * 收敛、索引同步与渲染，而不改变手牌数、交换区或牌堆身份账本。
 */
function resolveOnlyMove(event: MoveEventDraft): MoveEventDraft {
  return patchEvent(event, {
    cardIDs: [],
    cardCount: 0,
    options: {
      cardCount: 0,
      handMoveCount: 0,
      pileIdentityCardIDs: [],
      sourceCards: []
    }
  })
}

function failObserverInference(event: MoveEventDraft, room: Room): MoveEventDraft {
  clearJieLiState(room)
  return noOp(event)
}

/**
 * 使用稳定位置索引收集两类已知身份：确定在目标手里的明牌，以及仍包含目标手牌
 * 分支的候选明牌。匿名手牌只承担物理数量，不需要增加身份位置候选。
 */
function collectObserverTargetHandCards(room: Room, targetSeat: number): Card[] {
  const knownHandCards = room.locationIndex.knownHandBySeat.get(targetSeat) ?? []
  const candidateHandCards = room.locationIndex.candidateHandBySeat.get(targetSeat) ?? []

  return Array.from(new Set([...knownHandCards, ...candidateHandCards])).filter(
    (card) => card.id > 0 && card.isKnown === true
  )
}

/**
 * 结算前重新确认目标手牌分支仍然有效，避免交换链期间其它明确协议已经收敛了该牌，
 * 却仍根据旧快照给它追加牌顶范围。
 */
function hasTargetHandBranch(card: Card, targetSeat: number): boolean {
  const locationCandidates = card.getLocationCandidates()
  if (locationCandidates.length > 0) {
    return locationCandidates.some(
      (candidate) =>
        candidate.type === 'player' &&
        candidate.seatID === targetSeat &&
        candidate.subZone === 'hand'
    )
  }

  return card.location === 'player' && card.subZone === 'hand' && card.seats.has(targetSeat)
}

/**
 * 第三方视角观察到牌堆侧进入 exchange，只校验发动者与观看张数并启动状态机。
 * 即使消息意外携带正 CardIDs，也不会读取、物化或移动这些身份。
 */
function stageObserverPile(event: MoveEventDraft, room: Room): MoveEventDraft {
  const raw = getRaw(event)
  const context = getJieLiState(room)?.context
  const count = getCount(event)
  const actorSeat = Number(raw.ToID)

  if (!context || context.actorSeat !== actorSeat || context.pileCount !== count || !(count > 0)) {
    return failObserverInference(event, room)
  }

  ensureJieLiState(room).observerBatch = {
    actorSeat,
    targetSeat: context.targetSeat,
    pileCount: count,
    exchangeCount: 0,
    targetHandCards: [],
    phase: 'pile-staged'
  }
  return noOp(event)
}

/**
 * 手牌侧进入 exchange 证明本次确实发生了交换。此时物理状态尚未被本分支修改，
 * 因而可以安全快照目标手牌的确定明牌与候选明牌。
 */
function stageObserverTargetHand(event: MoveEventDraft, room: Room): MoveEventDraft {
  const raw = getRaw(event)
  const batch = getJieLiState(room)?.observerBatch
  const count = getCount(event)
  if (
    !batch ||
    batch.phase !== 'pile-staged' ||
    Number(raw.ToID) !== batch.actorSeat ||
    Number(raw.FromID) !== batch.targetSeat ||
    !(count > 0) ||
    count > batch.pileCount
  ) {
    return failObserverInference(event, room)
  }

  batch.exchangeCount = count
  batch.targetHandCards = collectObserverTargetHandCards(room, batch.targetSeat)
  batch.phase = 'hand-staged'
  return noOp(event)
}

/**
 * 回牌堆消息只推进状态机：第三方不知道哪些手牌被换出，因此不能在此移动实体、
 * 绑定匿名槽或消费消息中的 CardIDs。
 */
function returnObserverCardsToPile(event: MoveEventDraft, room: Room): MoveEventDraft {
  const raw = getRaw(event)
  const batch = getJieLiState(room)?.observerBatch
  if (
    !batch ||
    batch.phase !== 'hand-staged' ||
    Number(raw.FromID) !== batch.actorSeat ||
    Number(raw.ToID) !== 255 ||
    getCount(event) !== batch.pileCount
  ) {
    return failObserverInference(event, room)
  }

  batch.phase = 'pile-returned'
  return noOp(event)
}

/**
 * 完整交换链的提交点。对快照中仍含目标手牌分支的每张明牌，仅追加
 * “牌堆顶前 pileCount 张”这一可能位置，并保留它原有的全部位置分支。
 * exchangeCount 只能证明总交换张数，无法证明其中有几张属于这些候选明牌，
 * 所以这里刻意不创建 ConstraintGroup 的精确数量约束。
 */
function returnObserverCardsToTargetHand(event: MoveEventDraft, room: Room): MoveEventDraft {
  const raw = getRaw(event)
  const batch = getJieLiState(room)?.observerBatch
  if (
    !batch ||
    batch.phase !== 'pile-returned' ||
    Number(raw.FromID) !== batch.actorSeat ||
    Number(raw.ToID) !== batch.targetSeat ||
    getCount(event) !== batch.exchangeCount
  ) {
    return failObserverInference(event, room)
  }

  const pileCandidate = createPublicCandidate('pile', POSITION_TOP, batch.pileCount)
  let changed = false
  batch.targetHandCards.forEach((card) => {
    if (!hasTargetHandBranch(card, batch.targetSeat)) return
    changed = card.addPublicCandidate(pileCandidate) || changed
  })

  clearJieLiState(room)
  return changed ? resolveOnlyMove(event) : noOp(event)
}

function failTargetInference(
  event: MoveEventDraft,
  room: Room,
  informationMode: JieLiInformationMode
): MoveEventDraft {
  clearJieLiState(room)
  return informationMode === 'full' ? event : noOp(event)
}

function getKnownPileIdentityIDs(cards: Card[]): number[] {
  return cards.filter((card) => card.id > 0 && card.isKnown === true).map((card) => card.id)
}

/**
 * 牌堆批次进入 exchange(10)。
 *
 * full：保留协议 CardIDs，用于开发模式完整调试。
 * limited：改成匿名 sourceCards 移动，只保留协议 ID 与物理槽的短期映射。
 */
function stagePileToExchange(
  event: MoveEventDraft,
  room: Room,
  informationMode: JieLiInformationMode
): MoveEventDraft {
  const raw = getRaw(event)
  const state = getJieLiState(room)
  const context = state?.context
  const count = getCount(event)
  const pileProtocolCardIDs = getPositiveIDs(event.cardIDs ?? [])
  const actorSeat = Number(raw.ToID)
  // 牌堆内部是底 -> 顶；3483 进交换区的 ID 正好按这段的底 -> 顶排列。
  const pileZoneCards = room.zones.get('pile')?.cards ?? []
  const physicalPileSlots = pileZoneCards.slice(-count)

  if (
    !context ||
    context.actorSeat !== actorSeat ||
    context.targetSeat !== room.mySeatID ||
    context.pileCount !== count ||
    !(count > 0) ||
    pileProtocolCardIDs.length !== count ||
    physicalPileSlots.length !== count
  ) {
    return failTargetInference(event, room, informationMode)
  }

  let pileSlots = physicalPileSlots
  if (informationMode === 'full') {
    const existingCards = getEventSourceCards(event, room)
    const hasExactExistingOrder =
      existingCards.length === count &&
      existingCards.every((card, index) => card.id === pileProtocolCardIDs[index])

    if (hasExactExistingOrder) {
      pileSlots = existingCards
    } else {
      // 目标视角的开发模式可能只收到 Params=[pileCount]。
      // 此时用进交换区的底 -> 顶 ID 在对应物理槽上物化完整身份。
      const probedCards = pileProtocolCardIDs.map((cardID, index) =>
        room.probeMaterialize(cardID, physicalPileSlots[index])
      )
      if (probedCards.some((card) => !card) || new Set(probedCards).size !== probedCards.length) {
        return failTargetInference(event, room, informationMode)
      }

      pileSlots = pileProtocolCardIDs
        .map((cardID, index) => room.materialize(cardID, physicalPileSlots[index]))
        .filter((card): card is Card => Boolean(card))
      if (pileSlots.length !== count) {
        return failTargetInference(event, room, informationMode)
      }
    }
  }

  ensureJieLiState(room).batch = {
    actorSeat,
    targetSeat: context.targetSeat,
    informationMode,
    pileProtocolCardIDs,
    pileSlots,
    handCards: [],
    selection: null,
    returnedToPile: false
  }

  if (informationMode === 'full') return event

  return patchEvent(event, {
    cardIDs: [],
    options: {
      sourceCards: pileSlots,
      // 仅保留本次技能之前已经合法公开的牌堆身份。
      pileIdentityCardIDs: getKnownPileIdentityIDs(pileSlots)
    }
  })
}

function stageTargetHandToExchange(
  event: MoveEventDraft,
  room: Room,
  informationMode: JieLiInformationMode
): MoveEventDraft {
  const raw = getRaw(event)
  const batch = getBatch(room)
  const count = getCount(event)
  const cardIDs = getPositiveIDs(event.cardIDs ?? [])
  const actorSeat = Number(raw.ToID)
  const targetSeat = Number(raw.FromID)
  const handCards = getEventSourceCards(event, room)

  if (
    !batch ||
    batch.informationMode !== informationMode ||
    actorSeat !== batch.actorSeat ||
    targetSeat !== batch.targetSeat ||
    targetSeat !== room.mySeatID ||
    !(count > 0) ||
    cardIDs.length !== count ||
    handCards.length !== count
  ) {
    return failTargetInference(event, room, informationMode)
  }

  batch.handCards = handCards
  return event
}

function buildFinalPileOrder(batch: JieLiBatch): Card[] | null {
  const selection = batch.selection
  if (!selection) return null

  // Type 53 逐项表示：handToPile[i] 替换 pileToHand[i] 原先所在的物理槽。
  const replacementByPileSlot = new Map(
    selection.pileToHandSlots.map((pileSlot, index) => [pileSlot, selection.handToPileCards[index]])
  )
  return batch.pileSlots.map((card) => replacementByPileSlot.get(card) ?? card)
}

function returnTargetViewCardsToPile(
  event: MoveEventDraft,
  room: Room,
  informationMode: JieLiInformationMode
): MoveEventDraft {
  const raw = getRaw(event)
  const batch = getBatch(room)
  if (
    !batch ||
    batch.informationMode !== informationMode ||
    Number(raw.FromID) !== batch.actorSeat
  ) {
    return failTargetInference(event, room, informationMode)
  }

  // 开发模式若已经拿到完整回堆 ID，直接走默认精确移动即可。
  if (informationMode === 'full' && getPositiveIDs(event.cardIDs ?? []).length > 0) {
    clearJieLiState(room)
    return event
  }

  const pileSlots = batch.pileSlots.filter((card) => card.location === 'exchange')
  const handCards = batch.handCards.filter((card) => card.location === 'exchange')
  const finalPileCards = buildFinalPileOrder(batch)
  const count = getCount(event)

  if (
    count !== batch.pileSlots.length ||
    pileSlots.length !== batch.pileSlots.length ||
    handCards.length !== batch.handCards.length ||
    event.options?.position !== POSITION_TOP ||
    !finalPileCards ||
    finalPileCards.some((card) => card.location !== 'exchange')
  ) {
    return failTargetInference(event, room, informationMode)
  }

  batch.returnedToPile = true
  return patchEvent(event, {
    // 生产目标视角即使协议意外携带回堆 ID，也不将它们写入记牌器。
    ...(informationMode === 'limited' ? { cardIDs: [] } : {}),
    options: {
      sourceCards: finalPileCards,
      // limited 下只有目标原手牌（以及技能前已公开的牌）保留精确身份。
      pileIdentityCardIDs: getKnownPileIdentityIDs(finalPileCards)
    }
  })
}

function returnCardsToTargetHand(
  event: MoveEventDraft,
  room: Room,
  informationMode: JieLiInformationMode
): MoveEventDraft {
  const raw = getRaw(event)
  const batch = getBatch(room)
  const selection = batch?.selection
  if (
    !batch ||
    !selection ||
    batch.informationMode !== informationMode ||
    !batch.returnedToPile ||
    Number(raw.FromID) !== batch.actorSeat ||
    Number(raw.ToID) !== batch.targetSeat
  ) {
    return failTargetInference(event, room, informationMode)
  }

  const cardIDs = getPositiveIDs(event.cardIDs ?? [])
  const pileSlotByResultID = new Map(
    selection.pileToHandCardIDs.map((cardID, index) => [cardID, selection.pileToHandSlots[index]])
  )
  const handResultSlots = cardIDs
    .map((cardID) => pileSlotByResultID.get(cardID))
    .filter((card): card is Card => Boolean(card))

  clearJieLiState(room)
  if (
    cardIDs.length !== getCount(event) ||
    handResultSlots.length !== selection.pileToHandSlots.length ||
    handResultSlots.length !== cardIDs.length ||
    handResultSlots.some((card) => card.location !== 'exchange')
  ) {
    return informationMode === 'full' ? event : noOp(event)
  }

  return patchEvent(event, {
    options: {
      sourceCards: handResultSlots,
      // 回堆后 exchange 只剩被目标获得的槽，它们按 Type 53 的顶向序物化。
      fromPosition: POSITION_TOP
    }
  })
}

export default function decorateJieLi(event: MoveEventDraft, room: Room): MoveEventDraft {
  const raw = getRaw(event)
  const spellID = Number(raw.SpellID ?? event.options?.spellID)
  if (spellID !== JIE_LI_SPELL_ID) return event

  const moveType = Number(raw.MoveType ?? event.moveType ?? event.options?.moveType)
  const fromZone = Number(raw.FromZone)
  const toZone = Number(raw.ToZone)
  const eventActorSeat = fromZone === 1 || fromZone === 5 ? raw.ToID : raw.FromID
  const viewMode = resolveViewMode(room, eventActorSeat)

  if (moveType === MOVE_TYPE.SHOW) {
    // 生产目标与第三方视角都不消费泄露完整牌堆的同区展示。
    return viewMode === 'target-limited' || viewMode === 'observer-limited' || viewMode === 'skip'
      ? noOp(event)
      : event
  }

  if (moveType !== MOVE_TYPE.EXCHANGE) return event

  const isFinalReturn = fromZone === 10 && toZone === 5
  if (viewMode === 'default') {
    if (isFinalReturn) clearJieLiState(room)
    return event
  }
  if (viewMode === 'skip') {
    if (isFinalReturn) clearJieLiState(room)
    return noOp(event)
  }
  if (viewMode === 'observer-limited') {
    // 第三方只消费四条消息的座位、方向与张数，所有协议牌 ID 均保持不可见。
    if (fromZone === 1 && toZone === 10) return stageObserverPile(event, room)
    if (fromZone === 5 && toZone === 10) return stageObserverTargetHand(event, room)
    if (fromZone === 10 && toZone === 1) return returnObserverCardsToPile(event, room)
    if (fromZone === 10 && toZone === 5) return returnObserverCardsToTargetHand(event, room)
    return noOp(event)
  }

  const informationMode: JieLiInformationMode = viewMode === 'target-full' ? 'full' : 'limited'
  if (fromZone === 1 && toZone === 10) {
    return stagePileToExchange(event, room, informationMode)
  }
  if (fromZone === 5 && toZone === 10) {
    return stageTargetHandToExchange(event, room, informationMode)
  }
  if (fromZone === 10 && toZone === 1) {
    return returnTargetViewCardsToPile(event, room, informationMode)
  }
  if (fromZone === 10 && toZone === 5) {
    return returnCardsToTargetHand(event, room, informationMode)
  }

  return noOp(event)
}
