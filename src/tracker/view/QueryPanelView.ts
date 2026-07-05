import { CardConfig } from '@/config'
import { createQueryButton } from './cardButton'
import { CARD_INSTANCE_STATUSES } from '../CardCounter'
import type { CardInstance } from '../CardCounter'
import type { Room } from '../Room'

/**
 * 渲染查询详情面板：按 CardInstance.status 分四组（牌堆/场上/弃牌/销毁），
 * 顺序遵循 CardConfig.cardIDsOrder
 */
export function renderQueryPanel(room: Room, doc: Document): void {
  const div = doc.getElementById('cardTypeDetail')
  if (!div) return
  div.replaceChildren()

  const counter = room.counter
  if (!counter.querySet || counter.querySet.size === 0) return

  const instance = CardConfig.GetInstance()
  const grouped = CARD_INSTANCE_STATUSES.map(() => [] as CardInstance[])
  // cardInstances getter 会刷新状态；这里复用同一快照，避免循环内重复更新。
  const cardInstances = counter.cardInstances

  instance.cardIDsOrder
    .filter((id) => counter.querySet.has(id))
    .forEach((id) => {
      const inst = cardInstances[id]
      if (!inst) return
      grouped[inst.status]?.push(inst)
    })

  grouped.forEach((insts, index) => {
    const status = CARD_INSTANCE_STATUSES[index]
    insts.forEach((inst) => {
      div.appendChild(createQueryButton(doc, inst, status, room))
    })
  })
}
