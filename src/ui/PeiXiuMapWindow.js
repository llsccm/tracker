import { PEIXIU_DIRECTIONS } from '../utils/peixiuRouteFeature'

const WINDOW_ID = 'peixiu-map-window'
const STYLE_ID = 'peixiu-map-style'
const CELL_SIZE = 50

let cleanupDrag = null
let lastPosition = null

function getRewardInfo(reward, bonuses) {
  if (!reward) return null
  const config = bonuses?.get(Number(reward.rewardId))
  return {
    id: Number(reward.rewardId),
    name: config?.name || `奖励 ${reward.rewardId}`,
    desc: config?.desc || ''
  }
}

function getRouteCells(solution) {
  const cells = new Set()
  for (const step of solution?.path || []) {
    for (const cell of step.line || []) cells.add(cell)
    for (const move of step.specialMoves || []) {
      for (const cell of move.path || []) cells.add(cell)
    }
  }
  return cells
}

function formatRoute(solution, emptyText = '已完成') {
  const path = solution?.path || []
  if (!path.length) return emptyText
  return path
    .map((step) => `${PEIXIU_DIRECTIONS[step.dir]?.mark || step.dir}${step.to}`)
    .join(' → ')
}

export function buildPeiXiuMapViewModel(state, bonuses) {
  const map = state?.result?.map
  if (!map) return null

  const rewardsByCell = new Map(
    map.rewards
      .filter((reward) => reward.rawCell !== 26)
      .map((reward) => [reward.cell, getRewardInfo(reward, bonuses)])
  )
  const historyCells = new Set(state.historyCells || [])
  const collectedCells = new Set(historyCells).add(state.currentCell)
  const routeCells = getRouteCells(state.result.solution)

  return {
    width: 264,
    mapName: map.name || `地图 ${map.id}`,
    mapReward: getRewardInfo(map.mapReward, bonuses),
    currentCell: state.currentCell,
    presetRoutes: (state.presetRoutes || []).slice(0, 2).map(formatRoute),
    dynamicRoute: state.result.complete
      ? formatRoute(state.result.solution)
      : `无法拿全奖励，当前最优：${formatRoute(state.result.solution, '无可行路线')}`,
    historyCells,
    routeCells,
    cells: [...map.cells].map((id) => ({
      id,
      row: Math.floor((id - 1) / 5) + 1,
      column: ((id - 1) % 5) + 1,
      current: id === state.currentCell,
      visited: historyCells.has(id),
      onRoute: routeCells.has(id),
      reward: rewardsByCell.get(id) || null,
      rewardCollected: collectedCells.has(id),
      special: map.specials.get(id) || null
    }))
  }
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return

  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    #${WINDOW_ID} {
      position: fixed;
      top: 50px;
      right: 20px;
      z-index: 10000000020;
      box-sizing: border-box;
      width: 264px;
      padding: 0 6px 6px;
      color: #f4ead8;
      background: #292724;
      border: 1px solid #7b292d;
      box-shadow: 0 7px 18px rgba(0, 0, 0, 0.42);
      font-family: "Microsoft YaHei", sans-serif;
      user-select: none;
    }
    #${WINDOW_ID} * { box-sizing: border-box; }
    #${WINDOW_ID} .peixiu-header {
      height: 22px;
      margin: 0 -6px;
      padding: 0 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #7b292d;
      cursor: grab;
    }
    #${WINDOW_ID}.is-dragging .peixiu-header { cursor: grabbing; }
    #${WINDOW_ID} .peixiu-title {
      overflow: hidden;
      font-size: 12px;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #${WINDOW_ID} .peixiu-fixed-skill {
      min-height: 38px;
      padding: 4px 0;
      overflow: hidden;
      border-bottom: 1px solid #706457;
    }
    #${WINDOW_ID} .peixiu-fixed-skill span {
      overflow: hidden;
      font-size: 12px;
      line-height: 14px;
      white-space: normal;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    #${WINDOW_ID} .peixiu-presets {
      padding: 2px 0;
      display: grid;
      gap: 1px;
      color: #dce9ef;
      font-size: 16px;
      line-height: 16px;
    }
    #${WINDOW_ID} .peixiu-presets .peixiu-route + .peixiu-route {
      margin-top: 2px;
      padding-top: 2px;
      border-top: 1px solid #706457;
    }
    #${WINDOW_ID} .peixiu-dynamic-route {
      min-height: 36px;
      padding: 2px 0;
      color: #9ed4b4;
      font-size: 16px;
      line-height: 16px;
    }
    #${WINDOW_ID} .peixiu-route {
      overflow: hidden;
      display: -webkit-box;
      white-space: normal;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    #${WINDOW_ID} .peixiu-board {
      width: 250px;
      height: 250px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: repeat(5, ${CELL_SIZE}px);
      grid-template-rows: repeat(5, ${CELL_SIZE}px);
      background: rgba(219, 189, 134, 0.95);
      box-shadow: inset 0 0 0 1px #51463b;
    }
    #${WINDOW_ID} .peixiu-cell {
      position: relative;
      width: ${CELL_SIZE}px;
      height: ${CELL_SIZE}px;
      padding: 3px;
      color: #33261d;
      background: rgb(213, 175, 123);
      border: 1px solid rgba(70, 50, 36, 0.46);
      font-size: 12px;
      font-weight: 700;
    }
    #${WINDOW_ID} .peixiu-cell.is-visited { background: #66aa77; }
    #${WINDOW_ID} .peixiu-cell.is-route { box-shadow: inset 0 0 0 2px #3f6f86; }
    #${WINDOW_ID} .peixiu-cell.is-current {
      color: #fff;
      background: #8f3438;
      box-shadow: inset 0 0 0 2px #f2d06b;
    }
    #${WINDOW_ID} .peixiu-cell-number { position: absolute; top: 3px; left: 3px; }
    #${WINDOW_ID} .peixiu-reward-badge {
      position: absolute;
      right: 3px;
      bottom: 3px;
      max-width: 40px;
      padding: 2px;
      overflow: hidden;
      color: #fff8dd;
      background: #2f6652;
      border: 1px solid #d9c477;
      font-size: 12px;
      line-height: 8px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #${WINDOW_ID} .peixiu-reward-badge.is-collected {
      color: #2c2925;
      background: #fff;
      border-color: #8a8177;
    }
    #${WINDOW_ID} .peixiu-special {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: #6f2025;
      font-size: 13px;
    }
  `
  document.head.appendChild(style)
}

function bindDrag(element, handle) {
  cleanupDrag?.()
  let pointerId = null
  let offsetX = 0
  let offsetY = 0

  const move = (event) => {
    if (event.pointerId !== pointerId) return
    const left = Math.min(
      Math.max(0, window.innerWidth - element.offsetWidth),
      Math.max(0, event.clientX - offsetX)
    )
    const top = Math.min(
      Math.max(0, window.innerHeight - element.offsetHeight),
      Math.max(0, event.clientY - offsetY)
    )
    element.style.left = `${left}px`
    element.style.top = `${top}px`
    element.style.right = 'auto'
    lastPosition = { left, top }
  }
  const stop = (event) => {
    if (event.pointerId !== pointerId) return
    pointerId = null
    element.classList.remove('is-dragging')
    handle.releasePointerCapture?.(event.pointerId)
  }
  const start = (event) => {
    if (event.button !== 0) return
    const rect = element.getBoundingClientRect()
    pointerId = event.pointerId
    offsetX = event.clientX - rect.left
    offsetY = event.clientY - rect.top
    element.classList.add('is-dragging')
    handle.setPointerCapture?.(pointerId)
  }

  handle.addEventListener('pointerdown', start)
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', stop)
  handle.addEventListener('pointercancel', stop)
  cleanupDrag = () => {
    handle.removeEventListener('pointerdown', start)
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', stop)
    handle.removeEventListener('pointercancel', stop)
    cleanupDrag = null
  }
}

function createWindow() {
  ensureStyle()
  const element = document.createElement('section')
  element.id = WINDOW_ID
  element.innerHTML = `
    <header class="peixiu-header">
      <div class="peixiu-title"></div>
    </header>
    <div class="peixiu-fixed-skill"></div>
    <div class="peixiu-presets">
      <div class="peixiu-route" data-route="preset-1"></div>
      <div class="peixiu-route" data-route="preset-2"></div>
    </div>
    <div class="peixiu-board"></div>
    <div class="peixiu-route peixiu-dynamic-route" data-route="dynamic"></div>
  `
  document.body.appendChild(element)
  if (lastPosition) {
    const left = Math.min(
      Math.max(0, window.innerWidth - element.offsetWidth),
      Math.max(0, lastPosition.left)
    )
    const top = Math.min(
      Math.max(0, window.innerHeight - element.offsetHeight),
      Math.max(0, lastPosition.top)
    )
    element.style.left = `${left}px`
    element.style.top = `${top}px`
    element.style.right = 'auto'
    lastPosition = { left, top }
  }
  bindDrag(element, element.querySelector('.peixiu-header'))
  return element
}

function setSkillLine(element, desc) {
  element.replaceChildren()
  const text = document.createElement('span')
  text.textContent = desc || ''
  element.appendChild(text)
}

export function renderPeiXiuMapWindow(state, bonuses) {
  const model = buildPeiXiuMapViewModel(state, bonuses)
  if (!model) return false

  const element = document.getElementById(WINDOW_ID) || createWindow()
  element.querySelector('.peixiu-title').textContent = model.mapName
  element.querySelector('[data-route="preset-1"]').textContent = model.presetRoutes[0] || ''
  element.querySelector('[data-route="preset-2"]').textContent = model.presetRoutes[1] || ''
  element.querySelector('[data-route="dynamic"]').textContent = `动态：${model.dynamicRoute}`

  const fixedSkill = element.querySelector('.peixiu-fixed-skill')
  const fixedSkillDesc = model.mapReward?.desc || ''
  setSkillLine(fixedSkill, fixedSkillDesc)

  const board = element.querySelector('.peixiu-board')
  board.replaceChildren()
  for (const cell of model.cells) {
    const cellElement = document.createElement('div')
    cellElement.className = 'peixiu-cell'
    cellElement.style.gridRow = cell.row
    cellElement.style.gridColumn = cell.column
    cellElement.classList.toggle('is-visited', cell.visited)
    cellElement.classList.toggle('is-route', cell.onRoute)
    cellElement.classList.toggle('is-current', cell.current)

    const number = document.createElement('span')
    number.className = 'peixiu-cell-number'
    number.textContent = cell.id
    cellElement.appendChild(number)

    if (cell.reward) {
      const badge = document.createElement('span')
      badge.className = 'peixiu-reward-badge'
      badge.classList.toggle('is-collected', cell.rewardCollected)
      badge.textContent = cell.reward.name
      cellElement.appendChild(badge)
      cellElement.addEventListener('mouseenter', () => setSkillLine(fixedSkill, cell.reward.desc))
      cellElement.addEventListener('mouseleave', () => setSkillLine(fixedSkill, fixedSkillDesc))
    }
    if (cell.special?.effect === 3) {
      const special = document.createElement('span')
      special.className = 'peixiu-special'
      const direction =
        PEIXIU_DIRECTIONS[cell.special.param1]?.shortDirection || cell.special.param1
      special.textContent = `${direction}${cell.special.param2}`
      cellElement.appendChild(special)
    }
    board.appendChild(cellElement)
  }
  return true
}

export function destroyPeiXiuMapWindow() {
  cleanupDrag?.()
  document.getElementById(WINDOW_ID)?.remove()
}

export function setPeiXiuMapWindowVisible(visible) {
  const element = document.getElementById(WINDOW_ID)
  if (element) element.style.display = visible ? '' : 'none'
}
