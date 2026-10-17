// P2 sin cuenta (H8, H9): el dinero de quien no tiene cuenta llega a la wallet Custodia, a nombre de su cédula.
// Quien no tiene cuenta existe solo como metadata (cédula, celular) de los cobros en la Custodia:
// así retiros.js (C2.3) encuentra su saldo con op.listarCobros sin otra tabla.
//
//   registrar({ qrId, nombre, cedula, celular }) → QR cuyo dinero va a la Custodia
//   destinoDelQr(qr, monto)                      → destino del plan de pago (Custodia + metadata o wallet propia)
//   avisarLlegada(resumen)                       → se engancha en motor.onPagoCompletado: SMS "te llegó"
import { Router } from 'express';
import { db } from './db.js';
import * as store from './store.js';
import * as sms from './sms.js';
import * as retiros from './retiros.js';
import * as vinculos from './vinculos.js';
import { aWalletUrl } from './wallet.js';

db.exec(`
    CREATE TABLE IF NOT EXISTS personas_sin_cuenta (
        qr_id TEXT PRIMARY KEY,
        nombre TEXT NOT NULL,
        cedula TEXT NOT NULL,
        celular TEXT NOT NULL,
        creado TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS avisos_llegada (
        pago_id TEXT NOT NULL,
        destino INTEGER NOT NULL,
        enviado TEXT NOT NULL,
        PRIMARY KEY (pago_id, destino)
    );
`);

const soloDigitos = (texto) => String(texto ?? '').replace(/\D/g, '');

function custodia() {
    const wallet = process.env.CUSTODIA_WALLET;
    if (!wallet) throw new Error('Falta CUSTODIA_WALLET en el .env');
    return aWalletUrl(wallet);
}

export function registrar({ qrId, nombre, cedula, celular }) {
    const numero = sms.normalizarCelular(celular);
    if (!numero) throw new Error('Celular inválido');
    if (!soloDigitos(cedula)) throw new Error('Cédula inválida');
    if (!String(nombre ?? '').trim()) throw new Error('Falta el nombre');
    vinculos.vincular({ cedula, celular: numero });

    db.prepare(`
        INSERT INTO personas_sin_cuenta (qr_id, nombre, cedula, celular, creado) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(qr_id) DO UPDATE SET nombre = excluded.nombre, cedula = excluded.cedula, celular = excluded.celular
    `).run(qrId, nombre.trim(), soloDigitos(cedula), numero, new Date().toISOString());

    store.guardarQr({ id: qrId, vendedor: nombre.trim(), walletUrl: custodia() });
    return { qrId, nombre: nombre.trim(), cedula: soloDigitos(cedula), celular: numero };
}

export function personaDelQr(qrId) {
    return db.prepare('SELECT * FROM personas_sin_cuenta WHERE qr_id = ?').get(qrId) ?? null;
}

// Con cuenta: a su wallet. Sin cuenta: a la Custodia, con su cédula y celular en la metadata del cobro.
export function destinoDelQr(qr, monto) {
    const persona = personaDelQr(qr.id);
    if (!persona) return { nombre: qr.vendedor, walletUrl: qr.walletUrl, monto };
    return {
        nombre: persona.nombre,
        walletUrl: custodia(),
        monto,
        metadata: { cedula: persona.cedula, celular: persona.celular }
    };
}

function formatear(monto) {
    return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: monto.assetCode,
        maximumFractionDigits: monto.assetCode === 'COP' ? 0 : 2
    }).format(Number(monto.value) / 10 ** monto.assetScale);
}

// El motor llama esto solo cuando consultarCobro (incomingPayment.get) confirmó que el cobro se completó,
// así que el SMS sale con el receivedAmount real. Cada destino se avisa una sola vez aunque se confirme dos veces.
export async function avisarLlegada(resumen) {
    const pago = store.obtenerPago(resumen.pagoId);
    if (!pago) return;
    for (const [indice, destino] of pago.plan.destinos.entries()) {
        const celular = destino.metadata?.celular;
        if (!celular || !destino.completo) continue;
        const { changes } = db.prepare('INSERT OR IGNORE INTO avisos_llegada (pago_id, destino, enviado) VALUES (?, ?, ?)')
            .run(pago.id, indice, new Date().toISOString());
        if (changes === 0) continue;
        const recibido = destino.recibido ?? destino.monto;
        const cedula = destino.metadata?.cedula;
        // H9: el aviso trae el saldo total. Si no se puede leer en este momento, sale sin él.
        const saldo = cedula ? await retiros.saldo({ cedula }).then((r) => (r.ok ? r.saldo : null)).catch(() => null) : null;
        const pendiente = cedula ? retiros.retiroPendiente(cedula) : null;
        let texto = pago.plan.origen?.tipo === 'remesa'
            ? textoRemesa(recibido, destino.metadata?.remitente ?? pago.plan.origen?.nombreRemitente, saldo)
            : `La Cajita: te llegaron ${formatear(recibido)} por un pago con QR.${saldo ? ` Saldo: ${formatear(saldo)}.` : ''} `
                + 'Responde RETIRAR para sacarlo en efectivo o SALDO para ver cuánto tienes.';
        if (pendiente) {
            texto += ` Ya tienes un PIN activo por ${formatear(pendiente.monto)}: si respondes RETIRAR te damos uno nuevo por el total.`;
        }
        sms.enviar(celular, texto);
    }
}

// H11: "Te llegaron $200.000 de Carlos (desde el exterior). Responde RETIRAR para recibir tu PIN de retiro."
// Si llegan varias remesas antes de retirar, SALDO y RETIRAR ya las suman (todas quedan en la Custodia con la cédula).
export function textoRemesa(recibido, remitente, saldo = null) {
    const de = remitente ? ` de ${remitente}` : '';
    const total = saldo && saldo.value !== recibido.value ? ` Saldo: ${formatear(saldo)}.` : '';
    return `La Cajita: te llegaron ${formatear(recibido)}${de} desde el exterior.${total} `
        + 'Responde RETIRAR para recibir tu PIN de retiro o SALDO para ver cuánto tienes.';
}

export const rutasSinCuenta = Router();

// SDD §9 POST /personas: registra a alguien sin cuenta y le da su QR (el dinero queda en la Custodia).
rutasSinCuenta.post('/personas', (req, res) => {
    const { nombre, cedula, celular } = req.body ?? {};
    const qrId = `p-${soloDigitos(cedula)}`;
    try {
        const persona = registrar({ qrId, nombre, cedula, celular });
        res.json({ ...persona, conCuenta: false });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});
