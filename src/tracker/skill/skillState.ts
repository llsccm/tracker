import type { Room } from '../Room'

/** 只绑定类型和 key；状态仍由当前 Room 的 GameState 持有，不在模块中缓存。 */
export function defineSkillState<T>(
  key: string | number,
  dispose?: (room: Room, state: T) => void
) {
  return {
    read(room: Room): T | undefined {
      return room.readSkillState<T>(key)
    },
    ensure(room: Room, create: () => T): T {
      return room.ensureSkillState(key, create)
    },
    set(room: Room, state: T): void {
      room.setSkillState(key, state)
    },
    clear(room: Room): void {
      const state = room.readSkillState<T>(key)
      if (state !== undefined) dispose?.(room, state)
      room.deleteSkillState(key)
    }
  }
}

/** 删除某个技能分账；仅在所有 SpellID 都结算后释放共享状态。 */
export function deleteSpellState(room: Room, key: string | number, spellID: number): void {
  const state = room.readSkillState<{ bySpell: Record<string, unknown> }>(key)
  if (!state) return
  delete state.bySpell[String(spellID)]
  if (Object.keys(state.bySpell).length === 0) room.deleteSkillState(key)
}
