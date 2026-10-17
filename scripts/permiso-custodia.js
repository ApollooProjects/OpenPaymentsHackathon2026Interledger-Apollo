import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as esperar } from 'node:timers/promises';
import * as op from '../backend/src/op/index.js';
import { guardarPermiso, obtenerPermiso, actualizarTokenPermiso } from '../backend/src/app/store.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.loadEnvFile(path.join(raiz, '.env'));

const CLAVE = 'custodia-retiros';
const custodia = process.env.CUSTODIA_WALLET ?? 'https://ilp.interledger-test.dev/custodia-apollo';
const corresponsal = process.env.CORRESPONSAL_WALLET ?? 'https://ilp.interledger-test.dev/corresponsal-apollo';
const topePesos = BigInt(process.argv.find((a) => /^\d+$/.test(a)) ?? '500000');
const probar = process.argv.includes('--probar');
const puerto = 3999;

function esperarVuelta() {
    return new Promise((resolve) => {
        const lector = readline.createInterface({ input: process.stdin, output: process.stdout });
        const servidor = http.createServer((req, res) => {
            const url = new URL(req.url, `http://localhost:${puerto}`);
            if (url.pathname !== '/finish') {
                res.writeHead(404).end();
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Listo. Vuelve a la terminal.');
            terminar(url);
        });
        function terminar(url) {
            servidor.close();
            lector.close();
            resolve({
                interactRef: url.searchParams.get('interact_ref'),
                hash: url.searchParams.get('hash'),
                resultado: url.searchParams.get('result')
            });
        }
        servidor.listen(puerto);
        lector.question('   (Si aprobaste en otro computador, pega aquí la URL completa a la que te llevó y presiona Enter)\n', (texto) => {
            try {
                terminar(new URL(texto.trim()));
            } catch {
                console.log('   Esa no es una URL válida; espero el regreso a localhost.');
            }
        });
    });
}

async function pedirYGuardar() {
    const wallet = await op.obtenerWallet(custodia);
    const tope = { value: (topePesos * 10n ** BigInt(wallet.assetScale)).toString() };
    const interval = `R/${new Date().toISOString()}/P1D`;
    const nonce = randomUUID();

    const permiso = await op.pedirPermiso({
        walletUrl: custodia,
        tope,
        interval,
        finishUri: `http://localhost:${puerto}/finish`,
        nonce
    });
    console.log(`1. Permiso de retiros pedido: tope diario $${topePesos} ${wallet.assetCode}, interval ${interval}`);
    console.log(`2. La dueña de ${custodia} debe abrir esta URL y aceptar:`);
    console.log(permiso.redirectUrl);

    const vuelta = await esperarVuelta();
    if (!vuelta.interactRef) throw new Error(`Sin interact_ref: el permiso fue rechazado ${vuelta.resultado ?? ''}`);

    const hashValido = op.verificarHash({
        clientNonce: nonce,
        interactNonce: permiso.interactNonce,
        interactRef: vuelta.interactRef,
        authServerUrl: permiso.authServerUrl,
        hash: vuelta.hash
    });
    console.log('3. Hash válido:', hashValido ? 'sí' : 'no');
    if (!hashValido) throw new Error('El hash de la redirección no es válido');

    const { token, manageUrl } = await op.continuarPermiso({
        continueUri: permiso.continueUri,
        continueToken: permiso.continueToken,
        interactRef: vuelta.interactRef
    });
    guardarPermiso({ clave: CLAVE, walletUrl: custodia, token, manageUrl, tope: { ...tope, assetCode: wallet.assetCode, assetScale: wallet.assetScale }, interval });
    console.log(`4. Token guardado en data/cajita.sqlite (clave "${CLAVE}")`);
}

async function probarRetiro() {
    const guardado = obtenerPermiso(CLAVE);
    if (!guardado) throw new Error('No hay permiso guardado de la Custodia');

    const rotado = await op.rotar({ token: guardado.token, manageUrl: guardado.manageUrl });
    actualizarTokenPermiso(CLAVE, rotado);
    console.log('5. Token rotado:', rotado.token !== guardado.token ? 'sí (nuevo)' : 'no');

    const monto = { value: '1000' };
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const cobro = await op.crearCobro({ walletUrl: corresponsal, monto, metadata: { prueba: 'C2.2' }, expiresAt });
    console.log('6. Cobro en el Corresponsal con expiresAt', expiresAt);

    const pago = await op.pagar({ walletUrl: custodia, token: rotado.token, cobroId: cobro.id, monto });
    console.log('7. Pago Custodia → Corresponsal creado sin aprobar de nuevo');

    for (let intento = 0; intento < 15; intento++) {
        const estado = await op.consultarCobro(cobro.id);
        if (estado.completo) {
            console.log('8. Cobro completo:', estado.recibido.value, estado.recibido.assetCode);
            return;
        }
        const saliente = await op.consultarPago({ id: pago.id, token: rotado.token });
        if (saliente.fallido) throw new Error('El pago saliente falló (¿la Custodia tiene saldo?)');
        await esperar(1000);
    }
    throw new Error('El cobro todavía no aparece completo');
}

try {
    if (!obtenerPermiso(CLAVE) || process.argv.includes('--nuevo')) await pedirYGuardar();
    else console.log(`Ya hay un permiso guardado (clave "${CLAVE}"). Usa --nuevo para pedir otro.`);
    if (probar) await probarRetiro();
    process.exit(0);
} catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
}
