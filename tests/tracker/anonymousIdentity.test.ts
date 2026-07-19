import { describe, expect, it, vi } from 'vitest'
import { Card, hasRealIdentity, isAnonymous } from '@/tracker/Card'
import { trackerLogger } from '@/utils/logger'
import { createTestRoom, getCard } from './helpers/room'

describe('阶段 0 匿名身份与守恒观测', () => {
  it('匿名占位使用唯一负 ID 且不进入真实身份索引', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1] })

    const placeholders = room.createExternalCards([], 3)
    const anonymousIDs = placeholders.map((card) => card.id)

    expect(placeholders.every(isAnonymous)).toBe(true)
    expect(placeholders.every((card) => card.id === card.entityID && card.id < 0)).toBe(true)
    expect(new Set(anonymousIDs).size).toBe(placeholders.length)
    expect(placeholders.every((card) => !room.cardIndex.has(card.id))).toBe(true)
    expect(hasRealIdentity(getCard(room, 1))).toBe(true)
    expect(isAnonymous(getCard(room, 1))).toBe(false)
  })

  it('健康房间的守恒观测不告警', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1] })
    const warnSpy = vi.spyOn(trackerLogger, 'warn').mockImplementation(() => {})

    room.assertConservation('test:healthy')

    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('重复真实身份只告警不抛错', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1] })
    const duplicate = new Card(1, room)
    room.cards.push(duplicate)
    room.zones.get('outside')!.add(duplicate)
    const warnSpy = vi.spyOn(trackerLogger, 'warn').mockImplementation(() => {})

    expect(() => room.assertConservation('test:duplicated-identity')).not.toThrow()

    const warning = warnSpy.mock.calls.find(
      ([message]) => message === 'Room 身份/槽位守恒观测发现不一致'
    )
    expect(warning).toBeDefined()
    expect(warning?.[1]).toEqual(
      expect.objectContaining({
        context: 'test:duplicated-identity',
        issues: expect.arrayContaining([
          expect.objectContaining({ domain: 'identity', type: 'duplicated-real-id', cardID: 1 })
        ])
      })
    )
    warnSpy.mockRestore()
  })

  it('公共区槽位与实体位置错配时只告警不抛错', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1] })
    const card = getCard(room, 1)
    card.location = 'discard'
    const warnSpy = vi.spyOn(trackerLogger, 'warn').mockImplementation(() => {})

    expect(() => room.assertConservation('test:slot-mismatch')).not.toThrow()

    const warning = warnSpy.mock.calls.find(
      ([message]) => message === 'Room 身份/槽位守恒观测发现不一致'
    )
    expect(warning?.[1]).toEqual(
      expect.objectContaining({
        context: 'test:slot-mismatch',
        issues: expect.arrayContaining([
          expect.objectContaining({ domain: 'slot', type: 'zone-card-location-mismatch' })
        ])
      })
    )
    warnSpy.mockRestore()
  })

  it('resolveConstraints 尾部自动运行守恒观测', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1] })
    const assertSpy = vi.spyOn(room, 'assertConservation')

    room.resolveConstraints()

    expect(assertSpy).toHaveBeenCalledWith('resolveConstraints')
    assertSpy.mockRestore()
  })
})
