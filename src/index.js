import { logic } from './logic.js'
import { Init, Exit } from './dom.js'
import { notifyScriptError } from './utils/errorNotifier.js'

console.info(
  '%c三国杀小抄',
  'font-weight: bold; color: white; background-color: #525288; padding: 1px 4px; border-radius: 4px;'
)

const _SGSMODULE = []
window._SGSMODULE = _SGSMODULE

const sgsConsoleLog = function (...args) {
  const msg = args[0]
  if (
    window._debug &&
    msg != null &&
    typeof msg === 'object' &&
    msg.className !== 'decodeSSCChatmsgNtf'
  ) {
    console.info(...args)
  }
  window._SGSMODULE.forEach((fn) => fn?.(...args))
}

const originalConsole = window.console

window.console = new Proxy(originalConsole, {
  set(target, prop, value, receiver) {
    if (prop === 'log') {
      return true
    }
    return Reflect.set(target, prop, value, receiver)
  }
})

Object.defineProperty(originalConsole, 'log', {
  value: sgsConsoleLog,
  writable: true,
  configurable: true,
  enumerable: true
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
  if (r) window._SGSMODULE.push(main)
})
