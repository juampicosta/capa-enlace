/**
 * Gestor de Ventana Deslizante
 * Implementa control de flujo con ventana de 8 tramas y números de secuencia 0-15
 */

const { WINDOW_SIZE, Utils } = require('../constants')
const EventEmitter = require('events')

class WindowManager extends EventEmitter {
  constructor() {
    super()

    // Estado del transmisor
    this.sendBase = 0 // Número de secuencia más bajo sin ACK
    this.nextSeqNum = 0 // Próximo número de secuencia a usar
    this.windowSize = WINDOW_SIZE // Tamaño actual de ventana (puede ser dinámico)

    // Estado del receptor
    this.expectedSeqNum = 0 // Próximo número esperado
    this.receiveBuffer = new Array(16).fill(null) // Buffer circular para reordenar
    this.receivedMask = 0 // Bitmask de tramas recibidas en ventana

    // Estadísticas
    this.stats = {
      framesSent: 0,
      framesReceived: 0,
      framesBuffered: 0,
      windowFullEvents: 0,
      outOfOrderFrames: 0,
      windowSlides: 0
    }

    // Control de congestión (básico)
    this.congestionLevel = 0 // 0 = sin congestión, 1 = leve, 2 = severa
  }

  /**
   * Verifica si se puede enviar una nueva trama
   * @returns {boolean} True si la ventana permite envío
   */
  canSend() {
    const outstanding = Utils.seqNumDiff(this.nextSeqNum, this.sendBase)
    return outstanding < this.windowSize
  }

  /**
   * Obtiene el próximo número de secuencia disponible
   * @returns {number|null} Número de secuencia o null si ventana llena
   */
  getNextSeqNum() {
    if (!this.canSend()) {
      this.stats.windowFullEvents++
      this.emit('window_full', {
        sendBase: this.sendBase,
        nextSeqNum: this.nextSeqNum,
        windowSize: this.windowSize,
        timestamp: Date.now()
      })
      return null
    }

    const seqNum = this.nextSeqNum
    this.nextSeqNum = Utils.nextSeqNum(this.nextSeqNum)
    this.stats.framesSent++

    this.emit('frame_queued', {
      seqNum: seqNum,
      sendBase: this.sendBase,
      outstanding: Utils.seqNumDiff(this.nextSeqNum, this.sendBase),
      windowSize: this.windowSize,
      timestamp: Date.now()
    })

    return seqNum
  }

  /**
   * Procesa ACK recibido y desliza la ventana
   * @param {number} ackSeqNum - Número de secuencia confirmado
   * @returns {Object} Información sobre el deslizamiento
   */
  processAck(ackSeqNum) {
    // Verificar si el ACK está dentro de la ventana válida
    const diff = Utils.seqNumDiff(ackSeqNum, this.sendBase)

    if (diff < 0) {
      // ACK duplicado o muy antiguo
      return {
        action: 'duplicate',
        seqNum: ackSeqNum,
        sendBase: this.sendBase,
        windowSlid: false
      }
    }

    if (diff >= this.windowSize) {
      // ACK fuera de ventana
      return {
        action: 'out_of_window',
        seqNum: ackSeqNum,
        sendBase: this.sendBase,
        windowSlid: false
      }
    }

    // ACK válido - deslizar ventana
    const oldBase = this.sendBase
    this.sendBase = Utils.nextSeqNum(ackSeqNum)

    const slidDistance = Utils.seqNumDiff(this.sendBase, oldBase)
    this.stats.windowSlides++

    this.emit('window_slide', {
      oldBase: oldBase,
      newBase: this.sendBase,
      ackSeqNum: ackSeqNum,
      slidDistance: slidDistance,
      canSendNow: this.canSend(),
      timestamp: Date.now()
    })

    return {
      action: 'accepted',
      seqNum: ackSeqNum,
      oldBase: oldBase,
      newBase: this.sendBase,
      slidDistance: slidDistance,
      windowSlid: true
    }
  }

  /**
   * Procesa trama recibida en el receptor
   * @param {number} seqNum - Número de secuencia recibido
   * @param {Buffer} data - Datos de la trama
   * @returns {Object} Resultado del procesamiento
   */
  receiveFrame(seqNum, data) {
    this.stats.framesReceived++

    // Verificar si está dentro de la ventana de recepción
    const diff = Utils.seqNumDiff(seqNum, this.expectedSeqNum)

    if (diff < 0) {
      // Trama duplicada
      return {
        action: 'duplicate',
        seqNum: seqNum,
        expectedSeqNum: this.expectedSeqNum,
        shouldAck: true // Reenviar ACK
      }
    }

    if (diff >= this.windowSize) {
      // Trama fuera de ventana
      return {
        action: 'out_of_window',
        seqNum: seqNum,
        expectedSeqNum: this.expectedSeqNum,
        shouldAck: false
      }
    }

    // Trama dentro de ventana - almacenar en buffer
    this.receiveBuffer[seqNum] = {
      data: data,
      timestamp: Date.now()
    }

    // Marcar como recibida en bitmask
    const bitPos = Utils.seqNumDiff(seqNum, this.expectedSeqNum)
    this.receivedMask |= 1 << bitPos

    if (seqNum === this.expectedSeqNum) {
      // Trama en orden - entregar y avanzar ventana
      return this.deliverFramesInOrder()
    } else {
      // Trama fuera de orden - almacenar
      this.stats.outOfOrderFrames++
      this.stats.framesBuffered++

      this.emit('frame_buffered', {
        seqNum: seqNum,
        expectedSeqNum: this.expectedSeqNum,
        bufferSize: this.getBufferSize(),
        timestamp: Date.now()
      })

      return {
        action: 'buffered',
        seqNum: seqNum,
        expectedSeqNum: this.expectedSeqNum,
        shouldAck: false // Solo ACK para la esperada
      }
    }
  }

  /**
   * Entrega tramas en orden desde el buffer
   * @returns {Object} Información sobre tramas entregadas
   */
  deliverFramesInOrder() {
    const delivered = []

    // Entregar tramas consecutivas desde expectedSeqNum
    while (this.receiveBuffer[this.expectedSeqNum] !== null) {
      const frameData = this.receiveBuffer[this.expectedSeqNum]
      delivered.push({
        seqNum: this.expectedSeqNum,
        data: frameData.data,
        timestamp: frameData.timestamp
      })

      // Limpiar buffer
      this.receiveBuffer[this.expectedSeqNum] = null

      // Avanzar expected y actualizar bitmask
      this.expectedSeqNum = Utils.nextSeqNum(this.expectedSeqNum)
      this.receivedMask >>= 1 // Deslizar bitmask
    }

    this.emit('frames_delivered', {
      count: delivered.length,
      firstSeqNum: delivered[0]?.seqNum,
      lastSeqNum: delivered[delivered.length - 1]?.seqNum,
      newExpectedSeqNum: this.expectedSeqNum,
      timestamp: Date.now()
    })

    return {
      action: 'delivered',
      frames: delivered,
      expectedSeqNum: this.expectedSeqNum,
      shouldAck: true
    }
  }

  /**
   * Obtiene el estado actual de la ventana de envío
   */
  getSendWindow() {
    const outstanding = Utils.seqNumDiff(this.nextSeqNum, this.sendBase)
    const available = this.windowSize - outstanding

    return {
      sendBase: this.sendBase,
      nextSeqNum: this.nextSeqNum,
      windowSize: this.windowSize,
      outstanding: outstanding,
      available: available,
      canSend: this.canSend(),
      utilizationPercent: Math.round((outstanding / this.windowSize) * 100)
    }
  }

  /**
   * Obtiene el estado actual de la ventana de recepción
   */
  getReceiveWindow() {
    return {
      expectedSeqNum: this.expectedSeqNum,
      windowSize: this.windowSize,
      bufferedFrames: this.getBufferedFrames(),
      bufferUtilization: Math.round(
        (this.getBufferSize() / this.windowSize) * 100
      )
    }
  }

  /**
   * Obtiene tramas actualmente en buffer
   */
  getBufferedFrames() {
    const buffered = []

    for (let i = 0; i < 16; i++) {
      if (this.receiveBuffer[i] !== null) {
        buffered.push({
          seqNum: i,
          timestamp: this.receiveBuffer[i].timestamp,
          age: Date.now() - this.receiveBuffer[i].timestamp
        })
      }
    }

    return buffered.sort((a, b) => a.seqNum - b.seqNum)
  }

  /**
   * Obtiene número de tramas en buffer
   */
  getBufferSize() {
    let count = 0
    for (let i = 0; i < 16; i++) {
      if (this.receiveBuffer[i] !== null) count++
    }
    return count
  }

  /**
   * Ajusta dinámicamente el tamaño de ventana (control de congestión básico)
   * @param {number} rtt - Round Trip Time promedio
   * @param {number} lossRate - Tasa de pérdida (0-1)
   */
  adjustWindowSize(rtt, lossRate) {
    const oldSize = this.windowSize

    if (lossRate > 0.05) {
      // Alta pérdida - reducir ventana
      this.windowSize = Math.max(1, Math.floor(this.windowSize * 0.7))
      this.congestionLevel = 2
    } else if (lossRate > 0.01) {
      // Pérdida moderada - reducir ligeramente
      this.windowSize = Math.max(1, this.windowSize - 1)
      this.congestionLevel = 1
    } else if (rtt < 100 && lossRate < 0.001) {
      // Condiciones buenas - aumentar ventana
      this.windowSize = Math.min(WINDOW_SIZE, this.windowSize + 1)
      this.congestionLevel = 0
    }

    if (this.windowSize !== oldSize) {
      this.emit('window_size_adjusted', {
        oldSize: oldSize,
        newSize: this.windowSize,
        rtt: rtt,
        lossRate: lossRate,
        congestionLevel: this.congestionLevel,
        timestamp: Date.now()
      })
    }
  }

  /**
   * Resetea el estado de las ventanas
   */
  reset() {
    // Estado del transmisor
    this.sendBase = 0
    this.nextSeqNum = 0
    this.windowSize = WINDOW_SIZE

    // Estado del receptor
    this.expectedSeqNum = 0
    this.receiveBuffer = new Array(16).fill(null)
    this.receivedMask = 0

    // Control de congestión
    this.congestionLevel = 0

    this.emit('window_reset', {
      timestamp: Date.now()
    })
  }

  /**
   * Obtiene estadísticas completas
   */
  getStats() {
    return {
      ...this.stats,
      sendWindow: this.getSendWindow(),
      receiveWindow: this.getReceiveWindow(),
      congestionLevel: this.congestionLevel,
      timestamp: Date.now()
    }
  }
}

module.exports = WindowManager
