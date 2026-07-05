import { CardConfig } from '@/config'
import { n2N } from '@/utils'
import { CARD_INSTANCE_STATUS } from '../CardCounter'
import type { Room } from '../Room'
import type { CardID } from '../types'

const COLOR_MAP = ['', 'heart', 'diamond', 'spade', 'club', 'hongsha', 'heisha']
type QueryCallback = (dimension: string, key: string | number) => void

/**
 * 一次性生成统计面板的 cardType 按钮（牌名按类型分到 type1~type3，点数分到 type4）
 * onclick 调用 onQuery 触发查询面板渲染
 */
export function buildCardTypeButtons(room: Room, doc: Document, onQuery: QueryCallback): void {
  const counter = room.counter
  const instance = CardConfig.GetInstance()

  for (const id of [1, 2, 3, 4]) {
    doc.getElementById('type' + id)?.replaceChildren()
  }

  for (const name of Object.keys(counter.nameIndex)) {
    const ids = counter.nameIndex[name]
    if (!ids || !ids.size) continue
    const sampleId = [...ids][0]
    const type = instance.getCard(sampleId)?.type ?? 1
    const container = doc.getElementById('type' + type)
    if (!container) continue

    const button = doc.createElement('button')
    button.id = name
    button.className = 'cardType'
    button.textContent = name
    button.onclick = () => onQuery('nameIndex', name)
    container.appendChild(button)
  }

  const numberContainer = doc.getElementById('type4')
  for (let number = 0; number < counter.numberIndex.length; number++) {
    const set = counter.numberIndex[number]
    if (!set || !set.size) continue
    if (!numberContainer) break

    const button = doc.createElement('button')
    button.id = 'number' + number
    button.className = 'cardType'
    button.textContent = number === 0 ? '闪电牌' : n2N(number)
    button.onclick = () => onQuery('numberIndex', number)
    numberContainer.appendChild(button)
  }
}

/**
 * 全量刷新统计面板计数：牌名/点数/花色按牌堆剩余量更新 DOM
 * 口径对齐旧版 CardCounterView.resetStatistics
 */
export function renderStatistics(room: Room, doc: Document): void {
  const counter = room.counter

  const pileSet = counter.statusIndex[CARD_INSTANCE_STATUS.UNKNOWN]

  for (const name of Object.keys(counter.nameIndex)) {
    const n = countInSet(counter.nameIndex[name], pileSet)
    const lb = doc.getElementById(name)
    if (!lb) continue
    lb.textContent = n > 1 ? n + name : name
    lb.className = n > 0 ? 'cardType active' : 'cardType inactive'
  }

  for (let number = 0; number < counter.numberIndex.length; number++) {
    const set = counter.numberIndex[number]
    if (!set || !set.size) continue
    const n = countInSet(set, pileSet)
    const lb = doc.getElementById('number' + number)
    if (!lb) continue
    const numText = number === 0 ? '电' : n2N(number)
    lb.textContent = n > 1 ? `${numText}*${n}` : numText
    lb.className = n > 0 ? 'cardType active' : 'cardType inactive'
  }

  for (let c = 1; c <= 6; c++) {
    const set = counter.colorIndex[c]
    if (!set) continue
    const n = countInSet(set, pileSet)
    const lb = doc.getElementById(COLOR_MAP[c])
    if (!lb) continue
    lb.innerHTML = lb.innerHTML.replace(/-?\d+/, String(n))
  }
}

/** 统计某倒排索引集中、当前位于牌堆的卡牌数量 */
function countInSet(set: Set<CardID>, target: Set<CardID>): number {
  let n = 0
  for (const id of set) if (target.has(id)) n++
  return n
}
