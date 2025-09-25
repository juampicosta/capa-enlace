/**
 * Demostración del Protocolo de Capa de Enlace de Datos
 * Simula comunicación entre dos nodos con un canal físico
 */

const DataLinkLayer = require('./src/dataLinkLayer')
const { Utils } = require('./src/constants')

console.log('🔗 TP Redes de Datos - Protocolo de Capa de Enlace')
console.log('=============================================\n')

/**
 * Simulador de Canal Físico
 * Simula un medio de transmisión con posibles errores
 */
class PhysicalChannelSimulator {
  constructor(config = {}) {
    this.errorRate = config.errorRate || 0.02 // 2% de error
    this.lossRate = config.lossRate || 0.01 // 1% de pérdida
    this.delayMs = config.delayMs || 50 // 50ms de delay
    this.jitterMs = config.jitterMs || 20 // ±20ms jitter

    this.stats = {
      framesSent: 0,
      framesDelivered: 0,
      framesLost: 0,
      framesCorrupted: 0
    }
  }

  /**
   * Transmite una trama por el canal
   */
  transmit(frame, receiver, senderName) {
    this.stats.framesSent++

    // Simular pérdida de trama
    if (Math.random() < this.lossRate) {
      this.stats.framesLost++
      console.log(`📡 Canal: Trama perdida de ${senderName} (${frame.length}B)`)
      return
    }

    // Simular corrupción de datos
    let transmittedFrame = Buffer.from(frame)
    if (Math.random() < this.errorRate) {
      this.stats.framesCorrupted++
      // Corromper un byte aleatorio
      const pos = Math.floor(Math.random() * transmittedFrame.length)
      transmittedFrame[pos] = transmittedFrame[pos] ^ 0xff
      console.log(
        `📡 Canal: Trama corrupta de ${senderName} en posición ${pos}`
      )
    }

    // Simular delay y jitter
    const delay = this.delayMs + (Math.random() - 0.5) * this.jitterMs

    setTimeout(() => {
      this.stats.framesDelivered++
      receiver.receiveFromPhysical(transmittedFrame)
    }, Math.max(1, delay))
  }

  getStats() {
    return { ...this.stats }
  }
}

/**
 * Demo principal
 */
async function runDemo() {
  // Crear instancias
  const nodeA = new DataLinkLayer()
  const nodeB = new DataLinkLayer()
  const channel = new PhysicalChannelSimulator({
    errorRate: 0.03, // 3% error
    lossRate: 0.01, // 1% loss
    delayMs: 30, // 30ms delay
    jitterMs: 10 // ±10ms jitter
  })

  console.log('📟 Configurando nodos y canal...\n')

  // Configurar capas físicas (simuladas)
  nodeA.setPhysicalLayer((frame) => {
    channel.transmit(frame, nodeB, 'Nodo A')
  })

  nodeB.setPhysicalLayer((frame) => {
    channel.transmit(frame, nodeA, 'Nodo B')
  })

  // Configurar event listeners para logging
  setupEventListeners(nodeA, 'NODO A')
  setupEventListeners(nodeB, 'NODO B')

  try {
    console.log('🔌 Estableciendo conexión...\n')

    // Nodo B escucha conexiones
    nodeB.on('connection_request', (data) => {
      console.log(`📞 Nodo B: Solicitud de conexión recibida`)
      nodeB.acceptConnection(data.remoteSeqNum)
    })

    // Nodo A inicia conexión
    await nodeA.connect()

    console.log('✅ Conexión establecida!\n')
    await sleep(100)

    // Enviar datos de prueba
    console.log('📤 Enviando datos de prueba...\n')

    const messages = [
      'Hola desde Nodo A',
      'Este es el mensaje #2',
      'Protocolo funcionando correctamente',
      'Ventana deslizante activa',
      'Control de errores operativo',
      'Mensaje final de prueba'
    ]

    // Enviar mensajes en paralelo para probar ventana
    const sendPromises = messages.map(async (msg, index) => {
      await sleep(index * 200) // Espaciar envíos
      return nodeA.sendToNetwork(msg)
    })

    await Promise.all(sendPromises)

    console.log('\n📨 Todos los mensajes enviados')

    // Esperar a que se procesen todas las tramas
    await sleep(2000)

    // Mostrar estadísticas finales
    console.log('\n📊 ESTADÍSTICAS FINALES')
    console.log('========================')

    const statsA = nodeA.getStats()
    const statsB = nodeB.getStats()
    const channelStats = channel.getStats()

    console.log(`\n🔸 NODO A (Transmisor):`)
    console.log(`   • Tramas enviadas: ${statsA.totalFramesSent}`)
    console.log(`   • Bytes de datos enviados: ${statsA.totalDataBytesSent}`)
    console.log(
      `   • Throughput: ${statsA.throughput.dataBytesSentPerSec.toFixed(1)} B/s`
    )

    console.log(`\n🔸 NODO B (Receptor):`)
    console.log(`   • Tramas recibidas: ${statsB.totalFramesReceived}`)
    console.log(
      `   • Bytes de datos recibidos: ${statsB.totalDataBytesReceived}`
    )
    console.log(`   • Errores detectados: ${statsB.totalErrors}`)
    console.log(`   • Tasa de error: ${statsB.errorRate.toFixed(2)}%`)

    console.log(`\n🔸 CANAL FÍSICO:`)
    console.log(`   • Tramas transmitidas: ${channelStats.framesSent}`)
    console.log(`   • Tramas entregadas: ${channelStats.framesDelivered}`)
    console.log(`   • Tramas perdidas: ${channelStats.framesLost}`)
    console.log(`   • Tramas corruptas: ${channelStats.framesCorrupted}`)
    console.log(
      `   • Tasa de pérdida: ${(
        (channelStats.framesLost / channelStats.framesSent) *
        100
      ).toFixed(2)}%`
    )
    console.log(
      `   • Tasa de corrupción: ${(
        (channelStats.framesCorrupted / channelStats.framesSent) *
        100
      ).toFixed(2)}%`
    )

    // Desconectar
    console.log('\n🔌 Desconectando...')
    await nodeA.disconnect()

    console.log('\n✅ Demo completado exitosamente!\n')
  } catch (error) {
    console.error('❌ Error en demo:', error.message)
    process.exit(1)
  }
}

/**
 * Configura event listeners para logging
 */
function setupEventListeners(node, nodeName) {
  // Eventos de conexión
  node.on('connected', (data) => {
    console.log(`✅ ${nodeName}: Conectado (uptime: 0ms)`)
  })

  node.on('disconnected', (data) => {
    console.log(`🔌 ${nodeName}: Desconectado (uptime: ${data.uptime}ms)`)
  })

  // Eventos de datos
  node.on('data_received', (data) => {
    const message = data.data.toString('utf8')
    console.log(
      `📨 ${nodeName}: Recibido [${data.seqNum}] "${message}" (${data.size}B)`
    )
  })

  node.on('data_frame_sent', (data) => {
    console.log(
      `📤 ${nodeName}: Enviado [${data.seqNum}] ${data.dataSize}B (trama: ${data.frameSize}B)`
    )
  })

  // Eventos de control de flujo
  node.on('window_advanced', (data) => {
    console.log(
      `🎯 ${nodeName}: Ventana avanzada ${data.oldBase} → ${data.newBase}`
    )
  })

  // Eventos de errores
  node.on('frame_error', (data) => {
    console.log(`❌ ${nodeName}: Error en trama - ${data.error}`)
  })

  node.on('transmission_failed', (data) => {
    console.log(
      `💥 ${nodeName}: Falló transmisión [${data.seqNum}] después de ${data.retries} intentos`
    )
  })

  // Eventos informativos
  node.on('frame_buffered', (data) => {
    console.log(
      `🔄 ${nodeName}: Trama [${data.seqNum}] almacenada (esperando [${data.expectedSeqNum}])`
    )
  })

  node.on('window_full', (data) => {
    console.log(`⏳ ${nodeName}: Ventana llena - pausando envíos`)
  })

  // ✨ NUEVOS: Eventos de ACK/NAK que faltaban
  node.on('ack_sent', (data) => {
    console.log(
      `✅ ${nodeName}: ACK enviado [${data.seqNum}] (${data.frameSize}B)`
    )
  })

  node.on('nak_sent', (data) => {
    console.log(`❌ ${nodeName}: NAK enviado [${data.seqNum}] - ${data.reason}`)
  })

  node.on('ack_received', (data) => {
    console.log(
      `📩 ${nodeName}: ACK recibido [${data.seqNum}] (RTT: ${data.rtt}ms)`
    )
  })

  node.on('nak_received', (data) => {
    console.log(
      `📩 ${nodeName}: NAK recibido [${data.seqNum}] - retransmitiendo`
    )
  })
}

/**
 * Utilidad para pausa
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Manejar señales de terminación
 */
process.on('SIGINT', () => {
  console.log('\n\n👋 Demo interrumpido por usuario')
  process.exit(0)
})

process.on('uncaughtException', (error) => {
  console.error('\n💥 Error inesperado:', error.message)
  process.exit(1)
})

// Ejecutar demo
if (require.main === module) {
  runDemo().catch(console.error)
}

module.exports = { runDemo, PhysicalChannelSimulator }
