# Prompts de Valentina

## 2026-10-16 16:58 · Claude Code (Claude Opus 5.5) · SDD: remesas por SMS sin app ni cuenta

```
Actualiza el SDD borrador con este caso de uso:

Actor: persona que recibe una remesa y no tiene app, cuenta bancaria ni datos móviles.
Flujo:
1. Al llegar la remesa, recibe un SMS con el monto.
2. Responde RETIRAR desde un menú por SMS.
3. Recibe un PIN de un solo uso.
4. Retira en efectivo en cualquier corresponsal con el PIN y su cédula.

Restricciones de experiencia:
- Nada de "abrir" o "cerrar" cuentas ni cajitas: para un usuario no digital es confuso. La única acción es RETIRAR el saldo disponible.
- Debe funcionar en cualquier celular, sin internet.

Agrega la historia de usuario con criterios de aceptación y señala qué parte del flujo usa Open Payments.
```

## 2026-10-16 17:15 · Claude Code (Claude Opus 5.5) · SDD: aclarar los tres productos

```
El equipo está confundiendo los productos. Corrige el SDD para que quede así:

P1 · Pago por porcentaje (vendedor ↔ proveedor). Es el ÚNICO producto que usa "cajita".
  - Cada venta se reparte: una parte al vendedor y otra al proveedor.
  - Dos modos de cobro dentro de la app: QR estático y QR personalizado (con monto).

P2 · Cobro por QR + SMS (sin app).
  - Con cuenta bancaria: el dinero va directo a la cuenta.
  - Sin cuenta: queda a nombre de la cédula y se retira con SMS → RETIRAR → PIN.

P3 · Remesas desde el exterior.
  - El remitente solo necesita el celular y la cédula de quien recibe; no hay cajita.
  - Quien recibe recibe un SMS con el monto, responde RETIRAR y retira con PIN en cualquier corresponsal.

Elimina del SDD cualquier mención de cajita fuera de P1 y deja las historias de usuario consistentes con esto.
```

## 2026-10-16 17:20 · Claude Code (Claude Opus 5.5) · Qué usa de Open Payments cada producto

```
Para cada producto (P1, P2, P3), mapea qué piezas de Open Payments usa: incoming payment, outgoing payment, quote, grant interactivo o no interactivo, límites e intervalos del grant, y rotación o revocación de tokens.
Formato: tabla producto × recurso, más una línea sobre quién es el cliente, quién el emisor y quién el receptor en cada flujo.
```

## 2026-10-16 18:12 · Claude Code (Claude Opus 5.5) · Plan de implementación del proyecto

```
Con el SDD ya cerrado, analiza el proyecto completo y entrégame un plan de implementación con:
1. Componentes a construir (backend, frontend, integración con Open Payments, SMS, retiro en corresponsal).
2. Stack y herramientas, justificando cada elección según el tiempo disponible (24 h).
3. Dependencias entre componentes y riesgos técnicos, con su plan de mitigación.
4. Orden de construcción priorizando un flujo end-to-end funcional en la Test Wallet.
```

## 2026-10-16 18:21 · Claude Code (Claude Opus 5.5) · Todo debe pasar por Open Payments

```
Corrección al plan: ningún producto puede tener pasos de dinero simulados fuera de Open Payments. En P2 (SMS + retiro en cajero), el movimiento de dinero debe pasar por la API: grants, incoming/outgoing payments y, donde aplique, quotes.
Rediseña ese flujo para que cada transferencia, incluido el retiro en el corresponsal, sea una operación real de Open Payments. Indica qué operación cubre cada paso.
```

## 2026-10-16 18:25 · Claude Code (Claude Opus 5.5) · Plan de trabajo por capas (MVP → idea completa)

```
La carpeta compartida (fedora) ya está disponible. Escribe en `development/PLAN_DE_TRABAJO.md` un plan incremental por capas:
- Capa 0: cimientos (setup, cliente de Open Payments).
- Capa 1: MVP con un pago real end-to-end.
- Capas siguientes hasta la idea completa: reparto, remesas y extras.

Cada capa debe reutilizar lo construido en la anterior y terminar en una demo que funcione. Define para cada una: alcance, criterio de "hecho" y punto de corte si se atrasa.
```

## 2026-10-16 19:36 · Claude Code (Claude Opus 5.5) · Trazabilidad capas ↔ historias del SDD

```
Agrega al plan de trabajo una matriz de trazabilidad: para cada capa, qué historias del SDD (H1, H2, …) cubre total o parcialmente. Al final, lista las historias que no cubre ninguna capa.
```

## 2026-10-16 19:38 · Claude Code (Claude Opus 5.5) · Componentes no bloqueantes para trabajo en paralelo

```
Descompón cada capa en componentes independientes (sin dependencias entre sí dentro de la misma capa), para que 4 personas trabajen en paralelo y la capa se cierre antes de pasar a la siguiente.
Para cada componente: ID (C<capa>.<n>), descripción, entradas y salidas (interfaz), criterio de aceptación y la integración que lo une al resto de la capa.
```

## 2026-10-16 20:59 · Claude Code (Claude Opus 5.5) · Exigir integración real (no solo pruebas)

```
Revisa lo que entregaste en C1.1: veo pruebas, pero no una integración real. El componente debe ejecutar las operaciones contra la Test Wallet (ilp.interledger-test.dev), no solo contra el mock.
1. Explica qué quedó implementado y qué falta.
2. Completa la integración real y demuéstrala con un pago en el testnet.
3. Corrige el correo de autor de git para que use un correo válido (con @).
```

## 2026-10-17 00:45 · Claude Code (Claude Opus 5.5) · C5.1 y C5.2: integración y prueba real

```
Integra C5.1 y C5.2 en el motor y valida el flujo end-to-end con dinero real en el testnet.
Reporta: pasos ejecutados, IDs de los pagos, montos enviados contra recibidos, y cualquier error junto con su corrección.
```
