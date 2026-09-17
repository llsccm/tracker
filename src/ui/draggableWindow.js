import { getLayoutViewportWidth } from './drag'

const windowStates = new Map()

export function createDraggableWindow({ id, styleId, styleText, markup, handleSelector }) {
  ensureStyle(styleId, `${getShellStyle(id)}${styleText}`)

  const element = document.createElement('section')
  element.id = id
  element.innerHTML = markup
  document.body.appendChild(element)

  const state = windowStates.get(id) || {
    lastPosition: null,
    cleanupDrag: null,
    cleanupPosition: null
  }
  windowStates.set(id, state)
  restorePosition(element, state)
  bindDrag(element, element.querySelector(handleSelector), state)
  bindPositionCorrection(element, state)
  return element
}

export function destroyDraggableWindow(id) {
  const state = windowStates.get(id)
  state?.cleanupDrag?.()
  state?.cleanupPosition?.()
  document.getElementById(id)?.remove()
}

export function setDraggableWindowVisible(id, visible) {
  const element = document.getElementById(id)
  if (!element) return

  element.style.display = visible ? '' : 'none'
  const state = windowStates.get(id)
  if (visible && state) correctPosition(element, state)
}

function ensureStyle(styleId, styleText) {
  if (document.getElementById(styleId)) return

  const style = document.createElement('style')
  style.id = styleId
  style.textContent = styleText
  document.head.appendChild(style)
}

function getShellStyle(id) {
  return `
    #${id} {
      position: fixed;
      right: 20px;
      z-index: 10000000020;
      box-sizing: border-box;
      padding: 0 6px 6px;
      color: #f4ead8;
      background: #292724;
      border: 1px solid #7b292d;
      box-shadow: 0 7px 18px rgba(0, 0, 0, 0.42);
      font-family: "Microsoft YaHei", sans-serif;
      user-select: none;
    }
    #${id} * { box-sizing: border-box; }
    #${id} .draggable-window-header {
      height: 22px;
      margin: 0 -6px;
      padding: 0 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #7b292d;
      cursor: grab;
    }
    #${id}.is-dragging .draggable-window-header { cursor: grabbing; }
    #${id} .draggable-window-title {
      overflow: hidden;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `
}

function bindDrag(element, handle, state) {
  state.cleanupDrag?.()
  let pointerId = null
  let offsetX = 0
  let offsetY = 0

  const move = (event) => {
    if (event.pointerId !== pointerId) return
    state.lastPosition = setPosition(element, event.clientX - offsetX, event.clientY - offsetY)
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

  state.cleanupDrag = () => {
    handle.removeEventListener('pointerdown', start)
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', stop)
    handle.removeEventListener('pointercancel', stop)
    state.cleanupDrag = null
  }
}

function bindPositionCorrection(element, state) {
  state.cleanupPosition?.()
  const correct = () => correctPosition(element, state)
  const observer = new ResizeObserver(correct)
  observer.observe(element, { box: 'border-box' })
  window.addEventListener('resize', correct)
  correct()

  state.cleanupPosition = () => {
    observer.disconnect()
    window.removeEventListener('resize', correct)
    state.cleanupPosition = null
  }
}

function correctPosition(element, state) {
  if (!element.getClientRects().length) return

  const { left, top } = element.getBoundingClientRect()
  const position = clampPosition(element, left, top)
  // 保留仍在视口内的 CSS 定位，避免初次渲染就把右侧锚定改成固定 left。
  if (position.left === left && position.top === top) return

  state.lastPosition = setPosition(element, position.left, position.top)
}

function restorePosition(element, state) {
  if (!state.lastPosition) return
  state.lastPosition = setPosition(element, state.lastPosition.left, state.lastPosition.top)
}

function setPosition(element, left, top) {
  const position = clampPosition(element, left, top)
  element.style.left = `${position.left}px`
  element.style.top = `${position.top}px`
  element.style.right = 'auto'
  return position
}

function clampPosition(element, left, top) {
  return {
    left: Math.min(Math.max(0, getLayoutViewportWidth() - element.offsetWidth), Math.max(0, left)),
    top: Math.min(Math.max(0, window.innerHeight - element.offsetHeight), Math.max(0, top))
  }
}
