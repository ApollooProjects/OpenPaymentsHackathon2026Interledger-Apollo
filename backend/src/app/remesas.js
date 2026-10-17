import { randomUUID } from 'node:crypto';
import * as op from '../op/index.js';
import { db } from './db.js';
import * as motor from './motor.js';
import * as sms from './sms.js';
import * as vinculos from './vinculos.js';
import { aWalletUrl, esWalletUrl } from './wallet.js';

const VIGENCIA_COBRO_MS = 24 * 60 * 60 * 1000;

db.exec(`
    CREATE TABLE IF NOT EXISTS cotizaciones_remesa (
        id TEXT PRIMARY KEY,
        remitente TEXT NOT NULL,
        nombre_remitente TEXT,
        destino TEXT NOT NULL,
        cotizacion TEXT NOT NULL,
        pago_id TEXT,
        creado TEXT NOT NULL
    );
`);

const soloDigitos = (texto) => String(texto ?? '').replace(/\D/g, '');
const aUrl = aWalletUrl;

function custodia() {
    if (!process.env.CUSTODIA_WALLET) throw new Error('Falta CUSTODIA_WALLET en el .env');
    return aUrl(process.env.CUSTODIA_WALLET);
}

function errorHttp(status, mensaje) {
    return Object.assign(new Error(mensaje), { status });
}

async function destinoDeRemesa({ celular, cedula, destinatarioWallet, nombreRemitente }) {
    const remitente = nombreRemitente ? { remitente: nombreRemitente } : {};
    if (destinatarioWallet) {
        const wallet = await op.obtenerWallet(aUrl(destinatarioWallet));
        return { nombre: wallet.publicName ?? 'Familiar', walletUrl: wallet.id, metadata: { tipo: 'remesa', ...remitente } };
    }
    const numero = sms.normalizarCelular(celular);
    if (!numero) throw errorHttp(400, 'Celular inválido');
    if (!soloDigitos(cedula)) throw errorHttp(400, 'Cédula inválida');
    try {
        vinculos.vincular({ cedula, celular: numero });
    } catch (error) {
        throw errorHttp(400, error.message);
    }
    return {
        nombre: `Cédula ••••${soloDigitos(cedula).slice(-4)}`,
        walletUrl: custodia(),
        metadata: { tipo: 'remesa', cedula: soloDigitos(cedula), celular: numero, ...remitente }
    };
}

// modo 'envio' (por defecto): monto es lo que sale, en la moneda de quien envía.
// modo 'recibe': monto es lo que debe llegar exactamente, en la moneda de quien recibe (la comisión la paga quien envía).
export async function cotizar({ remitente, nombreRemitente, celular, cedula, destinatarioWallet, monto, modo = 'envio' } = {}) {
    const walletRemitente = aUrl(remitente);
    if (!esWalletUrl(walletRemitente)) throw errorHttp(400, 'Falta la dirección de tu billetera');
    const valor = typeof monto === 'object' && monto !== null ? monto.value : monto;
    if (!/^\d+$/.test(String(valor ?? '')) || BigInt(valor) <= 0n) {
        throw errorHttp(400, 'El monto debe ser un entero positivo en la unidad mínima (centavos)');
    }
    const nombre = String(nombreRemitente ?? '').trim() || null;
    if (modo !== 'envio' && modo !== 'recibe') throw errorHttp(400, 'modo debe ser "envio" o "recibe"');

    // La red cobra una comisión casi fija (~1 EUR en el testnet): con menos de 2 unidades la cotización no alcanza.
    const wallet = await op.obtenerWallet(walletRemitente);
    if (modo === 'envio' && wallet.assetCode !== 'COP' && BigInt(valor) < 2n * 10n ** BigInt(wallet.assetScale)) {
        throw errorHttp(400, `El envío mínimo es 2 ${wallet.assetCode}`);
    }

    const destino = await destinoDeRemesa({ celular, cedula, destinatarioWallet, nombreRemitente: nombre });
    const cobro = await op.crearCobro({
        walletUrl: destino.walletUrl,
        expiresAt: new Date(Date.now() + VIGENCIA_COBRO_MS).toISOString(),
        metadata: destino.metadata
    });
    let cotizacion;
    if (modo === 'recibe') {
        const moneda = await op.obtenerWallet(destino.walletUrl);
        const recibe = { value: String(valor), assetCode: moneda.assetCode, assetScale: moneda.assetScale };
        cotizacion = await op.cotizar({ walletUrl: walletRemitente, cobroId: cobro.id, recibe });
    } else {
        cotizacion = await op.cotizar({ walletUrl: walletRemitente, cobroId: cobro.id, debito: { value: String(valor) } });
    }

    const id = randomUUID();
    db.prepare(`
        INSERT INTO cotizaciones_remesa (id, remitente, nombre_remitente, destino, cotizacion, creado) VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, walletRemitente, nombre, JSON.stringify({ ...destino, cobroId: cobro.id }), JSON.stringify(cotizacion), new Date().toISOString());

    return { cotizacionId: id, cobra: cotizacion.debito, llega: cotizacion.recibe, vence: cotizacion.vence };
}

export async function enviar({ cotizacionId } = {}) {
    const fila = db.prepare('SELECT * FROM cotizaciones_remesa WHERE id = ?').get(String(cotizacionId ?? ''));
    if (!fila) throw errorHttp(404, 'Cotización no encontrada');
    if (fila.pago_id) throw errorHttp(409, 'Esta cotización ya se usó: vuelve a cotizar');
    const cotizacion = JSON.parse(fila.cotizacion);
    if (cotizacion.vence && new Date(cotizacion.vence) < new Date()) throw errorHttp(410, 'La cotización venció: vuelve a cotizar');

    const destino = JSON.parse(fila.destino);
    const resultado = await motor.iniciarPago({
        pagador: fila.remitente,
        cotizar: true,
        origen: { tipo: 'remesa', cotizacionId: fila.id, nombreRemitente: fila.nombre_remitente },
        destinos: [{ ...destino, monto: cotizacion.recibe, quoteId: cotizacion.quoteId, debito: cotizacion.debito }]
    });
    db.prepare('UPDATE cotizaciones_remesa SET pago_id = ? WHERE id = ?').run(resultado.pagoId, fila.id);
    return resultado;
}
