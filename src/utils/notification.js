const notificationQueue = [] // 队列来存储通知
let isNotificationShowing = false // 标志当前是否有通知正在显示
let currentTimeout = null // Store timeout for updating notifications
export const TOOLTIP_BG = "url('https://web.sanguosha.com/220/h5_2/res/assets/bigPng/propGet.png')"
const TOOLTIP_STYLE = {
  position: 'fixed',
  top: '20px',
  left: '50%',
  zIndex: '2147483647',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '12px 24px',
  borderRadius: '4px',
  backgroundColor: 'transparent',
  backgroundImage: TOOLTIP_BG,
  backgroundSize: '100% 100%',
  fontSize: '16px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Tahoma, Arial, sans-serif',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  pointerEvents: 'auto',
  transform: 'translateX(-50%)',
  textShadow: '0 0 4px rgba(0,0,0,0.6)',
  transition: 'opacity 0.3s ease, visibility 0.3s ease'
}

function applyTooltipStyle(el, className, visible = false) {
  Object.assign(el.style, TOOLTIP_STYLE, {
    color: '#f2de9c',
    opacity: visible ? '1' : '0',
    visibility: visible ? 'visible' : 'hidden'
  })
}

//两种通知方式
/**
 * Add a tooltip notification.
 * @param {string} text - The message to display.
 * @param {string} id - ID for the notification (used in sequential mode).
 * @param {number} duration - Duration in milliseconds for the notification.
 * @param {string} className - Optional CSS class for styling.
 * @param {function} clickCallback - Optional click event handler.
 * @param {boolean} shouldUpdate - If true, update the notification in place.
 */
export function addTooltip(
  text,
  id = 'acTooltip',
  duration = 10000,
  className = '',
  clickCallback = null,
  shouldUpdate = false
) {
  if (shouldUpdate) {
    updateOrCreateTooltip(text, id, duration, className)
  } else {
    notificationQueue.push({ text, id, duration, className, clickCallback })
    if (!isNotificationShowing) showNextNotification()
  }
}

/**
 * Update the tooltip in place or create it if it doesn't exist.
 */
function updateOrCreateTooltip(text, id, duration, className) {
  let element = document.getElementById(id)

  if (!element) {
    element = document.createElement('div')
    element.id = id
    element.className = 'ac-tooltip ' + className
    document.body.appendChild(element)
  }
  element.innerHTML = text
  element.className = 'ac-tooltip ' + className
  applyTooltipStyle(element, className)
  element.onclick = () => {
    removeTooltip(id)
  }
  setTimeout(() => {
    element.classList.remove('hide')
    element.classList.add('show')
    applyTooltipStyle(element, className, true)
  }, 50)
  // Reset the timer for the tooltip's duration
  if (currentTimeout) clearTimeout(currentTimeout)
  currentTimeout = setTimeout(() => removeTooltip(id), duration)
}

// msg 为HTML
// 时长固定3秒 不可点击 不能加button之类的互动
export function tooltipSGS(msg) {
  if (ChannelUtils?.openQQBuy) {
    ChannelUtils.openQQBuy({ ret: true, msg: msg })
    return
  }
}

function showNextNotification() {
  if (notificationQueue.length === 0) {
    isNotificationShowing = false
    return
  }

  isNotificationShowing = true

  const { text, id, duration, className, clickCallback } = notificationQueue.shift()

  const ele = document.getElementById(id)
  ele && ele.remove()
  const uniqueId = id + '-' + new Date().getTime() // 生成唯一ID
  const div = document.createElement('div')
  div.id = uniqueId
  div.className = 'ac-tooltip ' + className
  div.innerHTML = text
  applyTooltipStyle(div, className)
  document.body.appendChild(div)
  // Add click event listener if a callback is provided
  if (clickCallback && typeof clickCallback === 'function') {
    div.addEventListener('click', clickCallback)
  }
  // Add click event listener to close the notification
  div.addEventListener('click', () => {
    removeTooltip(uniqueId)
    showNextNotification() // 显示下一个通知
  })
  setTimeout(() => {
    div.classList.remove('hide')
    div.classList.add('show')
    applyTooltipStyle(div, className, true)
  }, 50)

  if (duration) {
    setTimeout(() => {
      removeTooltip(uniqueId)
      showNextNotification() // 显示下一个通知
    }, duration)
  } else {
    isNotificationShowing = false
  }
}

function removeTooltip(id) {
  const ele = document.getElementById(id)
  if (ele) {
    ele.classList.remove('show')
    ele.classList.add('hide')
    applyTooltipStyle(ele, ele.classList.contains('green') ? 'green' : '', false)
    setTimeout(() => {
      ele && ele.remove()
    }, 300) // 等待动画结束后再移除元素
  }
}
