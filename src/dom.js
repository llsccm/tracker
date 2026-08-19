import { CardConfig } from './config'
import { ConfigManager } from './config/ConfigManager'
import { clearZoneMirrors, drawMiZhu, drawSeatUIs } from './draw'
import { Game, globalConfig, globalState, UI } from './tracker'
import { setTrackerSeatUIReader, tracker } from './tracker/runtime/browser'
import { stopProtocolRecording } from './tracker/runtime/protocolRecorder'
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
import { bindPeiXiuHandSuitColorRefresh } from './ui/PeiXiuHandMirror'
import {
  bindProtocolRecorderControls,
  unbindProtocolRecorderControls
} from './ui/protocolRecorderControls'
import { loadInterfaceHtml } from './utils/htmlResource'
import { addTooltip } from './utils/notification'
import { setPeiXiuMapWindowVisible } from './ui/PeiXiuMapWindow'

let iframe = null
const version = import.meta.env.VITE_version ?? '0.9.0'

function getTrackedHandNumbers(seatID) {
  const config = CardConfig.GetInstance()
  return tracker
    .getTrackedPlayerHandCardIDs(seatID)
    .map((id) => config.getCardNumber(id))
    .filter((number) => number > 0)
}

export function Init() {
  bindInitialResize(globalConfig, resize)
  console.info('🚀 初始化...')
  return waitForLegacyFrameReady(initFrame)
}

export function Exit() {
  unbindProtocolRecorderControls()
  void stopProtocolRecording()
  Reflect.deleteProperty(window, 'innerWidth')
  return cleanupLifecycle({ resize, scheduleSetGameSize, SGSresize, globalState })
}

function resize() {
  const padding = Number(window.padding) || 0
  // innerWidth 是 Replaceable 属性；padding 为 0 时删除赋值产生的自有属性以恢复原生尺寸。
  if (padding > 0) window.innerWidth = document.documentElement.clientWidth - padding
  else Reflect.deleteProperty(window, 'innerWidth')
  document.documentElement.style.setProperty('--sgs-center-x', `${window.innerWidth / 2}px`)
}

function refreshSidebarViewport() {
  resize()
  window.dispatchEvent(new Event('resize'))
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
  }, 500)
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
    bindPeiXiuHandSuitColorRefresh()

    globalState.isFrameAdd = true

    return ConfigManager.GetInstance().loadAndParseConfigs()
  }
}

function setGameSize() {
  if (!SystemContext) return

  UI.width = (SystemContext.gameWidth * SystemContext.gameScale) >> 0
  UI.height = (SystemContext.gameHeight * SystemContext.gameScale) >> 0
  UI.scale = SystemContext.gameScale

  if (UI.seatUIs?.length > 0) {
    getSeatUiPos()
    if (UI.firstUpdateSeatUI) drawSeatUIs()
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

  // 斗地主按主视角相对先手的固定顺位调整左右侧落点。
  if (Game.isDouDiZhu && list.length === 3) {
    const myFixedViewId = list[0]?.fixedViewId

    if (myFixedViewId === 2) {
      top = 1
      right = 1
      left = 0
    } else if (myFixedViewId === 3) {
      top = 1
      left = 1
      right = 0
    }
  }

  if (Game.isShanHeTu && list.length === 3 && UI.friendGeneral === 1) {
    top = 1
    left = 1
    right = 0
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

/** 重置座位覆盖层状态并清理区域镜像。 */
export function resetSeatUIs() {
  UI.seatUIs = []
  UI.firstUpdateSeatUI = false
  UI.friendGeneral = 0
  clearZoneMirrors()
}

export function getSeatUIs() {
  const trackerRoom = tracker.getTrackerRoom()
  if (!trackerRoom?.seatIDs?.length || trackerRoom.mySeatID === undefined) return

  const { seatIDs, players, mySeatID } = trackerRoom
  const startIndex = seatIDs.indexOf(Number(mySeatID))
  if (startIndex < 0) return

  // 从主视角开始循环排列物理座位，同时保留相对先手的固定顺位。
  UI.seatUIs = seatIDs.map((_, index) => {
    const seatID = seatIDs[(startIndex + index) % seatIDs.length]
    return {
      seatID,
      fixedViewId: players.get(Number(seatID))?.fixedViewId
    }
  })

  // 先手和主视角都确定后才计算位置，容器仍保持 hidden，首轮开始时再显示。
  getSeatUiPos()
  if (trackerRoom.firstID !== undefined) drawSeatUIs()
}

setTrackerSeatUIReader(getSeatUIs)

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
  initDragElement(globalConfig, globalState, refreshSidebarViewport)
  // drawChatFace()
}

function buttonClick() {
  const detailBlockSwitchIds = [
    'blockKillEffectSwitch',
    'blockSkinStateSwitch',
    'skipAdWindowSwitch',
    'skipPackageWindowSwitch',
    'blockMvpSettlementSwitch'
  ]
  const getSwitchElement = (configKey) => document.getElementById(configKey)
  const setSwitchChecked = (configKey, value) => {
    const element = getSwitchElement(configKey)
    if (element) element.checked = value
  }

  const setConfigSwitch = (configKey, value) => {
    globalConfig[configKey] = value
    setSwitchChecked(configKey, value)
  }

  const syncEffectBlockSwitchFromDetails = () => {
    const enabled = detailBlockSwitchIds.some((configKey) => Boolean(globalConfig[configKey]))
    setConfigSwitch('effectBlockSwitch', enabled)
  }

  const syncDetailBlockSwitches = (switchValue) => {
    detailBlockSwitchIds.forEach((configKey) => setConfigSwitch(configKey, switchValue))
  }

  const switchHandlers = {
    seatUISwitch(switchValue) {
      document.getElementById('seatUI').style.display = switchValue ? 'block' : 'none'
    },
    cardLabelSwitch() {},
    showNameSwitch() {},
    rogueCitySwitch(switchValue) {
      switchValue && UI.cities ? drawCitiesUI(UI.cities) : drawCitiesUI('')
    },
    debugLogSwitch() {},
    peiXiuMapSwitch(switchValue) {
      setPeiXiuMapWindowVisible(switchValue)
    },
    effectBlockSwitch(switchValue) {
      syncDetailBlockSwitches(switchValue)
    },
    blockKillEffectSwitch() {
      syncEffectBlockSwitchFromDetails()
    },
    blockSkinStateSwitch() {
      syncEffectBlockSwitchFromDetails()
    },
    skipAdWindowSwitch() {
      syncEffectBlockSwitchFromDetails()
    },
    skipPackageWindowSwitch() {
      syncEffectBlockSwitchFromDetails()
    },
    blockMvpSettlementSwitch() {
      syncEffectBlockSwitchFromDetails()
    }
  }

  const switchConfigKeys = Object.keys(switchHandlers)

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
          refreshSidebarViewport()
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
    if (!switchElement?.matches?.('input[type="checkbox"]')) return

    const configKey = switchElement.dataset.configKey || switchElement.id
    const handler = switchHandlers[configKey]
    if (!handler) return

    const switchValue = switchElement.checked
    globalConfig[configKey] = switchValue
    handler(switchValue)
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
  refreshSidebarViewport()

  switchConfigKeys.forEach((configKey) =>
    setSwitchChecked(configKey, Boolean(globalConfig[configKey]))
  )

  const switchRoot = document.getElementById('createIframe')
  if (switchRoot && !switchRoot.dataset.switchDelegationBound) {
    switchRoot.dataset.switchDelegationBound = 'true'
    switchRoot.addEventListener('change', handleSwitchChange)
  }

  syncEffectBlockSwitchFromDetails()

  // bindExternalLinks()

  document.getElementById('mizhu').onmousedown = function () {
    // const mzBTNs = document.querySelectorAll('.mizhu')
    // mzBTNs.forEach((e) => (e.style.display = 'none'))
    drawMiZhu(getTrackedHandNumbers(Game.myID))
    // 统率可能要算糜竺 暂不兼容
  }

  // 屏蔽设置对话框控制
  const blockEffectContainer = document.getElementById('blockEffectContainer')
  const blockEffectDialog = document.getElementById('blockEffectDialog')
  if (blockEffectContainer && blockEffectDialog) {
    const explanation = blockEffectContainer.querySelector('.explanation')
    if (explanation) {
      explanation.onclick = function () {
        // 点击齿轮打开弹窗
        blockEffectDialog.showModal()
      }
    }
    const closeBtn = blockEffectDialog.querySelector('.dialog-close-btn')
    if (closeBtn) {
      closeBtn.onclick = function () {
        blockEffectDialog.close()
      }
    }

    blockEffectDialog.onclick = function (event) {
      if (event.target === blockEffectDialog) {
        blockEffectDialog.close()
      }
    }
  }

  bindProtocolRecorderControls()
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
