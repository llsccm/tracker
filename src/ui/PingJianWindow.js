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
      position: fixed;
      top: 60px;
      right: 20px;
      z-index: 10000000020;
      box-sizing: border-box;
      min-width: 140px;
      padding: 0 6px 6px;
      color: #f4ead8;
      background: #292724;
      border: 1px solid #7b292d;
      box-shadow: 0 7px 18px rgba(0, 0, 0, 0.42);
      font-family: "Microsoft YaHei", sans-serif;
      user-select: none;
    }
    #${WINDOW_ID} * { box-sizing: border-box; }
    #${WINDOW_ID} .pingjian-header {
      height: 22px;
      margin: 0 -6px;
      padding: 0 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #7b292d;
      cursor: grab;
    }
    #${WINDOW_ID}.is-dragging .pingjian-header { cursor: grabbing; }
    #${WINDOW_ID} .pingjian-title {
      overflow: hidden;
      font-size: 16px;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
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
    <header class="pingjian-header">
      <div class="pingjian-title">评鉴</div>
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
