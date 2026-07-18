import { logic } from './logic.js'
import { Init, Exit } from './dom.js'
import { notifyScriptError } from './utils/errorNotifier.js'
// 初始化性能监控
// initPerformanceMonitor();

// 在运行脚本前，删除全局对象（如果存在）
if (typeof SGSMODULE !== 'undefined') {
  Object.defineProperty(window.console, 'log', {
    get() {
      return console.info
    },
    set() {
      return
    }
  })

  window.SGSMODULE.forEach((fn) => fn('EXIT'))
  delete window.SGSMODULE
}

console.info(
  '%c三国杀小抄',
  'font-weight: bold; color: white; background-color: #525288; padding: 1px 4px; border-radius: 4px;'
)

window.SGSMODULE = []

const sgsConsoleLog = function (...args) {
  if (window._debug && args[0]?.className !== 'decodeSSCChatmsgNtf') console.info(...args)
  window.SGSMODULE.forEach((fn) => fn?.(...args))
}

Object.defineProperty(window.console, 'log', {
  get() {
    return sgsConsoleLog
  },
  set() {
    return
  }
})

function main() {
  const args = Array.prototype.slice.call(arguments)

  try {
    if (args[0] === 'INIT') return Init()
    else if (args[0] === 'EXIT') return Exit()
    else return logic(args[args.length - 1])
  } catch (e) {
    console.error(e.message)
    console.error(e.stack)
    notifyScriptError(e, `main.${args[0] || 'logic'}`)
  }
}

main('INIT').then((r) => {
  if (r) window.SGSMODULE.push(main)
})
