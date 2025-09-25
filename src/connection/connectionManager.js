/**
 * Gestor de Conexiones
 * Maneja establecimiento, mantenimiento y cierre de conexiones
 */

const {
  ConnectionState,
  FrameType,
  HEARTBEAT_INTERVAL
} = require('../constants')
const frameBuilder = require('../framing/frameBuilder')
const EventEmitter = require('events')

class ConnectionManager extends EventEmitter {
  constructor() {
    super()

    this.state = ConnectionState.DISCONNECTED
    this.localSeqNum = 0
    this.remoteSeqNum = 0

    // Timeouts y timers
    this.connectionTimeout = null
    this.heartbeatTimer = null
    this.lastHeartbeatReceived = null
    this.lastHeartbeatSent = null

    // Estadísticas
    this.stats = {
      connectionsEstablished: 0,
      connectionsFailed: 0,
      disconnections: 0,
      heartbeatsSent: 0,
      heartbeatsReceived: 0,
      connectionUptime: 0,
      connectionStartTime: null
    }

    // Configuración
    this.connectionTimeoutMs = 10000 // 10 segundos para establecer conexión
    this.heartbeatTimeoutMs = HEARTBEAT_INTERVAL * 3 // 3x intervalo para timeout
  }

  /**
   * Inicia el proceso de conexión (cliente)
   * @param {Function} sendCallback - Función para enviar tramas
   * @returns {Promise<boolean>} Promesa que resuelve cuando la conexión se establece
   */
  async connect(sendCallback) {
    if (this.state !== ConnectionState.DISCONNECTED) {
      throw new Error(`No se puede conectar desde estado ${this.state}`)
    }

    return new Promise((resolve, reject) => {
      this.state = ConnectionState.CONNECTING
      this.sendCallback = sendCallback

      this.emit('connection_starting', {
        timestamp: Date.now()
      })

      // Enviar solicitud de conexión
      const connFrame = frameBuilder.createConnectionFrame(this.localSeqNum)
      sendCallback(connFrame)

      // Configurar timeout
      this.connectionTimeout = setTimeout(() => {
        if (this.state === ConnectionState.CONNECTING) {
          this.state = ConnectionState.DISCONNECTED
          this.stats.connectionsFailed++

          this.emit('connection_failed', {
            reason: 'timeout',
            timestamp: Date.now()
          })

          reject(new Error('Timeout estableciendo conexión'))
        }
      }, this.connectionTimeoutMs)

      // Configurar listeners para respuesta
      const onConnAck = (result) => {
        if (result.success && this.state === ConnectionState.CONNECTING) {
          this.handleConnectionEstablished(resolve)
        }
      }

      const onConnFailed = () => {
        if (this.state === ConnectionState.CONNECTING) {
          this.state = ConnectionState.DISCONNECTED
          this.stats.connectionsFailed++
          reject(new Error('Conexión rechazada'))
        }
      }

      // Listeners temporales
      this.once('conn_ack_received', onConnAck)
      this.once('connection_rejected', onConnFailed)
    })
  }

  /**
   * Acepta una solicitud de conexión (servidor)
   * @param {number} remoteSeqNum - Número de secuencia del cliente
   * @param {Function} sendCallback - Función para enviar tramas
   */
  acceptConnection(remoteSeqNum, sendCallback) {
    if (this.state !== ConnectionState.DISCONNECTED) {
      this.emit('connection_rejected', {
        reason: `Estado actual: ${this.state}`,
        timestamp: Date.now()
      })
      return false
    }

    this.state = ConnectionState.CONNECTING
    this.remoteSeqNum = remoteSeqNum
    this.sendCallback = sendCallback

    // Enviar confirmación
    const connAckFrame = frameBuilder.createConnectionAckFrame(this.localSeqNum)
    sendCallback(connAckFrame)

    // Establecer conexión
    this.handleConnectionEstablished()

    return true
  }

  /**
   * Maneja el establecimiento exitoso de la conexión
   * @param {Function} resolve - Función resolve de promesa (opcional)
   */
  handleConnectionEstablished(resolve = null) {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout)
      this.connectionTimeout = null
    }

    this.state = ConnectionState.CONNECTED
    this.stats.connectionsEstablished++
    this.stats.connectionStartTime = Date.now()

    // Iniciar heartbeat
    this.startHeartbeat()

    this.emit('connection_established', {
      localSeqNum: this.localSeqNum,
      remoteSeqNum: this.remoteSeqNum,
      timestamp: Date.now()
    })

    if (resolve) {
      resolve(true)
    }
  }

  /**
   * Inicia el proceso de desconexión
   * @param {Function} sendCallback - Función para enviar tramas
   * @returns {Promise<boolean>} Promesa que resuelve cuando se desconecta
   */
  async disconnect(sendCallback) {
    if (this.state !== ConnectionState.CONNECTED) {
      return false
    }

    return new Promise((resolve) => {
      this.state = ConnectionState.DISCONNECTING

      // Detener heartbeat
      this.stopHeartbeat()

      this.emit('disconnection_starting', {
        timestamp: Date.now()
      })

      // Enviar solicitud de desconexión
      const discFrame = frameBuilder.createDisconnectionFrame(this.localSeqNum)
      sendCallback(discFrame)

      // Timeout para forzar desconexión
      setTimeout(() => {
        this.handleDisconnection()
        resolve(true)
      }, 5000)

      // Listener para confirmación
      this.once('disc_ack_received', () => {
        this.handleDisconnection()
        resolve(true)
      })
    })
  }

  /**
   * Maneja la desconexión
   */
  handleDisconnection() {
    if (this.stats.connectionStartTime) {
      this.stats.connectionUptime += Date.now() - this.stats.connectionStartTime
      this.stats.connectionStartTime = null
    }

    this.state = ConnectionState.DISCONNECTED
    this.stats.disconnections++

    this.stopHeartbeat()
    this.clearTimeouts()

    this.emit('disconnected', {
      uptime: this.stats.connectionUptime,
      timestamp: Date.now()
    })
  }

  /**
   * Procesa trama recibida relacionada con conexión
   * @param {Object} frame - Trama parseada
   * @returns {boolean} True si la trama fue procesada
   */
  processFrame(frame) {
    switch (frame.type) {
      case FrameType.CONN:
        return this.handleConnectionRequest(frame)

      case FrameType.CONN_ACK:
        return this.handleConnectionAck(frame)

      case FrameType.DISC:
        return this.handleDisconnectionRequest(frame)

      case FrameType.DISC_ACK:
        return this.handleDisconnectionAck(frame)

      case FrameType.HEARTBEAT:
        return this.handleHeartbeat(frame)

      default:
        return false // No es una trama de conexión
    }
  }

  /**
   * Maneja solicitud de conexión
   */
  handleConnectionRequest(frame) {
    this.emit('connection_request', {
      remoteSeqNum: frame.seqNum,
      data: frame.data.toString('utf8'),
      timestamp: Date.now()
    })

    return true
  }

  /**
   * Maneja confirmación de conexión
   */
  handleConnectionAck(frame) {
    this.remoteSeqNum = frame.seqNum

    this.emit('conn_ack_received', {
      success: true,
      remoteSeqNum: frame.seqNum,
      timestamp: Date.now()
    })

    return true
  }

  /**
   * Maneja solicitud de desconexión
   */
  handleDisconnectionRequest(frame) {
    if (this.state === ConnectionState.CONNECTED) {
      // Enviar confirmación
      const discAckFrame = frameBuilder.createDataFrame(
        this.localSeqNum,
        Buffer.from('DISC_ACK', 'utf8')
      )

      if (this.sendCallback) {
        this.sendCallback(discAckFrame)
      }

      // Desconectar
      setTimeout(() => this.handleDisconnection(), 100)
    }

    this.emit('disconnection_request', {
      remoteSeqNum: frame.seqNum,
      timestamp: Date.now()
    })

    return true
  }

  /**
   * Maneja confirmación de desconexión
   */
  handleDisconnectionAck(frame) {
    this.emit('disc_ack_received', {
      remoteSeqNum: frame.seqNum,
      timestamp: Date.now()
    })

    return true
  }

  /**
   * Maneja heartbeat recibido
   */
  handleHeartbeat(frame) {
    this.lastHeartbeatReceived = Date.now()
    this.stats.heartbeatsReceived++

    // Responder con heartbeat si estamos conectados
    if (this.state === ConnectionState.CONNECTED && this.sendCallback) {
      const heartbeatFrame = frameBuilder.createHeartbeatFrame(this.localSeqNum)
      this.sendCallback(heartbeatFrame)
      this.stats.heartbeatsSent++
    }

    this.emit('heartbeat_received', {
      remoteSeqNum: frame.seqNum,
      timestamp: Date.now()
    })

    return true
  }

  /**
   * Inicia el sistema de heartbeat
   */
  startHeartbeat() {
    this.stopHeartbeat() // Limpiar timer anterior

    this.heartbeatTimer = setInterval(() => {
      if (this.state === ConnectionState.CONNECTED && this.sendCallback) {
        const heartbeatFrame = frameBuilder.createHeartbeatFrame(
          this.localSeqNum
        )
        this.sendCallback(heartbeatFrame)
        this.lastHeartbeatSent = Date.now()
        this.stats.heartbeatsSent++

        this.emit('heartbeat_sent', {
          localSeqNum: this.localSeqNum,
          timestamp: Date.now()
        })

        // Verificar si el remoto está respondiendo
        if (
          this.lastHeartbeatReceived &&
          Date.now() - this.lastHeartbeatReceived > this.heartbeatTimeoutMs
        ) {
          this.emit('heartbeat_timeout', {
            lastReceived: this.lastHeartbeatReceived,
            timeout: this.heartbeatTimeoutMs,
            timestamp: Date.now()
          })

          // Desconectar por timeout
          this.handleDisconnection()
        }
      }
    }, HEARTBEAT_INTERVAL)

    this.lastHeartbeatSent = Date.now()
    this.lastHeartbeatReceived = Date.now()
  }

  /**
   * Detiene el sistema de heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /**
   * Limpia todos los timeouts
   */
  clearTimeouts() {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout)
      this.connectionTimeout = null
    }
  }

  /**
   * Verifica si está conectado
   */
  isConnected() {
    return this.state === ConnectionState.CONNECTED
  }

  /**
   * Obtiene estado actual
   */
  getState() {
    return this.state
  }

  /**
   * Obtiene información de la conexión
   */
  getConnectionInfo() {
    let uptime = 0
    if (this.stats.connectionStartTime) {
      uptime = Date.now() - this.stats.connectionStartTime
    }

    return {
      state: this.state,
      localSeqNum: this.localSeqNum,
      remoteSeqNum: this.remoteSeqNum,
      uptime: uptime,
      lastHeartbeatSent: this.lastHeartbeatSent,
      lastHeartbeatReceived: this.lastHeartbeatReceived,
      isHealthy: this.isConnectionHealthy()
    }
  }

  /**
   * Verifica si la conexión está saludable
   */
  isConnectionHealthy() {
    if (this.state !== ConnectionState.CONNECTED) {
      return false
    }

    if (!this.lastHeartbeatReceived) {
      return true // Recién conectado
    }

    const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeatReceived
    return timeSinceLastHeartbeat < this.heartbeatTimeoutMs
  }

  /**
   * Obtiene estadísticas
   */
  getStats() {
    let currentUptime = this.stats.connectionUptime
    if (this.stats.connectionStartTime) {
      currentUptime += Date.now() - this.stats.connectionStartTime
    }

    return {
      ...this.stats,
      connectionUptime: currentUptime,
      currentState: this.state,
      isConnected: this.isConnected(),
      isHealthy: this.isConnectionHealthy(),
      timestamp: Date.now()
    }
  }

  /**
   * Resetea estadísticas
   */
  resetStats() {
    this.stats = {
      connectionsEstablished: 0,
      connectionsFailed: 0,
      disconnections: 0,
      heartbeatsSent: 0,
      heartbeatsReceived: 0,
      connectionUptime: 0,
      connectionStartTime:
        this.state === ConnectionState.CONNECTED ? Date.now() : null
    }

    this.emit('stats_reset', {
      timestamp: Date.now()
    })
  }
}

module.exports = ConnectionManager
