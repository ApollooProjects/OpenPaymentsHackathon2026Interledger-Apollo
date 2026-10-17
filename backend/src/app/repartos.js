// P1 (H1, H2, H6, H7): cada venta se divide sola entre el proveedor (hasta saldar la deuda), el vendedor y los meseros.
// Con cuenta, la parte del vendedor va a su wallet; sin cuenta, a su cajita en la Custodia.
import { randomUUID } from 'node:crypto';
import * as op from '../op/index.js';
import * as store from './store.js';
import * as retiros from './retiros.js';
import * as sms from './sms.js';
import * as vinculos from './vinculos.js';
import { calcularReparto, normalizarMeseros } from './reparto.js';

const VIGENCIA_CAJITA_MS = 7 * 24 * 60 * 60 * 1000;

const soloDigitos = (texto) => String(texto ?? '').replace(/\D/g, '');
const aUrl = (wallet) => String(wallet ?? '').trim().replace(/^\$/, 'https://');

function custodia() {
    if (!process.env.CUSTODIA_WALLET) throw new Error('Falta CUSTODIA_WALLET en el .env');
    return aUrl(process.env.CUSTODIA_WALLET);
}

async function nuevaCajita({ id, cedula, celular }) {
    const vence = new Date(Date.now() + VIGENCIA_CAJITA_MS).toISOString();
    const cobro = await op.crearCobro({
        walletUrl: custodia(),
        expiresAt: vence,
        metadata: { cedula, celular, repartoId: id, tipo: 'cajita' }
    });
    return { cajitaId: cobro.id, cajitaVence: vence };
}

export async function crearReparto({
    vendedor, proveedorWallet, porcentaje = 35, deuda = null, conCuenta, vendedorWallet, cedula, celular, meseros = [],
    ahorroWallet = null, ahorroPorcentaje = 0
}) {
    if (!String(vendedor ?? '').trim()) throw new Error('Falta el nombre del vendedor');
    if (!aUrl(proveedorWallet).startsWith('https://')) throw new Error('Falta la wallet del proveedor');
    const pct = Number(porcentaje);
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new Error('porcentaje debe ser un entero entre 0 y 100');
    if (deuda !== null && deuda !== undefined && !/^\d+$/.test(String(deuda))) throw new Error('deuda debe ser un entero en centavos');
    if (conCuenta && !aUrl(vendedorWallet).startsWith('https://')) throw new Error('Con cuenta hace falta la wallet del vendedor');
    if (!conCuenta && (!soloDigitos(cedula) || !soloDigitos(celular))) throw new Error('Sin cuenta hacen falta la cédula y el celular');
    // Sin cuenta, el celular queda vinculado a la cédula (falla si ya es de otra) y normalizado como lo manda el SMS.
    if (!conCuenta) celular = vinculos.vincular({ cedula, celular }).celular;
    const listaMeseros = normalizarMeseros(meseros);

    const pctAhorro = Number(ahorroPorcentaje || 0);
    if (!Number.isInteger(pctAhorro) || pctAhorro < 0 || pctAhorro > 100) throw new Error('ahorroPorcentaje debe ser un entero entre 0 y 100');
    const walletAhorro = pctAhorro > 0 ? aUrl(ahorroWallet) : null;
    if (pctAhorro > 0) {
        if (!walletAhorro.startsWith('https://')) throw new Error('Con ahorro hace falta la wallet de ahorro');
        // En la Custodia el ahorro se sumaría al saldo que se retira con PIN: tiene que ir a otra wallet.
        if (process.env.CUSTODIA_WALLET && walletAhorro === custodia()) throw new Error('La wallet de ahorro no puede ser la Custodia');
        await op.obtenerWallet(walletAhorro);
    }

    const id = randomUUID();
    const qrId = `r-${id.slice(0, 8)}`;
    const reparto = {
        id,
        qrId,
        vendedor: vendedor.trim(),
        conCuenta: Boolean(conCuenta),
        vendedorWallet: conCuenta ? aUrl(vendedorWallet) : null,
        cedula: conCuenta ? null : soloDigitos(cedula),
        celular: conCuenta ? null : celular,
        proveedorWallet: aUrl(proveedorWallet),
        porcentaje: pct,
        deuda: deuda !== null && deuda !== undefined && BigInt(deuda) > 0n ? String(deuda) : null,
        ahorroWallet: walletAhorro,
        ahorroPorcentaje: pctAhorro
    };

    if (reparto.deuda) {
        const cobro = await op.crearCobro({
            walletUrl: reparto.proveedorWallet,
            monto: { value: reparto.deuda },
            metadata: { repartoId: id, tipo: 'deuda' }
        });
        reparto.deudaCobroId = cobro.id;
    }
    if (!reparto.conCuenta) Object.assign(reparto, await nuevaCajita(reparto));

    store.crearReparto(reparto);
    store.guardarQr({
        id: qrId,
        vendedor: reparto.vendedor,
        walletUrl: reparto.conCuenta ? reparto.vendedorWallet : custodia(),
        meseros: listaMeseros,
        propina: listaMeseros.length > 0
    });
    return { id, qrId };
}

export function repartoDelQr(qrId) {
    return store.repartoDelQr(qrId);
}

async function deudaPendiente(reparto) {
    if (!reparto.deudaCobroId) return null;
    const cobro = await op.consultarCobro(reparto.deudaCobroId);
    const falta = BigInt(reparto.deuda) - BigInt(cobro.recibido.value);
    return (falta > 0n ? falta : 0n).toString();
}

// Arma los destinos del plan de pago: un solo consentimiento del cliente cubre todos.
export async function destinosDeVenta(reparto, { monto, propina, meseros = [] }) {
    if (!reparto.conCuenta && new Date(reparto.cajitaVence) < new Date()) {
        reparto = store.cambiarCajita(reparto.id, await nuevaCajita(reparto));
    }

    const partes = calcularReparto({
        total: monto.value,
        propina: propina?.value ?? 0,
        porcentaje: reparto.porcentaje,
        deudaPendiente: await deudaPendiente(reparto),
        meseros,
        ahorro: reparto.ahorroWallet ? reparto.ahorroPorcentaje : 0
    });
    const wallets = meseros.map((m) => (typeof m === 'string' ? m : m.wallet));

    return partes.map(({ destino, valor }) => {
        const parte = { value: String(valor) };
        if (destino === 'proveedor') {
            return { nombre: 'Proveedor', walletUrl: reparto.proveedorWallet, monto: parte, ...(reparto.deudaCobroId && { cobroId: reparto.deudaCobroId }) };
        }
        if (destino === 'vendedor') {
            return reparto.conCuenta
                ? { nombre: reparto.vendedor, walletUrl: reparto.vendedorWallet, monto: parte }
                : { nombre: reparto.vendedor, walletUrl: custodia(), monto: parte, cobroId: reparto.cajitaId };
        }
        if (destino === 'ahorro') return { nombre: 'Ahorro', walletUrl: reparto.ahorroWallet, monto: parte };
        return { nombre: `Mesero ${wallets.indexOf(destino) + 1}`, walletUrl: destino, monto: parte };
    });
}

async function moneda(walletUrl) {
    const wallet = await op.obtenerWallet(walletUrl);
    return { assetCode: wallet.assetCode, assetScale: wallet.assetScale };
}

export async function resumenReparto(id) {
    const reparto = store.obtenerReparto(id);
    if (!reparto) return null;

    const ventas = store.pagosDelReparto(reparto.id).filter((pago) => pago.estado === 'completado');
    const parteDe = (pago, walletUrl) => pago.plan.destinos
        .filter((d) => d.walletUrl === walletUrl)
        .reduce((t, d) => t + BigInt(d.monto.value), 0n);

    let saldo;
    if (reparto.conCuenta) {
        const total = ventas.reduce((t, pago) => t + parteDe(pago, reparto.vendedorWallet), 0n);
        saldo = { value: total.toString(), ...(await moneda(reparto.vendedorWallet)) };
    } else {
        saldo = (await retiros.saldo({ cedula: reparto.cedula })).saldo ?? { value: '0', ...(await moneda(custodia())) };
    }

    const monedaProveedor = await moneda(reparto.proveedorWallet);
    let pagado;
    if (reparto.deudaCobroId) {
        pagado = (await op.consultarCobro(reparto.deudaCobroId)).recibido.value;
    } else {
        pagado = ventas.reduce((t, pago) => t + parteDe(pago, reparto.proveedorWallet), 0n).toString();
    }

    return {
        id: reparto.id,
        qrId: reparto.qrId,
        vendedor: reparto.vendedor,
        conCuenta: reparto.conCuenta,
        porcentaje: reparto.porcentaje,
        saldo,
        // Sin cuenta: el PIN que ya se pidió y todavía no se cobra (el saldo lo sigue incluyendo hasta que se entrega).
        retiroPendiente: reparto.conCuenta ? null : retiros.retiroPendiente(reparto.cedula),
        ventas: ventas.length,
        ahorro: reparto.ahorroWallet
            ? {
                porcentaje: reparto.ahorroPorcentaje,
                wallet: reparto.ahorroWallet,
                acumulado: { value: ventas.reduce((t, pago) => t + parteDe(pago, reparto.ahorroWallet), 0n).toString(), ...(await moneda(reparto.ahorroWallet)) }
            }
            : null,
        proveedor: {
            pagado: { value: String(pagado), ...monedaProveedor },
            deuda: reparto.deuda ? { value: reparto.deuda, ...monedaProveedor } : null
        }
    };
}

// H7: sin cuenta, se cambia de cajita (la nueva primero, para no perder ventas) y se pide el retiro con PIN.
export async function retirar(id) {
    const reparto = store.obtenerReparto(id);
    if (!reparto) return { ok: false, error: 'Reparto no encontrado' };
    if (reparto.conCuenta) return { ok: false, error: 'Con cuenta el dinero ya está en tu wallet: no hace falta retirar' };

    const anterior = reparto.cajitaId;
    store.cambiarCajita(reparto.id, await nuevaCajita(reparto));
    try {
        await op.cerrarCobro(anterior);
    } catch (error) {
        console.warn(`No se pudo cerrar la cajita ${anterior}: ${error.message}`);
    }
    return retiros.solicitar({ cedula: reparto.cedula });
}
