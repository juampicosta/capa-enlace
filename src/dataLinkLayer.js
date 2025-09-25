/**
 * Capa de Enlace de Datos Principal
 * Integra todos los módulos y coordina la transmisión/recepción
 */

const EventEmitter = require('events')
const frameBuilder = require('./framing/frameBuilder')
const WindowManager = require('./flowControl/windowManager')
const AcknowledgmentManager = require('./errorControl/acknowledgments')
const ConnectionManager = require('./connection/connectionManager')
const { FrameType, ConnectionState, ErrorMessages } = require('./constants')

class DataLinkLayer extends EventEmitter {
  constructor() {
    super()

    // Inicializar módulos
    this.windowManager = new WindowManager()
    this.ackManager = new AcknowledgmentManager()
    this.connectionManager = new ConnectionManager()

    // Colas de datos
    this.sendQueue = [] // Cola de datos para enviar
    this.receiveBuffer = [] // Buffer de datos recibidos

    // Estado interno
    this.isTransmitting = false
    this.physicalLayerCallback = null

    // Estadísticas globales
    this.globalStats = {
      totalFramesSent: 0,
      totalFramesReceived: 0,
      totalDataBytesSent: 0,
      totalDataBytesReceived: 0,
      totalErrors: 0,
      startTime: Date.now()
    }

    // Configurar event listeners entre módulos
    this.setupEventListeners()
  }

  /**
   * Configura los event listeners entre módulos
   */
  setupEventListeners() {
    // Window Manager eventos
    this.windowManager.on('window_full', (data) => {
      this.emit('flow_control', { type: 'window_full', ...data })
    })

    this.windowManager.on('frames_delivered', (data) => {
      // Entregar datos a la capa de red
      for (const frame of data.frames) {
        this.deliverToNetworkLayer(frame.data, frame.seqNum)
      }
    })

    // ACK Manager eventos
    this.ackManager.on('ack_timeout', (data) => {
      this.emit('error_recovery', { type: 'ack_timeout', ...data })
    })

    this.ackManager.on('frame_failed', (data) => {
      this.globalStats.totalErrors++
      this.emit('transmission_failed', data)
    })

    // ✨ NUEVOS: Propagar eventos de ACK/NAK hacia arriba
    this.ackManager.on('ack_sent', (data) => {
      this.emit('ack_sent', data)
    })

    this.ackManager.on('nak_sent', (data) => {
      this.emit('nak_sent', data)
    })

    this.ackManager.on('ack_received', (data) => {
      this.emit('ack_received', data)
    })

    this.ackManager.on('nak_received', (data) => {
      this.emit('nak_received', data)
    })

    // Connection Manager eventos
    this.connectionManager.on('connection_established', (data) => {
      this.emit('connected', data)
    })

    this.connectionManager.on('disconnected', (data) => {
      this.handleDisconnection()
      this.emit('disconnected', data)
    })

    this.connectionManager.on('connection_request', (data) => {
      this.emit('connection_request', data)
    })
  }

  /**
   * Configura la interfaz con la capa física
   * @param {Function} sendToPhysical - Función para enviar a capa física
   */
  setPhysicalLayer(sendToPhysical) {
    this.physicalLayerCallback = sendToPhysical
  }

  /**
   * Interfaz con la capa de red - Enviar datos
   * @param {Buffer|string} data - Datos a enviar
   * @returns {Promise<boolean>} Promesa que resuelve cuando se envía
   */
  async sendToNetwork(data) {
    if (!this.connectionManager.isConnected()) {
      throw new Error(ErrorMessages.NOT_CONNECTED)
    }

    // Convertir string a Buffer si es necesario
    if (typeof data === 'string') {
      data = Buffer.from(data, 'utf8')
    }

    // Añadir a cola de envío
    return new Promise((resolve, reject) => {
      this.sendQueue.push({
        data: data,
        resolve: resolve,
        reject: reject,
        timestamp: Date.now()
      })

      // Procesar cola si no estamos transmitiendo
      if (!this.isTransmitting) {
        this.processSendQueue()
      }
    })
  }

  /**
   * Procesa la cola de envío
   */
  async processSendQueue() {
    if (this.isTransmitting || this.sendQueue.length === 0) {
      return
    }

    this.isTransmitting = true

    try {
      while (
        this.sendQueue.length > 0 &&
        this.connectionManager.isConnected()
      ) {
        const queueItem = this.sendQueue.shift()

        try {
          await this.sendDataFrame(queueItem.data)
          queueItem.resolve(true)
        } catch (error) {
          queueItem.reject(error)
        }
      }
    } finally {
      this.isTransmitting = false
    }
  }

  /**
   * Envía una trama de datos
   * @param {Buffer} data - Datos a enviar
   */
  async sendDataFrame(data) {
    // Verificar ventana
    const seqNum = this.windowManager.getNextSeqNum()
    if (seqNum === null) {
      // Ventana llena - esperar
      await this.waitForWindowSpace()
      return this.sendDataFrame(data) // Reintentar
    }

    // Construir trama
    const frame = frameBuilder.createDataFrame(seqNum, data)

    // Registrar para ACK
    this.ackManager.registerPendingAck(
      seqNum,
      frame,
      (retransmitFrame, retransmitSeqNum) => {
        this.sendFrameToPhysical(retransmitFrame)
      }
    )

    // Enviar a capa física
    this.sendFrameToPhysical(frame)

    this.globalStats.totalFramesSent++
    this.globalStats.totalDataBytesSent += data.length

    this.emit('data_frame_sent', {
      seqNum: seqNum,
      dataSize: data.length,
      frameSize: frame.length,
      timestamp: Date.now()
    })
  }

  /**
   * Espera hasta que haya espacio en la ventana
   */
  waitForWindowSpace() {
    return new Promise((resolve) => {
      if (this.windowManager.canSend()) {
        resolve()
        return
      }

      const checkWindow = () => {
        if (this.windowManager.canSend()) {
          resolve()
        } else {
          setTimeout(checkWindow, 50) // Verificar cada 50ms
        }
      }

      checkWindow()
    })
  }

  /**
   * Envía trama a la capa física
   * @param {Buffer} frame - Trama a enviar
   */
  sendFrameToPhysical(frame) {
    if (!this.physicalLayerCallback) {
      throw new Error('Capa física no configurada')
    }

    this.physicalLayerCallback(frame)
  }

  /**
   * Interfaz con capa física - Recibir trama
   * @param {Buffer} rawFrame - Trama cruda recibida
   */
  receiveFromPhysical(rawFrame) {
    try {
      // Parsear trama
      const parseResult = frameBuilder.parseFrame(rawFrame)

      if (!parseResult.success) {
        this.globalStats.totalErrors++
        this.emit('frame_error', {
          error: parseResult.error,
          rawFrameSize: rawFrame.length,
          crcError: parseResult.crcError || false,
          timestamp: Date.now()
        })
        return
      }

      const frame = parseResult.frame
      this.globalStats.totalFramesReceived++

      this.emit('frame_received', {
        type: frameBuilder.frameTypeToString(frame.type),
        seqNum: frame.seqNum,
        dataSize: frame.payloadLength,
        timestamp: Date.now()
      })

      // Procesar según tipo de trama
      this.processReceivedFrame(frame)
    } catch (error) {
      this.globalStats.totalErrors++
      this.emit('receive_error', {
        error: error.message,
        rawFrameSize: rawFrame.length,
        timestamp: Date.now()
      })
    }
  }

  /**
   * Procesa trama recibida según su tipo
   * @param {Object} frame - Trama parseada
   */
  processReceivedFrame(frame) {
    // Verificar si es trama de conexión
    if (this.connectionManager.processFrame(frame)) {
      return // Procesada por connection manager
    }

    // Procesar según tipo
    switch (frame.type) {
      case FrameType.DATA:
        this.processDataFrame(frame)
        break

      case FrameType.ACK:
        this.processAckFrame(frame)
        break

      case FrameType.NAK:
        this.processNakFrame(frame)
        break

      default:
        this.emit('unknown_frame', {
          type: frame.type,
          seqNum: frame.seqNum,
          timestamp: Date.now()
        })
    }
  }

  /**
   * Procesa trama de datos recibida
   * @param {Object} frame - Trama de datos
   */
  processDataFrame(frame) {
    if (!this.connectionManager.isConnected()) {
      return // Ignorar si no estamos conectados
    }

    // Procesar con window manager
    const result = this.windowManager.receiveFrame(frame.seqNum, frame.data)

    switch (result.action) {
      case 'delivered':
        // Datos entregados en orden
        this.ackManager.sendAck(
          result.frames[result.frames.length - 1].seqNum,
          (ackFrame) => this.sendFrameToPhysical(ackFrame)
        )
        break

      case 'buffered':
        // Trama fuera de orden, buffered
        this.emit('frame_buffered', {
          seqNum: frame.seqNum,
          expectedSeqNum: result.expectedSeqNum,
          timestamp: Date.now()
        })
        break

      case 'duplicate':
        // Trama duplicada - reenviar ACK
        this.ackManager.sendAck(frame.seqNum, (ackFrame) =>
          this.sendFrameToPhysical(ackFrame)
        )
        break

      case 'out_of_window':
        // Trama fuera de ventana - ignorar
        this.emit('frame_out_of_window', {
          seqNum: frame.seqNum,
          expectedSeqNum: result.expectedSeqNum,
          timestamp: Date.now()
        })
        break
    }

    this.globalStats.totalDataBytesReceived += frame.data.length
  }

  /**
   * Procesa trama ACK recibida
   * @param {Object} frame - Trama ACK
   */
  processAckFrame(frame) {
    // Procesar ACK
    this.ackManager.handleReceivedAck(frame.seqNum)

    // Deslizar ventana
    const windowResult = this.windowManager.processAck(frame.seqNum)

    if (windowResult.windowSlid) {
      this.emit('window_advanced', {
        oldBase: windowResult.oldBase,
        newBase: windowResult.newBase,
        timestamp: Date.now()
      })

      // Continuar procesando cola de envío
      if (!this.isTransmitting) {
        this.processSendQueue()
      }
    }
  }

  /**
   * Procesa trama NAK recibida
   * @param {Object} frame - Trama NAK
   */
  processNakFrame(frame) {
    this.ackManager.handleReceivedNak(frame.seqNum)
  }

  /**
   * Entrega datos a la capa de red
   * @param {Buffer} data - Datos a entregar
   * @param {number} seqNum - Número de secuencia
   */
  deliverToNetworkLayer(data, seqNum) {
    this.emit('data_received', {
      data: data,
      seqNum: seqNum,
      size: data.length,
      timestamp: Date.now()
    })
  }

  /**
   * Establece conexión
   * @returns {Promise<boolean>} Promesa que resuelve cuando conecta
   */
  async connect() {
    return this.connectionManager.connect((frame) => {
      this.sendFrameToPhysical(frame)
    })
  }

  /**
   * Acepta conexión entrante
   * @param {number} remoteSeqNum - Número de secuencia remoto
   * @returns {boolean} True si se acepta la conexión
   */
  acceptConnection(remoteSeqNum) {
    return this.connectionManager.acceptConnection(remoteSeqNum, (frame) => {
      this.sendFrameToPhysical(frame)
    })
  }

  /**
   * Desconecta
   * @returns {Promise<boolean>} Promesa que resuelve cuando desconecta
   */
  async disconnect() {
    if (!this.connectionManager.isConnected()) {
      return true
    }

    return this.connectionManager.disconnect((frame) => {
      this.sendFrameToPhysical(frame)
    })
  }

  /**
   * Maneja desconexión
   */
  handleDisconnection() {
    // Limpiar colas
    this.sendQueue = []
    this.receiveBuffer = []

    // Limpiar ACKs pendientes
    this.ackManager.clearPendingAcks()

    // Resetear ventanas
    this.windowManager.reset()

    this.isTransmitting = false
  }

  /**
   * Verifica si está conectado
   */
  isConnected() {
    return this.connectionManager.isConnected()
  }

  /**
   * Obtiene estado de la conexión
   */
  getConnectionState() {
    return this.connectionManager.getState()
  }

  /**
   * Obtiene información completa del estado
   */
  getStatus() {
    return {
      connection: this.connectionManager.getConnectionInfo(),
      window: this.windowManager.getStats(),
      acknowledgments: this.ackManager.getStats(),
      queues: {
        sendQueue: this.sendQueue.length,
        receiveBuffer: this.receiveBuffer.length
      },
      global: this.globalStats,
      isTransmitting: this.isTransmitting
    }
  }

  /**
   * Obtiene estadísticas globales
   */
  getStats() {
    const uptime = Date.now() - this.globalStats.startTime

    return {
      ...this.globalStats,
      uptime: uptime,
      throughput: {
        framesSentPerSec: (this.globalStats.totalFramesSent / uptime) * 1000,
        framesReceivedPerSec:
          (this.globalStats.totalFramesReceived / uptime) * 1000,
        dataBytesSentPerSec:
          (this.globalStats.totalDataBytesSent / uptime) * 1000,
        dataBytesReceivedPerSec:
          (this.globalStats.totalDataBytesReceived / uptime) * 1000
      },
      errorRate:
        this.globalStats.totalFramesReceived > 0
          ? (this.globalStats.totalErrors /
              this.globalStats.totalFramesReceived) *
            100
          : 0
    }
  }

  /**
   * Resetea todas las estadísticas
   */
  resetStats() {
    this.globalStats = {
      totalFramesSent: 0,
      totalFramesReceived: 0,
      totalDataBytesSent: 0,
      totalDataBytesReceived: 0,
      totalErrors: 0,
      startTime: Date.now()
    }

    this.ackManager.resetStats()
    this.connectionManager.resetStats()

    this.emit('stats_reset', {
      timestamp: Date.now()
    })
  }
}

module.exports = DataLinkLayer
