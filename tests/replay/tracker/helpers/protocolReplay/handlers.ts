import { POSITION_BOTTOM, POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import type { GameState } from '@/tracker/Game'
import type { Room } from '@/tracker/Room'
import type { RecordedTrackerProtocol } from '@/tracker/runtime/protocolRecorder'
import {
  FULL_HAND_ROLE_OPT_SPELL_IDS,
  normalizeTrackerMovePosition,
  PARTIAL_HAND_ROLE_OPT_SPELL_IDS,
  prepareTrackerMoveCardIDs,
  shouldRevealAsFullHand
} from '@/tracker/runtime/protocolRules'
import type { RawMoveCardEvent } from '@/tracker/types'
import { parseGuiFuCardIDs } from '@/handler/skills/GuiFu'
import handleXiaShuMove, {
  handleXiaShuChoice,
  handleXiaShuTargetNotice
} from '@/handler/skills/XiaShu'
import {
  initializeDuoQiState,
  recordDuoQiActivation,
  recordDuoQiRoleDataTarget
} from '@/tracker/skill/DuoQi'
import type { ApplyTrackerProtocolResult, TrackerProtocolReplayContext } from './types'

interface ReplayMoveContext {
  game: GameState
  CardIDs: number[]
  CardCount: number
  FromID: number
  FromZone: number
  FromPosition: number
  ToID: number
  ToZone: number
  ToPosition: number
  MoveType: number
  SpellID: number
  SrcSeatID?: number
}

export function applyTrackerReplayProtocol(
  context: TrackerProtocolReplayContext,
  record: RecordedTrackerProtocol
): ApplyTrackerProtocolResult {
  switch (record.className) {
    case 'MsgReconnectGame':
      context.gameState.isDuanXian = true
      return partial('断线重连只记录状态；当前协议不足以恢复重连前牌堆')

    case 'decodeGameRecordInitInfo':
      return applyRecordInit(context, record)

    case 'decodeGsClientUserSeatFlagNtf':
      return applySeatInfo(context, record)

    case 'GsCFirstPhaseRole':
      requireRoom(context, record, '设置先手座位')
      context.controller.setTrackerFirstHand(requireInteger(record, 'SeatID'))
      return applied()

    case 'MsgGameShowFigure':
      return applyShowFigure(context, record)

    case 'GsCUpdateRoleDataNtf':
      return applyRoleData(context, record)

    case 'MsgGamePlayCardNtf':
      return applyDeckInit(context, record)

    case 'SmsgGameSetCharacter':
      return applySetCharacter(context, record)

    case 'GsCGuoZhanSetCharacter':
      return applyGuoZhanSetCharacter(context, record)

    case 'MsgGameTurnNtf':
      return applyTurn(context, record)

    case 'GsCGamephaseNtf':
      return applyPhase(context, record)

    case 'MsgGameRoundNtf':
      if (record.payload.isPassed) context.gameState.isPassed = Boolean(record.payload.isPassed)
      return applied()

    case 'MsgGameOver':
    case 'ClientLeavetableRep':
      context.gameState.end()
      context.controller.destroyTrackerRoom()
      return applied()

    case 'MsgNtfUseCardType':
      return applyUseCardState(context.gameState, {
        SeatID: readNumber(record.payload.castSeatId),
        useType: readNumber(record.payload.useType),
        isSend: record.payload.isSend,
        spellID: readNumber(record.payload.spellID ?? record.payload.spellId)
      })

    case 'PubGsCUseCard':
      return applyUseCardState(context.gameState, record.payload)

    case 'PubGsCUseSpell':
      return applyUseSpellState(context.gameState, record)

    case 'CGsRoleSpellOptRep':
      return applyRoleSpellOpt(context, record)

    case 'GsCRoleOptTargetNtf':
      return applyRoleOptTarget(context, record)

    case 'GsCUpdateRoleDataExNtf':
      return applyRoleDataEx(context, record)

    case 'PubGsCMoveCard':
      return applyMoveCard(context, record)

    default:
      throw new Error(`回放器尚未支持协议 ${record.className}，不能保证状态重建准确`)
  }
}

function applyRecordInit(
  context: TrackerProtocolReplayContext,
  record: RecordedTrackerProtocol
): ApplyTrackerProtocolResult {
  context.gameState.init()
  context.sessionInitialized = true

  const protoObj = readRecord(record.payload.ProtoObj)
  const matchName = typeof protoObj?.matchName === 'string' ? protoObj.matchName : ''
  if (!matchName) return applied()

  if (matchName === '斗地主') {
    context.gameState.isDouDiZhu = true
    context.gameState.needShowName = true
    return applied()
  }

  if (matchName === '新欢乐排位' || matchName.includes('cmk')) {
    context.gameState.needShowName = true
    return applied()
  }

  if (matchName === '单骑无双') {
    context.gameState.isRoguelike1v1 = true
    return applied()
  }

  if (/\[\d+\]$/.test(matchName) || matchName.includes('山河图')) {
    context.gameState.isShanHeTu = true
  }

  return applied()
}

function applySeatInfo(
  context: TrackerProtocolReplayContext,
  record: RecordedTrackerProtocol
): ApplyTrackerProtocolResult {
  const initializedLate = !context.sessionInitialized
  if (initializedLate) {
    context.gameState.init()
    context.sessionInitialized = true
  }

  const data = readRecord(record.payload.data)
  const protoObj = readRecord(data?.protoObj)
  const seatinfo = protoObj?.seatinfo
  if (!Array.isArray(seatinfo) || seatinfo.length === 0) {
    throw new Error('录像开局协议缺少 data.protoObj.seatinfo，无法重建 Room 玩家')
  }

  const players = seatinfo.map((item, index) => {
    const info = readRecord(item)
    if (!info) throw new Error(`seatinfo[${index}] 必须是对象`)
    return info
  })

  context.controller.initTrackerRoom()
  context.controller.registerTrackerPlayers(players, context.currentUserID)

  if (initializedLate) {
    return partial('录制缺少 decodeGameRecordInitInfo，已按默认模式初始化 GameState')
  }
  return applied()
}

function applyShowFigure(
  context: TrackerProtocolReplayContext,
  record: RecordedTrackerProtocol
): ApplyTrackerProtocolResult {
  if (readNumber(record.payload.Figure) !== 1) return ignored('该身份消息不设置先手')
  requireRoom(context, record, '根据身份设置先手座位')
  context.controller.setTrackerFirstHand(requireInteger(record, 'SeatID'))
  return applied()
}

function applyRoleData(
  context: TrackerProtocolReplayContext,
  record: RecordedTrackerProtocol
): ApplyTrackerProtocolResult {
  if (readNumber(record.payload.StateID) !== 58) return ignored('该角色状态不参与回放')
  if (!context.gameState.isRecord || context.gameState.myID !== undefined) {
    return ignored('主视角已经确定，无需使用 StateID=58 兜底')
  }

  requireRoom(context, record, '根据 StateID=58 设置录像主视角')
  context.controller.setTrackerMySeatID(requireInteger(record, 'SeatID'))
  return applied()
}

function applyDeckInit(
  context: TrackerProtocolReplayContext,
  record: RecordedTrackerProtocol
): ApplyTrackerProtocolResult {
  const room = requireRoom(context, record, '初始化牌堆')
  if (room.players.size === 0) {
    throw prerequisiteError(record, '初始化牌堆前缺少玩家注册协议')
  }
  if (context.gameState.isDuanXian) {
    throw new Error('录制包含断线重连；浏览器路径会跳过牌堆初始化，无法完整重建本局状态')
  }

  const cardList = requireNumberArray(record.payload.CardList, 'CardList')
  const cardIDs = cardList.filter((cardID) => cardID > 0)
  if (cardIDs.length === 0) throw new Error('MsgGamePlayCardNtf.CardList 为空，无法初始化牌堆')

  context.gameState.isGuoZhan = cardIDs.includes(1150)
  context.gameState.isDouDiZhu = cardIDs.includes(13005)
  context.gameState.isShanHeTu = cardIDs.includes(20100)
  context.gameState.resetConfigHandCards()
  context.controller.initTrackerDeck(cardIDs)
  return applied()
}

function applySetCharacter(
  context: TrackerProtocolReplayContext,
  record: RecordedTrackerProtocol
): ApplyTrackerProtocolResult {
  const room = requireRoom(context, record, '同步武将')
  const infos = record.payload.Infos
  if (!Array.isArray(infos) || infos.length === 0) return ignored('协议未携带武将信息')

  const normalizedInfos = infos.map((item, index) => {
    const info = readRecord(item)
    if (!info) throw new Error(`Infos[${index}] 必须是对象`)
    return info
  })

  if (
    context.gameState.isRecord &&
    context.gameState.myID === undefined &&
    normalizedInfos.length === 1 &&
    (context.gameState.isDouDiZhu || context.gameState.isShanHeTu)
  ) {
    context.controller.setTrackerMySeatID(
      requireObjectInteger(normalizedInfos[0], 'SeatID', 'Infos[0]')
    )
  }

  normalizedInfos.forEach((info, index) => {
    const seatID = requireObjectInteger(info, 'SeatID', `Infos[${index}]`)
    const characterID = requireObjectInteger(info, 'CharacterID', `Infos[${index}]`)
    if (!room.players.has(seatID)) throw new Error(`武将协议引用了未注册座位 ${seatID}`)
    context.gameState.setGeneral(seatID, characterID)
  })
  return applied()
}

function applyGuoZhanSetCharacter(
  context: TrackerProtocolReplayContext,
  record: RecordedTrackerProtocol
): ApplyTrackerProtocolResult {
  const room = requireRoom(context, record, '同步国战武将')
  const seatID = requireInteger(record, 'SeatID')
  if (!room.players.has(seatID)) throw new Error(`国战武将协议引用了未注册座位 ${seatID}`)

  const generalData = record.payload.GeneralData
  if (!Array.isArray(generalData) || generalData.length === 0) {
    return ignored('协议未携带国战武将信息')
  }

  generalData.forEach((item, index) => {
    const data = readRecord(item)
    if (!data) throw new Error(`GeneralData[${index}] 必须是对象`)
    context.gameState.setGeneral(
      seatID,
      requireObjectInteger(data, 'cardID', `GeneralData[${index}]`),
      requireObjectInteger(data, 'index', `GeneralData[${index}]`)
    )
  })
  return applied()
}

function applyTurn(
  context: TrackerProtocolReplayContext,
  record: RecordedTrackerProtocol
): ApplyTrackerProtocolResult {
  const turn = requireInteger(record, 'TurnCnt')
  if (turn <= 0) return ignored('非正数轮次不会推进 GameState')
  context.gameState.setTurn(turn)
  context.controller.scheduleTrackerRender()
  return applied()
}

function applyPhase(
  context: TrackerProtocolReplayContext,
  record: RecordedTrackerProtocol
): ApplyTrackerProtocolResult {
  requireRoom(context, record, '推进阶段')
  context.gameState.enter(requireInteger(record, 'Round'), requireInteger(record, 'SeatID'))
  context.controller.scheduleTrackerRender()
  return applied()
}

function applyUseCardState(
  gameState: GameState,
  payload: Record<string, unknown>
): ApplyTrackerProtocolResult {
  const seatID = readNumber(payload.SeatID)
  if (seatID === undefined || seatID !== gameState.myID) {
    return ignored('非主视角出牌不改变回放核心状态')
  }

  const useType = readNumber(payload.useType)
  const spellID = readNumber(payload.spellID ?? payload.SpellID)
  if (useType === 1 && !isTruthyProtocol(payload.isSend)) {
    if (spellID === 1) gameState.shaCounter()
    if (spellID) gameState.useCounter()
    return applied()
  }

  return ignored('该出牌消息不改变回放核心状态')
}

function applyUseSpellState(
  gameState: GameState,
  record: RecordedTrackerProtocol
): ApplyTrackerProtocolResult {
  const payload = record.payload
  const spellID = requireInteger(record, 'SpellID')
  const cardIDs = optionalNumberArray(payload.CardIDs, 'CardIDs')
  const seatID = readNumber(payload.SeatID)
  const srcSeatID = readNumber(payload.SrcSeatID)
  let didApply = false

  if (recordDuoQiActivation(gameState, payload)) didApply = true

  switch (spellID) {
    case 3090:
      if (seatID === gameState.currentID && readNumber(payload.EffectIndex) === 1) {
        gameState.spellSpace[3090] = Number(gameState.spellSpace[3090] ?? 0) + 1
        didApply = true
      }
      break

    case 3157:
    case 3511:
      if (srcSeatID === gameState.myID && cardIDs.some((cardID) => cardID > 0)) {
        gameState.setSpellState(spellID, cardIDs)
        didApply = true
      }
      break

    case 3193:
    case 3185:
    case 3138:
    case 3161:
      gameState.phase -= 1
      didApply = true
      break

    case 3750:
      if (
        readNumber(payload.EffectIndex) === 2 &&
        optionalArray(payload.DestSeatIDs).length === 0
      ) {
        gameState.setSpellState(3750, cardIDs)
        didApply = true
      }
      break

    default:
      break
  }

  return didApply ? applied() : ignored('该技能使用消息不改变回放核心状态')
}

function applyRoleSpellOpt(
  context: TrackerProtocolReplayContext,
  record: RecordedTrackerProtocol
): ApplyTrackerProtocolResult {
  const payload = record.payload
  const spellID = readNumber(payload.SpellID) ?? 0
  const type = readNumber(payload.Type)
  const datas = optionalNumberArray(payload.Datas, 'Datas')
  let didApply = false

  if (
    type === 72 &&
    context.gameState.isGameStart &&
    datas.length > 0 &&
    !context.gameState.round &&
    !context.gameState.phase
  ) {
    didApply = Boolean(initializeDuoQiState(context.gameState, datas))
  }

  switch (spellID) {
    case 2022:
      requireRoom(context, record, '同步已知武将')
      context.gameState.setGeneral(requireInteger(record, 'SeatID'), datas[0], datas[1], true)
      didApply = true
      break

    case 3659:
      requireReadyRoom(context, record, '揭示手牌')
      context.controller.revealTrackerCardsInZone(
        { id: requireInteger(record, 'SeatID'), zone: 5 },
        datas
      )
      didApply = datas.length > 0
      break

    case 3744:
      if (type !== 73 && datas.length > 0) {
        requireReadyRoom(context, record, '揭示牌堆')
        context.controller.revealTrackerCardsInZone({ id: 255, zone: 1 }, datas)
        didApply = true
      }
      break

    case 3868:
      if (type === 50 && datas.length > 0) {
        requireReadyRoom(context, record, '揭示牌堆')
        context.controller.revealTrackerCardsInZone({ id: 255, zone: 1 }, datas)
        didApply = true
      }
      break

    case 7009:
      if (type === 30 && datas.length > 0) {
        requireReadyRoom(context, record, '揭示牌堆')
        context.controller.revealTrackerCardsInZone({ id: 255, zone: 1 }, datas)
        didApply = true
      }
      break

    case 3336:
      if (type === 50 && datas.length > 0) {
        requireReadyRoom(context, record, '揭示牌底')
        context.controller.revealTrackerCardsInZone(
          { id: 255, zone: 1, pos: POSITION_BOTTOM },
          [...datas].reverse()
        )
        didApply = true
      }
      break

    case 361:
      didApply = handleXiaShuChoice(record.payload, context.gameState)
      break

    default:
      break
  }

  return didApply ? applied() : ignored('该技能回复未携带可重放的记牌状态')
}

function applyRoleOptTarget(
  context: TrackerProtocolReplayContext,
  record: RecordedTrackerProtocol
): ApplyTrackerProtocolResult {
  const spellID = requireInteger(record, 'SpellID')
  const param = readNumber(record.payload.Param)
  const params = optionalNumberArray(record.payload.Params, 'Params')
  const targetSeatID = readNumber(record.payload.targetSeatID)
  const srcSeatID = readNumber(record.payload.SrcSeatID)
  const type = readNumber(record.payload.Type)

  if (FULL_HAND_ROLE_OPT_SPELL_IDS.has(spellID)) {
    if (targetSeatID === undefined || targetSeatID === 255 || params.length === 0) {
      return ignored('全手牌展示协议未携带有效目标或牌面')
    }
    revealPlayerCards(context, record, targetSeatID, params, { fullHand: true })
    return applied()
  }

  if (PARTIAL_HAND_ROLE_OPT_SPELL_IDS.has(spellID)) {
    if (targetSeatID === undefined || targetSeatID === 255 || param !== 0 || params.length === 0) {
      return ignored('部分手牌展示协议未携带有效目标或牌面')
    }
    revealPlayerCards(context, record, targetSeatID, params)
    return applied()
  }

  switch (spellID) {
    case 361:
      return handleXiaShuTargetNotice(record.payload, context.gameState)
        ? applied()
        : ignored('下书目标通知未携带有效目标或展示牌')

    case 943:
      if (param !== 0 || params.length !== 1) return ignored('图南未携带单张牌堆顶')
      revealPileCards(context, record, params)
      return applied()

    case 898:
      if (srcSeatID === undefined || srcSeatID === 255 || param !== 0 || params.length <= 2) {
        return ignored('散文未携带可重放的手牌片段')
      }
      revealPlayerCards(context, record, srcSeatID, params.slice(1, params[0] + 1))
      return applied()

    case 987:
    case 988:
      return applyGuanXu(context, record, param, params, targetSeatID)

    case 3903:
      return applyTianHou(context, record, param, params, targetSeatID, type)

    case 3483:
      return applyJieLi(context, record, param, params, targetSeatID)

    case 2900:
      if (type !== 28 || targetSeatID === undefined) return ignored('国战先驱未进入武将展示分支')
      requireRoom(context, record, '同步国战先驱武将')
      context.gameState.setGeneral(targetSeatID, params[2], params[1], true)
      return applied()

    case 3571:
      return ignored('椒遇目标通知本身不改变当前记牌状态')

    default:
      return ignored('该目标通知分支没有可重放的核心记牌状态')
  }
}

function applyGuanXu(
  context: TrackerProtocolReplayContext,
  record: RecordedTrackerProtocol,
  param: number | undefined,
  params: number[],
  targetSeatID: number | undefined
): ApplyTrackerProtocolResult {
  if (targetSeatID === undefined || param !== 1 || params.length <= 2) {
    return ignored('观虚未携带完整观看结果')
  }

  const pileCount = Number(params[0]) || 0
  const handCount = Number(params[1]) || 0
  if (pileCount > 0) revealPileCards(context, record, params.slice(2, 2 + pileCount))
  if (handCount > 0 && targetSeatID !== 255) {
    revealPlayerCards(
      context,
      record,
      targetSeatID,
      params.slice(2 + pileCount, 2 + pileCount + handCount)
    )
  }
  return applied()
}

function applyTianHou(
  context: TrackerProtocolReplayContext,
  record: RecordedTrackerProtocol,
  param: number | undefined,
  params: number[],
  targetSeatID: number | undefined,
  type: number | undefined
): ApplyTrackerProtocolResult {
  if (targetSeatID !== 255 || param !== 0) return ignored('天候消息不是发动者可见结果')

  if (type === 28 && params.length > 2) {
    const pileCount = Number(params[0]) || 0
    const pileCardIDs = params.slice(2, 2 + pileCount)
    if (pileCount > 0 && pileCardIDs.length === pileCount) {
      revealPileCards(context, record, pileCardIDs)
      return applied()
    }
  }

  if (type === 29 && params.length === 4) {
    revealPileCards(context, record, params.slice(1))
    return applied()
  }

  return ignored('天候消息未携带完整牌堆观看结果')
}

function applyJieLi(
  context: TrackerProtocolReplayContext,
  record: RecordedTrackerProtocol,
  param: number | undefined,
  params: number[],
  targetSeatID: number | undefined
): ApplyTrackerProtocolResult {
  if (targetSeatID === undefined || param !== 1 || params.length === 0) {
    return ignored('诫厉未携带观看结果')
  }

  const room = requireReadyRoom(context, record, '重放诫厉观看结果')
  const pileCount = Number(params[0]) || 0
  const handCount = Number(params[1]) || 0
  if (pileCount > 0) room.getSkillState(3483).expectedPileCount = pileCount
  if (params.length <= 2) return applied()

  if (pileCount > 0) revealPileCards(context, record, params.slice(2, 2 + pileCount))
  if (handCount > 0 && targetSeatID !== 255) {
    const player = room.getPlayer(targetSeatID)
    const localHandCount = room.playerCardsSnapshot.filter(
      (card) => card.subZone === 'hand' && card.seats.has(Number(targetSeatID))
    ).length
    const fullHand = shouldRevealAsFullHand({
      handCount,
      observedHandCount: player?.hasObservedHandCount ? player.observedHandCount : null,
      localHandCount
    })
    revealPlayerCards(
      context,
      record,
      targetSeatID,
      params.slice(2 + pileCount, 2 + pileCount + handCount),
      fullHand ? { fullHand: true } : {}
    )
  }
  return applied()
}

function applyRoleDataEx(
  context: TrackerProtocolReplayContext,
  record: RecordedTrackerProtocol
): ApplyTrackerProtocolResult {
  const dataID = requireInteger(record, 'DataID')
  const datas = optionalNumberArray(record.payload.Datas, 'Datas')

  if (dataID === 8) {
    return recordDuoQiRoleDataTarget(context.gameState, record.payload)
      ? applied()
      : ignored('夺炁目标通知未携带可用状态')
  }

  if (dataID === 3571) {
    if (datas.length === 0) return ignored('椒遇颜色通知未携带颜色')
    context.gameState.setSpellState(3571, new Set(datas[0] === 1 ? [1, 2] : [3, 4]))
    return applied()
  }

  if (dataID === 3709) {
    const cardIDs = parseGuiFuCardIDs(datas)
    if (cardIDs.length === 0) return ignored('3709 身份通知未携带完整 CardIDs')
    const seatID = requireInteger(record, 'SeatID')
    const mySeatID = context.gameState.myID
    if (mySeatID === undefined) {
      throw prerequisiteError(record, '诡伏身份通知需要先确定主视角座位')
    }
    if (seatID === mySeatID) return ignored('主视角已从移动协议获知诡伏牌面')
    requireReadyRoom(context, record, '物化诡伏获得牌')
    const sourceEvent = {
      type: 'role-data-3709' as const,
      label: 'GsCUpdateRoleDataExNtf:3709',
      raw: record.payload
    }
    const settlement = context.controller.settleTrackerPendingDiscardGain(
      seatID,
      cardIDs,
      sourceEvent
    )
    // invalid 表示本条录制无法安全消费当前 FIFO；回放继续保留现场，但不能宣称完整应用。
    if (settlement.result === 'invalid') {
      return partial('3709 身份通知无法与待结算获得牌匹配', { cardIDs, seatIDs: [seatID] })
    }
    // missing 已经推进 3709 快照，必须使用结算返回的差量，不能在此重新查询。
    if (settlement.result === 'missing' && settlement.newCardIDs.length > 0) {
      context.controller.revealTrackerCards(
        {
          type: 'player',
          seatID,
          fromSeatID: seatID,
          fromZone: null,
          fromSubZone: 'hand',
          subZone: 'hand',
          handMoveCount: 0,
          sourceEvent
        },
        settlement.newCardIDs
      )
    }
    return applied()
  }

  if (dataID !== 3544) return ignored('该角色扩展状态不参与核心记牌回放')

  const seatID = requireInteger(record, 'SeatID')
  const mySeatID = context.gameState.myID
  if (mySeatID === undefined) {
    throw prerequisiteError(record, '巧织身份通知需要先确定主视角座位')
  }
  if (seatID === mySeatID) return ignored('主视角已从移动协议获知巧织牌面')

  const cardID = Number(datas[0])
  if (!(cardID > 0)) return ignored('巧织身份通知未携带有效 CardID')
  requireReadyRoom(context, record, '物化巧织暗取牌')
  context.controller.revealTrackerCards(
    {
      type: 'player',
      seatID,
      handMoveCount: 0,
      sourceEvent: {
        type: 'qiaozhi:update-role-data',
        label: 'GsCUpdateRoleDataExNtf:3544',
        raw: record.payload
      }
    },
    [cardID]
  )
  return applied()
}

function applyMoveCard(
  context: TrackerProtocolReplayContext,
  record: RecordedTrackerProtocol
): ApplyTrackerProtocolResult {
  requireReadyRoom(context, record, '同步移动协议')
  const move = readMove(record)
  const notes: string[] = []
  const afterMoveCallbacks: (() => void)[] = []
  const prepared = prepareTrackerMoveCardIDs({
    CardIDs: move.CardIDs,
    CardCount: move.CardCount,
    MoveType: move.MoveType,
    ToZone: move.ToZone,
    SpellID: move.SpellID,
    isSend: isTruthyProtocol(record.payload.isSend)
  })
  if (prepared.shouldReturn) {
    return ignored('与生产处理器一致跳过空移动、无效区或发送侧消息')
  }

  if (prepared.mixedVisibility) {
    notes.push('明暗牌混合已按生产逻辑降级为全暗移动')
  }

  const normalized = normalizeTrackerMovePosition({
    ...move,
    CardIDs: prepared.CardIDs,
    isGuoZhan: context.gameState.isGuoZhan
  })
  const moveContext: ReplayMoveContext = {
    game: context.gameState,
    CardIDs: normalized.CardIDs,
    CardCount: move.CardCount,
    FromID: move.FromID,
    FromZone: move.FromZone,
    FromPosition: normalized.FromPosition,
    ToID: move.ToID,
    ToZone: move.ToZone,
    ToPosition: normalized.ToPosition,
    MoveType: move.MoveType,
    SpellID: move.SpellID,
    SrcSeatID: readNumber(record.payload.SrcSeatID)
  }

  const specialZoneHandled = applySpecialZoneState(moveContext)
  if (!specialZoneHandled) {
    applyGameFlowState(context, record, moveContext)
    const spellNote = applyMoveSpellState(moveContext)
    if (spellNote) notes.push(spellNote)

    if (moveContext.SpellID === 361) {
      // 与生产 PubGsCMoveCard 一致：移动前注册下书副作用，tracker 同步完成后再结算。
      handleXiaShuMove({
        ...moveContext,
        tracker: context.controller,
        afterMove(callback: () => void) {
          afterMoveCallbacks.push(callback)
        }
      })
    }
  }

  if (matchesCardConfigDependentEquipmentMove(moveContext)) {
    notes.push('特殊装备牌随机位置归一化依赖浏览器 CardConfig，本次保留原协议位置')
  }

  context.controller.syncTrackerMove(record.payload as RawMoveCardEvent, {
    CardIDs: moveContext.CardIDs,
    FromPosition: moveContext.FromPosition,
    ToPosition: moveContext.ToPosition
  })
  // 下书需要先看到通用随机转移建立的数量约束，不能在 syncTrackerMove 之前执行。
  afterMoveCallbacks.splice(0).forEach((callback) => callback())

  return notes.length > 0 ? partial(notes.join('；')) : applied()
}

function applySpecialZoneState(context: ReplayMoveContext): boolean {
  if (context.ToZone === 12 || context.FromZone === 12) return true

  if (
    context.SpellID === 3694 &&
    context.FromZone === 0 &&
    context.ToZone === 1 &&
    context.ToPosition === POSITION_TOP + 1 &&
    context.MoveType === 19
  ) {
    context.ToPosition = POSITION_RANDOM
    return true
  }

  if (
    context.FromZone === 0 &&
    context.ToZone === 1 &&
    context.ToPosition === POSITION_TOP &&
    context.MoveType === 19
  ) {
    if (!context.game.isGameStart) context.game.isGameStart = null
    return true
  }

  if (context.FromZone === 2 && context.ToZone === 9 && context.MoveType === 255) {
    context.game.isPassed = false
    return true
  }
  return false
}

function applyGameFlowState(
  replay: TrackerProtocolReplayContext,
  record: RecordedTrackerProtocol,
  context: ReplayMoveContext
): void {
  const game = context.game
  if (
    context.FromZone === 1 &&
    context.MoveType === 19 &&
    context.SpellID === 0 &&
    !game.isGameStart &&
    !game.isPassed
  ) {
    if (game.isPassed === false) game.isPassed = null
    if (game.isGameStart !== null) context.FromPosition = POSITION_RANDOM
  }

  if (context.FromZone !== 1 || context.ToZone !== 5 || context.MoveType !== 1) return

  const faceUpDraw = context.CardIDs.filter((cardID) => cardID > 0).length === context.CardCount
  if (game.isRecord && game.myID === undefined && faceUpDraw) {
    requireRoom(replay, record, '根据录像首次明摸设置主视角')
    replay.controller.setTrackerMySeatID(context.ToID)
  }

  if (!game.isGameStart && !game.isPassed) {
    if (game.isGameStart === null) game.isGameStart = false
    if (faceUpDraw) context.FromPosition = POSITION_RANDOM
  }

  if (game.myID !== undefined && context.ToID === game.myID && game.turn > 0) {
    game.drawCounter(context.CardCount)
  }
}

function applyMoveSpellState(context: ReplayMoveContext): string | null {
  switch (context.SpellID) {
    case 3488:
      applyZuoLianState(context)
      return null

    case 3157:
    case 3511:
      applyKnownDiscardReturnState(context)
      return null

    case 3571:
      return applyJiaoYuState(context)

    case 3750:
      applyQianFuState(context)
      return null

    default:
      return null
  }
}

function applyZuoLianState(context: ReplayMoveContext): void {
  if (context.FromZone === 5 && context.ToZone === 5 && context.MoveType === 21) {
    const positiveIDs = context.CardIDs.filter((cardID) => cardID > 0)
    if (positiveIDs.length === 1) {
      const spellState = context.game.ensureSpellState<Record<string | number, number>>(
        context.SpellID,
        () => ({})
      )
      spellState[context.FromID] = positiveIDs[0]
    }
    return
  }

  if (context.FromZone === 5 && context.ToZone === 10 && context.MoveType === 11) {
    const spellState = context.game.ensureSpellState<Record<string | number, number>>(
      context.SpellID,
      () => ({})
    )
    const knownCardID = context.CardIDs.find((cardID) => cardID > 0)
    const cardID = knownCardID || spellState[context.FromID]
    delete spellState[context.FromID]
    if (!(cardID > 0)) {
      delete spellState.stack
      return
    }
    if (!knownCardID) context.CardIDs[0] = cardID
    spellState.stack = cardID
    return
  }

  if (
    context.FromZone === 10 &&
    (context.ToZone === 1 || context.ToZone === 2) &&
    context.MoveType === 11
  ) {
    const spellState = context.game.getSpellState<Record<string | number, number>>(context.SpellID)
    const cardID = spellState?.stack
    if (!context.CardIDs.some((id) => id > 0) && cardID > 0) context.CardIDs[0] = cardID
    if (spellState) delete spellState.stack
  }
}

function applyKnownDiscardReturnState(context: ReplayMoveContext): void {
  const spellCards = context.game.getSpellState<number[]>(context.SpellID)
  if (
    context.FromZone === 2 &&
    context.ToZone === 5 &&
    context.CardCount === spellCards?.length &&
    context.CardIDs.every((cardID) => cardID <= 0)
  ) {
    spellCards.forEach((cardID, index) => {
      context.CardIDs[index] = cardID
    })
    context.game.deleteSpellState(context.SpellID)
  }
}

function applyQianFuState(context: ReplayMoveContext): void {
  if (
    context.FromZone === 2 &&
    context.ToZone === 1 &&
    context.MoveType === 15 &&
    context.CardIDs.every((cardID) => cardID <= 0)
  ) {
    const spellCards = context.game.getSpellState<number[]>(context.SpellID)
    if (spellCards?.length) context.CardIDs.splice(0, Infinity, ...spellCards)
  }
}

function applyJiaoYuState(context: ReplayMoveContext): string | null {
  if (
    context.FromZone !== 8 ||
    context.ToZone !== 5 ||
    context.MoveType !== 8 ||
    context.CardIDs.some((cardID) => cardID > 0)
  ) {
    return null
  }

  const colors = context.game.getSpellState(context.SpellID)
  if (!(colors instanceof Set) || colors.size === 0) return null

  const markSpellID = Number(context.FromID || context.SpellID)
  const markCards =
    context.game.room
      ?.refreshPlayerSnapshot()
      .filter(
        (card) =>
          card.location === 'player' &&
          card.subZone === 'mark' &&
          Number(card.spellID) === markSpellID &&
          card.isKnown &&
          card.id > 0 &&
          colors.has(card.color)
      ) ?? []
  const spellCardIDs = markCards.map((card) => card.id)
  if (spellCardIDs.length === context.CardCount) {
    context.CardIDs.splice(0, context.CardIDs.length, ...spellCardIDs)
    return null
  }

  return '椒遇颜色推断依赖浏览器 CardConfig；候选不唯一时保留暗牌语义'
}

function matchesCardConfigDependentEquipmentMove(context: ReplayMoveContext): boolean {
  return (
    context.FromZone === 1 &&
    context.FromPosition === POSITION_TOP + 1 &&
    context.ToZone === 5 &&
    context.SpellID === 0 &&
    context.MoveType === 1 &&
    context.CardCount === 4 &&
    context.CardIDs.length === 4
  )
}

function revealPileCards(
  context: TrackerProtocolReplayContext,
  record: RecordedTrackerProtocol,
  cardIDs: number[]
): void {
  requireReadyRoom(context, record, '揭示牌堆牌面')
  context.controller.revealTrackerCards(
    { type: 'public', zoneName: 'pile', reposition: true, cardIDsTopFirst: true },
    cardIDs
  )
}

function revealPlayerCards(
  context: TrackerProtocolReplayContext,
  record: RecordedTrackerProtocol,
  seatID: number,
  cardIDs: number[],
  options: { fullHand?: boolean } = {}
): void {
  requireReadyRoom(context, record, '揭示玩家手牌')
  context.controller.revealTrackerCards({ type: 'player', seatID, ...options }, cardIDs)
}

function readMove(record: RecordedTrackerProtocol) {
  return {
    CardIDs: requireNumberArray(record.payload.CardIDs, 'CardIDs'),
    CardCount: requireInteger(record, 'CardCount'),
    FromID: requireInteger(record, 'FromID'),
    FromZone: requireInteger(record, 'FromZone'),
    FromZoneParam: requireInteger(record, 'FromZoneParam'),
    FromPosition: requireInteger(record, 'FromPosition'),
    ToID: requireInteger(record, 'ToID'),
    ToZone: requireInteger(record, 'ToZone'),
    ToZoneParam: requireInteger(record, 'ToZoneParam'),
    ToPosition: requireInteger(record, 'ToPosition'),
    MoveType: requireInteger(record, 'MoveType'),
    SpellID: requireInteger(record, 'SpellID')
  }
}

function requireRoom(
  context: TrackerProtocolReplayContext,
  record: RecordedTrackerProtocol,
  action: string
): Room {
  const room = context.controller.getTrackerRoom()
  if (room) return room
  throw prerequisiteError(record, `${action}前缺少 decodeGsClientUserSeatFlagNtf`)
}

function requireReadyRoom(
  context: TrackerProtocolReplayContext,
  record: RecordedTrackerProtocol,
  action: string
): Room {
  const room = requireRoom(context, record, action)
  if (room.isDeckReady) return room
  throw prerequisiteError(record, `${action}前缺少 MsgGamePlayCardNtf`)
}

function prerequisiteError(record: RecordedTrackerProtocol, detail: string): Error {
  return new Error(
    `${detail}；录制可能开始过晚，无法可靠重建 seq=${record.seq} ${record.className} 的前置状态。建议开局前开启录制`
  )
}

function requireInteger(record: RecordedTrackerProtocol, field: string): number {
  const value = readNumber(record.payload[field])
  if (value === undefined || !Number.isInteger(value)) {
    throw new Error(`${record.className}.${field} 必须是整数`)
  }
  return value
}

function requireObjectInteger(
  value: Record<string, unknown>,
  field: string,
  label: string
): number {
  const result = readNumber(value[field])
  if (result === undefined || !Number.isInteger(result)) {
    throw new Error(`${label}.${field} 必须是整数`)
  }
  return result
}

function requireNumberArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`)
  return value.map((item, index) => {
    const number = readNumber(item)
    if (number === undefined || !Number.isInteger(number)) {
      throw new Error(`${label}[${index}] 必须是整数`)
    }
    return number
  })
}

function optionalNumberArray(value: unknown, label: string): number[] {
  if (value === undefined || value === null) return []
  return requireNumberArray(value, label)
}

function optionalArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function isTruthyProtocol(value: unknown): boolean {
  return value === true || value === 1 || value === '1'
}

function applied(note?: string): ApplyTrackerProtocolResult {
  return note ? { status: 'applied', note } : { status: 'applied' }
}

function ignored(note: string): ApplyTrackerProtocolResult {
  return { status: 'ignored', note }
}

function partial(
  note: string,
  affected: { cardIDs?: number[]; seatIDs?: number[] } = {}
): ApplyTrackerProtocolResult {
  const result: ApplyTrackerProtocolResult = { status: 'partial', note }
  if (affected.cardIDs?.length) result.affectedCardIDs = affected.cardIDs.slice()
  if (affected.seatIDs?.length) result.affectedSeatIDs = affected.seatIDs.slice()
  return result
}
