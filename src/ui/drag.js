const boundPenetrationDocs = new WeakSet()

export function addDragHint() {
  var sidebarHint = document.createElement('div')
  sidebarHint.id = 'sidebarHint'
  sidebarHint.innerText = '拖到这里变为变为侧边栏，再次拖动取消侧边栏'
  document.body.appendChild(sidebarHint)
}

export function getLayoutViewportWidth() {
  return document.documentElement.clientWidth || window.innerWidth
}

export function initDragElement(globalConfig, globalState, requestWindowResize) {
  bindSorderPenetration()

  // 获取需要拖动的元素
  const draggable = document.getElementById('header')
  const container = document.getElementById('tracker-shell')
  const sidebarHint = document.getElementById('sidebarHint')
  if (!draggable || !container) return

  let activePointerId = null
  let hasMoved = false
  let startX = 0
  let startY = 0
  let originTranslateX = 0
  let originTranslateY = 0
  let baseLeft = 0
  let baseTop = 0
  let containerWidth = 230
  let translateX = 0
  let translateY = 0
  let pendingFrame = false
  let rafId = 0

  const dockToSidebar = () => {
    if (globalConfig.padding) return
    if (globalState.closeIframe) {
      document.getElementById('toggle-me')?.click()
    }
    globalConfig.padding = 232
    requestWindowResize()
    translateX = 0
    translateY = 0
    container.style.transform = 'translate(0px, 0px)'
  }

  const startDrag = (e) => {
    if (activePointerId !== null || e.isPrimary === false) return
    if (e.button !== undefined && e.button !== 0) return
    // 忽略折叠按钮，避免 setPointerCapture 劫持子按钮的 click 派发
    if (e.target?.closest?.('#toggle-me')) return

    const current = readTranslate(container)
    translateX = current.x
    translateY = current.y
    originTranslateX = current.x
    originTranslateY = current.y

    const rect = container.getBoundingClientRect()
    baseLeft = rect.left - current.x
    baseTop = rect.top - current.y
    containerWidth = rect.width || 230

    activePointerId = e.pointerId ?? 0
    hasMoved = false
    startX = e.clientX ?? 0
    startY = e.clientY ?? 0

    draggable.style.cursor = 'grabbing'
    container.style.userSelect = 'none'
    container.style.willChange = 'transform'
    draggable.setPointerCapture?.(activePointerId)
  }

  const onDrag = (e) => {
    if ((e.pointerId ?? 0) !== activePointerId) return

    hasMoved = true
    if (sidebarHint) sidebarHint.style.display = 'flex'

    const clientX = e.clientX ?? startX
    const clientY = e.clientY ?? startY
    const viewportWidth = getLayoutViewportWidth()

    translateX = clamp(
      originTranslateX + (clientX - startX),
      -baseLeft,
      viewportWidth - containerWidth - baseLeft
    )
    translateY = clamp(
      originTranslateY + (clientY - startY),
      -baseTop,
      window.innerHeight - 30 - baseTop
    )

    if (globalConfig.padding) {
      globalConfig.padding = 0
      container.style.height = '500px'
      requestWindowResize()
    }

    if (!pendingFrame) {
      pendingFrame = true
      rafId = requestAnimationFrame(() => {
        pendingFrame = false
        rafId = 0
        container.style.transform = `translate(${translateX}px, ${translateY}px)`
      })
    }

    if (sidebarHint) {
      sidebarHint.style.backgroundColor =
        viewportWidth - clientX < 25 ? 'rgba(55, 40, 32, 1)' : 'rgba(55, 40, 32, 0.8)'
    }
  }

  const stopDrag = (e) => {
    if ((e.pointerId ?? 0) !== activePointerId) return

    const pointerId = activePointerId
    activePointerId = null

    if (pendingFrame) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId)
      pendingFrame = false
      rafId = 0
    }

    if (sidebarHint) sidebarHint.style.display = 'none'
    draggable.style.cursor = 'grab'
    container.style.userSelect = ''
    container.style.willChange = 'auto'

    if (draggable.hasPointerCapture?.(pointerId)) {
      draggable.releasePointerCapture?.(pointerId)
    }

    if (e.type !== 'pointercancel' && e.type !== 'lostpointercapture') {
      const finalClientX = e.clientX ?? startX
      if (hasMoved && getLayoutViewportWidth() - finalClientX < 25 && draggable.id === 'header') {
        dockToSidebar()
        return
      }
    }

    if (hasMoved) {
      container.style.transform = `translate(${translateX}px, ${translateY}px)`
    }
  }

  draggable.addEventListener('pointerdown', startDrag)
  draggable.addEventListener('pointermove', onDrag)
  draggable.addEventListener('pointerup', stopDrag)
  draggable.addEventListener('pointercancel', stopDrag)
  draggable.addEventListener('lostpointercapture', stopDrag)
}

function bindSorderPenetration() {
  if (boundPenetrationDocs.has(document)) return
  boundPenetrationDocs.add(document)

  // 1.在明牌框框内点击拖动三国杀页面元素会拖动不了
  // 2.拖动三国杀元素途径明牌框框，会拖动不了
  // 鼠标按下的时候 禁止明牌框框鼠标悬浮查看更多卡牌功能 且重新分发鼠标事件
  let mousePressed = false
  // 在捕获阶段处理，优先级最高
  document.addEventListener(
    'mousedown',
    function (e) {
      if (mousePressed) return
      mousePressed = true
      document.body.classList.add('mouse-pressed')

      const clickedSorderBody = e.target.closest('.sorder-body')
      if (!clickedSorderBody) return

      // 阻止事件传播到目标并重新分发到下层游戏元素
      e.preventDefault()
      e.stopImmediatePropagation()

      setTimeout(() => {
        const elementBelow = document.elementFromPoint(e.clientX, e.clientY)
        if (!elementBelow || elementBelow === clickedSorderBody) return
        elementBelow.dispatchEvent(
          new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            clientX: e.clientX,
            clientY: e.clientY,
            button: e.button,
            buttons: e.buttons
          })
        )
      }, 0)
    },
    true
  )

  const clearMousePressed = () => {
    if (!mousePressed) return
    mousePressed = false
    document.body.classList.remove('mouse-pressed')
  }

  document.addEventListener('mouseup', clearMousePressed)
  document.addEventListener('pointerup', clearMousePressed)
  document.addEventListener('pointercancel', clearMousePressed)
  window.addEventListener?.('blur', clearMousePressed)
}

function readTranslate(element) {
  const match = element.style.transform?.match(
    /translate\(\s*([+-]?[\d.]+)(?:px)?\s*,\s*([+-]?[\d.]+)(?:px)?\s*\)/
  )
  if (!match) return { x: 0, y: 0 }
  return { x: Number(match[1]) || 0, y: Number(match[2]) || 0 }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}
