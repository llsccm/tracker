import { describe, expect, it } from 'vitest'
import { createTestRoom } from './helpers/room'

describe('命名交换批次', () => {
  it('批次间重排只改变成员视图，离区成员过滤且销毁释放引用', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3] })
    const [a, b, c] = room.zones.get('pile')!.cards
    const first = room.publicZones.getExchangeBatch('skill:pile')
    const second = room.publicZones.getExchangeBatch('skill:hand')
    first.stage([a, b])
    second.stage([c])
    expect(first.cards).toEqual([])
    room.zones.get('exchange')!.add([a, b, c])
    const original = [...room.zones.get('exchange')!.cards]
    expect(first.transferTo(second, [b], 0)).toBe(true)
    expect(first.cards).toEqual([a])
    expect(second.cards).toEqual([b, c])
    expect(room.zones.get('exchange')!.cards).toEqual(original)
    room.zones.get('discard')!.add([b])
    expect(second.cards).toEqual([c])
    room.zones.get('exchange')!.completeExchangeMove()
    room.zones.get('exchange')!.add([b])
    expect(second.cards).toEqual([c])
    room.destroy()
    expect(first.cards).toEqual([])
    expect(second.cards).toEqual([])
  })

  it('候选引用与物理槽分开，不把另一个批次的实体当作来源', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [1] })
    const [a, b] = room.zones.get('pile')!.cards
    const batch = room.publicZones.getExchangeBatch('121:1:1')
    batch.stage([a])
    a.setLocationCandidates([{ type: 'outside', zone: 'exchange', batchID: batch.key }])
    room.zones.get('exchange')!.add([b])
    expect(batch.cards).toEqual([])
    expect(batch.candidateCards).toEqual([a])
    room.publicZones.deleteExchangeBatch(batch.key)
    expect(batch.candidateCards).toEqual([])
  })
})
