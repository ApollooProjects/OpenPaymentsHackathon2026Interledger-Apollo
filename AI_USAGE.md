# AI Usage Disclosure

## Herramientas usadas
- **Claude Code** (modelos Claude Opus 5.5 y, en algunas tareas de apoyo, Claude Sonnet 5.5). Todo el equipo lo usó.
- Planes pagados: **2 cuentas de USD 20/mes y 1 cuenta de USD 100/mes** (USD 140 en suscripciones).
- Consumo de Claude Code en el proyecto (16–17 de octubre), medido en el computador de cada integrante:

  | Integrante | Modelo | Entrada | Salida | Escritura de caché | Lectura de caché | Equivalente a precio de API |
  |---|---|---|---|---|---|---|
  | Raúl | Claude Opus 5.5 | 3.628 | 1.160.528 | 4.643.460 | 339.099.424 | USD 128,19 |
  | Raúl | Claude Sonnet 5.5 | 104 | 117.439 | 518.377 | 11.204.692 | USD 5,49 |
  | Valentina | Claude Opus 5.5 | 1.166 | 555.824 | 4.634.209 | 245.553.818 | USD 97,31 |
  | Angélica | Claude Opus 5.5 | 1.650 | 592.649 | 3.221.279 | 230.665.130 | USD 83,76 |
  | Sofía | Claude Opus 5.5 | 1.102 | 350.721 | 3.075.621 | 212.636.490 | USD 74,15 |
  | **Total** | | | | | | **USD 388,90** |

  Al ser planes de suscripción, el costo real es el de los planes, no el equivalente de API.

## Dónde y cómo usamos IA
**Se usó IA en todo el proyecto.** No hay ningún archivo del repositorio que podamos asegurar que se escribió sin ayuda de IA. Detalle por componente:

### 1. Módulo de Open Payments (`backend/src/op/**`)
- Claude escribió la primera versión de `grants.js` y `op/index.js`, y agregó `incoming.js` (listar cobros), `token.js` (rotación del token) y `mock.js` a partir de pedidos concretos del equipo (`prompts/angelica.md`).
- Después hizo cambios pequeños: retiro sin límite en el grant de la Custodia, timeout de 20 s y aceptar wallets con `https://` o `$` en `client.js`, `receiveAmount` en `quote.js`.
- Es el módulo donde el equipo intentó usar **menos** IA: en varios prompts se le pidió explícitamente no escribir `op/quote.js` ni tocar `op/` salvo que fuera imprescindible. El equipo revisó y probó cada función contra el testnet (grants, incoming, outgoing, quote, `token.rotate` con 401/403).

### 2. Backend de la app (`backend/src/app/**`)
- Esqueleto del servidor (Express 5, ESM, SQLite con `node:sqlite`): andamiaje con Claude.
- Lógica de negocio: reparto 35/65 y deuda al proveedor (`reparto.js`, `repartos.js`), pagos rápidos (`pagosRapidos.js`), sin cuenta y Custodia (`sinCuenta.js`), retiros con PIN (`retiros.js`), remesas (`remesas.js`), QR (`qr.js`), SMS simulados y reales (`sms.js`, `smsReal.js`), vínculo celular–cédula (`vinculos.js`), cuentas y sesión (`cuentas.js`, `routes/auth.js`, `routes/yo.js`), repartos del usuario (`repartosDelUsuario.js`). Claude los implementó o los modificó, con pruebas automáticas en varios casos.
- Algunas piezas (motor de pagos, primeras versiones de retiros, reparto y remesas) no tienen el prompt original registrado; luego se modificaron con IA.

### 3. Frontend
- `app/` (app web del usuario): investigación de diseño e implementación completa con Claude.
- `corresponsal/` (pantalla del cajero): implementación completa con Claude.
- `frontend/` (demo en vivo con pestañas): implementación con Claude, más un rediseño de accesibilidad para personas mayores y mejoras de UX.

### 4. Scripts (`scripts/`)
- `permiso-custodia.js`, `probar-grants.js`, `registrar-webhook-sms.js`, `vincular-celular.js` y otros scripts de prueba contra el testnet, escritos con Claude.

### 5. Documentación
- `README.md`, `.env.example`, diagramas de arquitectura y de secuencia (`docs/diagramas`) y capturas de las pruebas de punta a punta (`docs/capturas`): redactados o generados con Claude y revisados por el equipo.

## Archivos con poca o ninguna IA
- Ninguno sin IA. El que tiene **menos** IA es `backend/src/op/**`: ahí la IA hizo funciones puntuales que pidió y revisó el equipo, no el módulo completo de una sola vez.

## Registro de prompts
Los prompts literales están en [`prompts/`](prompts/), un archivo por integrante: [`angelica.md`](prompts/angelica.md), [`raul.md`](prompts/raul.md), [`sofia.md`](prompts/sofia.md) y [`valentina.md`](prompts/valentina.md).
