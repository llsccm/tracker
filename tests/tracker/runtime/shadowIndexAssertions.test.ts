import { afterEach, describe, expect, it, vi } from 'vitest'
import { CardLocationIndex } from '@/tracker/projection/CardLocationIndex'
import { AmbiguousKnownIndex } from '@/tracker/projection/AmbiguousKnownIndex'
import { createTestRoom } from '../helpers/room'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function createRoomWithDebugAssert(search = '') {
  vi.stubGlobal('location', { search })
  return createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1, 2] }).room
}

function spyOnIndexRebuilds() {
  return {
    locationIndex: vi.spyOn(CardLocationIndex.prototype, 'rebuild'),
    ambiguousKnownIndex: vi.spyOn(AmbiguousKnownIndex.prototype, 'rebuild')
  }
}

// 主索引初始化也使用 record:false；影子检查使用独立的索引实例。
function getShadowRebuildCounts(
  rebuilds: ReturnType<typeof spyOnIndexRebuilds>,
  room: ReturnType<typeof createRoomWithDebugAssert>
) {
  return {
    locationIndex: rebuilds.locationIndex.mock.contexts.filter(
      (instance) => instance !== room.locationIndex
    ).length,
    ambiguousKnownIndex: rebuilds.ambiguousKnownIndex.mock.contexts.filter(
      (instance) => instance !== room.ambiguousKnownIndex
    ).length
  }
}

describe('Room DEV 影子索引断言门控', () => {
  it('默认在首次及每 32 次收敛时成对抽样', () => {
    const room = createRoomWithDebugAssert()
    const rebuilds = spyOnIndexRebuilds()

    for (let index = 0; index < 31; index += 1) room.resolveConstraints()
    expect(getShadowRebuildCounts(rebuilds, room)).toEqual({
      locationIndex: 1,
      ambiguousKnownIndex: 1
    })

    room.resolveConstraints()
    expect(getShadowRebuildCounts(rebuilds, room)).toEqual({
      locationIndex: 2,
      ambiguousKnownIndex: 2
    })
  })

  it('debugAssert=1 时每次收敛都成对检查', () => {
    const room = createRoomWithDebugAssert('?debugAssert=1')
    const rebuilds = spyOnIndexRebuilds()

    room.resolveConstraints()
    room.resolveConstraints()
    room.resolveConstraints()

    expect(getShadowRebuildCounts(rebuilds, room)).toEqual({
      locationIndex: 3,
      ambiguousKnownIndex: 3
    })
  })

  it('debugAssert=0 时关闭收敛尾部的影子索引检查', () => {
    const room = createRoomWithDebugAssert('?debugAssert=0')
    const rebuilds = spyOnIndexRebuilds()

    room.resolveConstraints()
    room.resolveConstraints()

    expect(getShadowRebuildCounts(rebuilds, room)).toEqual({
      locationIndex: 0,
      ambiguousKnownIndex: 0
    })
  })

  it('重新初始化牌堆后从首次抽样重新计数', () => {
    const room = createRoomWithDebugAssert()
    const rebuilds = spyOnIndexRebuilds()

    room.resolveConstraints()
    room.resolveConstraints()
    room.initDeck([1, 2, 3])
    room.resolveConstraints()

    expect(getShadowRebuildCounts(rebuilds, room)).toEqual({
      locationIndex: 2,
      ambiguousKnownIndex: 2
    })
  })
})
