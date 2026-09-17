import {
  createDraggableWindow,
  destroyDraggableWindow,
  setDraggableWindowVisible
} from './draggableWindow'

const WINDOW_ID = 'pingjian-window'
const STYLE_ID = 'pingjian-style'

function createWindow() {
  return createDraggableWindow({
    id: WINDOW_ID,
    styleId: STYLE_ID,
    styleText: `
    #${WINDOW_ID} {
      top: 60px;
      min-width: 140px;
    }
    #${WINDOW_ID} .pingjian-title {
      font-size: 16px;
    }
    #${WINDOW_ID} .pingjian-list {
      margin: 4px 0 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    #${WINDOW_ID} .pingjian-item {
      padding: 3px 6px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(242, 208, 107, 0.2);
      border-radius: 2px;
      font-size: 16px;
      color: #f2d06b;
      white-space: nowrap;
      text-align: center;
    }
  `,
    markup: `
    <header class="draggable-window-header pingjian-header">
      <div class="draggable-window-title pingjian-title">评鉴</div>
    </header>
    <ul class="pingjian-list"></ul>
  `,
    handleSelector: '.pingjian-header'
  })
}

export function renderPingJianWindow(names) {
  if (!Array.isArray(names) || !names.length) return false

  const element = document.getElementById(WINDOW_ID) || createWindow()
  const list = element.querySelector('.pingjian-list')
  if (!list) return false

  const items = names.map((name) => {
    const li = document.createElement('li')
    li.className = 'pingjian-item'
    li.textContent = name
    return li
  })

  list.replaceChildren(...items)
  return true
}

export function destroyPingJianWindow() {
  destroyDraggableWindow(WINDOW_ID)
}

export function setPingJianWindowVisible(visible) {
  setDraggableWindowVisible(WINDOW_ID, visible)
}
