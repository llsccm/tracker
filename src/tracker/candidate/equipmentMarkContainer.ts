// 装备附属标记容器注册表：把“装备实体牌”和“随装备移动的标记空间”绑定。
// 当前只有木牛流马：装备牌 161 承载标记空间 700；后续新增同类装备只扩展这里。
import type { CardID, ContainerLocationCandidate, SpellID } from '../types'

export interface EquipmentMarkContainer {
  equipmentCardID: CardID
  markSpellID: SpellID
}

interface EquipmentMarkContainerMoveInput {
  equipmentCardID?: CardID | string | null
  spellID?: SpellID | string | null
  previousSpellID?: SpellID | string | null
}

const EQUIPMENT_MARK_CONTAINERS: EquipmentMarkContainer[] = [
  { equipmentCardID: 161, markSpellID: 700 }
]

const EQUIPMENT_MARK_CONTAINER_BY_EQUIPMENT_ID = new Map(
  EQUIPMENT_MARK_CONTAINERS.map((container) => [container.equipmentCardID, container])
)
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

export function getEquipmentMarkContainerByEquipmentCardID(
  cardID: unknown
): EquipmentMarkContainer | null {
  const equipmentCardID = Number(cardID)
  if (!Number.isFinite(equipmentCardID)) return null

  return EQUIPMENT_MARK_CONTAINER_BY_EQUIPMENT_ID.get(equipmentCardID) ?? null
}

export function getEquipmentMarkContainerForMove({
  equipmentCardID,
  spellID,
  previousSpellID
}: EquipmentMarkContainerMoveInput = {}): EquipmentMarkContainer | null {
  // 移动协议可能带旧标记空间、当前协议 spellID，或只暴露装备实体牌 ID。
  const markIDCandidates = [previousSpellID, spellID]

  for (const markID of markIDCandidates) {
    const container = getEquipmentMarkContainerByMarkSpellID(markID)
    if (container) return container
  }

  return getEquipmentMarkContainerByEquipmentCardID(equipmentCardID)
}

export function createEquipmentContainerLocationCandidate(
  spellID: unknown
): ContainerLocationCandidate | null {
  // container 候选固定在装备物理牌上，装备换座时只更新投影，不改候选 key。
  const container = getEquipmentMarkContainerByMarkSpellID(spellID)
  if (!container) return null

  return {
    type: 'container',
    containerType: 'equipment',
    cardID: container.equipmentCardID,
    spellID: container.markSpellID
  }
}
