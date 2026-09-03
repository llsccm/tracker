import { bindTrackerVisibilityShortcut } from './trackerVisibility'

const STYLE_ID = 'dxc-shell-style'

function ensureStyle() {
  let style = document.getElementById(STYLE_ID)
  if (style) return
  style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    #tracker-shell {
      position: fixed;
      overflow: hidden;
      resize: vertical;
      top: 31px;
      right: 155px;
      width: 230px;
      height: 500px;
      z-index: 10000000000;
      display: flex;
      flex-direction: column;
      color: #f2de9c;
      background: rgb(35, 32, 29);
      user-select: none;
      text-align: left;
      transition: width 200ms, opacity 200ms;
      border-radius: 8px;
      transform-origin: top right;
      transform: translate(0px, 0px);
    }
    #tracker-shell.collapsed {
      height: 30px !important;
      width: 75px !important;
      opacity: 0.6 !important;
      resize: none !important;
    }
    #tracker-shell .header {
      margin: 1px;
      user-select: none;
      cursor: grab;
      display: flex;
      align-items: center;
      font-size: 20px;
      border-radius: 5px;
    }
    #tracker-shell #title {
      margin-right: auto;
    }
    #tracker-shell #toggle-me {
      text-align: center;
      color: #f2de9c;
      background: rgb(107, 30, 30);
      border-radius: 6px;
      width: 26px;
      height: 26px;
      border: 1px solid rgb(212, 212, 162);
      cursor: pointer;
      user-select: none;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 1px;
      font-size: 20px;
    }
    #tracker-shell #toggle-me:hover {
      background-color: rgb(130, 30, 30);
    }
    #tracker-shell .tracker-content {
      border: none;
      width: 230px;
      height: 100%;
      margin: 0px;
      overflow: hidden;
    }
    #tracker-shell.collapsed .tracker-content {
      display: none !important;
    }
  `
  document.head.appendChild(style)
}

export function createMainShell(version) {
  ensureStyle()

  const div = document.createElement('div')
  div.id = 'tracker-shell'

  const header = document.createElement('p')
  header.id = 'header'
  header.className = 'header'

  const title = document.createElement('span')
  title.id = 'title'
  title.style = 'margin-right: auto;'
  title.innerText = '三国杀小抄' + version

  div.appendChild(header)

  const btn = document.createElement('button')
  btn.innerText = '-'
  btn.id = 'toggle-me'
  btn.type = 'button'

  header.appendChild(title)
  header.appendChild(btn)

  document.body.appendChild(div)
  bindTrackerVisibilityShortcut()

  const iframe = document.createElement('div')
  iframe.className = 'tracker-content'
  div.append(iframe)

  return { div, iframe }
}
