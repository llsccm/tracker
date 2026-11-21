import { CardConfig } from './config'
import { ConfigManager } from './config/ConfigManager'
import { drawMiZhu, refreshZoneMirrorOverflow } from './draw'
import { laya } from './runtime/gameAdapter'
import { Game, globalConfig, globalState, UI } from './tracker'
import { setTrackerSeatUIReader, tracker } from './tracker/runtime/browser'
import { drawCitiesUI } from './ui/CitiesUI'
import { bindDelegatedTooltips } from './ui/domHelpers'
import { addDragHint, initDragElement } from './ui/drag'
import { getPanelContentInner, initInjectedInterface } from './ui/frameContent'
import { configureViewport, removeInjectedDom, waitForLegacyFrameReady } from './ui/lifecycle'
import { createSeatOverlay, setSeatOverlayVisible, updateSeatOverlay } from './ui/seatOverlay'
import { createMainShell } from './ui/shell'
import { requestWindowResize, subscribeWindowResize } from './ui/windowResize'
import { bindPeiXiuHandSuitColorRefresh } from './ui/PeiXiuHandMirror'
import { bindProtocolRecorderControls } from './ui/protocolRecorderControls'
import { loadInterfaceHtml } from './utils/htmlResource'
import { addTooltip } from './utils/notification'
import { setPeiXiuMapWindowVisible } from './ui/PeiXiuMapWindow'

let iframe = null
const version = import.meta.env.VITE_version ?? '0.9.0'
const GAME_SIZE_DEBOUNCE_MS = 150

function getTrackedHandNumbers(seatID) {
  const config = CardConfig.GetInstance()
  return tracker
    .getTrackedPlayerHandCardIDs(seatID)
    .map((id) => config.getCardNumber(id))
    .filter((number) => number > 0)
}

export function Init() {
  configureViewport(globalConfig)
  startGameSizeUpdates()
  console.info('🚀 初始化...')
  return waitForLegacyFrameReady(initFrame)
}

function updateViewportCenter() {
  document.documentElement.style.setProperty('--sgs-center-x', `${window.innerWidth / 2}px`)
}

let updateTimeout = null
let stopWindowResize = null
let overflowFrame = null

function startGameSizeUpdates() {
  stopGameSizeUpdates()
  stopWindowResize = subscribeWindowResize(() => {
    updateViewportCenter()
    scheduleSetGameSize()
  })
}

function stopGameSizeUpdates() {
  stopWindowResize?.()
  stopWindowResize = null
  if (updateTimeout !== null) clearTimeout(updateTimeout)
  updateTimeout = null
  if (overflowFrame !== null) cancelAnimationFrame(overflowFrame)
  overflowFrame = null
}

function scheduleSetGameSize() {
  if (updateTimeout !== null) clearTimeout(updateTimeout)

  updateTimeout = setTimeout(() => {
    updateTimeout = null
    setGameSize()
  }, GAME_SIZE_DEBOUNCE_MS)
}

export async function initFrame(force = false) {
  if (!stopWindowResize) return

  if (force) {
    stopGameSizeUpdates()
    removeInjectedDom(globalState)
  }

  if (!globalState.isFrameAdd) {
    startGameSizeUpdates()
    const stopCurrentResize = stopWindowResize

    try {
      //禁止拖动背景
      document.getElementById('bgDiv').firstElementChild.draggable = false
      //移除4399服的CSS
      document.querySelector('link[rel=stylesheet]')?.remove()
    } catch {
      console.error('移除4399服的CSS失败')
    }

    //injectCSS()
    createSeatOverlay(globalConfig)
    // addDynamicBG()
    await addFrame(stopCurrentResize)
    // 重建后，不继续处理旧界面的异步初始化。
    if (stopWindowResize !== stopCurrentResize) return
    setGameSize()
    bindPeiXiuHandSuitColorRefresh()

    globalState.isFrameAdd = true

    return ConfigManager.GetInstance().loadAndParseConfigs()
  }
}

function setGameSize() {
  const bgDiv = document.getElementById('bgDiv')
  if (bgDiv) bgDiv.style.width = document.documentElement.clientWidth + 'px'

  const shell = document.getElementById('tracker-shell')
  if (globalConfig.padding && shell) {
    shell.style.height = '100%'
    shell.style.right = '0px'
    shell.style.top = '0px'
  }

  updateSeatOverlay(tracker.getTrackerRoom())

  if (overflowFrame !== null) cancelAnimationFrame(overflowFrame)
  overflowFrame = requestAnimationFrame(() => {
    overflowFrame = null
    refreshZoneMirrorOverflow()
  })
}

setTrackerSeatUIReader(() => updateSeatOverlay(tracker.getTrackerRoom()))

export async function addFrame(stopCurrentResize = stopWindowResize) {
  if (!document.getElementById('tracker-shell')) {
    const shell = createMainShell(version)
    iframe = shell.iframe

    if (localStorage.getItem('DXCVersion') != version) {
      addTooltip(`小抄已经更新到${version}`, 'acTooltip', 15000)
      localStorage.setItem('DXCVersion', version)
    }

    let html
    try {
      html = await loadInterfaceHtml()
    } catch (error) {
      console.error('Failed to load iframe content:', error)
    }

    if (stopWindowResize !== stopCurrentResize) return
    if (html !== undefined) iframe.innerHTML = html

    initInjectedInterface({
      container: iframe,
      expandJiePanel,
      bindDelegatedTooltips
    })
  }

  addDragHint()
  buttonClick()
  initDragElement(globalConfig, globalState, requestWindowResize)
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
      setSeatOverlayVisible(switchValue)
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

      const container = document.getElementById('tracker-shell')
      if (globalState.closeIframe) {
        container.classList.add('collapsed')
        toggle.innerText = '+'
        document.getElementById('title').innerText = '小抄'
        container.style.top = '31px'
        container.style.right = '155px'

        if (globalConfig.padding) {
          globalConfig.padding = 0
          requestWindowResize()
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
    // document.getElementById('tracker-shell').style.top = '0px'
    // document.getElementById('tracker-shell').style.right = '0px';
    // document.getElementById('tracker-shell').style.left = '';
  }
  requestWindowResize()

  switchConfigKeys.forEach((configKey) =>
    setSwitchChecked(configKey, Boolean(globalConfig[configKey]))
  )

  const switchRoot = document.getElementById('tracker-shell')
  if (switchRoot && !switchRoot.dataset.switchDelegationBound) {
    switchRoot.dataset.switchDelegationBound = 'true'
    switchRoot.addEventListener('change', handleSwitchChange)
  }

  syncEffectBlockSwitchFromDetails()

  // bindExternalLinks()

  const mizhuBtn = document.getElementById('mizhu')
  if (mizhuBtn) {
    mizhuBtn.onclick = function () {
      // const mzBTNs = document.querySelectorAll('.mizhu')
      // mzBTNs.forEach((e) => (e.style.display = 'none'))
      drawMiZhu(getTrackedHandNumbers(Game.myID))
      // 统率可能要算糜竺 暂不兼容
    }
  }

  const openWelfareBtn = document.getElementById('openWelfareBtn')
  if (openWelfareBtn) {
    openWelfareBtn.onclick = function () {
      laya.ShowWindow('WelfareWindow')
    }
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

  const protocolRecordSwitch = document.getElementById('protocolRecordSwitch')
  const protocolRecorderControls = document.getElementById('protocolRecorderControls')
  if (import.meta.env.DEV) {
    bindProtocolRecorderControls()
  } else {
    protocolRecordSwitch?.closest('.switch-container')?.style.setProperty('display', 'none')
    protocolRecorderControls?.style.setProperty('display', 'none')
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
