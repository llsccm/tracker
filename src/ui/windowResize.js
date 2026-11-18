const resizeEvents = new EventTarget()
const resizeListeners = new Set()

/** @param {() => void} callback */
export function subscribeWindowResize(callback) {
  const listener = () => callback()
  if (resizeListeners.size === 0) {
    window.addEventListener('resize', dispatchResize, true)
  }

  resizeListeners.add(listener)
  resizeEvents.addEventListener('resize', listener)

  return () => {
    resizeEvents.removeEventListener('resize', listener)
    if (resizeListeners.delete(listener) && resizeListeners.size === 0) {
      window.removeEventListener('resize', dispatchResize, true)
    }
  }
}

export function requestWindowResize() {
  // 继续通知宿主游戏的 resize 处理器。
  window.dispatchEvent(new Event('resize'))
}

function dispatchResize() {
  // 使用 EventTarget 分发，单个回调报错不会中断其他订阅者。
  resizeEvents.dispatchEvent(new Event('resize'))
}
