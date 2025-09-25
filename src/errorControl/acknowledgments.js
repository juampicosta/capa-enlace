/**
 * Sistema de Acknowledgments (ACK/NAK)
 * Maneja confirmaciones positivas y negativas
 */

const { FrameType, ACK_TIMEOUT, MAX_RETRIES, Utils } = require('../constants')
const frameBuilder = require('../framing/frameBuilder')
const EventEmitter = require('events')

class AcknowledgmentManager extends EventEmitter {
  constructor() {
    super()

    // Estructuras de datos para tracking
    this.pendingAcks = new Map() // seqNum -> {frame, timestamp, retries, timeout}
    this.receivedFrames = new Set() // Para detectar duplicados
    this.expectedSeqNum = 0 // Próximo número esperado

    // Estadísticas
    this.stats = {
      acksSent: 0,
      naksSent: 0,
      acksReceived: 0,
      naksReceived: 0,
      timeouts: 0,
      retransmissions: 0,
      duplicatesDetected: 0
    }
  }

  /**
   * Envía confirmación positiva (ACK)
   * @param {number} seqNum - Número de secuencia a confirmar
   * @param {Function} sendCallback - Función para enviar la trama
   */
  sendAck(seqNum, sendCallback) {
    const ackFrame = frameBuilder.createAckFrame(seqNum)

    this.stats.acksSent++

    // Emitir evento antes de enviar
    this.emit('ack_sending', {
      seqNum: seqNum,
      timestamp: Date.now()
    })

    // Enviar usando callback proporcionado
    if (sendCallback) {
      sendCallback(ackFrame)
    }

    this.emit('ack_sent', {
      seqNum: seqNum,
      frameSize: ackFrame.length,
      timestamp: Date.now()
    })
  }

  /**
   * Envía confirmación negativa (NAK)
   * @param {number} seqNum - Número de secuencia con error
   * @param {Function} sendCallback - Función para enviar la trama
   * @param {string} reason - Razón del NAK
   */
  sendNak(seqNum, sendCallback, reason = 'Unknown error') {
    const nakFrame = frameBuilder.createNakFrame(seqNum)

    this.stats.naksSent++

    this.emit('nak_sending', {
      seqNum: seqNum,
      reason: reason,
      timestamp: Date.now()
    })

    if (sendCallback) {
      sendCallback(nakFrame)
    }

    this.emit('nak_sent', {
      seqNum: seqNum,
      reason: reason,
      frameSize: nakFrame.length,
      timestamp: Date.now()
    })
  }

  /**
   * Registra una trama enviada que espera ACK
   * @param {number} seqNum - Número de secuencia
   * @param {Buffer} frame - Trama enviada
   * @param {Function} retransmitCallback - Función para retransmitir
   */
  registerPendingAck(seqNum, frame, retransmitCallback) {
    // Cancelar timeout anterior si existe
    if (this.pendingAcks.has(seqNum)) {
      const existing = this.pendingAcks.get(seqNum)
      if (existing.timeout) {
        clearTimeout(existing.timeout)
      }
    }

    // Configurar timeout para este ACK
    const timeout = setTimeout(() => {
      this.handleAckTimeout(seqNum, retransmitCallback)
    }, ACK_TIMEOUT)

    // Registrar la trama pendiente
    this.pendingAcks.set(seqNum, {
      frame: frame,
      timestamp: Date.now(),
      retries: 0,
      timeout: timeout,
      retransmitCallback: retransmitCallback
    })

    this.emit('ack_registered', {
      seqNum: seqNum,
      frameSize: frame.length,
      timeout: ACK_TIMEOUT
    })
  }

  /**
   * Procesa ACK recibido
   * @param {number} seqNum - Número de secuencia confirmado
   * @returns {boolean} True si el ACK era esperado
   */
  handleReceivedAck(seqNum) {
    this.stats.acksReceived++

    if (!this.pendingAcks.has(seqNum)) {
      this.emit('ack_unexpected', {
        seqNum: seqNum,
        timestamp: Date.now()
      })
      return false
    }

    // Recuperar información de la trama pendiente
    const pending = this.pendingAcks.get(seqNum)
    const rtt = Date.now() - pending.timestamp

    // Cancelar timeout
    if (pending.timeout) {
      clearTimeout(pending.timeout)
    }

    // Remover de pendientes
    this.pendingAcks.delete(seqNum)

    this.emit('ack_received', {
      seqNum: seqNum,
      rtt: rtt,
      retries: pending.retries,
      timestamp: Date.now()
    })

    return true
  }

  /**
   * Procesa NAK recibido
   * @param {number} seqNum - Número de secuencia con error
   * @returns {boolean} True si se debe retransmitir
   */
  handleReceivedNak(seqNum) {
    this.stats.naksReceived++

    if (!this.pendingAcks.has(seqNum)) {
      this.emit('nak_unexpected', {
        seqNum: seqNum,
        timestamp: Date.now()
      })
      return false
    }

    const pending = this.pendingAcks.get(seqNum)

    this.emit('nak_received', {
      seqNum: seqNum,
      retries: pending.retries,
      timestamp: Date.now()
    })

    // Retransmitir inmediatamente
    this.retransmitFrame(seqNum)
    return true
  }

  /**
   * Maneja timeout de ACK
   * @param {number} seqNum - Número de secuencia que hizo timeout
   * @param {Function} retransmitCallback - Función para retransmitir
   */
  handleAckTimeout(seqNum, retransmitCallback) {
    if (!this.pendingAcks.has(seqNum)) {
      return // Ya fue procesado
    }

    const pending = this.pendingAcks.get(seqNum)
    pending.retries++
    this.stats.timeouts++

    this.emit('ack_timeout', {
      seqNum: seqNum,
      retries: pending.retries,
      maxRetries: MAX_RETRIES,
      timestamp: Date.now()
    })

    if (pending.retries >= MAX_RETRIES) {
      // Máximo de reintentos alcanzado
      this.pendingAcks.delete(seqNum)

      this.emit('frame_failed', {
        seqNum: seqNum,
        retries: pending.retries,
        reason: 'Max retries exceeded',
        timestamp: Date.now()
      })
    } else {
      // Retransmitir
      this.retransmitFrame(seqNum)
    }
  }

  /**
   * Retransmite una trama
   * @param {number} seqNum - Número de secuencia a retransmitir
   */
  retransmitFrame(seqNum) {
    if (!this.pendingAcks.has(seqNum)) {
      return
    }

    const pending = this.pendingAcks.get(seqNum)
    this.stats.retransmissions++

    // Configurar nuevo timeout
    if (pending.timeout) {
      clearTimeout(pending.timeout)
    }

    pending.timeout = setTimeout(() => {
      this.handleAckTimeout(seqNum, pending.retransmitCallback)
    }, ACK_TIMEOUT)

    pending.timestamp = Date.now()

    this.emit('frame_retransmitting', {
      seqNum: seqNum,
      attempt: pending.retries + 1,
      timestamp: Date.now()
    })

    // Llamar callback de retransmisión
    if (pending.retransmitCallback) {
      pending.retransmitCallback(pending.frame, seqNum)
    }
  }

  /**
   * Procesa trama de datos recibida
   * @param {number} seqNum - Número de secuencia recibido
   * @param {Function} sendCallback - Función para enviar respuesta
   * @returns {Object} Resultado del procesamiento
   */
  processReceivedDataFrame(seqNum, sendCallback) {
    // Verificar si es la trama esperada
    if (seqNum === this.expectedSeqNum) {
      // Trama en orden
      this.receivedFrames.add(seqNum)
      this.expectedSeqNum = Utils.nextSeqNum(this.expectedSeqNum)

      this.sendAck(seqNum, sendCallback)

      return {
        action: 'accept',
        seqNum: seqNum,
        nextExpected: this.expectedSeqNum
      }
    } else if (this.receivedFrames.has(seqNum)) {
      // Trama duplicada
      this.stats.duplicatesDetected++
      this.sendAck(seqNum, sendCallback) // Reenviar ACK

      return {
        action: 'duplicate',
        seqNum: seqNum,
        nextExpected: this.expectedSeqNum
      }
    } else {
      // Trama fuera de orden - enviar NAK pidiendo la esperada
      this.sendNak(this.expectedSeqNum, sendCallback, 'Out of order frame')

      return {
        action: 'out_of_order',
        seqNum: seqNum,
        expectedSeqNum: this.expectedSeqNum
      }
    }
  }

  /**
   * Limpia ACKs pendientes (para desconexión)
   */
  clearPendingAcks() {
    for (const [seqNum, pending] of this.pendingAcks) {
      if (pending.timeout) {
        clearTimeout(pending.timeout)
      }
    }

    this.pendingAcks.clear()
    this.receivedFrames.clear()

    this.emit('acks_cleared', {
      timestamp: Date.now()
    })
  }

  /**
   * Obtiene estadísticas del sistema de ACKs
   */
  getStats() {
    return {
      ...this.stats,
      pendingCount: this.pendingAcks.size,
      receivedFramesCount: this.receivedFrames.size,
      expectedSeqNum: this.expectedSeqNum,
      timestamp: Date.now()
    }
  }

  /**
   * Obtiene información de ACKs pendientes
   */
  getPendingAcks() {
    const pending = []

    for (const [seqNum, data] of this.pendingAcks) {
      pending.push({
        seqNum: seqNum,
        age: Date.now() - data.timestamp,
        retries: data.retries,
        frameSize: data.frame.length
      })
    }

    return pending.sort((a, b) => b.age - a.age)
  }

  /**
   * Resetea estadísticas
   */
  resetStats() {
    this.stats = {
      acksSent: 0,
      naksSent: 0,
      acksReceived: 0,
      naksReceived: 0,
      timeouts: 0,
      retransmissions: 0,
      duplicatesDetected: 0
    }

    this.emit('stats_reset', {
      timestamp: Date.now()
    })
  }
}

module.exports = AcknowledgmentManager
