import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as esperar } from 'node:timers/promises';
import * as op from '../backend/src/op/index.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.loadEnvFile(path.join(raiz, '.env'));

const pagador = process.argv[2] ?? 'https://ilp.interledger-test.dev/cliente-b-apollo';
const vendedor = process.env.DEMO_VENDEDOR_WALLET ?? 'https://ilp.interledger-test.dev/vendedorapollo';
const custodia = process.env.CUSTODIA_WALLET ?? 'https://ilp.interledger-test.dev/custodia-apollo';
const monto = { value: '1000' };
const tope = { value: '3000' };
const puerto = 3999;
const nonce = randomUUID();

function esperarFinish() {
    return new Promise((resolve) => {
        const servidor = http.createServer((req, res) => {
            const url = new URL(req.url, `http://localhost:${puerto}`);
            if (url.pathname !== '/finish') {
                res.writeHead(404).end();
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Listo. Vuelve a la terminal.');
            servidor.close();
            resolve({
                interactRef: url.searchParams.get('interact_ref'),
                hash: url.searchParams.get('hash'),
                resultado: url.searchParams.get('result')
            });
        });
        servidor.listen(puerto);
    });
}

async function esperarCobro(id, listo) {
    for (let intento = 0; intento < 15; intento++) {
        const estado = await op.consultarCobro(id);
        if (listo(estado)) return estado;
        await esperar(1000);
    }
    return op.consultarCobro(id);
}

const cobro = await op.crearCobro({ walletUrl: vendedor, monto, metadata: { prueba: 'C3.2' } });
const cajita = await op.crearCobro({
    walletUrl: custodia,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    metadata: { prueba: 'C3.2', tipo: 'cajita' }
});
console.log('1. Cobro con monto en', vendedor);
console.log('   Cajita sin monto en', custodia);

const permiso = await op.pedirPermiso({
    walletUrl: pagador,
    tope,
    finishUri: `http://localhost:${puerto}/finish`,
    nonce
});
console.log('2. Abre esta URL e inicia sesión con la dueña de', pagador);
console.log(permiso.redirectUrl);

const vuelta = await esperarFinish();
if (!vuelta.interactRef) {
    console.log('3. Sin interact_ref: el permiso fue rechazado', vuelta.resultado ?? '');
    process.exit(1);
}

const hashValido = op.verificarHash({
    clientNonce: nonce,
    interactNonce: permiso.interactNonce,
    interactRef: vuelta.interactRef,
    authServerUrl: permiso.authServerUrl,
    hash: vuelta.hash
});
console.log('3. Hash válido:', hashValido ? 'sí' : 'no');
if (!hashValido) process.exit(1);

const { token } = await op.continuarPermiso({
    continueUri: permiso.continueUri,
    continueToken: permiso.continueToken,
    interactRef: vuelta.interactRef
});

await op.pagar({ walletUrl: pagador, token, cobroId: cobro.id, monto });
await op.pagar({ walletUrl: pagador, token, cobroId: cajita.id, monto });
await op.pagar({ walletUrl: pagador, token, cobroId: cajita.id, monto });
console.log('4. Tres pagos salientes con el mismo token: 1 al cobro con monto y 2 a la cajita');

const estadoCobro = await esperarCobro(cobro.id, (e) => e.completo);
console.log('5. Cobro con monto completo:', estadoCobro.completo ? 'sí' : 'no', '·', estadoCobro.recibido.value);

const estadoCajita = await esperarCobro(cajita.id, (e) => BigInt(e.recibido.value) >= 2000n);
const cajitaBien = BigInt(estadoCajita.recibido.value) === 2000n && !estadoCajita.completo;
console.log('6. Cajita recibió', estadoCajita.recibido.value, '· sigue abierta:', estadoCajita.completo ? 'no' : 'sí');

await op.cerrarCobro(cajita.id);
const cerrada = await op.consultarCobro(cajita.id);
console.log('7. cerrarCobro → cajita completa:', cerrada.completo ? 'sí' : 'no');

process.exit(estadoCobro.completo && cajitaBien && cerrada.completo ? 0 : 1);
