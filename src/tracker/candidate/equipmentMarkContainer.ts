// 装备附属标记容器注册表：关联装备实体与标记空间；空间迁移以 mark 协议为准。
// 当前只有木牛流马：装备牌 161 承载标记空间 700；后续新增同类装备只扩展这里。
import type { CardID, ContainerLocationCandidate, SpellID } from '../types'

export interface EquipmentMarkContainer {
  equipmentCardID: CardID
  markSpellID: SpellID
}

const EQUIPMENT_MARK_CONTAINERS: EquipmentMarkContainer[] = [
  { equipmentCardID: 161, markSpellID: 700 }
]

const EQUIPMENT_MARK_CONTAINER_BY_MARK_SPELL_ID = new Map(
  EQUIPMENT_MARK_CONTAINERS.map((container) => [container.markSpellID, container])
)

export function getEquipmentMarkContainerByMarkSpellID(
  spellID: unknown
): EquipmentMarkContainer | null {
  const markID = Number(spellID)
  if (!Number.isFinite(markID)) return null

  return EQUIPMENT_MARK_CONTAINER_BY_MARK_SPELL_ID.get(markID) ?? null
}

export function createEquipmentContainerLocationCandidate(
  spellID: unknown
): ContainerLocationCandidate | null {
  // container 候选固定在装备物理牌上，mark 空间迁座不改变候选 key。
  const container = getEquipmentMarkContainerByMarkSpellID(spellID)
  if (!container) return null

  return {
    type: 'container',
    containerType: 'equipment',
    cardID: container.equipmentCardID,
    spellID: container.markSpellID
  }
}
