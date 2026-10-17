// App producto: la cuenta de quien tiene sesión, su inicio (saldo y movimientos) y su QR para cobrar.
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { db } from '../db.js';
import * as op from '../../op/index.js';
import * as store from '../store.js';
import * as cuentas from '../cuentas.js';
import * as retiros from '../retiros.js';
import { delExterior, registrar } from '../sinCuenta.js';
import { crearQrTransferencia, urlDelQr } from '../qr.js';
import { aWalletUrl } from '../wallet.js';
import { conSesion, responderError } from './auth.js';

export const rutasYo = Router();

const soloDigitos = (texto) => String(texto ?? '').replace(/\D/g, '');
const base = (req) => `${req.protocol}://${req.get('host')}`;

function custodia() {
    if (!process.env.CUSTODIA_WALLET) throw new Error('Falta CUSTODIA_WALLET en el .env');
    return aWalletUrl(process.env.CUSTODIA_WALLET);
}

// Nombre para mostrar de una wallet: el de su usuario en la app si lo hay; si no, el final de la dirección.
function nombreDeWallet(url) {
    if (!url) return null;
    const fila = db.prepare('SELECT nombre FROM usuarios WHERE wallet = ? AND nombre IS NOT NULL').get(url);
    return fila?.nombre ?? url.split('/').pop();
}

const sumar = (montos) => montos.reduce(
    (total, m) => ({ ...m, value: (BigInt(total?.value ?? 0) + BigInt(m.value)).toString() }), null
);

const VISIBLE = (pago) => !['esperando_consentimiento', 'rechazado'].includes(pago.estado);

function contraparteRecibido(pago) {
    const origen = pago.plan.origen ?? {};
    if (origen.tipo === 'remesa') return origen.nombreRemitente || (delExterior(pago) ? 'Remesa del exterior' : 'Envío de dinero');
    return nombreDeWallet(pago.pagador) || 'Pago con QR';
}

// Efectivo: lo recibido son los cobros de la Custodia con su cédula (en el testnet); lo retirado, sus retiros.
async function resumenEfectivo(usuario) {
    const cedula = usuario.cedula;
    const [cobros, saldo] = await Promise.all([
        op.listarCobros({ walletUrl: custodia() }),
        retiros.saldo({ cedula })
    ]);
    const pagoPorCobro = new Map();
    for (const pago of store.pagosHacia(custodia())) {
        for (const destino of pago.plan.destinos) if (destino.cobroId) pagoPorCobro.set(destino.cobroId, pago);
    }

    const movimientos = cobros
        .filter((cobro) => soloDigitos(cobro.metadata?.cedula) === cedula && BigInt(cobro.recibido.value) > 0n)
        .map((cobro) => {
            const pago = pagoPorCobro.get(cobro.id);
            return {
                id: cobro.id,
                fecha: cobro.creado,
                tipo: 'recibido',
                monto: cobro.recibido,
                contraparte: cobro.metadata?.remitente || (pago ? contraparteRecibido(pago) : 'Pago recibido'),
                // Los cobros sin monto (remesas, cajita) no se cierran nunca: si recibió dinero, ya llegó.
                estado: 'completado',
                comprobante: cobro.id
            };
        });
    for (const retiro of store.retirosDe(cedula)) {
        if (!['entregado', 'pagando'].includes(retiro.estado)) continue;
        movimientos.push({
            id: retiro.id,
            fecha: retiro.creado,
            tipo: 'retiro',
            monto: retiro.monto,
            contraparte: 'Corresponsal',
            estado: retiro.estado === 'entregado' ? 'completado' : 'procesando',
            comprobante: retiro.pagoOpId ?? retiro.cobroId
        });
    }

    let disponible = saldo.ok ? saldo.saldo : null;
    if (!disponible) {
        const wallet = await op.obtenerWallet(custodia());
        disponible = { value: '0', assetCode: wallet.assetCode, assetScale: wallet.assetScale };
    }
    return { saldo: disponible, retiroPendiente: retiros.retiroPendiente(cedula), movimientos };
}

// Billetera: Open Payments no expone el saldo de una wallet; los movimientos son los pagos de la base.
function resumenBilletera(usuario) {
    const wallet = usuario.wallet;
    const movimientos = [];
    for (const pago of store.pagosDesde(wallet).filter(VISIBLE)) {
        const origen = pago.plan.origen ?? {};
        const destinos = pago.plan.destinos ?? [];
        const contraparte = origen.tipo === 'qr'
            ? store.obtenerQr(origen.qrId)?.vendedor ?? destinos[0]?.nombre
            : destinos[0]?.nombre;
        movimientos.push({
            id: pago.id,
            fecha: pago.creado,
            tipo: 'enviado',
            monto: pago.plan.tope ?? sumar(destinos.map((d) => d.monto)),
            contraparte: contraparte || 'Pago',
            estado: pago.estado,
            comprobante: destinos.find((d) => d.pagoOpId)?.pagoOpId ?? null
        });
    }
    for (const pago of store.pagosHacia(wallet).filter(VISIBLE)) {
        if (pago.pagador === wallet) continue;
        const propios = pago.plan.destinos.filter((d) => d.walletUrl === wallet);
        movimientos.push({
            id: pago.id,
            fecha: pago.creado,
            tipo: 'recibido',
            monto: sumar(propios.map((d) => d.recibido ?? d.monto)),
            contraparte: contraparteRecibido(pago),
            estado: pago.estado,
            comprobante: propios[0]?.cobroId ?? null
        });
    }
    return { saldo: null, retiroPendiente: null, movimientos };
}

rutasYo.use('/yo', conSesion);

rutasYo.get('/yo', (req, res) => res.json({ usuario: req.usuario }));

rutasYo.patch('/yo', (req, res) => {
    try {
        res.json({ usuario: cuentas.cambiarNombre(req.usuario.id, req.body?.nombre) });
    } catch (error) {
        responderError(res, error);
    }
});

rutasYo.post('/yo/billetera', async (req, res) => {
    try {
        res.json(await cuentas.usarBilletera(req.usuario.id, req.body?.wallet));
    } catch (error) {
        responderError(res, error);
    }
});

rutasYo.post('/yo/efectivo', (req, res) => {
    try {
        res.json(cuentas.usarEfectivo(req.usuario.id, req.body?.cedula));
    } catch (error) {
        responderError(res, error);
    }
});

rutasYo.get('/yo/resumen', async (req, res) => {
    const usuario = req.usuario;
    let resumen = { saldo: null, retiroPendiente: null, movimientos: [] };
    if (usuario.tipo === 'efectivo') resumen = await resumenEfectivo(usuario);
    else if (usuario.tipo === 'billetera') resumen = resumenBilletera(usuario);
    resumen.movimientos.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    const qrId = cuentas.qrDelUsuario(usuario.id);
    res.json({ ...resumen, qr: qrId ? { id: qrId, enlace: urlDelQr(qrId, base(req)) } : null });
});

function centavos(entrada) {
    const value = typeof entrada === 'object' && entrada !== null ? entrada.value : entrada;
    if (value === undefined || value === null || value === '') return null;
    if (!/^\d+$/.test(String(value)) || BigInt(value) <= 0n) throw new cuentas.ErrorCuenta('El monto debe ser un entero positivo en centavos');
    return String(value);
}

// POST /yo/qr { monto?, concepto? } → { qr: { id, enlace, monto } }
// Sin monto ni concepto es su QR fijo (se crea una vez y se devuelve el mismo); con alguno, un QR de un solo pago.
rutasYo.post('/yo/qr', async (req, res) => {
    const usuario = req.usuario;
    try {
        if (!usuario.tipo) throw new cuentas.ErrorCuenta('Primero elige cómo quieres recibir el dinero: billetera o efectivo');
        const monto = centavos(req.body?.monto);
        const concepto = String(req.body?.concepto ?? '').trim() || null;
        const fijo = !monto && !concepto;
        const nombre = usuario.nombre || `Celular ${cuentas.ocultarCelular(usuario.celular)}`;

        const existente = fijo ? cuentas.qrDelUsuario(usuario.id) : null;
        if (existente && store.obtenerQr(existente)) {
            return res.json({ qr: { id: existente, enlace: urlDelQr(existente, base(req)), monto: null } });
        }

        let qr;
        if (usuario.tipo === 'billetera') {
            let creado;
            try {
                creado = await crearQrTransferencia({ nombre, wallet: usuario.wallet, monto, concepto });
            } catch (error) {
                throw new cuentas.ErrorCuenta(error.message);
            }
            qr = { id: creado.qrId, monto: creado.monto };
        } else {
            const qrId = fijo ? `p-${usuario.cedula}` : `e-${randomUUID().slice(0, 8)}`;
            try {
                registrar({
                    qrId, nombre, cedula: usuario.cedula, celular: usuario.celular,
                    ...(fijo ? {} : { tipo: 'efectivo', monto, descripcion: concepto })
                });
            } catch (error) {
                throw new cuentas.ErrorCuenta(error.message);
            }
            const moneda = monto ? await op.obtenerWallet(custodia()) : null;
            qr = { id: qrId, monto: monto ? { value: monto, assetCode: moneda.assetCode, assetScale: moneda.assetScale } : null };
        }
        if (fijo) cuentas.guardarQrDelUsuario(usuario.id, qr.id);
        res.json({ qr: { id: qr.id, enlace: urlDelQr(qr.id, base(req)), monto: qr.monto } });
    } catch (error) {
        responderError(res, error);
    }
});
