// C4.1: cotización real entre dos monedas (EUR → COP) y, con --pagar <wallet>, pago real con esa cotización.
//   node scripts/probar-cotizacion.js                       → solo cotiza (no mueve dinero, no pide aprobación)
//   node scripts/probar-cotizacion.js --pagar <wallet>      → además paga desde <wallet> (su dueña aprueba una vez)
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as esperar } from 'node:timers/promises';
import * as op from '../backend/src/op/index.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.loadEnvFile(path.join(raiz, '.env'));

const remitente = 'https://ilp.interledger-test.dev/remitente-apollo';
const destino = process.env.CUSTODIA_WALLET ?? 'https://ilp.interledger-test.dev/custodia-apollo';
const indicePagar = process.argv.indexOf('--pagar');
const pagador = indicePagar > -1 ? process.argv[indicePagar + 1]?.replace(/^\$/, 'https://') : null;
const puerto = 3999;

const formato = (m) => `${(Number(m.value) / 10 ** m.assetScale).toLocaleString('es-CO')} ${m.assetCode}`;

function esperarFinish() {
    return new Promise((resolve) => {
        const servidor = http.createServer((req, res) => {
            const url = new URL(req.url, `http://localhost:${puerto}`);
            if (url.pathname !== '/finish') return res.writeHead(404).end();
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Listo. Vuelve a la terminal.');
            servidor.close();
            resolve({ interactRef: url.searchParams.get('interact_ref'), hash: url.searchParams.get('hash') });
        });
        servidor.listen(puerto);
    });
}

try {
    const cobro = await op.crearCobro({ walletUrl: destino, metadata: { prueba: 'C4.1' } });
    console.log('1. Cobro abierto (sin monto) en', destino);

    // €10: el testnet cobra una comisión fija cercana a €1, así que con €1 no llega nada.
    const euros = await op.cotizar({ walletUrl: remitente, cobroId: cobro.id, debito: { value: '1000' } });
    const tasa = Number(euros.recibe.value) / 10 ** euros.recibe.assetScale / (Number(euros.debito.value) / 10 ** euros.debito.assetScale);
    console.log(`2. Cotización ${euros.debito.assetCode} → ${euros.recibe.assetCode}: cobran ${formato(euros.debito)}, llega ${formato(euros.recibe)} (≈ ${tasa.toFixed(2)} ${euros.recibe.assetCode} por ${euros.debito.assetCode})`);

    if (!pagador) {
        console.log('   (Para pagar con una cotización: --pagar <wallet que paga>)');
        process.exit(0);
    }

    const cotizacion = await op.cotizar({ walletUrl: pagador, cobroId: cobro.id, debito: { value: '100000' } });
    console.log(`3. Cotización desde ${pagador}: cobran ${formato(cotizacion.debito)}, llega ${formato(cotizacion.recibe)}`);

    const nonce = randomUUID();
    const permiso = await op.pedirPermiso({
        walletUrl: pagador,
        tope: cotizacion.debito,
        finishUri: `http://localhost:${puerto}/finish`,
        nonce
    });
    console.log('4. La dueña de la wallet debe abrir esta URL y aceptar:\n' + permiso.redirectUrl);
    const vuelta = await esperarFinish();
    const { token } = await op.continuarPermiso({ continueUri: permiso.continueUri, continueToken: permiso.continueToken, interactRef: vuelta.interactRef });

    await op.pagarConCotizacion({ walletUrl: pagador, token, quoteId: cotizacion.quoteId });
    console.log('5. Pago con quoteId creado');

    for (let intento = 0; intento < 15; intento++) {
        const estado = await op.consultarCobro(cobro.id);
        if (BigInt(estado.recibido.value) >= BigInt(cotizacion.recibe.value)) {
            console.log(`6. El cobro recibió ${formato(estado.recibido)} (lo que decía la cotización)`);
            process.exit(0);
        }
        await esperar(1000);
    }
    throw new Error('El cobro todavía no recibió lo cotizado');
} catch (error) {
    console.error('Error:', error.message, error.description ?? '');
    process.exit(1);
}
