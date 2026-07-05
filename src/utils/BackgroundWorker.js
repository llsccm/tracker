/**
 * 后台定时器增强系统 - 解决浏览器后台限制问题
 *
 * 核心功能:
 * 1. Worker发送心跳信号阻止浏览器节流
 * 2. 重写原生定时器避免后台运行时间偏差
 * 3. 强制渲染画面保持游戏运行 自动LayaAir保活
 * 4. 用worker新建并销毁去检测控制台是否打开
 *
 * 解决问题:
 * - 浏览器后台时定时器被限制到60秒/次
 * - LayaAir游戏引擎后台暂停渲染
 * - 长时间后台运行导致的时间同步问题
 *   startTimerWorker() - 启动系统
 *   getTimerPerformance() - 查看性能
 *   backgroundWorker.destroy() - 销毁系统
 **/
class BackgroundWorker {
  constructor() {
    this.worker = null // Web Worker实例，用于在独立线程运行定时器
    this.callbacks = new Map() // 存储定时器回调函数的映射表
    this.counter = 0 // 定时器ID计数器，确保每个定时器有唯一ID
    this.isInitialized = false // 系统初始化状态标志
    this.consoleDetected = false // 控制台检测状态标志

    // 保存原生定时器方法，用于系统降级时恢复
    this.originalMethods = {
      setTimeout: window.setTimeout,
      setInterval: window.setInterval,
      clearTimeout: window.clearTimeout,
      clearInterval: window.clearInterval
    }
  }

  /**
   * 初始化统一Worker系统
   * 启动整个定时器增强系统的核心入口方法
   */
  async init() {
    if (this.isInitialized) return

    console.info('🚀 初始化定时器系统...')

    try {
      this.worker = this.createWorker() // 创建Web Worker实例
      this.setupMessageHandling() // 建立主线程与Worker的通信机制
      this.replaceNativeTimers() // 替换浏览器原生定时器方法
      this.setupDevToolMonitoring() // 启动性能监控和统计

      this.isInitialized = true
      console.info('✅ 定时器系统初始化成功，三国杀后台可用')
    } catch (error) {
      console.error('❌ 统一定时器系统初始化失败:', error)
      this.fallbackToNative() // 初始化失败时降级到原生定时器
    }
  }

  /**
   * 创建统一Worker实例
   * 在独立线程中运行定时器逻辑，避免主线程被浏览器限制
   * @returns {Worker} 配置好的Worker实例
   */
  createWorker() {
    const workerCode = `
            // ========== 统一定时器Worker ==========
            // 运行在独立Worker线程中的定时器管理类
            class TimerWorker {
                constructor() {
                    this.timers = new Map(); // Worker内部定时器存储映射
                    this.timerId = 0; // Worker内部定时器ID计数器
                    this.layaKeepAlive = null; // LayaAir游戏引擎保活定时器

                    // Worker性能统计数据
                    this.performanceStats = {
                        timerCount: 0, // 已执行的定时器总数
                        messageCount: 0, // 处理的消息总数
                        startTime: Date.now() // Worker启动时间戳
                    };
                }

                /**
                 * 处理主线程发送的消息
                 * 根据消息类型执行相应的定时器操作
                 */
                handleMessage(e) {
                    const { type, id, delay, interval } = e.data;
                    this.performanceStats.messageCount++; // 统计消息处理次数

                    switch (type) {
                        case 'setTimeout':
                            this.createTimeout(delay, id); // 创建一次性定时器
                            break;
                        case 'setInterval':
                            this.createInterval(delay || interval, id); // 创建循环定时器
                            break;
                        case 'clear':
                            this.clearTimer(id); // 清除指定定时器
                            break;
                        case 'startLayaKeepAlive':
                            this.startLayaKeepAlive(); // 启动游戏引擎保活
                            break;
                        case 'stopLayaKeepAlive':
                            this.stopLayaKeepAlive(); // 停止游戏引擎保活
                            break;
                    }
                }

                /**
                 * 创建一次性定时器（setTimeout）
                 * @param {number} delay 延迟时间（毫秒）
                 * @param {number} id 用户定时器ID
                 */
                createTimeout(delay, id) {
                    const timerId = ++this.timerId; // 生成Worker内部唯一ID
                    const handle = setTimeout(() => {
                        self.postMessage({ type: 'fire', id, timerId }); // 通知主线程执行回调
                        this.timers.delete(timerId); // 一次性定时器执行后自动清理
                        this.performanceStats.timerCount++; // 统计执行次数
                    }, delay);

                    // 存储定时器信息，建立用户ID与Worker内部ID的映射
                    this.timers.set(timerId, { handle, isInterval: false, userTimerId: id });
                    self.postMessage({ type: 'created', userTimerId: id, workerTimerId: timerId });
                }

                /**
                 * 创建循环定时器（setInterval）
                 * @param {number} interval 间隔时间（毫秒）
                 * @param {number} id 用户定时器ID
                 */
                createInterval(interval, id) {
                    const timerId = ++this.timerId;
                    const handle = setInterval(() => {
                        self.postMessage({ type: 'fire', id, timerId }); // 持续通知主线程执行回调
                        this.performanceStats.timerCount++;
                    }, interval);

                    // 循环定时器不会自动清理，需要手动调用clearTimer
                    this.timers.set(timerId, { handle, isInterval: true, userTimerId: id });
                    self.postMessage({ type: 'created', userTimerId: id, workerTimerId: timerId });
                }

                /**
                 * 清除指定的定时器
                 * @param {number} id 用户定时器ID
                 */
                clearTimer(id) {
                    // 遍历查找对应的Worker内部定时器ID
                    for (const [timerId, timer] of this.timers) {
                        if (timer.userTimerId === id) {
                            // 根据定时器类型选择合适的清理方法
                            if (timer.isInterval) {
                                clearInterval(timer.handle);
                            } else {
                                clearTimeout(timer.handle);
                            }
                            this.timers.delete(timerId); // 从映射表中移除
                            break;
                        }
                    }
                }

                /**
                 * 启动LayaAir游戏引擎保活机制
                 * 以60fps频率发送心跳信号，防止游戏在后台暂停
                 */
                startLayaKeepAlive() {
                    if (this.layaKeepAlive) return; // 避免重复启动

                    const keepAlive = () => {
                        self.postMessage({ type: 'layaTick' }); // 发送心跳信号到主线程
                        this.layaKeepAlive = setTimeout(keepAlive, 16); // 16ms = 60fps
                    };

                    this.layaKeepAlive = setTimeout(keepAlive, 16);
                }

                /**
                 * 停止LayaAir游戏引擎保活机制
                 */
                stopLayaKeepAlive() {
                    if (this.layaKeepAlive) {
                        clearTimeout(this.layaKeepAlive);
                        this.layaKeepAlive = null;
                    }
                }
            }

            // 初始化Worker实例
            const worker = new TimerWorker();

            // 消息处理
            self.onmessage = (e) => worker.handleMessage(e);

            // 错误处理
            self.onerror = (error) => {
                self.postMessage({
                    type: 'error',
                    error: error.message || '未知Worker错误'
                });
            };

        `

    const blob = new Blob([workerCode], { type: 'application/javascript' })
    return new Worker(URL.createObjectURL(blob))
  }

  /**
   * 设置Worker消息处理机制
   * 建立主线程与Worker线程的双向通信
   */
  setupMessageHandling() {
    this.worker.onmessage = (e) => {
      const { type, id, error } = e.data

      switch (type) {
        case 'fire':
          this.handleTimerFire(id) // 执行定时器回调函数
          break
        case 'created':
          // 定时器创建确认，可以在这里做额外处理
          break
        case 'layaTick':
          this.handleLayaTick() // 处理游戏引擎心跳
          break
        case 'error':
          console.error('Worker错误:', error)
          this.fallbackToNative() // Worker出错时降级到原生定时器
          break
      }
    }

    this.worker.onerror = (error) => {
      console.error('Worker异常:', error)
      this.fallbackToNative()
    }
  }

  /**
   * 处理定时器触发事件
   * 执行用户注册的回调函数
   * @param {number} id 定时器ID
   */
  handleTimerFire(id) {
    const callback = this.callbacks.get(id)
    if (callback) {
      try {
        callback() // 执行用户回调函数
      } catch (error) {
        console.error('定时器回调执行错误:', error)
      }
    }
  }

  /**
   * 处理LayaAir游戏引擎心跳信号
   * 强制更新游戏定时器和渲染循环，防止后台暂停
   */
  handleLayaTick() {
    if (window.Laya) {
      try {
        Laya.timer && Laya.timer._update() // 更新游戏内部定时器
        Laya.stage && Laya.stage._loop() // 强制执行渲染循环
      } catch (error) {
        console.error('LayaAir更新错误:', error)
      }
    }
  }

  /**
   * 替换浏览器原生定时器方法
   * 将所有setTimeout/setInterval调用重定向到Worker系统
   */
  replaceNativeTimers() {
    // 替换setTimeout - 一次性定时器
    window.setTimeout = (callback, delay, ...args) => {
      // 如果不是函数，使用原生方法处理
      if (typeof callback !== 'function') {
        return this.originalMethods.setTimeout.call(window, callback, delay, ...args)
      }

      const id = ++this.counter // 生成唯一ID
      this.callbacks.set(id, () => {
        this.callbacks.delete(id) // setTimeout只执行一次，执行后清理
        callback(...args) // 执行用户回调
      })

      // 发送消息给Worker创建定时器
      this.worker.postMessage({ type: 'setTimeout', id, delay })
      return id // 返回定时器ID供用户清理使用
    }

    // 替换setInterval - 循环定时器
    window.setInterval = (callback, interval, ...args) => {
      if (typeof callback !== 'function') {
        return this.originalMethods.setInterval.call(window, callback, interval, ...args)
      }

      const id = ++this.counter
      // 循环定时器的回调不需要自动清理，会一直执行直到手动清除
      this.callbacks.set(id, () => callback(...args))

      this.worker.postMessage({ type: 'setInterval', id, interval })
      return id
    }

    // 替换定时器清理方法 - 统一处理clearTimeout和clearInterval
    const clearTimer = (id) => {
      this.callbacks.delete(id) // 清理主线程回调映射
      this.worker.postMessage({ type: 'clear', id }) // 通知Worker清理定时器
    }

    window.clearTimeout = clearTimer
    window.clearInterval = clearTimer

    console.info('🔄 原生定时器已被替换，settimeout后台可用')
  }

  /**
   * 启动LayaAir游戏引擎保活功能
   * 用于页面后台时保持游戏运行
   */
  startLayaKeepAlive() {
    if (this.worker) {
      this.worker.postMessage({ type: 'startLayaKeepAlive' })
      console.info('🎮 LayaAir保活已启动')
    }
  }

  /**
   * 停止LayaAir游戏引擎保活功能
   * 页面恢复前台时停止保活以节省资源
   */
  stopLayaKeepAlive() {
    if (this.worker) {
      this.worker.postMessage({ type: 'stopLayaKeepAlive' })
    }
  }

  setupDevToolMonitoring() {
    const shouldSkipDetection = () => document.visibilityState === 'hidden'

    if (this.worker && !shouldSkipDetection()) {
      this.performDetectionWithGlobalTimeout()
    }

    document.addEventListener('visibilitychange', () => {
      if (!this.consoleDetected && !shouldSkipDetection() && this.worker) {
        this.performDetectionWithGlobalTimeout()
      }
    })

    setInterval(() => {
      if (this.consoleDetected || shouldSkipDetection()) {
        return
      }

      if (this.worker) {
        this.performDetectionWithGlobalTimeout()
      }
    }, 20000)
  }

  /**
   * 创建一次性检测Worker worker线程可能会阻塞
   * 关键：每次检测都创建全新Worker，避免状态污染
   */
  createStealthDetector() {
    return new Promise((resolve) => {
      const startTime = performance.now()
      let resolved = false
      const debuggerCode = 'debugg' + 'er'

      // 创建一次性检测Worker（完全复制stealth-console-detector逻辑）
      const detectorCode = `
                let isActive = true;

                onmessage = function(e) {
                    if (e.data === 'detect' && isActive) {
                        const detectStart = performance.now();

                        // 关键：设置自动终止定时器
                        const autoTerminate = setTimeout(() => {
                            if (isActive) {
                                isActive = false;
                                postMessage({
                                    d: true,
                                    duration: performance.now() - detectStart,
                                    reason: 'debugger_timeout'
                                });
                                close();
                            }
                        }, 200); // 200ms超时

                        // 执行debugger检测
                        try {
                            eval('${debuggerCode}');

                            // 如果能执行到这里，说明debugger被跳过（控制台未开启）
                            if (isActive) {
                                clearTimeout(autoTerminate);
                                isActive = false;
                                postMessage({
                                    d: false,
                                    duration: performance.now() - detectStart,
                                    reason: 'debugger_skipped'
                                });
                                close();
                            }
                        } catch (e) {
                            if (isActive) {
                                clearTimeout(autoTerminate);
                                isActive = false;
                                postMessage({
                                    d: false,
                                    duration: performance.now() - detectStart,
                                    reason: 'debugger_error'
                                });
                                close();
                            }
                        }
                    }
                };
            `

      const blob = new Blob([detectorCode], { type: 'application/javascript' })
      const worker = new Worker(URL.createObjectURL(blob))

      worker.onmessage = function (e) {
        if (!resolved) {
          resolved = true
          const totalDuration = performance.now() - startTime

          worker.terminate()
          URL.revokeObjectURL(blob)

          resolve({
            ...e.data,
            totalDuration: totalDuration
          })
        }
      }

      worker.onerror = function () {
        if (!resolved) {
          resolved = true
          worker.terminate()
          URL.revokeObjectURL(blob)
          resolve({
            d: false,
            duration: performance.now() - startTime,
            reason: 'worker_error'
          })
        }
      }

      // 启动检测
      worker.postMessage('detect')

      // 额外的安全超时（关键！这个不会被Worker中的debugger阻塞）
      setTimeout(() => {
        if (!resolved) {
          resolved = true
          worker.terminate()
          URL.revokeObjectURL(blob)
          resolve({
            d: true,
            duration: performance.now() - startTime,
            reason: 'global_timeout'
          })
        }
      }, 200)
    })
  }

  async performDetectionWithGlobalTimeout() {
    // 检测前再次确认：如果已经检测到控制台，直接返回 不再继续定时创建worker
    if (this.consoleDetected) {
      return
    }

    try {
      const result = await this.createStealthDetector()

      if (result.d) {
        // 设置检测状态，停止后续检测
        this.consoleDetected = true
      }
    } catch (error) {
      console.error('Worker异常:', error)
    }
  }

  /**
   * 降级到原生定时器系统
   * 当Worker系统出现问题时的故障恢复机制
   */
  fallbackToNative() {
    console.info('🔄 降级到原生定时器')

    // 恢复原生定时器方法
    window.setTimeout = this.originalMethods.setTimeout
    window.setInterval = this.originalMethods.setInterval
    window.clearTimeout = this.originalMethods.clearTimeout
    window.clearInterval = this.originalMethods.clearInterval

    this.isInitialized = false

    // 终止Worker进程并清理资源
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
  }

  /**
   * 智能启动系统
   * 根据页面状态自动配置最佳运行模式
   */
  start() {
    // 立即启动统一定时器系统
    this.init()

    // 如果页面已经处于后台状态，延迟启动保活机制
    if (document.visibilityState === 'hidden') {
      setTimeout(() => this.startLayaKeepAlive(), 100)
    }

    // 监听页面可见性变化，自动切换保活状态
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.startLayaKeepAlive() // 页面隐藏时启动保活
      } else {
        this.stopLayaKeepAlive() // 页面显示时停止保活节省资源
      }
    })
  }

  /**
   * 销毁整个定时器系统
   * 清理所有资源，恢复原生定时器
   */
  destroy() {
    this.fallbackToNative() // 恢复原生定时器并终止Worker
    this.callbacks.clear() // 清理所有回调函数映射
    console.info('🗑️ 定时器系统已销毁')
  }
}

// ========== 全局实例和API接口 ==========

// 创建全局唯一的定时器系统实例
export const backgroundWorker = new BackgroundWorker()
