import { getLayoutViewportWidth } from './drag'

const windowStates = new Map()

export function createDraggableWindow({ id, styleId, styleText, markup, handleSelector }) {
  ensureStyle(styleId, styleText)

  const element = document.createElement('section')
  element.id = id
  element.innerHTML = markup
  document.body.appendChild(element)

  const state = windowStates.get(id) || { lastPosition: null, cleanupDrag: null }
  windowStates.set(id, state)
  restorePosition(element, state)
  bindDrag(element, element.querySelector(handleSelector), state)
  return element
}

export function destroyDraggableWindow(id) {
  windowStates.get(id)?.cleanupDrag?.()
  document.getElementById(id)?.remove()
}

export function setDraggableWindowVisible(id, visible) {
  const element = document.getElementById(id)
  if (element) element.style.display = visible ? '' : 'none'
}

function ensureStyle(styleId, styleText) {
  if (document.getElementById(styleId)) return

  const style = document.createElement('style')
  style.id = styleId
  style.textContent = styleText
  document.head.appendChild(style)
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

function restorePosition(element, state) {
  if (!state.lastPosition) return
  state.lastPosition = setPosition(element, state.lastPosition.left, state.lastPosition.top)
}

function setPosition(element, left, top) {
  const position = {
    left: Math.min(Math.max(0, getLayoutViewportWidth() - element.offsetWidth), Math.max(0, left)),
    top: Math.min(Math.max(0, window.innerHeight - element.offsetHeight), Math.max(0, top))
  }
  element.style.left = `${position.left}px`
  element.style.top = `${position.top}px`
  element.style.right = 'auto'
  return position
}
