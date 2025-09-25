/**
 * Módulo de Control de Redundancia Cíclica (CRC-16)
 * Implementa CRC-16-CCITT para detección de errores
 */

const { CRC_POLYNOMIAL } = require('../constants')

class CRC16 {
  constructor() {
    // Tabla de lookup precompilada para CRC-16-CCITT
    this.crcTable = this.generateCrcTable()
  }

  /**
   * Genera tabla de lookup para cálculo rápido de CRC
   * @returns {Array} Tabla de lookup de 256 elementos
   */
  generateCrcTable() {
    const table = new Array(256)

    for (let i = 0; i < 256; i++) {
      let crc = i << 8

      for (let j = 0; j < 8; j++) {
        if (crc & 0x8000) {
          crc = (crc << 1) ^ CRC_POLYNOMIAL
        } else {
          crc = crc << 1
        }
      }

      table[i] = crc & 0xffff
    }

    return table
  }

  /**
   * Calcula CRC-16 para un buffer de datos
   * @param {Buffer|Uint8Array} data - Datos para calcular CRC
   * @param {number} initialValue - Valor inicial del CRC (por defecto 0xFFFF)
   * @returns {number} Valor CRC-16
   */
  calculate(data, initialValue = 0xffff) {
    let crc = initialValue

    for (let i = 0; i < data.length; i++) {
      const tableIndex = ((crc >> 8) ^ data[i]) & 0xff
      crc = ((crc << 8) ^ this.crcTable[tableIndex]) & 0xffff
    }

    return crc ^ 0xffff // Inversión final
  }

  /**
   * Valida si los datos tienen el CRC correcto
   * @param {Buffer|Uint8Array} data - Datos sin CRC
   * @param {number} receivedCrc - CRC recibido
   * @returns {boolean} True si el CRC es válido
   */
  validate(data, receivedCrc) {
    const calculatedCrc = this.calculate(data)
    return calculatedCrc === receivedCrc
  }

  /**
   * Añade CRC a los datos
   * @param {Buffer|Uint8Array} data - Datos originales
   * @returns {Buffer} Datos con CRC añadido al final
   */
  addCrc(data) {
    const crc = this.calculate(data)
    const result = Buffer.alloc(data.length + 2)

    // Copiar datos originales
    data.copy ? data.copy(result, 0) : Buffer.from(data).copy(result, 0)

    // Añadir CRC al final (big-endian)
    result[data.length] = (crc >> 8) & 0xff
    result[data.length + 1] = crc & 0xff

    return result
  }

  /**
   * Extrae y valida CRC de los datos
   * @param {Buffer|Uint8Array} dataWithCrc - Datos con CRC incluido
   * @returns {Object} {valid: boolean, data: Buffer, crc: number}
   */
  extractAndValidate(dataWithCrc) {
    if (dataWithCrc.length < 2) {
      return {
        valid: false,
        data: Buffer.alloc(0),
        crc: 0,
        error: 'Datos insuficientes para CRC'
      }
    }

    // Extraer datos y CRC
    const dataLength = dataWithCrc.length - 2
    const data = Buffer.alloc(dataLength)

    if (dataWithCrc.copy) {
      dataWithCrc.copy(data, 0, 0, dataLength)
    } else {
      Buffer.from(dataWithCrc).copy(data, 0, 0, dataLength)
    }

    // Extraer CRC (big-endian)
    const receivedCrc =
      (dataWithCrc[dataLength] << 8) | dataWithCrc[dataLength + 1]

    // Validar CRC
    const valid = this.validate(data, receivedCrc)

    return {
      valid,
      data,
      crc: receivedCrc,
      calculatedCrc: this.calculate(data)
    }
  }

  /**
   * Utilidad para debugging - convierte CRC a string hexadecimal
   * @param {number} crc - Valor CRC
   * @returns {string} Representación hexadecimal
   */
  crcToHex(crc) {
    return '0x' + crc.toString(16).padStart(4, '0').toUpperCase()
  }
}

// Instancia singleton para uso global
const crc16 = new CRC16()

/**
 * Funciones de conveniencia para uso directo
 */
const CRCUtils = {
  /**
   * Calcula CRC para datos
   */
  calculate: (data) => crc16.calculate(data),

  /**
   * Valida CRC de datos
   */
  validate: (data, crc) => crc16.validate(data, crc),

  /**
   * Añade CRC a datos
   */
  addCrc: (data) => crc16.addCrc(data),

  /**
   * Extrae y valida CRC
   */
  extractAndValidate: (dataWithCrc) => crc16.extractAndValidate(dataWithCrc),

  /**
   * Convierte CRC a hex
   */
  toHex: (crc) => crc16.crcToHex(crc),

  /**
   * Acceso a la instancia CRC16 para uso avanzado
   */
  instance: crc16
}

module.exports = CRCUtils
