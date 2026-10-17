import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as esperar } from 'node:timers/promises';
import * as op from '../backend/src/op/index.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.loadEnvFile(path.join(raiz, '.env'));

const pagador = process.argv[2] ?? 'https://ilp.interledger-test.dev/cliente-b-apollo';
const destino = process.argv[3] ?? 'https://ilp.interledger-test.dev/vendedorapollo';
const monto = { value: '1000' };
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

const cobro = await op.crearCobro({ walletUrl: destino, monto, metadata: { prueba: 'C1.2' } });
console.log('1. Cobro creado en', destino);

const permiso = await op.pedirPermiso({
    walletUrl: pagador,
    tope: monto,
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

const { token, manageUrl } = await op.continuarPermiso({
    continueUri: permiso.continueUri,
    continueToken: permiso.continueToken,
    interactRef: vuelta.interactRef
});
console.log('4. Token recibido:', token ? 'sí' : 'no', '· URL de gestión:', manageUrl ? 'sí' : 'no');

await op.pagar({ walletUrl: pagador, token, cobroId: cobro.id, monto });
console.log('5. Pago saliente creado');

for (let intento = 0; intento < 10; intento++) {
    const estado = await op.consultarCobro(cobro.id);
    if (estado.completo) {
        console.log('6. Cobro completo:', estado.recibido.value, estado.recibido.assetCode);
        process.exit(0);
    }
    await esperar(1000);
}
console.log('6. El cobro todavía no aparece completo');
process.exit(1);
