import { randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import * as op from '../op/index.js';
import * as store from './store.js';

const VIGENCIA_MS = 24 * 60 * 60 * 1000;
const PERMISO_CUSTODIA = 'custodia';

let enviarSms = async (celular, texto) => console.log(`[SMS → ${celular ?? 'sin celular'}] ${texto}`);

// C2.1 conecta aquí el envío real a la bandeja: retiros.usarSms(sms.enviar).
export function usarSms(fn) {
    enviarSms = fn;
}

function wallets() {
    const custodia = process.env.CUSTODIA_WALLET;
    const corresponsal = process.env.CORRESPONSAL_WALLET;
    if (!custodia || !corresponsal) throw new Error('Faltan CUSTODIA_WALLET o CORRESPONSAL_WALLET en el .env');
    return { custodia, corresponsal };
}

const soloDigitos = (texto) => String(texto ?? '').replace(/\D/g, '');

function cifrarPin(pin, sal) {
    return scryptSync(soloDigitos(pin), sal, 32).toString('hex');
}

function pinCorrecto(pin, retiro) {
    const intento = Buffer.from(cifrarPin(pin, retiro.pinSal), 'hex');
    const guardado = Buffer.from(retiro.pinHash, 'hex');
    return intento.length === guardado.length && timingSafeEqual(intento, guardado);
}

export function formatear(monto) {
    return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: monto.assetCode,
        maximumFractionDigits: monto.assetCode === 'COP' ? 0 : 2
    }).format(Number(monto.value) / 10 ** monto.assetScale);
}

// Quien no tiene cuenta existe solo como metadata (cédula, celular) de los cobros en la Custodia.
async function identificar({ cedula, celular }) {
    const { custodia } = wallets();
    const buscada = soloDigitos(cedula);
    const celularBuscado = soloDigitos(celular);
    const cobros = await op.listarCobros({ walletUrl: custodia });
    const propios = cobros.filter((cobro) => {
        const meta = cobro.metadata ?? {};
        if (buscada) return soloDigitos(meta.cedula) === buscada;
        return celularBuscado && soloDigitos(meta.celular) === celularBuscado;
    });
    if (propios.length === 0) return null;
    const meta = propios.find((c) => c.metadata?.celular)?.metadata ?? propios[0].metadata;
    return { cedula: soloDigitos(meta.cedula), celular: meta.celular ?? celular ?? null, cobros: propios };
}

function retirado(cedula) {
    return store.retirosDe(cedula)
        .filter((r) => r.estado === 'entregado' || r.estado === 'pagando')
        .reduce((total, r) => total + BigInt(r.monto.value), 0n);
}

async function calcularSaldo(persona) {
    const { custodia } = wallets();
    const wallet = await op.obtenerWallet(custodia);
    const recibido = persona.cobros.reduce((total, cobro) => total + BigInt(cobro.recibido.value), 0n);
    const disponible = recibido - retirado(persona.cedula);
    return { value: (disponible > 0n ? disponible : 0n).toString(), assetCode: wallet.assetCode, assetScale: wallet.assetScale };
}

export async function saldo({ cedula, celular }) {
    const persona = await identificar({ cedula, celular });
    if (!persona) return { ok: false, error: 'No hay dinero a tu nombre' };
    return { ok: true, cedula: persona.cedula, saldo: await calcularSaldo(persona) };
}

export async function solicitar({ cedula, celular }) {
    const persona = await identificar({ cedula, celular });
    if (!persona) return { ok: false, error: 'No hay dinero a tu nombre' };

    // Un PIN nuevo reemplaza al anterior que no se haya usado: siempre se retira el saldo total.
    for (const anterior of store.retirosDe(persona.cedula)) {
        if (anterior.estado === 'activo') store.cambiarEstadoRetiro(anterior.id, 'activo', 'anulado');
    }

    const monto = await calcularSaldo(persona);
    if (BigInt(monto.value) === 0n) {
        await enviarSms(persona.celular, 'No tienes saldo para retirar.');
        return { ok: false, error: 'No tienes saldo para retirar' };
    }

    const { corresponsal } = wallets();
    const retiroId = randomUUID();
    const vence = new Date(Date.now() + VIGENCIA_MS).toISOString();
    const cobro = await op.crearCobro({
        walletUrl: corresponsal,
        monto: { value: monto.value },
        expiresAt: vence,
        metadata: { retiroId }
    });

    const digitos = String(randomInt(0, 100_000_000)).padStart(8, '0');
    const pin = `${digitos.slice(0, 4)}-${digitos.slice(4)}`;
    const pinSal = randomBytes(16).toString('hex');
    store.crearRetiro({
        id: retiroId,
        cedula: persona.cedula,
        celular: persona.celular,
        monto,
        cobroId: cobro.id,
        pinHash: cifrarPin(pin, pinSal),
        pinSal,
        vence,
        estado: 'activo'
    });

    await enviarSms(
        persona.celular,
        `Retira ${formatear(monto)} en cualquier corresponsal con el PIN ${pin} y tu cédula. Vence en 24 h.`
    );
    return { ok: true, retiroId, monto, vence };
}

async function pagarConPermiso({ custodia, retiro }) {
    let permiso = store.obtenerPermiso(PERMISO_CUSTODIA);
    if (!permiso) throw new Error('Falta el permiso de retiros de la Custodia (se pide una vez con el script de C2.2)');
    const pago = { walletUrl: custodia, cobroId: retiro.cobroId, monto: { value: retiro.monto.value } };
    try {
        return await op.pagar({ ...pago, token: permiso.token });
    } catch (error) {
        if (error.status !== 401) throw error;
        permiso = await op.rotar(permiso);
        store.guardarPermiso(PERMISO_CUSTODIA, permiso);
        return op.pagar({ ...pago, token: permiso.token });
    }
}

async function esperarEntrega(retiro) {
    for (let intento = 0; intento < 5; intento++) {
        if (intento > 0) await new Promise((r) => setTimeout(r, 1000));
        const cobro = await op.consultarCobro(retiro.cobroId);
        if (cobro.completo) return 'entregado';
    }
    const permiso = store.obtenerPermiso(PERMISO_CUSTODIA);
    if (retiro.pagoOpId && permiso) {
        const saliente = await op.consultarPago({ id: retiro.pagoOpId, token: permiso.token }).catch(() => null);
        if (saliente?.fallido) return 'fallido';
    }
    return 'pagando';
}

export async function validar({ pin, cedula }) {
    const retiro = store.retirosDe(soloDigitos(cedula))
        .filter((r) => r.estado === 'activo' || r.estado === 'pagando')
        .find((r) => pinCorrecto(pin, r));
    if (!retiro) return { ok: false, error: 'PIN o cédula incorrectos' };

    if (retiro.estado === 'activo') {
        if (new Date(retiro.vence) < new Date()) {
            store.cambiarEstadoRetiro(retiro.id, 'activo', 'vencido');
            return { ok: false, error: 'El PIN venció. Responde RETIRAR por SMS para pedir uno nuevo' };
        }
        if (!store.cambiarEstadoRetiro(retiro.id, 'activo', 'pagando')) {
            return { ok: false, error: 'Este retiro ya se está procesando' };
        }
        const { custodia } = wallets();
        try {
            const { id } = await pagarConPermiso({ custodia, retiro });
            store.cambiarEstadoRetiro(retiro.id, 'pagando', 'pagando', { pagoOpId: id });
        } catch (error) {
            store.cambiarEstadoRetiro(retiro.id, 'pagando', 'activo', { error: error.message });
            return { ok: false, error: `No se pudo pagar el retiro: ${error.message}` };
        }
    }

    const resultado = await esperarEntrega(store.obtenerRetiro(retiro.id));
    if (resultado === 'entregado') {
        store.cambiarEstadoRetiro(retiro.id, 'pagando', 'entregado');
        await enviarSms(retiro.celular, `Retiraste ${formatear(retiro.monto)}. Gracias por usar La Cajita.`);
        return { ok: true, estado: 'entregado', monto: retiro.monto };
    }
    if (resultado === 'fallido') {
        store.cambiarEstadoRetiro(retiro.id, 'pagando', 'activo', { error: 'La Custodia no pudo pagar el retiro' });
        return { ok: false, error: 'La Custodia no pudo pagar el retiro. Intenta de nuevo en un momento' };
    }
    return { ok: false, estado: 'procesando', error: 'El pago al corresponsal sigue en proceso: vuelve a validar en unos segundos' };
}
