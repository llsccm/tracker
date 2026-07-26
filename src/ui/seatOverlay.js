export function addSeatUI(globalConfig) {
  var seatUI = document.createElement('div')
  seatUI.id = 'seatUI'
  seatUI.style.position = 'absolute'
  seatUI.style.top = '50%'
  seatUI.style.left = '50%'
  seatUI.style.transform = 'translate(-50%, -50%)'
  seatUI.style.pointerEvents = 'none' // 确保点击事件穿透
  seatUI.style.display = ''

  var rogueUI = document.createElement('div')
  rogueUI.id = 'rogueUI'
  rogueUI.style.position = 'absolute'
  rogueUI.style.top = '50%'
  rogueUI.style.left = '50%'
  rogueUI.style.transform = 'translate(-50%, -50%)'
  rogueUI.style.pointerEvents = 'none' // 确保点击事件穿透
  rogueUI.style.display = ''

  var deckEdgeUI = document.createElement('div')
  deckEdgeUI.id = 'deckEdgeUI'
  deckEdgeUI.className = 'sorderContainer deckEdgeUI'
  deckEdgeUI.style.display = 'none'
  seatUI.appendChild(deckEdgeUI)

  const seatSlotFragment = document.createDocumentFragment()
  for (let i = 1; i <= 8; i++) {
    const orderContainer = document.createElement('div')
    orderContainer.className = 'sorderContainer'
    orderContainer.id = 'or' + i
    orderContainer.style.display = 'none'

    const orderBody = document.createElement('div')
    orderBody.className = 'sorder-body'
    orderBody.classList.add('sNo' + i)
    orderBody.id = 's' + i
    orderContainer.appendChild(orderBody)

    seatSlotFragment.appendChild(orderContainer)
  }
  seatUI.appendChild(seatSlotFragment)
  // 初始化
  // 关闭明牌框框 不需要将山河图的城市也关了
  globalConfig.seatUISwitch
    ? (seatUI.style.display = 'block')
    : ((seatUI.style.display = 'none'),
      document
        .querySelectorAll('#seatUI > *:not(.city)')
        .forEach((el) => (el.style.display = 'none')))

  document.body.appendChild(seatUI)
  document.body.appendChild(rogueUI)
}

export function resetOrderContainer() {
  for (let i = 0; i <= 7; i++) {
    const o = 'or' + (i + 1)
    const orderContainer = document.querySelector('#seatUI #' + o)
    if (!orderContainer) continue

    orderContainer.style.display = 'flex'
    orderContainer.style.visibility = 'hidden'
    orderContainer.style.removeProperty('top')
    orderContainer.style.removeProperty('left')
    orderContainer.style.removeProperty('width')
  }
}

export function hideOrderContainer(size) {
  for (let i = 7; i >= size; i--) {
    const o = 'or' + (i + 1)
    const orderContainer = document.querySelector('#seatUI #' + o)
    if (!orderContainer) continue

    orderContainer.style.display = 'none'
    orderContainer.style.visibility = 'hidden'
  }
}

/** 隐藏主视角的明牌框 */
export function hideSelfOrderContainer(displayID) {
  if (!displayID) return false
  const orderContainer = document.querySelector('#seatUI #or' + displayID)
  if (!orderContainer) return false

  orderContainer.style.display = 'none'
  orderContainer.style.visibility = 'hidden'
  return true
}

/** 第一轮开始时显示已经定位的有效座位，主视角因 display:none 保持隐藏。 */
export function showOrderContainers() {
  for (let i = 1; i <= 8; i++) {
    const orderContainer = document.querySelector('#seatUI #or' + i)
    if (!orderContainer || orderContainer.style.display === 'none') continue
    orderContainer.style.visibility = 'visible'
  }
}
