# 🔗 Protocolo de Capa de Enlace de Datos

**Autor:** Juan Pablo Costa  
**Materia:** Redes de Datos  
**Universidad:** [Nombre de Universidad]

## 📋 Descripción

Implementación completa de un protocolo para la capa de enlace de datos que transforma el medio de transmisión en bruto en una línea libre de errores no detectados para la capa de red.

### 🎯 Características Implementadas

- **Servicio orientado a la conexión** con confirmación de recepción
- **Entramado con banderas** de inicio y fin con relleno de bits
- **Control de errores** con ACK/NAK y números de secuencia
- **Control de flujo** basado en retroalimentación con ventana deslizante
- **Ventana de 8 tramas** con números de secuencia 0-15 (4 bits)
- **Detección de errores** con CRC-16-CCITT
- **Manejo de duplicados** y tramas fuera de orden

## 🏗️ Arquitectura

```
📁 src/
├── 📁 framing/
│   ├── frameBuilder.js        # Constructor/parser de tramas
│   └── bitStuffing.js         # Bit stuffing/unstuffing
├── 📁 errorControl/
│   ├── crc.js                 # CRC-16 para detección de errores
│   └── acknowledgments.js     # Sistema ACK/NAK
├── 📁 flowControl/
│   └── windowManager.js       # Ventana deslizante
├── 📁 connection/
│   └── connectionManager.js   # Gestión de conexiones
├── constants.js               # Constantes del protocolo
└── dataLinkLayer.js          # Capa principal
```

## 📦 Estructura de Trama

```
| FLAG | CONTROL | SEQ_NUM | DATA | CRC-16 | FLAG |
  8bits    8bits     4bits   Nbits   16bits   8bits
```

- **FLAG:** `0x7E` (01111110) - Delimitadores de inicio/fin
- **CONTROL:** Tipo de trama (DATA/ACK/NAK/CONN/DISC/HEARTBEAT)
- **SEQ_NUM:** Número de secuencia 0-15 (4 bits)
- **DATA:** Payload de la capa de red (máximo 1024 bytes)
- **CRC-16:** Checksum para detección de errores

## 🚀 Instalación y Uso

### Prerrequisitos

- Node.js >= 14.0.0
- npm o yarn

### Instalación

```bash
# Clonar el repositorio
git clone [url-del-repo]
cd capa-enlace

# Instalar dependencias (opcional para desarrollo)
npm install
```

### Ejecutar Demo

```bash
# Ejecutar demostración completa
npm start

# O directamente con node
node index.js
```

### Otros Scripts Disponibles

```bash
npm run demo          # Demo básico
npm run test          # Tests unitarios
npm run test:basic    # Tests básicos
npm run dev           # Modo desarrollo con auto-reload
```

## 💡 Ejemplo de Uso

```javascript
const DataLinkLayer = require('./src/dataLinkLayer')

// Crear instancia
const dataLink = new DataLinkLayer()

// Configurar capa física (simulada)
dataLink.setPhysicalLayer((frame) => {
  // Enviar frame a través del medio físico
  physicalMedium.transmit(frame)
})

// Establecer conexión
await dataLink.connect()

// Enviar datos
await dataLink.sendToNetwork('Hola mundo!')

// Escuchar datos recibidos
dataLink.on('data_received', (data) => {
  console.log('Datos recibidos:', data.data.toString('utf8'))
})

// Desconectar
await dataLink.disconnect()
```

## 🔧 Funcionalidades Principales

### 1. **Ventana Deslizante**

- Tamaño de ventana: 8 tramas
- Números de secuencia: 0-15 (módulo 16)
- Control de flujo automático
- Detección de tramas duplicadas

### 2. **Control de Errores**

- CRC-16-CCITT para detección
- ACK/NAK con timeouts
- Retransmisión automática
- Máximo 3 reintentos por trama

### 3. **Bit Stuffing**

- Escape de flags dentro de datos
- Transparencia de datos garantizada
- Detección automática de flags malformadas

### 4. **Gestión de Conexión**

- Handshake de 3 vías
- Heartbeat para keep-alive
- Desconexión ordenada
- Timeouts configurables

## 📊 Eventos y Monitoreo

El protocolo emite eventos detallados para monitoreo:

```javascript
dataLink.on('data_frame_sent', (info) => {
  console.log(`Trama [${info.seqNum}] enviada: ${info.dataSize}B`)
})

dataLink.on('window_advanced', (info) => {
  console.log(`Ventana: ${info.oldBase} → ${info.newBase}`)
})

dataLink.on('frame_error', (info) => {
  console.log(`Error: ${info.error}`)
})
```

## 🧪 Testing

### Demo Interactivo

```bash
npm start
```

El demo simula:

- Canal con errores y pérdidas
- Múltiples mensajes en paralelo
- Estadísticas en tiempo real
- Recuperación automática de errores

### Tests Unitarios

```bash
npm test
```

Incluye tests para:

- CRC-16 calculation
- Bit stuffing/unstuffing
- Frame building/parsing
- Window management
- ACK/NAK handling

## 📈 Estadísticas

El protocolo proporciona estadísticas detalladas:

```javascript
const stats = dataLink.getStats()
console.log({
  framesSent: stats.totalFramesSent,
  framesReceived: stats.totalFramesReceived,
  throughput: stats.throughput.dataBytesSentPerSec,
  errorRate: stats.errorRate
})
```

## ⚙️ Configuración

Constantes principales en `src/constants.js`:

```javascript
const WINDOW_SIZE = 8 // Tamaño de ventana
const ACK_TIMEOUT = 2000 // Timeout para ACK (2s)
const MAX_RETRIES = 3 // Máximo reintentos
const HEARTBEAT_INTERVAL = 5000 // Heartbeat cada 5s
const MAX_DATA = 1024 // Máximo datos por trama
```

## 🐛 Manejo de Errores

El protocolo maneja automáticamente:

- **Tramas corruptas** → Detectadas por CRC, enviado NAK
- **Tramas perdidas** → Timeout, retransmisión automática
- **Tramas duplicadas** → Detectadas por número de secuencia
- **Tramas fuera de orden** → Buffering y reordenamiento
- **Ventana llena** → Pausa automática hasta liberar espacio
- **Desconexión inesperada** → Cleanup automático

## 🔍 Debugging

Para debugging detallado:

```javascript
// Habilitar todos los eventos
dataLink.on('*', (eventName, data) => {
  console.log(`[${eventName}]:`, data)
})

// Ver estado actual
console.log(dataLink.getStatus())

// Información de ventana
console.log(dataLink.windowManager.getSendWindow())
```

## 📚 Referencias Técnicas

- **CRC-16-CCITT:** Polynomial 0x1021
- **Bit Stuffing:** Escape sequence 0x7D + XOR(0x20)
- **Window Protocol:** Go-Back-N con buffer selectivo
- **Timeouts:** Exponential backoff no implementado (fijo 2s)

## 🤝 Contribuciones

Este es un trabajo académico, pero sugerencias son bienvenidas:

1. Fork el repositorio
2. Crear feature branch
3. Commit cambios
4. Crear Pull Request

## 📄 Licencia

ISC License - Proyecto Académico

---

**¿Preguntas?** Contactar: [juan.costa@alumnos.frm.utn.edu.ar]

**Fecha:** Septiembre 2025
