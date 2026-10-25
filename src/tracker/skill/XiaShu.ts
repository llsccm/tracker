import type { Room } from '../Room'
import type { RoomSkillPlugin } from '../room/moveEvents'
import type { CardID, NormalizedMoveEvent, SeatID } from '../types'
import type { SkillChoiceMessage, SkillTargetNotice } from './protocolEvents'

interface XiaShuState {
  shownCardIDs: CardID[]
  targetSeatID: SeatID
  choice?: 1 | 2
  actorSeatID?: SeatID
}

const XIA_SHU_SPELL_ID = 361

export function handleXiaShuTargetNotice(room: Room, msg: SkillTargetNotice): boolean {
  const shownCardIDs = msg.Params.filter((id) => id > 0)
  const targetSeatID = msg.targetSeatID
  if (!shownCardIDs.length || targetSeatID == null || targetSeatID === 255) return false
  room.setSkillState<XiaShuState>(XIA_SHU_SPELL_ID, { shownCardIDs, targetSeatID })
  return true
}

export function handleXiaShuChoice(room: Room, msg: SkillChoiceMessage): boolean {
  const choice = msg.Datas[0]
  if (choice !== 1 && choice !== 2) return false
  const state = room.readSkillState<XiaShuState>(XIA_SHU_SPELL_ID)
  if (!state) return false
  state.choice = choice
  if (msg.SeatID != null && msg.SeatID !== 255) state.actorSeatID = msg.SeatID
  return true
}

export function settleXiaShuAfterMove(event: NormalizedMoveEvent, room: Room): void {
  const state = room.readSkillState<XiaShuState>(XIA_SHU_SPELL_ID)
  if (!state || (state.choice !== 1 && state.choice !== 2)) return
  const { from, to } = event
  if (
    event.type === 'showCards' ||
    event.type === 'noop' ||
    from.type !== 'player' ||
    to.type !== 'player' ||
    from.subZone !== 'hand' ||
    to.subZone !== 'hand' ||
    event.cardCount <= 0 ||
    from.seatID !== state.targetSeatID ||
    to.seatID === 255 ||
    (state.actorSeatID != null && state.actorSeatID !== to.seatID)
  )
    return

  if (state.choice === 2) {
    // 通用转移已建立 N 选 K 约束；零增量确认展示牌留在目标手中，再让约束收敛。
    const completed = room.moveCards(state.shownCardIDs, {
      from: { type: 'player', seatID: state.targetSeatID, subZone: 'hand' },
      to: { type: 'player', seatID: state.targetSeatID, subZone: 'hand' },
      cardCount: state.shownCardIDs.length,
      handMoveCount: 0,
      sourceEvent: {
        type: 'xiaShu:hidden-choice',
        label: '下书选择暗牌，展示牌留在原目标手牌'
      }
    })
    if (!completed) return
    room.applyPileIdentityReveal(state.shownCardIDs)
    room.notifyCardsRevealed(state.shownCardIDs)
  }
  room.deleteSkillState(XIA_SHU_SPELL_ID)
}

export const xiaShuPlugin: RoomSkillPlugin = {
  id: 'xiaShu',
  spellIDs: [XIA_SHU_SPELL_ID],
  afterMoveCommitted: settleXiaShuAfterMove,
  onProtocolEvent(event, room) {
    const msg = event.message
    if (!('SpellID' in msg) || msg.SpellID !== XIA_SHU_SPELL_ID) return
    if (event.type === 'targetNotice') {
      const notice = event.message
      if (notice.Param === 0 && notice.Type === 29 && notice.Params?.length) {
        handleXiaShuTargetNotice(room, notice)
      }
    }
    if (
      event.type === 'choice' &&
      event.message.Type === 22 &&
      event.message.data_count === 2 &&
      event.message.Datas
    ) {
      handleXiaShuChoice(room, event.message)
    }
  },
  onDeckInitialized: (room) => room.deleteSkillState(XIA_SHU_SPELL_ID)
}
