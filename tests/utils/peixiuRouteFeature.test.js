import { describe, expect, it } from 'vitest'
import {
  PEIXIU_DIRECTIONS,
  PeiXiuMapState,
  findPeiXiuOptimalRoutes,
  getPeiXiuMove,
  parsePeiXiuMap,
  parsePeiXiuRoleData,
  solvePeiXiuRoleData
} from '@/utils/peixiuRouteFeature'
import { buildPeiXiuMapViewModel } from '@/ui/PeiXiuMapWindow'

const YONG_ZHOU = {
  cellID: '12',
  name: '雍州',
  cell: '1,6,7,12,14,15,17,18,19,22,23,24',
  precell: '18',
  spcell: '24,3,1,2|15,1,2|17,1,1|7,2,1',
  reward: '26,73|7,54|15,52|17,53|24,51'
}

describe('裴秀地图数据层', () => {
  it('解析 5x5 有效格、起始格和地图自身奖励', () => {
    const map = parsePeiXiuMap(YONG_ZHOU)

    expect(map.id).toBe('12')
    expect([...map.cells]).toEqual([1, 6, 7, 12, 14, 15, 17, 18, 19, 22, 23, 24])
    expect(map.start).toBe(18)
    expect(map.mapReward).toMatchObject({ rawCell: 26, rewardId: 73 })
    expect(map.rewardCells).toEqual([7, 15, 17, 24])
  })

  it('四种花色使用固定方向，并移动到连续可走区域的端点', () => {
    const map = parsePeiXiuMap(YONG_ZHOU)

    expect(PEIXIU_DIRECTIONS[1].name).toBe('红桃')
    expect(PEIXIU_DIRECTIONS[1].shortDirection).toBe('左')
    expect(PEIXIU_DIRECTIONS[2].name).toBe('方块')
    expect(PEIXIU_DIRECTIONS[3].name).toBe('黑桃')
    expect(PEIXIU_DIRECTIONS[4].name).toBe('梅花')
    expect(getPeiXiuMove(map, 18, 1)).toMatchObject({ from: 18, to: 17, line: [17] })
    expect(getPeiXiuMove(map, 18, 2)).toBeNull()
    expect(getPeiXiuMove(map, 18, 3)).toMatchObject({ from: 18, to: 19, line: [19] })
    expect(getPeiXiuMove(map, 18, 4)).toMatchObject({ from: 18, to: 23, line: [23] })
    expect(getPeiXiuMove(map, 19, 1)).toMatchObject({
      from: 19,
      to: 17,
      line: [18, 17]
    })
  })

  it('维护当前位置、经过格和已获得的格子奖励', () => {
    const state = new PeiXiuMapState(YONG_ZHOU)

    expect(state.currentCell).toBe(18)
    expect(state.availableDirections).toEqual([1, 3, 4])
    expect(state.mapReward).toMatchObject({ rewardId: 73 })

    const step = state.move(1)

    expect(step).toMatchObject({ from: 18, to: 17 })
    expect(state.currentCell).toBe(17)
    expect([...state.visitedCells]).toEqual([18, 17])
    expect([...state.collectedRewardCells]).toEqual([17])
    expect(state.collectedRewards.map((reward) => reward.rewardId)).toEqual([73, 53])
  })

  it('到达 3 号效果格后按配置方向强制移动指定格数', () => {
    const map = parsePeiXiuMap(YONG_ZHOU)

    const step = getPeiXiuMove(map, 22, 3)

    expect(step).toMatchObject({
      from: 22,
      to: 22,
      line: [23, 24],
      specialMoves: [
        {
          from: 24,
          to: 22,
          dir: 1,
          steps: 2,
          path: [23, 22]
        }
      ]
    })
  })

  it('解析 4022 地图状态并从当前位置计算剩余最优路径', () => {
    const datas = [12, 22, 6, 19, 14, 15, 24, 23, 22, 0]

    expect(parsePeiXiuRoleData(datas)).toEqual({
      mapId: 12,
      currentCell: 22,
      historyCount: 6,
      historyCells: [19, 14, 15, 24, 23, 22]
    })

    const state = solvePeiXiuRoleData(YONG_ZHOU, datas)

    expect(state.result.complete).toBe(true)
    expect(state.result.solution.path).toHaveLength(1)
    expect(state.result.solution.path[0]).toMatchObject({
      from: 22,
      to: 7,
      line: [17, 12, 7]
    })
  })

  it('4022 历史轨迹已覆盖全部奖励时无需继续移动', () => {
    const datas = [12, 7, 9, 19, 14, 15, 24, 23, 22, 17, 12, 7, 0]
    const state = solvePeiXiuRoleData(YONG_ZHOU, datas)

    expect(state.result.complete).toBe(true)
    expect(state.result.solution.path).toEqual([])
  })

  it('走过的奖励格标记为已领取，且不参与后续路线目标', () => {
    const datas = [12, 22, 6, 19, 14, 15, 24, 23, 22, 0]
    const state = solvePeiXiuRoleData(YONG_ZHOU, datas)

    const model = buildPeiXiuMapViewModel(state, new Map())
    const uncollectedRewardCells = model.cells
      .filter((cell) => cell.reward && !cell.rewardCollected)
      .map((cell) => cell.id)

    expect(uncollectedRewardCells).toEqual([7, 17])
    expect(model.cells.find((cell) => cell.id === 15)).toMatchObject({
      reward: { id: 52 },
      rewardCollected: true
    })
    expect(state.result.solution.path).toHaveLength(1)
    expect(state.result.solution.path[0].line).toEqual([17, 12, 7])
  })

  it('保留按步数排序的两条初始完整路线', () => {
    const routes = findPeiXiuOptimalRoutes(YONG_ZHOU)

    expect(routes).toHaveLength(2)
    expect(routes[0].path).toHaveLength(6)
    expect(routes[1].path.length).toBeGreaterThanOrEqual(routes[0].path.length)
  })

  it('达到迭代安全上限时停止搜索', () => {
    const routes = findPeiXiuOptimalRoutes(YONG_ZHOU, { maxIterations: 1 })

    expect(routes).toEqual([])
  })

  it('地图视图模型只包含可走格，并区分两条预设路线和动态路线', () => {
    const state = solvePeiXiuRoleData(YONG_ZHOU, [12, 18, 0, 0])
    state.presetRoutes = findPeiXiuOptimalRoutes(YONG_ZHOU)
    const bonuses = new Map([
      [73, { ID: 73, name: '雍州', desc: '固定技能' }],
      [53, { ID: 53, name: '奖励格', desc: '经过后获得' }]
    ])

    const model = buildPeiXiuMapViewModel(state, bonuses)

    expect(model.width).toBe(264)
    expect(model.cells).toHaveLength(12)
    expect(model.cells.map((cell) => cell.id)).not.toContain(2)
    expect(model.presetRoutes).toHaveLength(2)
    expect(model.requiredSuits).toBe('♠2♥1♣1♦2')
    expect(model.dynamicRoute).toContain('♠19')
    expect(model.mapReward).toMatchObject({ id: 73, name: '雍州' })
  })

  it('无法拿全奖励时提示并展示当前最优结果', () => {
    const unreachableMap = {
      cellID: '13',
      name: '断路',
      cell: '1,3',
      precell: '1',
      reward: '3,99'
    }
    const state = solvePeiXiuRoleData(unreachableMap, [13, 1, 0, 0])

    const model = buildPeiXiuMapViewModel(state, new Map())

    expect(state.result.complete).toBe(false)
    expect(model.dynamicRoute).toBe('无法拿全奖励，当前最优：无可行路线')
  })

  it('拒绝数量或截止符不符合协议的 4022 数据', () => {
    expect(parsePeiXiuRoleData([12, 14, 2, 19, 0])).toBeNull()
    expect(parsePeiXiuRoleData([12, 14, 1, 19, 1])).toBeNull()
  })

  it('拒绝不属于当前地图的起始格', () => {
    expect(() => new PeiXiuMapState(YONG_ZHOU, { startCell: 13 })).toThrow('裴秀地图起始格无效: 13')
  })
})
