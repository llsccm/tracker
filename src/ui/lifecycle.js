import { unbindTrackerVisibilityShortcut } from './trackerVisibility'
import { destroyPeiXiuMapWindow } from '@/ui/PeiXiuMapWindow'

export function bindInitialResize(globalConfig, resize) {
  window.WDVerSion = '1.0.0'
  window.padding = globalConfig.padding || 0
  window.addEventListener('resize', resize) // 网页端开启
}

export function removeInjectedDom(globalState) {
  unbindTrackerVisibilityShortcut()
  //document.getElementById('injectCSS')?.remove()
  document.getElementById('seatUI')?.remove()
  document.getElementById('rogueUI')?.remove()
  document.getElementById('cusBGDiv')?.remove()
  document.getElementById('createIframe')?.remove()
  destroyPeiXiuMapWindow()
  document.getElementById('peixiu-map-style')?.remove()
  globalState.isFrameAdd = false
}

export function cleanupLifecycle({ resize, scheduleSetGameSize, SGSresize, globalState }) {
  window.removeEventListener('resize', resize)
  window.removeEventListener('resize', scheduleSetGameSize)
  window.removeEventListener('SGSresize', SGSresize)
  window.SGSMODULE.splice(0, Infinity) // 清空模块
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
            typeof SystemContext !== 'undefined' &&
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

export function installSystemContextResizeDispatchers() {
  SystemContext._gameScreenType = SystemContext.gameScreenType
  SystemContext._gameScale = SystemContext.gameScale

  Object.defineProperty(SystemContext, 'gameScreenType', {
    get: function () {
      return this._gameScreenType
    },
    set: function (value) {
      if (this._gameScreenType !== value) {
        this._gameScreenType = value
        window.dispatchEvent(new Event('SGSresize'))
      }
    }
  })

  Object.defineProperty(SystemContext, 'gameScale', {
    get: function () {
      return this._gameScale
    },
    set: function (value) {
      if (this._gameScale !== value) {
        this._gameScale = value
        window.dispatchEvent(new Event('SGSresize'))
      }
    }
  })
}
