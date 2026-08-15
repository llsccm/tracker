const XIA_SHU_SPELL_ID = 361
const XIA_SHU_TAKE_SHOWN = 1
const XIA_SHU_TAKE_HIDDEN = 2

function getXiaShuState(game) {
  const state = game.getSpellState(XIA_SHU_SPELL_ID)
  if (!state || Array.isArray(state) || typeof state !== 'object') return undefined
  return state
}

export function handleXiaShuTargetNotice(msg, game) {
  const { Param, Params, targetSeatID, Type } = msg
  if (Number(Param) !== 0 || Number(Type) !== 29 || !Array.isArray(Params)) return false

  const shownCardIDs = Array.from(new Set(Params.filter((id) => Number(id) > 0).map(Number)))
  const targetSeat = Number(targetSeatID)
  if (!shownCardIDs.length || !Number.isInteger(targetSeat) || targetSeat === 255) return false

  // 该通知同时给出展示牌与真实目标座位；SeatID/SrcSeatID 则都是技能发动者。
  game.setSpellState(XIA_SHU_SPELL_ID, {
    shownCardIDs,
    targetSeatID: targetSeat
  })
  return true
}

function settleXiaShuAfterMove(game, tracker) {
  const state = getXiaShuState(game)
  if (!state) return false
  if (state.choice !== XIA_SHU_TAKE_SHOWN && state.choice !== XIA_SHU_TAKE_HIDDEN) return false

  if (state.choice === XIA_SHU_TAKE_HIDDEN) {
    if (!Number.isInteger(state.targetSeatID) || !state.shownCardIDs?.length) return false
    if (typeof tracker?.revealTrackerCards !== 'function') return false

    // 暗牌转移已经由通用框架建立“目标剩余 / 发动者获得”的 N 选 K 约束。
    // 此处只把展示牌零增量确认在原目标手中：当它们填满目标的剩余手牌槽后，
    // 约束收敛会自动移除其它牌的目标手牌分支。确定暗牌因此落到发动者；
    // 候选槽则随转移获得发动者分支，同时保留原有的其它候选位置。
    tracker.revealTrackerCards(
      {
        type: 'player',
        seatID: state.targetSeatID,
        handMoveCount: 0,
        sourceEvent: {
          type: 'xiaShu:hidden-choice',
          label: '下书选择暗牌，展示牌留在原目标手牌'
        }
      },
      state.shownCardIDs
    )
  }

  game.deleteSpellState(XIA_SHU_SPELL_ID)
  return true
}

export function handleXiaShuChoice(msg, game) {
  const { Datas, SeatID, Type } = msg
  const dataCount = Number(msg.data_count ?? Datas?.length)
  if (Number(Type) !== 22 || dataCount !== 2 || !Array.isArray(Datas)) return false

  const choice = Number(Datas[0])
  if (choice !== XIA_SHU_TAKE_SHOWN && choice !== XIA_SHU_TAKE_HIDDEN) return false

  const state = getXiaShuState(game)
  if (!state) return false

  const actorSeatID = Number(SeatID)
  state.choice = choice
  if (Number.isInteger(actorSeatID) && actorSeatID !== 255) state.actorSeatID = actorSeatID

  // 实测协议顺序固定为选择回复先于后续取牌 PubGsCMoveCard。
  // 这里只记录选择，必须等待通用移动建立数量约束后再结算。
  return true
}

export default function handleXiaShuMove(context) {
  const isHandTransfer =
    context.FromZone == 5 &&
    context.ToZone == 5 &&
    context.FromID != context.ToID &&
    Number(context.CardCount) > 0
  if (!isHandTransfer) return

  const state = getXiaShuState(context.game)
  const targetSeatID = Number(context.FromID)
  const transferSeatID = Number(context.ToID)
  if (!state || state.targetSeatID !== targetSeatID) return
  if (!Number.isInteger(transferSeatID) || transferSeatID === 255) return
  if (Number.isInteger(state.actorSeatID) && state.actorSeatID !== transferSeatID) return
  if (typeof context.afterMove !== 'function') return

  // 必须等待通用移动完成：随机转移约束和双方观测手牌数都在该阶段建立。
  context.afterMove(() => {
    settleXiaShuAfterMove(context.game, context.tracker)
  })
}
