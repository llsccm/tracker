export const PEIXIU_DIRECTIONS = {
  1: {
    name: '红桃',
    shortDirection: '左',
    mark: '♥',
    dx: -1,
    dy: 0
  },
  2: {
    name: '方块',
    shortDirection: '上',
    mark: '♦',
    dx: 0,
    dy: -1
  },
  3: {
    name: '黑桃',
    shortDirection: '右',
    mark: '♠',
    dx: 1,
    dy: 0
  },
  4: {
    name: '梅花',
    shortDirection: '下',
    mark: '♣',
    dx: 0,
    dy: 1
  }
}
const DIR = PEIXIU_DIRECTIONS
const DIRECTIONS = [1, 2, 3, 4]
const MAX_ROUTE_ITERATIONS = 2000

function nums(text) {
  if (Array.isArray(text)) {
    return text.map(Number).filter(Number.isFinite)
  }

  return String(text || '')
    .split(',')
    .map((n) => Number(n.trim()))
    .filter(Number.isFinite)
}

function firstField(raw, ...keys) {
  for (const key of keys) {
    if (raw && raw[key] !== undefined && raw[key] !== null) {
      return raw[key]
    }
  }

  return undefined
}

function field(raw, lower, upper, fallback = 0) {
  return firstField(raw, lower, upper) ?? fallback
}

function normalizeCell(cell) {
  const n = Number(cell) || 0
  if (n <= 25) return n

  const row = Math.floor(n / 10)
  const col = n % 10

  return row >= 1 && row <= 5 && col >= 1 && col <= 5 ? (row - 1) * 5 + col : n
}

function pos(cell) {
  const n = normalizeCell(cell)

  return {
    row: Math.floor((n - 1) / 5),
    col: (n - 1) % 5
  }
}

function cellAt(row, col) {
  if (row < 0 || row >= 5 || col < 0 || col >= 5) {
    return 0
  }

  return row * 5 + col + 1
}

function validCell(cell) {
  return cell >= 1 && cell <= 25
}

function parseCells(value) {
  return nums(value).map(normalizeCell).filter(validCell)
}

function parseSpecialCells(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || '')
        .split('|')
        .filter(Boolean)

  return list.map((item) => {
    if (!Array.isArray(item) && typeof item == 'object') {
      return {
        cell: field(item, 'cell', 'CellID'),
        effect: field(item, 'effect', 'EffectID'),
        param1: field(item, 'param1', 'Param1'),
        param2: field(item, 'param2', 'Param2')
      }
    }

    const [cell, effect, param1 = 0, param2 = 0] = nums(item)

    return { cell, effect, param1, param2 }
  })
}

function parseRewards(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || '')
        .split('|')
        .filter(Boolean)

  return list.map((item) => {
    if (!Array.isArray(item) && typeof item == 'object') {
      const cell = field(item, 'cell', 'CellID')

      return {
        cell: normalizeCell(cell),
        rawCell: Number(cell),
        rewardId: field(item, 'rewardId', 'RewardID')
      }
    }

    const [cell, rewardId] = nums(item)

    return { cell: normalizeCell(cell), rawCell: Number(cell), rewardId }
  })
}

export function parsePeiXiuMap(raw) {
  const cells = new Set(parseCells(firstField(raw, 'cell', 'Cells', 'cells')))
  const specials = new Map()

  parseSpecialCells(firstField(raw, 'spcell', 'SpecialCells', 'specialCells')).forEach((item) => {
    const id = normalizeCell(item.cell)
    if (validCell(id)) {
      specials.set(id, {
        cell: id,
        effect: Number(item.effect) || 0,
        param1: Number(item.param1) || 0,
        param2: Number(item.param2) || 0
      })
    }
  })

  const rewards = parseRewards(firstField(raw, 'reward', 'RewardCells', 'rewardCells'))
  const mapReward = rewards.find((reward) => reward.rawCell === 26) || null
  const rewardCells = rewards
    .filter((reward) => reward.rawCell !== 26 && validCell(reward.cell) && cells.has(reward.cell))
    .map((r) => r.cell)

  return {
    id: firstField(raw, 'cellID', 'CellID', 'id', 'mapId') || 0,
    name: raw?.name || '',
    cells,
    start: normalizeCell(firstField(raw, 'precell', 'PreCell', 'start') || 0),
    specials,
    rewards,
    mapReward,
    rewardCells: [...new Set(rewardCells)].sort((a, b) => a - b),
    color: Number(firstField(raw, 'color', 'Color')) || 0,
    bigMapPos: firstField(raw, 'bigMapPos', 'bigmappos', 'BigMapPos') || ''
  }
}

function orderedLineCells(from, dir, cells) {
  const p = pos(from)
  const step = DIR[dir]
  const list = []
  if (!step) return list

  for (let i = 1; i <= 4; i += 1) {
    const next = cellAt(p.row + step.dy * i, p.col + step.dx * i)
    if (!next || !cells.has(next)) break
    list.push(next)
  }

  return list
}

function forcedMove(from, special, map) {
  const dir = DIR[special.param1]
  const steps = Number(special.param2) || 0

  if (!dir || steps <= 0) return null

  const start = pos(from)
  const path = []
  let end = from

  for (let i = 1; i <= steps; i += 1) {
    const next = cellAt(start.row + dir.dy * i, start.col + dir.dx * i)
    if (!next) break
    if (!map.cells.has(next)) break
    path.push(next)
    end = next
  }

  return { dir: special.param1, steps, path, end }
}

function rewardIndexMap(map) {
  const index = new Map()
  map.rewardCells.forEach((cell, i) => index.set(cell, i))
  return index
}

function collectMask(cells, index) {
  let mask = 0

  for (const cell of cells) {
    const i = index.get(cell)
    if (i !== undefined) mask |= 1 << i
  }

  return mask
}

function applySpecials(startPos, index, startMask, map) {
  let current = startPos
  let mask = startMask
  const specialMoves = []
  const seen = new Set()

  while (map.specials.get(current)?.effect === 3 && !seen.has(current)) {
    seen.add(current)
    const special = map.specials.get(current)
    const forced = forcedMove(current, special, map)
    if (!forced || forced.end === current) break

    mask |= collectMask(forced.path, index)
    specialMoves.push({
      from: current,
      to: forced.end,
      dir: forced.dir,
      steps: forced.steps,
      path: forced.path
    })
    current = forced.end
  }

  return { pos: current, mask, specialMoves }
}

function buildTransition(from, dir, map, index) {
  const line = orderedLineCells(from, dir, map.cells)
  if (!line.length) return null

  const specialResult = applySpecials(line[line.length - 1], index, collectMask(line, index), map)

  return {
    pos: specialResult.pos,
    mask: specialResult.mask,
    step: {
      dir,
      from,
      to: specialResult.pos,
      line,
      specialMoves: specialResult.specialMoves
    }
  }
}

export function getPeiXiuMove(mapOrRaw, from, direction) {
  const map = mapOrRaw?.cells instanceof Set ? mapOrRaw : parsePeiXiuMap(mapOrRaw)
  const start = normalizeCell(from)

  if (!validCell(start) || !map.cells.has(start)) return null

  return buildTransition(start, Number(direction), map, rewardIndexMap(map))?.step || null
}

export class PeiXiuMapState {
  constructor(raw, options = {}) {
    this.map = parsePeiXiuMap(raw)
    const startCell = normalizeCell(options.startCell ?? this.map.start)

    if (!this.map.cells.has(startCell)) {
      throw new RangeError(`裴秀地图起始格无效: ${startCell}`)
    }

    this.map.start = startCell
    this.currentCell = startCell
    this.visitedCells = new Set([startCell])
    this.collectedRewardCells = new Set()
    this.moves = []
    this.collectRewards([startCell])
  }

  get availableDirections() {
    return DIRECTIONS.filter((direction) => getPeiXiuMove(this.map, this.currentCell, direction))
  }

  get collectedRewards() {
    return this.map.rewards.filter(
      (reward) => reward.rawCell === 26 || this.collectedRewardCells.has(reward.cell)
    )
  }

  get mapReward() {
    return this.map.mapReward
  }

  collectRewards(cells) {
    for (const cell of cells) {
      if (this.map.rewardCells.includes(cell)) this.collectedRewardCells.add(cell)
    }
  }

  move(direction) {
    const step = getPeiXiuMove(this.map, this.currentCell, direction)
    if (!step) return null

    const traversedCells = step.line.concat(
      step.specialMoves.flatMap((specialMove) => specialMove.path)
    )

    for (const cell of traversedCells) this.visitedCells.add(cell)

    this.collectRewards(traversedCells)
    this.currentCell = step.to
    this.moves.push(step)

    return step
  }

  snapshot() {
    return {
      mapId: this.map.id,
      mapName: this.map.name,
      startCell: this.map.start,
      currentCell: this.currentCell,
      availableDirections: this.availableDirections,
      visitedCells: [...this.visitedCells],
      collectedRewardCells: [...this.collectedRewardCells],
      mapReward: this.mapReward,
      collectedRewards: this.collectedRewards,
      moves: [...this.moves]
    }
  }
}

function buildTransitionTable(map, index) {
  const table = new Map()
  const positions = new Set(map.cells)
  positions.add(map.start)

  for (const from of positions) {
    const transitions = []

    for (const dir of DIRECTIONS) {
      const next = buildTransition(from, dir, map, index)
      if (next) transitions.push(next)
    }

    if (transitions.length) table.set(from, transitions)
  }

  return table
}

function betterRoute(state, best) {
  return state.count > best.count || (state.count === best.count && state.depth < best.depth)
}

function buildSolution(state) {
  const path = []

  for (let current = state; current?.parent; current = current.parent) {
    path.push(current.step)
  }

  path.reverse()

  return { pos: state.pos, mask: state.mask, path }
}

export function solvePeiXiuMap(raw, options = {}) {
  const map = parsePeiXiuMap(raw)
  const startCell = normalizeCell(options.startCell ?? map.start)

  if (validCell(startCell)) map.start = startCell

  const index = rewardIndexMap(map)
  const target = map.rewardCells.length ? (1 << map.rewardCells.length) - 1 : 0

  const collectedCells = Array.isArray(options.collectedCells)
    ? options.collectedCells.map(normalizeCell)
    : []

  const startMask =
    options.collectStart === false
      ? collectMask(collectedCells, index)
      : collectMask([map.start].concat(collectedCells), index)

  const start = {
    pos: map.start,
    mask: startMask,
    count: bitCount(startMask),
    depth: 0,
    parent: null,
    step: null
  }

  const queue = [start]
  const seen = new Set([`${start.pos}:${start.mask}`])
  const transitions = buildTransitionTable(map, index)
  let best = start

  for (let head = 0; head < queue.length; head += 1) {
    const state = queue[head]
    if (state.mask === target) return { map, solution: buildSolution(state), complete: true }

    if (betterRoute(state, best)) best = state

    for (const next of transitions.get(state.pos) || []) {
      const mask = state.mask | next.mask
      const key = `${next.pos}:${mask}`

      if (seen.has(key)) continue

      seen.add(key)
      queue.push({
        pos: next.pos,
        mask,
        count: bitCount(mask),
        depth: state.depth + 1,
        parent: state,
        step: {
          ...next.step,
          gainedMask: mask & ~state.mask
        }
      })
    }
  }

  return { map, solution: buildSolution(best), complete: false }
}

export function findPeiXiuOptimalRoutes(raw, options = {}, limit = 2) {
  const map = parsePeiXiuMap(raw)
  const startCell = normalizeCell(options.startCell ?? map.start)
  if (validCell(startCell)) map.start = startCell

  const index = rewardIndexMap(map)
  const target = map.rewardCells.length ? (1 << map.rewardCells.length) - 1 : 0
  const collectedCells = Array.isArray(options.collectedCells)
    ? options.collectedCells.map(normalizeCell)
    : []

  const startMask = collectMask([map.start].concat(collectedCells), index)
  const startKey = `${map.start}:${startMask}`

  const queue = [
    {
      pos: map.start,
      mask: startMask,
      path: [],
      visited: new Set([startKey])
    }
  ]

  const transitions = buildTransitionTable(map, index)
  const routes = []
  const requestedIterations = Number(options.maxIterations)
  const maxIterations =
    Number.isInteger(requestedIterations) && requestedIterations > 0
      ? Math.min(requestedIterations, MAX_ROUTE_ITERATIONS)
      : MAX_ROUTE_ITERATIONS

  for (let head = 0; head < queue.length && head < maxIterations; head += 1) {
    const state = queue[head]

    if (state.mask === target) {
      routes.push({
        pos: state.pos,
        mask: state.mask,
        path: state.path
      })

      if (routes.length >= Math.max(1, Number(limit) || 1)) break
      continue
    }

    for (const next of transitions.get(state.pos) || []) {
      const mask = state.mask | next.mask
      const key = `${next.pos}:${mask}`

      if (state.visited.has(key)) continue

      queue.push({
        pos: next.pos,
        mask,
        path: state.path.concat({
          ...next.step,
          gainedMask: mask & ~state.mask
        }),
        visited: new Set(state.visited).add(key)
      })
    }
  }

  return routes
}

export function parsePeiXiuRoleData(datas) {
  if (!Array.isArray(datas) || datas.length < 4) return null

  const mapId = Number(datas[0])
  const currentCell = normalizeCell(datas[1])
  const historyCount = Number(datas[2])

  if (
    !Number.isInteger(mapId) ||
    !validCell(currentCell) ||
    !Number.isInteger(historyCount) ||
    historyCount < 0
  ) {
    return null
  }

  const historyCells = datas.slice(3, 3 + historyCount).map(normalizeCell)
  if (historyCells.length !== historyCount || historyCells.some((cell) => !validCell(cell))) {
    return null
  }

  const terminatorIndex = 3 + historyCount
  if (datas[terminatorIndex] !== 0) return null

  return {
    mapId,
    currentCell,
    historyCount,
    historyCells
  }
}

export function solvePeiXiuRoleData(raw, datas) {
  const roleData = parsePeiXiuRoleData(datas)
  if (!roleData) return null

  const map = parsePeiXiuMap(raw)
  if (Number(map.id) !== roleData.mapId || !map.cells.has(roleData.currentCell)) return null

  return {
    ...roleData,
    result: solvePeiXiuMap(raw, {
      startCell: roleData.currentCell,
      collectedCells: roleData.historyCells
    })
  }
}

function bitCount(n) {
  let count = 0

  while (n) {
    n &= n - 1
    count += 1
  }

  return count
}
