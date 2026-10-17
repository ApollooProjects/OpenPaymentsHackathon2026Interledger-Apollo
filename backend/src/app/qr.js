import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import QRCode from 'qrcode';
import * as op from '../op/index.js';
import * as store from './store.js';
import { normalizarMeseros } from './reparto.js';

// URL a la que lleva el QR impreso: abre directo la pestaña Cliente con ese QR.
export function urlDelQr(qrId, base) {
    const raiz = (process.env.PUBLIC_URL || base).replace(/\/$/, '');
    return `${raiz}/#cliente?qr=${encodeURIComponent(qrId)}`;
}

export function imagenQr(texto) {
    return QRCode.toString(texto, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
}

function valorEntero(entrada) {
    const value = typeof entrada === 'object' && entrada !== null ? entrada.value : entrada;
    return /^\d+$/.test(String(value ?? '')) && BigInt(value) > 0n ? String(value) : null;
}

// QR personalizado (H4, H5b): monto, descripción, meseros y vigencia, todo opcional.
// Va ligado a un reparto: la venta se divide igual que con el QR estático y la propina entre sus meseros.
export async function crearQrPersonalizado({ repartoId, monto, descripcion, meseros = [], vigenteHasta } = {}) {
    const reparto = repartoId ? store.obtenerReparto(String(repartoId)) : null;
    if (!reparto) throw new Error('Falta un reparto válido (repartoId)');

    let valor = null;
    if (monto !== undefined && monto !== null && monto !== '') {
        valor = valorEntero(monto);
        if (!valor) throw new Error('El monto debe ser un entero positivo en centavos');
    }

    // Cada mesero es su wallet (partes iguales) o { wallet, porcentaje } (C5.1, deben sumar 100).
    const listaMeseros = normalizarMeseros(Array.isArray(meseros) ? meseros.filter(Boolean) : []);
    const wallets = listaMeseros.map((m) => (typeof m === 'string' ? m : m.wallet));
    // Se valida que cada wallet exista y use la misma moneda que el QR, para que la propina no falle al pagar.
    const qrEstatico = store.obtenerQr(reparto.qrId);
    const moneda = await op.obtenerWallet(qrEstatico.walletUrl);
    for (const wallet of wallets) {
        let datos;
        try {
            datos = await op.obtenerWallet(wallet);
        } catch {
            throw new Error(`No existe la wallet del mesero: ${wallet}`);
        }
        if (datos.assetCode !== moneda.assetCode) throw new Error(`La wallet ${wallet} es ${datos.assetCode}, no ${moneda.assetCode}`);
    }

    let vence = null;
    if (vigenteHasta) {
        const fecha = new Date(vigenteHasta);
        if (Number.isNaN(fecha.getTime())) throw new Error('vigenteHasta debe ser una fecha ISO');
        if (fecha < new Date()) throw new Error('La vigencia ya pasó');
        vence = fecha.toISOString();
    }

    const qrId = `p-${randomUUID().slice(0, 8)}`;
    store.guardarQr({
        id: qrId,
        vendedor: reparto.vendedor,
        walletUrl: qrEstatico.walletUrl,
        tipo: 'personalizado',
        monto: valor,
        meseros: listaMeseros,
        vigenteHasta: vence,
        propina: wallets.length > 0,
        repartoId: reparto.id,
        descripcion: String(descripcion ?? '').trim() || null
    });
    return { qrId };
}

// Un QR con monto sirve para un solo pago: queda usado cuando un pago suyo se completó o está en curso.
export function qrUsado(qr) {
    if (!qr.monto) return false;
    return store.pagosDelQr(qr.id).some((pago) => ['procesando', 'enviado', 'completado'].includes(pago.estado));
}

export const rutasQr = Router();

// POST /qr → { qrId, url }
rutasQr.post('/qr', async (req, res) => {
    try {
        const { qrId } = await crearQrPersonalizado(req.body ?? {});
        res.json({ qrId, url: urlDelQr(qrId, `${req.protocol}://${req.get('host')}`) });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// GET /qr/:qrId/imagen → SVG del QR que apunta a la pestaña Cliente.
// Los datos del QR (GET /qr/:qrId) los sirve routes/pagos.js.
rutasQr.get('/qr/:qrId/imagen', async (req, res) => {
    const base = `${req.protocol}://${req.get('host')}`;
    const svg = await imagenQr(urlDelQr(req.params.qrId, base));
    res.type('image/svg+xml').send(svg);
});
