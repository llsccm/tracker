import type { Room } from '../Room'
import type { CardID, PatchedMoveCardFields } from '../types'
import type { SkillUseSpellMessage } from './protocolEvents'
import { defineStoredCardsPlugin } from './storedCardsPlugin'

export const qianFuPlugin = defineStoredCardsPlugin({
  id: 'qianFu',
  spellIDs: [3750],
  prepare: handleQianFu,
  record: recordQianFu
})

function recordQianFu(room: Room, msg: SkillUseSpellMessage): void {
  if (msg.EffectIndex === 2 && !msg.DestSeatIDs?.length) {
    room.setSkillState(msg.SpellID, [...(msg.CardIDs ?? [])])
  }
}

function handleQianFu(patched: PatchedMoveCardFields, room: Room): void {
  const spellCards = room.readSkillState<CardID[]>(patched.SpellID)

  if (
    patched.FromZone == 2 &&
    patched.ToZone == 1 &&
    patched.MoveType == 15 &&
    patched.CardCount == spellCards?.length &&
    patched.CardIDs.filter((id) => id > 0).length == 0
  ) {
    patched.CardIDs = [...spellCards]
    room.deleteSkillState(patched.SpellID)
  }
}
