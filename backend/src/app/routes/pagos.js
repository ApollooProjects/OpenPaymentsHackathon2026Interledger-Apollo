import { Router } from 'express';
import * as store from '../store.js';
import * as motor from '../motor.js';
import * as op from '../../op/index.js';

export const rutasPagos = Router();

// Acepta la wallet como la muestra la Test Wallet ($ilp…) o como URL (https://ilp…).
function normalizarWallet(texto) {
    const limpio = String(texto ?? '').trim();
    if (limpio.startsWith('$')) return `https://${limpio.slice(1)}`;
    return limpio;
}

function aMonto(entrada) {
    const value = typeof entrada === 'object' && entrada !== null ? entrada.value : entrada;
    if (!/^\d+$/.test(String(value ?? '')) || BigInt(value) <= 0n) return null;
    return { value: String(value) };
}

async function qrPublico(qr) {
    let monto = null;
    if (qr.monto) {
        const wallet = await op.obtenerWallet(qr.walletUrl);
        monto = { value: qr.monto, assetCode: wallet.assetCode, assetScale: wallet.assetScale };
    }
    return {
        qrId: qr.id,
        vendedor: qr.vendedor,
        tipo: qr.tipo,
        monto,
        meseros: qr.meseros,
        vigenteHasta: qr.vigenteHasta,
        propina: qr.propina
    };
}

const vencido = (qr) => qr.vigenteHasta && new Date(qr.vigenteHasta) < new Date();

rutasPagos.get('/qr/:qrId', async (req, res) => {
    const qr = store.obtenerQr(req.params.qrId);
    if (!qr) return res.status(404).json({ error: 'QR no encontrado' });
    if (vencido(qr)) return res.status(410).json({ error: 'Este QR ya venció', ...(await qrPublico(qr)) });
    res.json(await qrPublico(qr));
});

rutasPagos.post('/pagar/:qrId', async (req, res) => {
    const qr = store.obtenerQr(req.params.qrId);
    if (!qr) return res.status(404).json({ error: 'QR no encontrado' });
    if (vencido(qr)) return res.status(410).json({ error: 'Este QR ya venció' });

    const pagador = normalizarWallet(req.body?.pagador);
    if (!pagador.startsWith('https://')) return res.status(400).json({ error: 'Falta la wallet de quien paga' });

    const monto = aMonto(qr.monto ?? req.body?.monto);
    if (!monto) return res.status(400).json({ error: 'El monto debe ser un entero positivo en la unidad mínima (centavos)' });

    const { pagoId, redirectUrl } = await motor.iniciarPago({
        pagador,
        clienteId: req.body?.clienteId ?? null,
        origen: { tipo: 'qr', qrId: qr.id },
        destinos: [{ nombre: qr.vendedor, walletUrl: qr.walletUrl, monto }]
    });
    res.json({ pagoId, redirectUrl });
});

rutasPagos.get('/op/finish', async (req, res) => {
    const { pago, interact_ref: interactRef, hash, result: resultado } = req.query;
    if (!pago) return res.status(400).send('Falta el parámetro pago');
    await motor.terminarPago({ pagoId: pago, interactRef, hash, resultado });
    res.redirect(`/#recibo?pago=${encodeURIComponent(pago)}`);
});

rutasPagos.get('/pagos/:id', async (req, res) => {
    let pago = store.obtenerPago(req.params.id);
    if (!pago) return res.status(404).json({ error: 'Pago no encontrado' });
    if (pago.estado === motor.ESTADOS.ENVIADO) pago = await motor.confirmar(pago.id);
    res.json(motor.resumen(pago));
});
