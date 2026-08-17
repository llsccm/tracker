export function addDragHint() {
  var sidebarHint = document.createElement('div')
  sidebarHint.id = 'sidebarHint'
  sidebarHint.innerText = '拖到这里变为变为侧边栏，再次拖动取消侧边栏'
  document.body.appendChild(sidebarHint)
}

function getLayoutViewportWidth() {
  return document.documentElement.clientWidth || window.innerWidth
}

export function initDragElement(globalConfig, globalState, refreshSidebarViewport) {
  // 1.在明牌框框内点击拖动三国杀页面元素会拖动不了
  // 2.拖动三国杀元素途径明牌框框，会拖动不了
  // 鼠标按下的时候 禁止明牌框框鼠标悬浮查看更多卡牌功能 且重新分发鼠标事件
  let mousePressed = false
  // 在捕获阶段处理，优先级最高
  document.addEventListener(
    'mousedown',
    function (e) {
      if (!mousePressed) {
        mousePressed = true

        const clickedSorderBody = e.target.closest('.sorder-body')

        if (clickedSorderBody) {
          // 立即添加CSS类
          document.body.classList.add('mouse-pressed')

          // 阻止事件传播到目标
          e.preventDefault()
          e.stopImmediatePropagation()

          // 重新分发到下层
          setTimeout(() => {
            const elementBelow = document.elementFromPoint(e.clientX, e.clientY)
            if (elementBelow && elementBelow !== clickedSorderBody) {
              // 使用冒泡阶段的新事件
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
            }
          }, 0)
        } else {
          document.body.classList.add('mouse-pressed')
        }
      }
    },
    true
  ) // true = 捕获阶段

  document.addEventListener('mouseup', () => {
    if (mousePressed) {
      mousePressed = false
      document.body.classList.remove('mouse-pressed')
    }
  })

  // 获取需要拖动的元素
  const draggable = document.getElementById('header')
  const container = document.getElementById('createIframe') // 获取整个容器
  const sidebarHint = document.getElementById('sidebarHint')

  // 初始化状态
  let isDragging = false
  let startX = 0,
    startY = 0
  let translateX = 0,
    translateY = 0 // 添加这两行以初始化平移变量
  let pendingFrame = false

  // 鼠标按下事件：开始拖动
  const startDrag = (e) => {
    draggable.style.cursor = 'grabbing'
    isDragging = true
    startX = e.clientX ?? e.touches?.[0]?.clientX ?? 0 // 支持触摸
    startY = e.clientY ?? e.touches?.[0]?.clientY ?? 0 // 支持触摸

    container.style.userSelect = 'none' // 应用到整个容器
    container.style.willChange = 'transform' // 硬件加速应用到容器

    document.addEventListener('mousemove', onDrag)
    document.addEventListener('mouseup', stopDrag)
    document.addEventListener('touchmove', onDrag) // 添加触摸移动事件
    document.addEventListener('touchend', stopDrag) // 添加触摸结束事件
  }

  draggable.addEventListener('mousedown', startDrag)
  draggable.addEventListener('touchstart', startDrag) // 添加触摸开始事件

  function onDrag(e) {
    if (!isDragging) return
    sidebarHint.style.display = 'flex'

    const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? startX // 支持触摸
    const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? startY // 支持触摸

    const deltaX = clientX - startX
    const deltaY = clientY - startY

    const rect = container.getBoundingClientRect()
    const left0 = rect.left - translateX
    const top0 = rect.top - translateY
    const width = rect.width || 230
    const viewportWidth = getLayoutViewportWidth()

    translateX += deltaX
    translateY += deltaY

    const minX = -left0
    const maxX = viewportWidth - width - left0
    const minY = -top0
    const maxY = window.innerHeight - 30 - top0

    translateX = Math.max(minX, Math.min(maxX, translateX))
    translateY = Math.max(minY, Math.min(maxY, translateY))

    if (globalConfig.padding) {
      globalConfig.padding = 0
      container.style.height = '500px' // 应用到容器
      refreshSidebarViewport()
    }

    if (!pendingFrame) {
      pendingFrame = true
      requestAnimationFrame(() => {
        container.style.transform = `translate(${translateX}px, ${translateY}px)` // 移动整个容器
        pendingFrame = false
      })
    }

    if (viewportWidth - clientX < 25) {
      sidebarHint.style.backgroundColor = 'rgba(55, 40, 32, 1)'
    } else {
      sidebarHint.style.backgroundColor = 'rgba(55, 40, 32, 0.8)'
    }

    startX = clientX
    startY = clientY
  }

  function stopDrag(e) {
    sidebarHint.style.display = 'none'
    draggable.style.cursor = 'grab'
    isDragging = false

    document.removeEventListener('mousemove', onDrag)
    document.removeEventListener('mouseup', stopDrag)
    document.removeEventListener('touchmove', onDrag) // 移除触摸移动事件
    document.removeEventListener('touchend', stopDrag) // 移除触摸结束事件

    container.style.willChange = 'auto'

    const finalClientX =
      e.clientX ?? e.changedTouches?.[0]?.clientX ?? e.touches?.[0]?.clientX ?? startX
    if (getLayoutViewportWidth() - finalClientX < 25 && draggable.id === 'header') {
      if (!globalConfig.padding) {
        if (globalState.closeIframe) {
          const toggle = document.getElementById('toggle-me')
          toggle.click()
        }
        globalConfig.padding = 232
        refreshSidebarViewport()
        translateX = 0
        translateY = 0
        container.style.transform = `translate(${translateX}px, ${translateY}px)` // 重置整个容器位置
      }
    }
  }
}
