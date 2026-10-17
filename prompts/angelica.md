# Prompts de Angélica

## 2026-10-16 20:35 · Claude Code (Claude Opus 5.5) · Esqueleto del backend

```
Crea el esqueleto del proyecto: backend/ con Node >= 22.13 en ESM, Express 5, dotenv (carga el .env desde la raíz del repo) y SQLite con node:sqlite en data/cajita.sqlite, solo la conexión, sin tablas.
npm start debe servir frontend/index.html (una app de pestañas que cambia con #hash) desde el mismo servidor y exponer GET /salud con un SELECT 1.
Agrega @interledger/open-payments@^7.4 como dependencia.
Actualiza .gitignore para bloquear data/, *.sqlite-wal, *.sqlite-shm y *.sqlite-journal, y .env.example con OP_MOCK y PORT.
Verifica desde un clon limpio (npm ci, /salud responde 200 y git check-ignore confirma que data/ y .env no se suben). No hagas push sin mi aprobación.
```

## 2026-10-16 21:00 · Claude Code (Claude Opus 5.5) · Permisos de pago con GNAP

```
Implementa backend/src/op/grants.js con tres funciones:
- pedirPermiso({ walletUrl, tope, interval?, finishUri, nonce }): grant.request al authServer de la wallet del pagador, type 'outgoing-payment', actions ['create','read'], identifier = la wallet, limits.debitAmount tomando assetCode y assetScale de la wallet (nunca a mano) e interval opcional (ISO 8601 repetitivo R/<inicio>/P1W), interact { start: ['redirect'], finish: { method: 'redirect', uri, nonce } }. Valida con isPendingGrant y devuelve redirectUrl, continueUri, continueToken, interactNonce y authServerUrl.
- continuarPermiso: grant.continue con interact_ref; valida con isFinalizedGrantWithAccessToken y devuelve { token, manageUrl }.
- verificarHash: SHA-256 de clientNonce\ninteractNonce\ninteractRef\nauthServerUrl en Base64 sin padding, tolerando el + convertido en espacio.
Expórtalas en op/index.js junto con su versión de prueba (OP_MOCK=1). Pruébalas primero con el mock y después contra el testnet, con un script que levante un servidor de finish en localhost:3999, pague $10 COP entre dos wallets de prueba y confirme incomingPayment.completed. No imprimas tokens.
```

## 2026-10-16 21:29 · Claude Code (Claude Opus 5.5) · Open Payments del retiro

```
Agrega al módulo op/:
- listarCobros({ walletUrl, cedula? }): grant de incoming con list/read, paginación con first: 100 + cursor (no uses last sin cursor), filtro por metadata.cedula. Devuelve { id, recibido, completo, metadata }.
- rotar({ token, manageUrl }) en op/token.js con token.rotate.
- Versiones equivalentes en el mock.
Crea scripts/permiso-custodia.js, que pide una sola vez un grant de outgoing sobre la wallet Custodia con interval R/<ahora>/P1D y un tope de $500.000 COP convertido con el assetScale de la wallet, y guarda el token en SQLite. Debe aceptar que se pegue la URL de regreso si se aprueba desde otro equipo.
Con --probar, rota el token y paga $10 de Custodia a Corresponsal contra un cobro con expiresAt +24 h, sin volver a pedir aprobación.
```

## 2026-10-16 21:40 · Claude Code (Claude Opus 5.5) · Prueba de punta a punta sin cuenta

```
Con OP_MOCK=0, ejecuta contra el testnet el flujo de cobro sin cuenta usando una cédula y un celular de prueba propios, para no mezclar saldos:
1. POST /pagar/<qr> por $3.000 COP y aprobación en la wallet del pagador.
2. Verifica GET /pagos/:id en completado y el SMS de llegada.
3. Envía RETIRAR por /sms/entrante y recibe el PIN.
4. POST /retiros/validar con PIN + cédula.
Confirma con incomingPayment.get que el cobro del Corresponsal quedó completed, que el PIN no se puede reutilizar y que SALDO queda en 0. Reporta qué verificaste y contra qué.
```

## 2026-10-16 21:55 · Claude Code (Claude Opus 5.5) · Accesibilidad para adultos mayores

```
Investiga pautas con fuente (W3C WAI Older Users, WCAG 2.2 criterios 1.4.3, 1.4.10, 2.5.5 y 2.5.8, NN/g y NIA) y aplícalas al frontend sin crear archivos estáticos nuevos (el CSS va en index.html) y sin romper los selectores data-* que usa el JavaScript:
- Texto base de 20 px, sin serifa, interlineado de 1,6 o más.
- Contraste AAA (7:1) en el texto, calculado con la fórmula de WCAG.
- Áreas táctiles de 44 px o más.
- Foco visible de 4 px.
- Sin animaciones.
- Estado activo de las pestañas con aria-current.
- Etiquetas en lenguaje simple, sin jerga ("billetera", no "wallet address").
- Ejemplos fuera del campo, no como placeholder.
- Errores con ícono + texto, junto al campo y visibles sin scroll.
Valida con JavaScript en el navegador: tamaño de todos los controles, que no haya scroll horizontal a 375 px y a 320 px, y que el botón principal quede visible sin bajar.
```

## 2026-10-16 22:12 · Claude Code (Claude Opus 5.5) · Sistema visual tipo Uber Base

```
Aplica al frontend los principios del sistema Base de Uber, según su documentación:
- Paleta en blanco y negro, con un solo acento.
- Un botón principal negro por pantalla.
- Tarjetas #F6F6F6 y cuadrícula de 4 px.
- Tipografía Inter como sustituta de Uber Move.
Usa #1E54B7 como acento de marca (logo, pestaña activa, foco, avisos informativos) en lugar de #276EF1, que no llega a 7:1. Mantén la base de 20 px y los bordes de los campos con 3:1 o más (WCAG 1.4.11).
Fija el botón principal abajo con position: sticky y respeta safe-area-inset-bottom. Sobrescribe las variables del tema claro de Pico con :root[data-theme="light"] para ganarle en especificidad.
Muéstralo en el navegador a 375 px y entrega los contrastes calculados de cada par de colores.
```

## 2026-10-16 ~23:15 · Claude Code (Claude Opus 5.5) · Prueba E2E de un flujo de retiro

```
Ejecuta de punta a punta el flujo de retiro sin cuenta: envío a la Custodia, SMS de llegada, RETIRAR, SMS con el PIN, validación del PIN y la cédula, y pago de la Custodia al Corresponsal con el permiso diario (interval R/<inicio>/P1D).
Para cada paso registra la petición, la respuesta, el estado del pago y los saldos antes y después. Marca qué pasos funcionan, cuáles fallan y la causa raíz probable.
```

## 2026-10-16 ~23:50 · Claude Code (Claude Opus 5.5) · Diagnosticar un fallo de integración

```
En la integración de la capa 4 funcionan el envío, el SMS y la generación del PIN, pero el retiro en el cajero falla. Reproduce el retiro y captura la petición y la respuesta exactas. Revisa:
- La validación del PIN (hash contra el valor ingresado).
- El estado del incoming payment del Corresponsal (monto, expiresAt, completed).
- El grant de outgoing de la Custodia (límite, interval, vencimiento del token y si hace falta token.rotate).
Entrégame la causa raíz con evidencia y el arreglo propuesto antes de cambiar código.
```

## 2026-10-16 ~23:55 · Claude Code (Claude Opus 5.5) · Transferencia wallet a wallet con Open Payments

```
Implementa la transferencia directa wallet a wallet con Open Payments. Usa el flujo GNAP:
1. Grant de incoming payment en el receptor.
2. Quote con receiveAmount, con la comisión a cargo del emisor.
3. Grant interactivo de outgoing payment aprobado por el dueño.
4. Creación del outgoing payment.
Maneja la rotación del token (10 min), la vigencia de la quote (5 min), los montos en enteros con assetScale y los errores de cada paso. Pruébala primero con el mock y después en el testnet.
```

## 2026-10-17 ~00:00 · Claude Code (Claude Opus 5.5) · Rediseño accesible del frontend

```
Rediseña frontend/index.html y las vistas de frontend/js/ (cliente, remitente, vendedor, cajero, celular) para personas mayores y usuarios con poca experiencia digital. Requisitos:
- Contraste WCAG 2.2 AA (4.5:1 en texto y 3:1 en componentes).
- Texto base de 18 px o más, con un control para agrandar y achicar la letra.
- Zonas táctiles de 48x48 px o más.
- Un solo objetivo por pantalla, etiquetas en lenguaje claro sin jerga financiera y confirmación antes de cada pago.
- Mobile-first y responsive, de 360 px a escritorio.
- Paleta clara de estilo Uber con acentos azules.
Sin librerías nuevas. No toques la lógica de pagos.
```

## 2026-10-17 ~00:20 · Claude Code (Claude Opus 5.5) · Verificación visual en dispositivos

```
Levanta el frontend y verifícalo en el navegador a 360, 768 y 1280 px, y en mi Android conectado. Para cada vista comprueba que no haya scroll horizontal, que se vea el foco, que el control de tamaño de letra funcione y que los botones se puedan tocar.
Mándame capturas de cada breakpoint y la lista de defectos. No subas nada a main.
```

## 2026-10-17 ~01:00 · Claude Code (Claude Opus 5.5) · De demo a app Android

```
Analiza qué falta para convertir la demo en una app Android instalable (APK):
- Empaquetado (Capacitor, PWA con TWA o nativo).
- Autenticación de usuarios.
- Persistencia de tokens y grants fuera del cliente.
- Manejo de secretos en el backend.
- Notificaciones.
- Despliegue del servidor.
Dame una tabla de brechas con su esfuerzo estimado y el orden de trabajo. Ten en cuenta que el login ya está en desarrollo. Solo análisis, sin código.
```
