/**
 * Constructor y Parser de Tramas
 * Maneja la estructura: FLAG | CONTROL | SEQ_NUM | DATA | CRC | FLAG
 */

const {
  FLAG,
  FrameType,
  FieldSize,
  ErrorMessages,
  Utils
} = require('../constants')
const { bitStuff, bitUnstuff } = require('./bitStuffing')
const CRC = require('../errorControl/crc')

class FrameBuilder {
  constructor() {
    this.frameCounter = 0 // Para debugging
  }

  /**
   * Construye una trama completa con todos los campos
   * @param {Object} frameData - Datos de la trama
   * @param {number} frameData.type - Tipo de trama (FrameType)
   * @param {number} frameData.seqNum - Número de secuencia (0-15)
   * @param {Buffer|string} frameData.data - Datos payload
   * @returns {Buffer} Trama completa lista para transmitir
   */
  buildFrame({ type, seqNum, data = Buffer.alloc(0) }) {
    // Validar parámetros
    if (!Object.values(FrameType).includes(type)) {
      throw new Error(`Tipo de trama inválido: ${type}`)
    }

    if (seqNum < 0 || seqNum > 15) {
      throw new Error(
        `Número de secuencia inválido: ${seqNum} (debe estar entre 0-15)`
      )
    }

    // Convertir data a Buffer si es string
    if (typeof data === 'string') {
      data = Buffer.from(data, 'utf8')
    }

    // Validar tamaño de datos
    if (data.length > FieldSize.MAX_DATA) {
      throw new Error(
        `Datos demasiado grandes: ${data.length} bytes (máximo ${FieldSize.MAX_DATA})`
      )
    }

    // Construir campo de control y número de secuencia
    const controlField = type
    const seqField = seqNum & 0x0f // Asegurar que son solo 4 bits

    // Crear payload interno (CONTROL | SEQ_NUM | DATA)
    const payloadSize = 1 + 1 + data.length // control + seq + data
    const payload = Buffer.alloc(payloadSize)

    payload[0] = controlField
    payload[1] = seqField

    if (data.length > 0) {
      data.copy(payload, 2)
    }

    // Añadir CRC al payload
    const payloadWithCrc = CRC.addCrc(payload)

    // Aplicar bit stuffing
    const stuffedPayload = bitStuff(payloadWithCrc)

    // Construir trama final con FLAGS
    const frameSize = 1 + stuffedPayload.length + 1 // FLAG + payload + FLAG
    const frame = Buffer.alloc(frameSize)

    frame[0] = FLAG // FLAG inicial
    stuffedPayload.copy(frame, 1) // Payload con stuffing
    frame[frameSize - 1] = FLAG // FLAG final

    this.frameCounter++

    return frame
  }

  /**
   * Parsea una trama recibida y extrae sus componentes
   * @param {Buffer} rawFrame - Trama cruda recibida
   * @returns {Object} Resultado del parsing
   */
  parseFrame(rawFrame) {
    try {
      // Validar tamaño mínimo
      if (rawFrame.length < 4) {
        // MIN: FLAG + CONTROL + SEQ + CRC(2) + FLAG
        return {
          success: false,
          error: 'Trama demasiado pequeña',
          frame: null
        }
      }

      // Validar FLAGS
      if (rawFrame[0] !== FLAG || rawFrame[rawFrame.length - 1] !== FLAG) {
        return {
          success: false,
          error: 'FLAGS de inicio/fin incorrectas',
          frame: null
        }
      }

      // Extraer payload (sin FLAGS)
      const stuffedPayload = rawFrame.slice(1, -1)

      // Aplicar bit unstuffing
      const unstuffResult = bitUnstuff(stuffedPayload)
      if (!unstuffResult.success) {
        return {
          success: false,
          error: `Error en bit unstuffing: ${unstuffResult.error}`,
          frame: null
        }
      }

      const payload = unstuffResult.data

      // Validar tamaño mínimo del payload
      if (payload.length < 4) {
        // CONTROL + SEQ + CRC(2)
        return {
          success: false,
          error: 'Payload demasiado pequeño',
          frame: null
        }
      }

      // Extraer y validar CRC
      const crcResult = CRC.extractAndValidate(payload)
      if (!crcResult.valid) {
        return {
          success: false,
          error: `Error de CRC: calculado=${CRC.toHex(
            crcResult.calculatedCrc
          )}, recibido=${CRC.toHex(crcResult.crc)}`,
          frame: null,
          crcError: true
        }
      }

      const validPayload = crcResult.data

      // Extraer campos del payload validado
      if (validPayload.length < 2) {
        return {
          success: false,
          error: 'Payload validado demasiado pequeño',
          frame: null
        }
      }

      const controlField = validPayload[0]
      const seqField = validPayload[1] & 0x0f // Solo 4 bits LSB
      const data =
        validPayload.length > 2 ? validPayload.slice(2) : Buffer.alloc(0)

      // Validar tipo de trama
      if (!Object.values(FrameType).includes(controlField)) {
        return {
          success: false,
          error: `Tipo de trama desconocido: 0x${controlField.toString(16)}`,
          frame: null
        }
      }

      return {
        success: true,
        frame: {
          type: controlField,
          seqNum: seqField,
          data: data,
          rawLength: rawFrame.length,
          payloadLength: data.length,
          crc: crcResult.crc
        },
        stats: {
          originalSize: rawFrame.length,
          stuffedSize: stuffedPayload.length,
          finalSize: payload.length,
          overhead: rawFrame.length - data.length
        }
      }
    } catch (error) {
      return {
        success: false,
        error: `Error inesperado al parsear trama: ${error.message}`,
        frame: null
      }
    }
  }

  /**
   * Crea trama de datos
   */
  createDataFrame(seqNum, data) {
    return this.buildFrame({
      type: FrameType.DATA,
      seqNum: seqNum,
      data: data
    })
  }

  /**
   * Crea trama de ACK
   */
  createAckFrame(seqNum) {
    return this.buildFrame({
      type: FrameType.ACK,
      seqNum: seqNum,
      data: Buffer.alloc(0)
    })
  }

  /**
   * Crea trama de NAK
   */
  createNakFrame(seqNum) {
    return this.buildFrame({
      type: FrameType.NAK,
      seqNum: seqNum,
      data: Buffer.alloc(0)
    })
  }

  /**
   * Crea trama de conexión
   */
  createConnectionFrame(seqNum = 0) {
    return this.buildFrame({
      type: FrameType.CONN,
      seqNum: seqNum,
      data: Buffer.from('CONNECT_REQUEST', 'utf8')
    })
  }

  /**
   * Crea trama de confirmación de conexión
   */
  createConnectionAckFrame(seqNum = 0) {
    return this.buildFrame({
      type: FrameType.CONN_ACK,
      seqNum: seqNum,
      data: Buffer.from('CONNECT_ACK', 'utf8')
    })
  }

  /**
   * Crea trama de desconexión
   */
  createDisconnectionFrame(seqNum = 0) {
    return this.buildFrame({
      type: FrameType.DISC,
      seqNum: seqNum,
      data: Buffer.from('DISCONNECT', 'utf8')
    })
  }

  /**
   * Crea trama de heartbeat
   */
  createHeartbeatFrame(seqNum = 0) {
    return this.buildFrame({
      type: FrameType.HEARTBEAT,
      seqNum: seqNum,
      data: Buffer.from(Date.now().toString(), 'utf8')
    })
  }

  /**
   * Convierte tipo de trama a string legible
   */
  frameTypeToString(type) {
    const typeNames = {
      [FrameType.DATA]: 'DATA',
      [FrameType.ACK]: 'ACK',
      [FrameType.NAK]: 'NAK',
      [FrameType.CONN]: 'CONN',
      [FrameType.CONN_ACK]: 'CONN_ACK',
      [FrameType.DISC]: 'DISC',
      [FrameType.DISC_ACK]: 'DISC_ACK',
      [FrameType.HEARTBEAT]: 'HEARTBEAT'
    }

    return typeNames[type] || `UNKNOWN(0x${type.toString(16)})`
  }

  /**
   * Genera representación legible de la trama para debugging
   */
  frameToString(frameData) {
    if (!frameData || !frameData.frame) {
      return 'INVALID_FRAME'
    }

    const frame = frameData.frame
    const dataStr =
      frame.data.length > 0 ? ` data="${frame.data.toString('utf8')}"` : ''

    return `${this.frameTypeToString(frame.type)}(seq=${
      frame.seqNum
    }${dataStr}) [${frame.rawLength}B]`
  }

  /**
   * Obtiene estadísticas del builder
   */
  getStats() {
    return {
      framesBuilt: this.frameCounter,
      timestamp: new Date().toISOString()
    }
  }
}

// Instancia singleton
const frameBuilder = new FrameBuilder()

module.exports = frameBuilder
