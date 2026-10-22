import type { CardID } from '@/tracker/types'
import type { Room } from '../Room'
import type { PatchedMoveCardFields } from '../types'
import type { SkillUseSpellMessage } from './protocolEvents'

export function recordShengMo(room: Room, msg: SkillUseSpellMessage): void {
  if (room.mySeatID === undefined || msg.SeatID === room.mySeatID) return
  room.setSkillState(3434, [...(msg.CardIDs ?? [])])
}

export default function handleShengMo(patched: PatchedMoveCardFields, room: Room): void {
  const spellCards = room.readSkillState<CardID[]>(patched.SpellID)

  if (
    patched.FromZone == 2 &&
    patched.ToZone == 5 &&
    patched.MoveType == 15 &&
    patched.CardCount == spellCards?.length &&
    patched.CardIDs.filter((id) => id > 0).length == 0
  ) {
    patched.CardIDs = [...spellCards]
    room.deleteSkillState(patched.SpellID)
  }
}
