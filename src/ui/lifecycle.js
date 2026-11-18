import { unbindTrackerVisibilityShortcut } from './trackerVisibility'
import { destroyPeiXiuMapWindow } from '@/ui/PeiXiuMapWindow'
import { destroyPingJianWindow } from './PingJianWindow'
import { unbindPeiXiuHandSuitColorRefresh } from './PeiXiuHandMirror'
import { destroySeatOverlay } from './seatOverlay'

export function configureViewport(globalConfig) {
  window.WDVerSion = '1.0.0'
  window.padding = globalConfig.padding || 0
  // 每次读取都按当前视口扣除侧栏，避免 Electron 最大化/还原时读到旧宽度。
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    enumerable: true,
    get() {
      const padding = Math.max(0, Number(window.padding) || 0)
      return document.documentElement.clientWidth - padding
    }
  })
}

export function removeInjectedDom(globalState) {
  unbindPeiXiuHandSuitColorRefresh()
  unbindTrackerVisibilityShortcut()
  //document.getElementById('injectCSS')?.remove()
  destroySeatOverlay()
  document.getElementById('cusBGDiv')?.remove()
  document.getElementById('tracker-shell')?.remove()
  destroyPeiXiuMapWindow()
  destroyPingJianWindow()
  document.getElementById('peixiu-map-style')?.remove()
  globalState.isFrameAdd = false
}

export function cleanupLifecycle(globalState) {
  removeInjectedDom(globalState)
  return true
}

export function waitForLegacyFrameReady(initFrame) {
  return new Promise((resolve, reject) => {
    // 检查 JSZipUtils、CtrUtil 和其他脚本的加载状态
    function checkLibraries() {
      return new Promise((libResolve) => {
        function checkLibs() {
          if (
            typeof JSZipUtils !== 'undefined' &&
            typeof CtrUtil !== 'undefined' &&
            typeof CtrUtil?.Ctr?.Ofb_Dec !== 'undefined' &&
            typeof ChannelUtils !== 'undefined' &&
            document.getElementById('bgDiv')
          ) {
            initFrame(true).then(libResolve)
          }
          // 重制版入口
          else if (typeof PUERTS_JS_RESOURCES !== 'undefined') {
            libResolve(true)
          } else {
            setTimeout(checkLibs, 1000)
          }
        }

        checkLibs()
      })
    }

    // 并行执行两个异步操作，全部完成后 resolve
    Promise.all([checkLibraries()]).then(resolve).catch(reject)
  })
}
