import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestRoom } from './helpers/room'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function createRoomWithDebugAssert(search = '') {
  vi.stubGlobal('location', { search })
  return createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1, 2] }).room
}

function spyOnShadowIndexAssertions(room: ReturnType<typeof createRoomWithDebugAssert>) {
  const locationIndex = vi
    .spyOn(room, 'assertLocationIndexConsistency')
    .mockImplementation(() => undefined)
  const ambiguousKnownIndex = vi
    .spyOn(room, 'assertAmbiguousKnownIndexConsistency')
    .mockImplementation(() => undefined)

  return { locationIndex, ambiguousKnownIndex }
}

describe('Room DEV 影子索引断言门控', () => {
  it('默认在首次及每 32 次收敛时成对抽样', () => {
    const room = createRoomWithDebugAssert()
    const assertions = spyOnShadowIndexAssertions(room)

    for (let index = 0; index < 31; index += 1) room.resolveConstraints()
    expect(assertions.locationIndex).toHaveBeenCalledTimes(1)
    expect(assertions.ambiguousKnownIndex).toHaveBeenCalledTimes(1)

    room.resolveConstraints()
    expect(assertions.locationIndex).toHaveBeenCalledTimes(2)
    expect(assertions.ambiguousKnownIndex).toHaveBeenCalledTimes(2)
  })

  it('debugAssert=1 时每次收敛都成对检查', () => {
    const room = createRoomWithDebugAssert('?debugAssert=1')
    const assertions = spyOnShadowIndexAssertions(room)

    room.resolveConstraints()
    room.resolveConstraints()
    room.resolveConstraints()

    expect(assertions.locationIndex).toHaveBeenCalledTimes(3)
    expect(assertions.ambiguousKnownIndex).toHaveBeenCalledTimes(3)
  })

  it('debugAssert=0 时关闭收敛尾部的影子索引检查', () => {
    const room = createRoomWithDebugAssert('?debugAssert=0')
    const assertions = spyOnShadowIndexAssertions(room)

    room.resolveConstraints()
    room.resolveConstraints()

    expect(assertions.locationIndex).not.toHaveBeenCalled()
    expect(assertions.ambiguousKnownIndex).not.toHaveBeenCalled()
  })

  it('重新初始化牌堆后从首次抽样重新计数', () => {
    const room = createRoomWithDebugAssert()
    const assertions = spyOnShadowIndexAssertions(room)

    room.resolveConstraints()
    room.resolveConstraints()
    room.initDeck([1, 2, 3])
    room.resolveConstraints()

    expect(assertions.locationIndex).toHaveBeenCalledTimes(2)
    expect(assertions.ambiguousKnownIndex).toHaveBeenCalledTimes(2)
  })
})
