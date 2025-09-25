/**
 * Constantes del Protocolo de Capa de Enlace de Datos
 * Universidad - Trabajo Práctico de Redes de Datos
 */

// === BANDERAS Y DELIMITADORES ===
const FLAG = 0x7e // 01111110 - Bandera de inicio y fin de trama
const ESC = 0x7d // 01111101 - Caracter de escape para bit stuffing

// === TIPOS DE TRAMA (Campo CONTROL) ===
const FrameType = {
  DATA: 0x01, // Trama de datos
  ACK: 0x02, // Confirmación positiva
  NAK: 0x03, // Confirmación negativa
  CONN: 0x04, // Solicitud de conexión
  CONN_ACK: 0x05, // Confirmación de conexión
  DISC: 0x06, // Solicitud de desconexión
  DISC_ACK: 0x07, // Confirmación de desconexión
  HEARTBEAT: 0x08 // Keep-alive
}

// === CONFIGURACIÓN DE VENTANA DESLIZANTE ===
const WINDOW_SIZE = 8 // Tamaño de ventana de envío
const MAX_SEQ_NUM = 15 // Número de secuencia máximo (4 bits: 0-15)
const SEQ_NUM_BITS = 4 // Bits para número de secuencia

// === TIMEOUTS Y RETRANSMISIONES ===
const ACK_TIMEOUT = 2000 // Timeout para ACK (2 segundos)
const MAX_RETRIES = 3 // Máximo número de retransmisiones
const HEARTBEAT_INTERVAL = 5000 // Intervalo de keep-alive (5 segundos)

// === TAMAÑOS DE CAMPOS ===
const FieldSize = {
  FLAG: 1, // 1 byte
  CONTROL: 1, // 1 byte
  SEQ_NUM: 1, // 1 byte (4 bits usados)
  CRC: 2, // 2 bytes (CRC-16)
  MIN_DATA: 0, // Tamaño mínimo de datos
  MAX_DATA: 1024 // Tamaño máximo de datos (1KB)
}

// === ESTADOS DE CONEXIÓN ===
const ConnectionState = {
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  DISCONNECTING: 'DISCONNECTING'
}

// === ESTADOS DE TRAMA ===
const FrameState = {
  PENDING: 'PENDING', // Esperando ACK
  ACKNOWLEDGED: 'ACKNOWLEDGED', // ACK recibido
  TIMEOUT: 'TIMEOUT', // Timeout, necesita retransmisión
  ERROR: 'ERROR' // Error detectado
}

// === CONFIGURACIÓN DE CRC ===
const CRC_POLYNOMIAL = 0x1021 // CRC-16-CCITT polynomial

// === MENSAJES DE ERROR ===
const ErrorMessages = {
  INVALID_FRAME: 'Trama inválida o corrupta',
  CRC_MISMATCH: 'Error de CRC - trama corrupta',
  SEQUENCE_ERROR: 'Error de secuencia - trama duplicada o fuera de orden',
  TIMEOUT: 'Timeout - no se recibió ACK',
  BUFFER_OVERFLOW: 'Buffer lleno - receptor saturado',
  CONNECTION_FAILED: 'Error al establecer conexión',
  NOT_CONNECTED: 'No hay conexión establecida'
}

// === UTILIDADES ===
const Utils = {
  /**
   * Incrementa número de secuencia con aritmética módulo 16
   */
  nextSeqNum: (seqNum) => (seqNum + 1) % (MAX_SEQ_NUM + 1),

  /**
   * Calcula diferencia entre números de secuencia considerando wrap-around
   */
  seqNumDiff: (a, b) => {
    const diff = (a - b + MAX_SEQ_NUM + 1) % (MAX_SEQ_NUM + 1)
    return diff > (MAX_SEQ_NUM + 1) / 2 ? diff - (MAX_SEQ_NUM + 1) : diff
  },

  /**
   * Verifica si un número de secuencia está dentro de la ventana
   */
  inWindow: (seqNum, base, windowSize) => {
    const diff = Utils.seqNumDiff(seqNum, base)
    return diff >= 0 && diff < windowSize
  },

  /**
   * Convierte buffer a string hexadecimal para debug
   */
  bufferToHex: (buffer) => {
    return Array.from(buffer)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ')
      .toUpperCase()
  }
}

module.exports = {
  FLAG,
  ESC,
  FrameType,
  WINDOW_SIZE,
  MAX_SEQ_NUM,
  SEQ_NUM_BITS,
  ACK_TIMEOUT,
  MAX_RETRIES,
  HEARTBEAT_INTERVAL,
  FieldSize,
  ConnectionState,
  FrameState,
  CRC_POLYNOMIAL,
  ErrorMessages,
  Utils
}
