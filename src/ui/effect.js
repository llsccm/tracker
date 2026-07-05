export function addDynamicBG() {
  var bgDiv = document.getElementById('bgDiv')
  if (bgDiv) {
    // 创建视频 div
    var cusBGDiv = document.createElement('div')
    cusBGDiv.id = 'cusBGDiv'
    cusBGDiv.style.position = 'absolute'
    cusBGDiv.style.top = '50%'
    cusBGDiv.style.left = '50%'
    cusBGDiv.style.transform = 'translate(-50%, -50%)'
    cusBGDiv.style.zIndex = '0' // 确保视频在图片之上
    cusBGDiv.style.pointerEvents = 'none' // 禁用视频上的鼠标事件

    // 创建视频元素
    var video = document.createElement('video')
    video.className = 'bg-ani'
    video.id = 'sgsBgVideo'
    video.autoplay = true
    video.loop = true
    video.muted = true
    video.preload = 'auto' // 设置视频预加载属性
    video.style.setProperty('object-fit', 'fill', 'important')
    // video.style.display = 'none';

    // // 击杀背景
    var imgBG = document.createElement('img')
    imgBG.className = 'bg-ani'
    imgBG.id = 'sgsBgIMG'
    //设定默认值 以免出现白边 什么神经病设定 空值会出现白边
    imgBG.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    imgBG.style.zIndex = '1' // 确保图片在视频之上
    imgBG.style.position = 'absolute'
    imgBG.style.top = '0'
    imgBG.style.left = '0'
    // 将视频元素添加到视频 div
    cusBGDiv.appendChild(video)
    cusBGDiv.appendChild(imgBG)
    bgDiv.appendChild(cusBGDiv)
    //创建完，初始化

    window.dispatchEvent(new Event('resize'))
  }
}

const gsap = window.gsap

export function createParticleEffect(e) {
  if (typeof gsap === 'undefined' || !gsap) {
    console.info('GSAP库未加载，粒子特效已跳过')
    return
  }

  // 获取按钮的位置信息
  const buttonRect = e.getBoundingClientRect()
  const buttonCenterX = buttonRect.left + buttonRect.width / 2
  const buttonCenterY = buttonRect.top + buttonRect.height / 2
  // 控制台检测
  // !import.meta.env.DEV && backgroundWorker.consoleDetected

  // 创建粒子
  for (let i = 0; i < 20; i++) {
    const particle = document.createElement('div')
    particle.classList.add('particle')
    document.body.appendChild(particle)

    // 随机角度和距离
    const angle = Math.random() * 360
    const distance = Math.random() * 50 + 30

    // 粒子动画
    gsap.fromTo(
      particle,
      {
        x: buttonCenterX,
        y: buttonCenterY,
        opacity: 1
      },
      {
        x: buttonCenterX + Math.cos((angle * Math.PI) / 180) * distance,
        y: buttonCenterY + Math.sin((angle * Math.PI) / 180) * distance,
        opacity: 0,
        duration: 1,
        ease: 'power2.out',
        onComplete: () => {
          particle.remove() // 动画完成后移除粒子
        }
      }
    )
  }
}
