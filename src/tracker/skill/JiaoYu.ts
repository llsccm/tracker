import type { Room } from '../Room'
import type { PatchedMoveCardFields } from '../types'
import type { SkillRoleDataMessage } from './protocolEvents'

export function recordJiaoYu(room: Room, msg: SkillRoleDataMessage): void {
  if (msg.Datas) room.setSkillState(3571, new Set(msg.Datas[0] === 1 ? [1, 2] : [3, 4]))
}

export default function handleJiaoYu(patched: PatchedMoveCardFields, room: Room): void {
  if (
    patched.FromZone != 8 ||
    patched.ToZone != 5 ||
    patched.MoveType != 8 ||
    patched.CardIDs.some((id) => id > 0)
  ) {
    return
  }

  const colors = room.readSkillState<Set<number>>(patched.SpellID)
  if (!(colors instanceof Set) || colors.size == 0) return

  const markSpellID = patched.FromID || patched.SpellID
  const markCards =
    room
      .refreshPlayerSnapshot()
      .filter(
        (card) =>
          card.location === 'player' &&
          card.subZone === 'mark' &&
          card.spellID === markSpellID &&
          card.isKnown === true &&
          card.id > 0 &&
          colors.has(card.color)
      ) ?? []
  const spellCardIDs = markCards.map((card) => card.id)

  // 同色候选数与协议张数不一致时无法唯一确认，保留暗牌语义交给 tracker 收敛。
  if (spellCardIDs.length != patched.CardCount) return
  patched.CardIDs.splice(0, patched.CardIDs.length, ...spellCardIDs)
}
