import { toClipboard } from '@/utils/clipboard'

/**
 * 初始化聊天面板里的表情与快捷语句。
 * 这里直接写宿主聊天 DOM，点击动作只复制文本，不主动发送消息。
 */
export function drawChatFace() {
  const chatBody = document.getElementsByClassName('chat-body')[0]
  if (!chatBody) return

  const fragment = document.createDocumentFragment()

  for (let i = 11; i <= 60; i++) {
    const link = `https://web.sanguosha.com/220/h5_2/res/runtime/pc/Face/${i}.png`
    const img = document.createElement('img')
    img.src = link
    img.classList.add('face')
    img.onmousedown = () => toClipboard(`#${i}`, false)
    fragment.appendChild(img)
  }

  const chatMessages = [
    '昏君，昏君啊',
    '主公，别开枪，自己人',
    '能不能快一点儿呀，兵贵神速啊',
    '小内再不跳，后面还怎么玩儿啊',
    '小内啊，您老悠着点儿',
    '不好意思，刚才卡了',
    '你可以打的再烂一点儿吗',
    '哥们儿，给力点儿行吗',
    '你们怎么忍心就这么让我酱油了',
    '我，我惹你们了吗',
    '姑娘，你真是条汉子',
    '三十六计，走为上，容我去去便回',
    '人心散了，队伍不好带啊',
    '风吹鸡蛋壳，牌去人安乐',
    '哥，交个朋友吧',
    '妹子，交个朋友吧',
    '我从未见过如此厚颜无耻之人',
    '你随便杀，闪不了算我输',
    '这波不亏',
    '请收下我的膝盖',
    '你咋不上天呢',
    '放开我的队友，冲我来',
    '见证奇迹的时刻到了'
  ]

  chatMessages.forEach((message) => {
    const span = document.createElement('span')
    span.classList.add('calRes')
    span.textContent = message

    span.onmousedown = () => toClipboard(`${message}`, false)
    fragment.appendChild(span)
  })

  chatBody.appendChild(fragment)
}
