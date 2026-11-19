import { getMovePosition } from '@/tracker/helper/moveEndpoint'
/**
 * 族钟繇【诫厉】（SpellID=3483）交换适配。
 *
 * 公平性边界：
 * - 发动者本来就拥有完整操作信息，仅走协议默认移动，不运行本地推断。
 * - 开发模式允许目标视角保留协议中的完整牌堆身份，便于调试。
 * - 生产模式的目标视角只利用 Type=53 确定“自己被换走的手牌落在哪个
 *   牌堆槽位”；其它牌堆槽位保持匿名，不把协议泄露的 CardID 物化到牌堆。
 * - 其它明确视角按协议中的 CardID 执行默认移动，同阵营队友可同步完整交换结果。
 *
 * 目标视角的生产路径会短暂保存“协议牌 ID -> 匿名物理槽”映射，它只用于计算
 * 目标手牌的回堆位置，不进入 Card/cardIndex/PileIdentityLedger，结算后立即清理。
 */
import type { Card } from '@/tracker/model/Card'
import { POSITION_TOP } from '../candidate/cardPositions'
import { MOVE_TYPE } from '../protocol/MoveEventNormalizer'
import type { Room } from '../Room'
import type { RoomSkillPlugin } from '../room/moveEvents'
import { getPositiveIDs } from '../helper/cardIDs'
import { getCount, getEventSourceCards, patchEvent, type MoveEventDraft } from './moveEventUtils'
import type { SkillChoiceMessage } from './protocolEvents'
import { defineSkillState } from './skillState'

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

export interface JieLiParsedNotice extends JieLiContextData {
  pileCardIDs: number[] | null
  handCardIDs: number[] | null
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

type JieLiState = {
  context?: JieLiContextData
  batch?: JieLiBatch
}

type JieLiViewMode = 'default' | 'target-full' | 'target-limited' | 'skip'

const jieLiState = defineSkillState<JieLiState>(JIE_LI_SPELL_ID)

function getBatch(room: Room): JieLiBatch | undefined {
  return jieLiState.read(room)?.batch
}

export function clearJieLiState(room: Room): void {
  jieLiState.clear(room)
}

/**
 * 由 GsCRoleOptTargetNtf 记录发动者/目标座位。
 * 这里不保存任何牌 ID，只为后续移动选择正确的视角策略。
 */
export function recordJieLiContext(room: Room, data: JieLiContextData): void {
  const state = jieLiState.ensure(room, () => ({}))
  state.context = data
  delete state.batch
}

/**
 * 接收 CGsRoleSpellOptRep 已完成目标视角筛选与协议解析的选择，按当前批次配对两组 ID。
 * 生产目标视角中，pileCardIDs 只查找前一条牌堆进交换区消息所对应的匿名槽，
 * 不把这些 ID 写入卡牌实体。
 */
export function recordJieLiSelection(room: Room, data: JieLiSelectionData): boolean {
  const batch = getBatch(room)
  if (
    !batch ||
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

export function parseJieLiNotice(msg: {
  Params?: readonly number[]
  SeatID?: number
  SrcSeatID?: number
  targetSeatID?: number
}): JieLiParsedNotice | null {
  const { Params, SeatID, SrcSeatID, targetSeatID } = msg
  if (targetSeatID === undefined || !Array.isArray(Params) || Params.length === 0) {
    return null
  }

  const actorSeat = (SrcSeatID ?? SeatID) as number
  const targetSeat = targetSeatID
  const [pileCount, handCount] = Params
  if (!Number.isInteger(pileCount) || pileCount <= 0) return null

  if (Params.length === 1) {
    return { actorSeat, targetSeat, pileCount, pileCardIDs: null, handCardIDs: null }
  }

  if (
    !Number.isInteger(handCount) ||
    handCount < 0 ||
    Params.length !== 2 + pileCount + handCount
  ) {
    return null
  }

  return {
    actorSeat,
    targetSeat,
    pileCount,
    pileCardIDs: Params.slice(2, 2 + pileCount),
    handCardIDs: Params.slice(2 + pileCount)
  }
}

export function handleJieLiChoice(room: Room, msg: SkillChoiceMessage): boolean {
  const { Datas, Type } = msg
  if (Type !== 53 || !Array.isArray(Datas) || room.mySeatID !== Datas[1]) return false

  // Datas: [actorSeat, targetSeat, handCount, ...handToPile, pileCount, ...pileToHand]
  const [actorSeat, targetSeat, handCount] = Datas
  const handEnd = 3 + handCount
  const pileStart = handEnd + 1
  const pileCount = Datas[handEnd]

  if (
    !Number.isInteger(handCount) ||
    !Number.isInteger(pileCount) ||
    handCount <= 0 ||
    pileCount <= 0 ||
    handCount !== pileCount ||
    Datas.length !== pileStart + pileCount
  ) {
    return false
  }

  return recordJieLiSelection(room, {
    actorSeat,
    targetSeat,
    handCardIDs: Datas.slice(3, handEnd),
    pileCardIDs: Datas.slice(pileStart, pileStart + pileCount)
  })
}

function resolveViewMode(room: Room, eventActorSeat?: number): JieLiViewMode {
  const context = jieLiState.read(room)?.context
  const actorSeat =
    eventActorSeat != null && eventActorSeat !== 255 ? eventActorSeat : (context?.actorSeat ?? null)

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
    // 同阵营队友也可能收到完整身份，按协议执行普通移动。
    return 'default'
  }

  return 'skip'
}

function noOp(event: MoveEventDraft): MoveEventDraft {
  return patchEvent(event, { type: 'noop' })
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
  const move = event.protocol
  const state = jieLiState.read(room)
  const context = state?.context
  const count = getCount(event)
  const pileProtocolCardIDs = getPositiveIDs(event.cardIDs)
  const actorSeat = move.ToID
  // 牌堆内部是底 -> 顶；3483 进交换区的 ID 正好按这段的底 -> 顶排列。
  const pileZoneCards = room.getZone('pile').cards
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

  jieLiState.ensure(room, () => ({})).batch = {
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
  const move = event.protocol
  const batch = getBatch(room)
  const count = getCount(event)
  const cardIDs = getPositiveIDs(event.cardIDs)
  const actorSeat = move.ToID
  const targetSeat = move.FromID
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
  const move = event.protocol
  const batch = getBatch(room)
  if (!batch || batch.informationMode !== informationMode || move.FromID !== batch.actorSeat) {
    return failTargetInference(event, room, informationMode)
  }

  // 开发模式若已经拿到完整回堆 ID，直接走默认精确移动即可。
  if (informationMode === 'full' && getPositiveIDs(event.cardIDs).length > 0) {
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
    getMovePosition(event.to) !== POSITION_TOP ||
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
  const move = event.protocol
  const batch = getBatch(room)
  const selection = batch?.selection
  if (
    !batch ||
    !selection ||
    batch.informationMode !== informationMode ||
    !batch.returnedToPile ||
    move.FromID !== batch.actorSeat ||
    move.ToID !== batch.targetSeat
  ) {
    return failTargetInference(event, room, informationMode)
  }

  const cardIDs = getPositiveIDs(event.cardIDs)
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
    from: event.from.type === 'public' ? { ...event.from, position: POSITION_TOP } : event.from,
    options: { sourceCards: handResultSlots }
  })
}

export default function decorateJieLi(event: MoveEventDraft, room: Room): MoveEventDraft {
  const move = event.protocol
  const spellID = move.SpellID
  if (spellID !== JIE_LI_SPELL_ID) return event

  const moveType = event.moveType
  const fromZone = move.FromZone
  const toZone = move.ToZone
  const eventActorSeat = fromZone === 1 || fromZone === 5 ? move.ToID : move.FromID
  const viewMode = resolveViewMode(room, eventActorSeat)

  if (moveType === MOVE_TYPE.SHOW) {
    // 生产目标不消费泄露完整牌堆的同区展示。
    return viewMode === 'target-limited' || viewMode === 'skip' ? noOp(event) : event
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

export const jieLiPlugin: RoomSkillPlugin = {
  id: 'jieLi',
  spellIDs: [JIE_LI_SPELL_ID],
  decorateMove: decorateJieLi,
  onProtocolEvent(event, room) {
    const msg = event.message
    if (!('SpellID' in msg) || msg.SpellID !== JIE_LI_SPELL_ID) return

    if (event.type === 'targetNotice') {
      const noticeMsg = event.message
      if (
        noticeMsg.targetSeatID !== undefined &&
        noticeMsg.Param == 1 &&
        noticeMsg.Params &&
        noticeMsg.Params.length > 0
      ) {
        const notice = parseJieLiNotice(noticeMsg)
        if (!notice) {
          clearJieLiState(room)
          return
        }
        recordJieLiContext(room, {
          actorSeat: notice.actorSeat,
          targetSeat: notice.targetSeat,
          pileCount: notice.pileCount
        })
      }
      return
    }

    if (event.type === 'choice') {
      handleJieLiChoice(room, event.message)
    }
  }
}
