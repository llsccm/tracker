import { CardConfig } from './config'
import { ConfigManager } from './config/ConfigManager'
import { clearZoneMirrors, drawMiZhu, drawSeatUIs } from './draw'
import { Game, globalConfig, globalState, UI } from './tracker'
import { setTrackerSeatUIReader, tracker } from './tracker/runtime/browser'
import { drawCitiesUI } from './ui/CitiesUI'
import { bindDelegatedTooltips } from './ui/domHelpers'
import { addDragHint, initDragElement } from './ui/drag'
import { getPanelContentInner, initInjectedInterface } from './ui/frameContent'
import {
  bindInitialResize,
  cleanupLifecycle,
  installSystemContextResizeDispatchers,
  removeInjectedDom,
  waitForLegacyFrameReady
} from './ui/lifecycle'
import { addSeatUI } from './ui/seatOverlay'
import { createMainShell } from './ui/shell'
import { loadInterfaceHtml } from './utils/htmlResource'
import { addTooltip } from './utils/notification'

// import {buildActivityPlannerInput} from './utils/activityPlanner.js';
let iframe = null
const version = import.meta.env.VITE_version ?? '0.9.0'

export var Sdocument = document.getElementById('createSkinIframeSource')?.contentWindow?.document

function getTrackedHandNumbers(seatID) {
  const config = CardConfig.GetInstance()
  return (tracker.getReadyTrackerRoom()?.getPlayerHandCardIDs(seatID) ?? [])
    .map((id) => config.getCardNumber(id))
    .filter((number) => number > 0)
}

export function Init() {
  bindInitialResize(globalConfig, resize)
  console.info('🚀 初始化...')
  return waitForLegacyFrameReady(initFrame)
}

export function Exit() {
  return cleanupLifecycle({ resize, scheduleSetGameSize, SGSresize, globalState })
}

function resize() {
  window.innerWidth = document.documentElement.clientWidth - window.padding
  document.documentElement.style.setProperty('--sgs-center-x', `${window.innerWidth / 2}px`)
}

function SGSresize() {
  window.dispatchEvent(new Event('resize'))
}

let updateTimeout

//防抖
function scheduleSetGameSize() {
  // window.innerWidth = document.documentElement.clientWidth - window.padding;

  if (updateTimeout) clearTimeout(updateTimeout)

  updateTimeout = setTimeout(() => {
    setGameSize()
    updateTimeout = null
  }, 500) // 延迟 100 毫秒调用 setGameSize
}

export async function initFrame(force = false) {
  if (typeof SystemContext == 'undefined') return

  if (force) {
    removeInjectedDom(globalState)
  }

  if (!globalState.isFrameAdd) {
    // 监听变化事件
    window.addEventListener('resize', scheduleSetGameSize)

    installSystemContextResizeDispatchers()
    window.addEventListener('SGSresize', SGSresize)

    try {
      //禁止拖动背景
      document.getElementById('bgDiv').firstElementChild.draggable = false
      //移除4399服的CSS
      document.querySelector('link[rel=stylesheet]')?.remove()
    } catch {
      console.error('移除4399服的CSS失败')
    }

    //injectCSS()
    addSeatUI(globalConfig)
    // addDynamicBG()
    await addFrame()

    globalState.isFrameAdd = true

    return ConfigManager.GetInstance().loadAndParseConfigs()
  }
}

function setGameSize() {
  if (!SystemContext) return

  UI.width = (SystemContext.gameWidth * SystemContext.gameScale) >> 0
  UI.height = (SystemContext.gameHeight * SystemContext.gameScale) >> 0
  UI.scale = SystemContext.gameScale

  if (UI.seatUIs && UI.seatUIs.length > 0) {
    getSeatUiPos()
    drawSeatUIs()
  }

  const app = {
    width: ((SystemContext.gameWidth * SystemContext.gameScale) >> 0) / window.devicePixelRatio,
    height: ((SystemContext.gameHeight * SystemContext.gameScale) >> 0) / window.devicePixelRatio
  }

  if (globalConfig.padding && document.getElementById('createIframe')) {
    document.getElementById('bgDiv').style.width = document.documentElement.clientWidth + 'px'
    document.getElementById('createIframe').style.height = '100%'
    document.getElementById('createIframe').style.right = '0px' // 启用窗口调整大小
    document.getElementById('createIframe').style.top = '0px' // 启用窗口调整大小
  } else {
    document.getElementById('bgDiv').style.width = document.documentElement.clientWidth + 'px'
  }

  // let cusBGDiv = document.getElementById('cusBGDiv')
  // let sgsBgVideo = document.getElementById('sgsBgVideo')
  // let imgBG = document.getElementById('sgsBgIMG')
  const seatUI = document.getElementById('seatUI')
  const rogueUI = document.getElementById('rogueUI')

  const top =
    ((window.innerHeight * window.devicePixelRatio -
      SystemContext.gameScale * SystemContext.gameHeight) /
      (2 * window.devicePixelRatio) +
      (SystemContext.gameScale * SystemContext.gameHeight) / 2) /
    window.devicePixelRatio

  // if (cusBGDiv) {
  //   cusBGDiv.style.width = `${app.width}px`
  //   cusBGDiv.style.height = `${app.height}px`
  //   cusBGDiv.style.left = window.innerWidth / 2 + 'px'
  //   cusBGDiv.style.top = top + 'px'
  // }

  // if (sgsBgVideo) {
  // sgsBgVideo.width = app.width // 设置视频宽度为 bgDiv 的宽度
  // sgsBgVideo.height = app.height // 设置视频高度为 bgDiv 的高度
  // sgsBgVideo.style.left = window.innerWidth / 2 + 'px'
  // sgsBgVideo.style.top = top + 'px'
  // }

  // imgBG.width = app.width // 设置图片宽度为 bgDiv 的宽度
  // imgBG.height = app.height // 设置图片高度为 bgDiv 的高度
  // imgBG.style.left = (window.innerWidth / 2) + 'px';
  // imgBG.style.top = top + 'px';

  seatUI.style.width = `${app.width}px`
  seatUI.style.height = `${app.height}px`
  seatUI.style.left = window.innerWidth / 2 + 'px'
  seatUI.style.top = top + 'px'
  // drawDeckEdgeUI()
  window.dispatchEvent(new CustomEvent('dxc-seat-overlay-layout'))
  rogueUI.style.width = `${app.width}px`
  rogueUI.style.height = `${app.height}px`
  rogueUI.style.left = window.innerWidth / 2 + 'px'
  rogueUI.style.top = top + 'px'
  UI.centerX = window.innerWidth > app.width ? app.width / 2 : window.innerWidth / 2
  UI.centerY = app.height / 2
  document.documentElement.style.setProperty('--sgs-center-x', `${UI.centerX}px`)
}

function getSeatUiPos() {
  const list = UI.seatUIs || []
  const metrics = getSeatLayoutMetrics()

  UI.ScaleWidth = metrics.seatWidth
  UI.ScaleHeight = metrics.seatHeight

  if (list.length <= 1) return

  const seatCount = getSeatLayoutCount(list)
  let nextIndex = 1

  nextIndex = layoutRightSeats(list, nextIndex, seatCount.right, metrics)
  nextIndex = layoutTopSeats(list, nextIndex, seatCount.top, metrics)
  layoutLeftSeats(list, nextIndex, seatCount.left, metrics)
}

function getSeatLayoutMetrics() {
  const scale = UI.scale

  return {
    scale,
    dpr: window.devicePixelRatio,
    width: UI.width,
    height: UI.height,
    seatWidth: UI.unscaledWidth * scale,
    seatHeight: UI.unscaledHeight * scale,
    selfSeatHeight: UI.selfSeatUiUnscaledHeight * scale,
    rightBarWidth: UI.rightBarWidth * scale,
    topPadding: (UI.paddingTop + 10) * scale
  }
}

function getSeatLayoutCount(list) {
  const otherSeatCount = list.length - 1
  let top = getDefaultTopSeatCount(otherSeatCount)
  let right = (otherSeatCount - top) >> 1
  let left = otherSeatCount - right - top

  // 斗地主和山河图的三人布局会按主视角调整左右侧落点。
  if (Game.isDouDiZhu) {
    if (list[0]?.actualSeatID === 2) {
      top = 1
      right = 1
    } else if (list[0]?.actualSeatID === 3) {
      top = 1
      left = 1
    }
  }

  if (Game.isShanHeTu && list.length === 3 && UI.friendGeneral === 1) {
    top = 1
    left = 1
  }

  return { top, right, left }
}

function getDefaultTopSeatCount(otherSeatCount) {
  if (otherSeatCount < 3) return otherSeatCount
  if (otherSeatCount === 3) return 1
  if (otherSeatCount === 4 || otherSeatCount === 6) return 2
  if (otherSeatCount === 5 || otherSeatCount === 7) return 3

  return 0
}

function layoutRightSeats(list, startIndex, count, metrics) {
  if (count <= 0) return startIndex

  const { measuredHeight, gap } = getVerticalSeatLayout(count, metrics)
  const endIndex = startIndex + count
  const x =
    metrics.width - metrics.seatWidth - UI.paddingRight * metrics.scale - metrics.rightBarWidth
  let y = getSideSeatsStartY(measuredHeight, metrics) + measuredHeight

  UI.verticalGap = gap

  for (let index = startIndex; index < endIndex; index += 1) {
    y -= metrics.seatHeight
    setSeatPosition(list[index], 'Right', x - 5, y + metrics.seatHeight, metrics.dpr)
    y -= gap
  }

  return endIndex
}

function layoutTopSeats(list, startIndex, count, metrics) {
  if (count <= 0) return startIndex

  let measuredWidth = metrics.seatWidth * count
  const gap = ((metrics.width - metrics.rightBarWidth - measuredWidth) * 0.07) >> 0
  const endIndex = startIndex + count
  const y = metrics.topPadding + metrics.seatHeight
  measuredWidth += (count - 1) * gap

  let x =
    (metrics.width - measuredWidth - metrics.rightBarWidth) / 2 +
    measuredWidth +
    (metrics.width <= 1600 ? UI.paddingLeftTopExtra : 0)

  UI.horizontalGap = gap

  for (let index = startIndex; index < endIndex; index += 1) {
    x -= metrics.seatWidth
    setSeatPosition(list[index], 'Top', x, y, metrics.dpr)
    x -= gap
  }

  return endIndex
}

function layoutLeftSeats(list, startIndex, count, metrics) {
  if (count <= 0) return startIndex

  const { measuredHeight, gap } = getVerticalSeatLayout(count, metrics)
  const endIndex = startIndex + count
  const x = UI.paddingLeft * metrics.scale
  let y = getSideSeatsStartY(measuredHeight, metrics)

  for (let index = startIndex; index < endIndex; index += 1) {
    setSeatPosition(list[index], 'Left', x, y + metrics.seatHeight, metrics.dpr)
    y += metrics.seatHeight + gap
  }

  return endIndex
}

function getVerticalSeatLayout(count, metrics) {
  let measuredHeight = metrics.seatHeight * count
  const gap = ((metrics.height - metrics.selfSeatHeight - measuredHeight) * 0.25) >> 0
  measuredHeight += (count - 1) * gap

  return { measuredHeight, gap }
}

function getSideSeatsStartY(measuredHeight, metrics) {
  return (
    ((metrics.height -
      metrics.selfSeatHeight -
      measuredHeight -
      UI.paddingTop * metrics.scale -
      UI.paddingBottom) >>
      1) +
    metrics.topPadding +
    UI.leftRightTop
  )
}

function setSeatPosition(seatUI, displayLocation, x, y, dpr) {
  if (!seatUI) return

  seatUI.DisplayLocation = displayLocation
  seatUI.posX = (x >> 0) / dpr
  seatUI.posY = (y >> 0) / dpr
}

/**
 * 重绘座位覆盖层明牌框。
 * @param {{ reset?: boolean }} [options]
 */
export function getSeatUIs({ reset = false } = {}) {
  // 如果有 则先清除前面的 再画seatUI
  UI.seatUIs = []
  UI.friendGeneral = 0
  drawSeatUIs()
  if (reset) return

  const trackerRoom = tracker.getTrackerRoom()
  // 从我开始逆时针排列 例如房间 2301 我的id是 3 则 变成 3012 用这个顺序去排列seatUI
  const UIOrder = getTrackerSeatSequence(trackerRoom)
  if (!UIOrder.length) return

  // 从游戏开始的seatid去排列，例如房间 2301 firstid是 1 则 变成 1230 id为值 序号为座位号+1，则id为1 是1号位 id为0是4号位
  // let seatOrder = room.sequence(room.firstID);
  // UI.seatUIs actualSeatID 为座位号，排列数组为UIOrder 如 3012 中 3 对应 actualSeatID 为 3； 0 actualSeatID 为 4； 1 actualSeat 1； 2 actualSeat 2
  UI.seatUIs = UIOrder.map((seatID, index) => {
    // actualSeatID 对应屏幕 UI 位置：1 是自己，2+ 是其他玩家。
    // 出牌座位序号使用新版 Player.fixedViewId，避免手牌框位置与座位号混用。
    return {
      actualSeatID: index + 1,
      seatID,
      order: getTrackerPlayerOrder(trackerRoom, seatID)
    }
  })

  // UI.seatUIs = order.map(seatID => ({ actualSeatID: order.indexOf(seatID) + 1 }));

  // UI.seatUIs = room.sequence(room.firstID).map((seatID) => ({ actualSeatID: seatID + 1 }));
  //console.info(UI.seatUIs)
  getSeatUiPos()
  drawSeatUIs()
  window.dispatchEvent(new CustomEvent('dxc-seat-overlay-layout'))
}

setTrackerSeatUIReader(getSeatUIs)

function getTrackerSeatSequence(room) {
  if (!room?.seatIDs?.length || room.mySeatID === undefined) return []

  const startIndex = room.seatIDs.indexOf(Number(room.mySeatID))
  if (startIndex < 0) return []

  return room.seatIDs.slice(startIndex).concat(room.seatIDs.slice(0, startIndex))
}

function getTrackerPlayerOrder(room, seatID) {
  const fixedViewId = room?.players?.get(Number(seatID))?.fixedViewId
  return Number.isFinite(fixedViewId) ? fixedViewId - 1 : undefined
}

export async function addFrame() {
  if (!document.getElementById('createIframe')) {
    const shell = createMainShell(version)
    iframe = shell.iframe

    if (localStorage.getItem('DXCVersion') != version) {
      addTooltip(`小抄已经更新到${version}`, 'acTooltip', 15000)
      localStorage.setItem('DXCVersion', version)
    }

    try {
      iframe.innerHTML = await loadInterfaceHtml()
    } catch (error) {
      console.error('Failed to load iframe content:', error)
    }

    initInjectedInterface({
      container: iframe,
      expandJiePanel,
      bindDelegatedTooltips
    })
  }

  addDragHint()
  buttonClick()
  initDragElement(globalConfig, globalState)
  // drawChatFace()
}

function buttonClick() {
  const retainedSwitchIds = new Set([
    'seatUISwitch',
    'cardLabelSwitch',
    'rogueCitySwitch',
    'debugLogSwitch'
  ])
  const isDeprecatedElement = () => false

  const toggle = document.getElementById('toggle-me')
  if (toggle) {
    toggle.onclick = function () {
      globalState.closeIframe = !globalState.closeIframe

      const container = document.getElementById('createIframe')
      if (globalState.closeIframe) {
        container.classList.add('collapsed')
        toggle.innerText = '+'
        document.getElementById('title').innerText = '小抄'
        container.style.top = '31px'
        container.style.right = '155px'

        if (globalConfig.padding) {
          globalConfig.padding = 0
          window.dispatchEvent(new Event('resize'))
          container.style.transform = 'translate(0px, 0px)'
        }
      } else {
        container.classList.remove('collapsed')
        toggle.innerText = '-'
        document.getElementById('title').innerText = '三国杀小抄' + version
        expandJiePanel({ defer: true })
      }
    }
  }

  // 定义一个函数来处理保留开关状态更改事件
  function handleSwitchChange(event) {
    const switchElement = event.target
    const configKey = switchElement.dataset.configKey || switchElement.id
    if (!retainedSwitchIds.has(configKey) || isDeprecatedElement(switchElement)) return

    const switchValue = switchElement.checked
    globalConfig[configKey] = switchValue

    if (configKey == 'seatUISwitch') {
      document.getElementById('seatUI').style.display = switchValue ? 'block' : 'none'
    } else if (configKey == 'rogueCitySwitch') {
      switchValue && UI.cities ? drawCitiesUI(UI.cities) : drawCitiesUI('')
    }
  }

  //侧边栏 初始化 记住状态
  // 1 状态 不在侧边栏 则缩起来
  // 2 状态 在侧边栏 则展示全部
  if (window.padding == 0) {
    toggle?.click()
    // document.getElementById('createIframe').style.top = '0px'
    // document.getElementById('createIframe').style.right = '0px';
    // document.getElementById('createIframe').style.left = '';
  }
  window.dispatchEvent(new Event('resize'))

  // 只为保留功能开关添加事件监听器：座位 UI、卡牌标签、山河地图
  document.querySelectorAll('input[id$="Switch"]').forEach((element) => {
    const configKey = element.dataset.configKey || element.id
    if (!retainedSwitchIds.has(configKey) || isDeprecatedElement(element)) return
    element.checked = Boolean(globalConfig[configKey])
    element.addEventListener('change', handleSwitchChange)
  })

  // bindExternalLinks()

  document.getElementById('mizhu').onmousedown = function () {
    const mzBTNs = document.querySelectorAll('.mizhu')
    if (Game.mySeats.length <= 1) {
      mzBTNs.forEach((e) => (e.style.display = 'none'))
      drawMiZhu(getTrackedHandNumbers(Game.myID))
    } else
      Game.mySeats.forEach((seatID, i) => {
        mzBTNs[i].style.display = 'block'
        mzBTNs[i].innerText = Game.name(seatID)
        mzBTNs[i].onclick = () => {
          drawMiZhu(getTrackedHandNumbers(seatID))
        }
        if (i == 0) mzBTNs[i].click()
      })
  }
}

function expandJiePanel(options = {}) {
  const { defer = false } = options

  const apply = () => {
    const layaHeader = document.querySelector('.jie-header')
    if (!layaHeader) return

    const panelContent = layaHeader.nextElementSibling
    if (!panelContent) return

    getPanelContentInner(panelContent)
    panelContent.style.removeProperty('max-height')
    layaHeader.classList.add('active')
  }

  if (defer) {
    requestAnimationFrame(apply)
  } else {
    apply()
  }
}

/**
 * 重置新一局开始时的界面状态。
 *
 * 清空上局残留的卡牌分类、出牌顺序与座位覆盖层内容，并按当前玩法刷新扩展 UI。
 */
export function resetGameUiState() {
  // 清空上一局遗留的卡牌分类区域。
  // for (let i = 1; i <= 4; i++) document.getElementById('type' + i).innerHTML = ''

  // 清空出牌顺序区域，同时恢复每列对应的序号提示。
  // for (const e of document.getElementsByClassName('order-body')) {
  //   e.innerHTML = ''
  //   e.title = '零一二三四五六七八'[e.id.slice(-1)] ?? e.title
  // }

  // 重绘座位覆盖层，并根据当前模式刷新山河图相关 UI。
  UI.seatUIs = []
  // drawSeatUIs()
  clearZoneMirrors()
  // handleRogueLike()
}
