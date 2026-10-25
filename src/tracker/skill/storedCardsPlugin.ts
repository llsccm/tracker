import type { Room } from '../Room'
import type { RoomSkillPlugin } from '../room/index'
import type { PatchedMoveCardFields, SpellID } from '../types'
import type { SkillUseSpellMessage } from './protocolEvents'

interface StoredCardsPluginOptions {
  id: string
  spellIDs: readonly SpellID[]
  prepare: (patched: PatchedMoveCardFields, room: Room) => void
  record: (room: Room, msg: SkillUseSpellMessage) => void
}

/** 这些技能共享“技能公开牌列表 -> 下一条暗移动补全”的两段契约。 */
export function defineStoredCardsPlugin({
  id,
  spellIDs,
  prepare,
  record
}: StoredCardsPluginOptions): RoomSkillPlugin {
  return {
    id,
    spellIDs,
    beforeNormalizeMove: (patched, raw, room) => prepare(patched, room),
    onProtocolEvent(event, room) {
      // 非移动协议广播给全部插件，仍需按技能 ID 过滤。
      if (event.type === 'useSpell' && spellIDs.includes(event.message.SpellID))
        record(room, event.message)
    },
    onDeckInitialized: (room) => spellIDs.forEach((spellID) => room.deleteSkillState(spellID))
  }
}

export function recordSharedCardIDs(room: Room, msg: SkillUseSpellMessage): void {
  if (room.mySeatID === undefined || msg.SeatID === room.mySeatID) return
  if (msg.dest_Count === 1 && msg.DestSeatIDs?.[0] === room.mySeatID) return
  if (msg.CardIDs && msg.CardIDs.length === msg.card_count) {
    room.setSkillState(msg.SpellID, [...msg.CardIDs])
  }
}
