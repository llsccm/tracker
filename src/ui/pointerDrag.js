export function bindPointerDrag(handle, { onStart, onMove, onStop }) {
  let activePointerId = null

  const releasePointer = () => {
    const pointerId = activePointerId
    activePointerId = null
    if (pointerId !== null && handle.hasPointerCapture?.(pointerId)) {
      handle.releasePointerCapture?.(pointerId)
    }
  }

  const start = (event) => {
    if (activePointerId !== null || event.isPrimary === false) return
    if (event.button !== undefined && event.button !== 0) return
    // 调用方可忽略按钮等不应触发拖拽的目标。
    if (onStart(event) === false) return

    activePointerId = event.pointerId ?? 0
    handle.setPointerCapture?.(activePointerId)
  }

  const move = (event) => {
    if ((event.pointerId ?? 0) !== activePointerId) return
    onMove(event)
  }

  const stop = (event) => {
    if ((event.pointerId ?? 0) !== activePointerId) return
    releasePointer()
    onStop(event)
  }

  const listeners = [
    ['pointerdown', start],
    ['pointermove', move],
    ['pointerup', stop],
    ['pointercancel', stop],
    ['lostpointercapture', stop]
  ]
  for (const [type, listener] of listeners) {
    handle.addEventListener(type, listener)
  }

  return () => {
    releasePointer()
    for (const [type, listener] of listeners) {
      handle.removeEventListener(type, listener)
    }
  }
}
