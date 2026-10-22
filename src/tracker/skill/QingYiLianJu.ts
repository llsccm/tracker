import type { CardID } from '@/tracker/types'
import type { Room } from '../Room'
import type { PatchedMoveCardFields } from '../types'
import type { SkillUseSpellMessage } from './protocolEvents'

export function recordSharedCardIDs(room: Room, msg: SkillUseSpellMessage): void {
  if (room.mySeatID === undefined || msg.SeatID === room.mySeatID) return
  if (msg.dest_Count === 1 && msg.DestSeatIDs?.[0] === room.mySeatID) return
  if (msg.CardIDs?.length === msg.card_count) {
    room.setSkillState(msg.SpellID, [...msg.CardIDs])
  }
}

export default function handleQingYiLianJu(patched: PatchedMoveCardFields, room: Room): void {
  const spellCards = room.readSkillState<CardID[]>(patched.SpellID)
  if (
    patched.FromZone == 2 &&
    patched.ToZone == 5 &&
    patched.CardCount == spellCards?.length &&
    patched.CardIDs.filter((id) => id > 0).length == 0
  ) {
    spellCards.forEach((id, i) => {
      patched.CardIDs[i] = id
    })
    room.deleteSkillState(patched.SpellID)
  }
}
