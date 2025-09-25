/**
 * Módulo de Bit Stuffing/Unstuffing
 * Implementa el relleno de bits para evitar flags falsas en los datos
 */

const { FLAG, ESC } = require('../constants')

/**
 * Realiza bit stuffing en los datos
 * Reemplaza secuencias problemáticas con escape sequences
 * @param {Buffer|Uint8Array} data - Datos originales
 * @returns {Buffer} Datos con bit stuffing aplicado
 */
function bitStuff(data) {
  if (!data || data.length === 0) {
    return Buffer.alloc(0)
  }

  const result = []

  for (let i = 0; i < data.length; i++) {
    const byte = data[i]

    if (byte === FLAG) {
      // Escapar FLAG (0x7E)
      result.push(ESC) // Agregar escape
      result.push(0x5e) // FLAG XOR 0x20
    } else if (byte === ESC) {
      // Escapar ESC (0x7D)
      result.push(ESC) // Agregar escape
      result.push(0x5d) // ESC XOR 0x20
    } else {
      // Byte normal, no necesita escape
      result.push(byte)
    }
  }

  return Buffer.from(result)
}

/**
 * Remueve bit stuffing de los datos
 * Procesa escape sequences y restaura datos originales
 * @param {Buffer|Uint8Array} stuffedData - Datos con bit stuffing
 * @returns {Object} {success: boolean, data: Buffer, error?: string}
 */
function bitUnstuff(stuffedData) {
  if (!stuffedData || stuffedData.length === 0) {
    return {
      success: true,
      data: Buffer.alloc(0)
    }
  }

  const result = []
  let i = 0

  while (i < stuffedData.length) {
    const byte = stuffedData[i]

    if (byte === ESC) {
      // Encontramos escape, necesitamos el siguiente byte
      if (i + 1 >= stuffedData.length) {
        return {
          success: false,
          data: Buffer.alloc(0),
          error: 'Escape incompleto al final de los datos'
        }
      }

      const nextByte = stuffedData[i + 1]

      if (nextByte === 0x5e) {
        // ESC + 0x5E = FLAG original
        result.push(FLAG)
      } else if (nextByte === 0x5d) {
        // ESC + 0x5D = ESC original
        result.push(ESC)
      } else {
        return {
          success: false,
          data: Buffer.alloc(0),
          error: `Secuencia de escape inválida: ${ESC.toString(
            16
          )} ${nextByte.toString(16)}`
        }
      }

      i += 2 // Saltar ambos bytes del escape
    } else if (byte === FLAG) {
      return {
        success: false,
        data: Buffer.alloc(0),
        error: 'FLAG encontrada sin escape en los datos'
      }
    } else {
      // Byte normal
      result.push(byte)
      i++
    }
  }

  return {
    success: true,
    data: Buffer.from(result)
  }
}

/**
 * Calcula el tamaño máximo después del bit stuffing
 * En el peor caso, cada byte podría necesitar escape
 * @param {number} originalSize - Tamaño original
 * @returns {number} Tamaño máximo después del stuffing
 */
function getMaxStuffedSize(originalSize) {
  // En el peor caso, cada byte es FLAG o ESC y necesita escape
  return originalSize * 2
}

/**
 * Estadísticas de bit stuffing para análisis
 * @param {Buffer} originalData - Datos originales
 * @param {Buffer} stuffedData - Datos después del stuffing
 * @returns {Object} Estadísticas detalladas
 */
function getStuffingStats(originalData, stuffedData) {
  const originalSize = originalData.length
  const stuffedSize = stuffedData.length
  const overhead = stuffedSize - originalSize
  const overheadPercent = originalSize > 0 ? (overhead / originalSize) * 100 : 0

  // Contar bytes que necesitaron escape
  let flagCount = 0
  let escCount = 0

  for (let i = 0; i < originalData.length; i++) {
    if (originalData[i] === FLAG) flagCount++
    if (originalData[i] === ESC) escCount++
  }

  return {
    originalSize,
    stuffedSize,
    overhead,
    overheadPercent: Math.round(overheadPercent * 100) / 100,
    flagsEscaped: flagCount,
    escsEscaped: escCount,
    totalEscaped: flagCount + escCount
  }
}

/**
 * Valida que los datos no contengan flags sin escape
 * Útil para debugging
 * @param {Buffer|Uint8Array} data - Datos a validar
 * @returns {Object} {valid: boolean, issues: Array}
 */
function validateStuffedData(data) {
  const issues = []
  let valid = true

  for (let i = 0; i < data.length; i++) {
    if (data[i] === FLAG) {
      issues.push({
        position: i,
        issue: 'FLAG sin escape encontrada',
        byte: data[i]
      })
      valid = false
    }

    // Validar secuencias de escape
    if (data[i] === ESC) {
      if (i + 1 >= data.length) {
        issues.push({
          position: i,
          issue: 'ESC al final sin byte siguiente',
          byte: data[i]
        })
        valid = false
      } else {
        const nextByte = data[i + 1]
        if (nextByte !== 0x5e && nextByte !== 0x5d) {
          issues.push({
            position: i,
            issue: `Secuencia de escape inválida: ${nextByte.toString(16)}`,
            byte: data[i]
          })
          valid = false
        }
      }
    }
  }

  return { valid, issues }
}

/**
 * Utilidades para testing y debugging
 */
const BitStuffingUtils = {
  /**
   * Convierte buffer a representación visual para debugging
   */
  visualize: (data, label = '') => {
    const hex = Array.from(data)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ')
    const ascii = Array.from(data)
      .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.'))
      .join('')

    console.log(`${label}:`)
    console.log(`  HEX:   ${hex}`)
    console.log(`  ASCII: ${ascii}`)
    console.log(`  Size:  ${data.length} bytes`)
  },

  /**
   * Test de round-trip (stuff -> unstuff)
   */
  testRoundTrip: (originalData) => {
    const stuffed = bitStuff(originalData)
    const unstuffed = bitUnstuff(stuffed)

    if (!unstuffed.success) {
      return {
        success: false,
        error: unstuffed.error
      }
    }

    const matches = Buffer.compare(originalData, unstuffed.data) === 0

    return {
      success: matches,
      originalSize: originalData.length,
      stuffedSize: stuffed.length,
      finalSize: unstuffed.data.length,
      matches
    }
  }
}

module.exports = {
  bitStuff,
  bitUnstuff,
  getMaxStuffedSize,
  getStuffingStats,
  validateStuffedData,
  BitStuffingUtils
}
