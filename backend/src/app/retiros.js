import { randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import * as op from '../op/index.js';
import * as store from './store.js';
import { mensajeParaUsuario } from './errores.js';

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

// "el sáb., 18 de oct. a las 11:55 p. m." en hora de Colombia.
export function horaLocal(iso) {
    const fecha = new Date(iso);
    const dia = fecha.toLocaleDateString('es-CO', { timeZone: 'America/Bogota', weekday: 'short', day: 'numeric', month: 'short' });
    const hora = fecha.toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit' });
    return `el ${dia} a las ${hora}`;
}

// PIN vigente de esa cédula (para avisarle cuando llega más dinero y para el panel del vendedor).
export function retiroPendiente(cedula) {
    const activo = store.retirosDe(soloDigitos(cedula))
        .filter((r) => r.estado === 'activo' && new Date(r.vence) > new Date())
        .pop();
    return activo ? { monto: activo.monto, vence: activo.vence } : null;
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
    let propios = cobros.filter((cobro) => {
        const meta = cobro.metadata ?? {};
        if (buscada) return soloDigitos(meta.cedula) === buscada;
        return celularBuscado && soloDigitos(meta.celular) === celularBuscado;
    });
    if (propios.length === 0) return null;
    // Por SMS solo se conoce el celular, y un celular puede tener cobros de varias cédulas:
    // se usa la cédula del cobro más reciente y solo sus cobros, para no sumar dinero de otra persona.
    if (!buscada) {
        const reciente = propios.reduce((a, b) => (String(b.creado ?? '') > String(a.creado ?? '') ? b : a));
        const elegida = soloDigitos(reciente.metadata?.cedula);
        propios = cobros.filter((cobro) => soloDigitos(cobro.metadata?.cedula) === elegida);
    }
    const meta = propios.find((c) => c.metadata?.celular)?.metadata ?? propios[0].metadata;
    return { cedula: soloDigitos(meta.cedula), celular: celularBuscado || meta.celular || null, cobros: propios };
}

// Lo retirado se cuenta en el testnet (cobros del Corresponsal con esa cédula), igual que lo recibido en la Custodia:
// así el saldo es el mismo en cualquier máquina que corra el backend, aunque cada una tenga su propia base local.
// Se suman también los retiros locales entregados o en camino cuyo dinero no aparece ahí (en camino, o retiros
// anteriores a guardar la cédula en el cobro del Corresponsal).
async function retirado(cedula) {
    const { corresponsal } = wallets();
    const cobros = await op.listarCobros({ walletUrl: corresponsal, cedula });
    const recibidoPorCobro = new Map(cobros.map((cobro) => [cobro.id, BigInt(cobro.recibido.value)]));
    const enTestnet = [...recibidoPorCobro.values()].reduce((total, valor) => total + valor, 0n);
    const soloLocal = store.retirosDe(cedula)
        .filter((r) => (r.estado === 'entregado' || r.estado === 'pagando') && !recibidoPorCobro.get(r.cobroId))
        .reduce((total, r) => total + BigInt(r.monto.value), 0n);
    return enTestnet + soloLocal;
}

async function calcularSaldo(persona) {
    const { custodia } = wallets();
    const wallet = await op.obtenerWallet(custodia);
    const recibido = persona.cobros.reduce((total, cobro) => total + BigInt(cobro.recibido.value), 0n);
    const disponible = recibido - (await retirado(persona.cedula));
    return { value: (disponible > 0n ? disponible : 0n).toString(), assetCode: wallet.assetCode, assetScale: wallet.assetScale };
}

export async function saldo({ cedula, celular }) {
    const persona = await identificar({ cedula, celular });
    if (!persona) return { ok: false, error: 'No hay dinero a tu nombre' };
    return { ok: true, cedula: persona.cedula, saldo: await calcularSaldo(persona) };
}

// Las solicitudes van en fila: dos RETIRAR casi al mismo tiempo (botón + SMS) no pueden dejar dos PIN activos.
let fila = Promise.resolve();

export function solicitar(datos) {
    const turno = fila.then(() => solicitarAhora(datos));
    fila = turno.catch(() => {});
    return turno;
}

async function solicitarAhora({ cedula, celular }) {
    const persona = await identificar({ cedula, celular });
    if (!persona) return { ok: false, error: 'No hay dinero a tu nombre' };

    // Un PIN nuevo reemplaza al anterior que no se haya usado: siempre se retira el saldo total.
    let reemplazo = false;
    for (const anterior of store.retirosDe(persona.cedula)) {
        if (anterior.estado === 'activo' && store.cambiarEstadoRetiro(anterior.id, 'activo', 'anulado')) reemplazo = true;
    }

    const monto = await calcularSaldo(persona);
    if (BigInt(monto.value) === 0n) {
        await enviarSms(persona.celular, 'La Cajita: no tienes saldo para retirar. Te avisaremos por SMS cuando te llegue dinero.');
        return { ok: false, error: 'No tienes saldo para retirar' };
    }

    const { corresponsal } = wallets();
    const retiroId = randomUUID();
    const vence = new Date(Date.now() + VIGENCIA_MS).toISOString();
    const cobro = await op.crearCobro({
        walletUrl: corresponsal,
        monto: { value: monto.value },
        expiresAt: vence,
        metadata: { retiroId, cedula: persona.cedula }
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
        // .replace: la hora termina en "p. m." y no debe quedar ".." antes de la frase siguiente.
        `La Cajita: retira ${formatear(monto)} (todo tu saldo) en cualquier corresponsal con el PIN ${pin} y tu cédula `
            + `(termina en ${persona.cedula.slice(-4)}). Vence ${horaLocal(vence)}.${reemplazo ? ' Tu PIN anterior ya no sirve.' : ''}`.replace('..', '.')
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
        if (error.status !== 401 && error.status !== 403) throw error;
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

const YA_NO_SIRVE = {
    vencido: 'Este PIN venció. Tu dinero sigue a tu nombre: responde RETIRAR por SMS para pedir uno nuevo',
    anulado: 'Este PIN se reemplazó por uno más reciente: usa el último PIN que te llegó por SMS',
    entregado: 'Este PIN ya se usó: el dinero ya se entregó'
};

export async function validar({ pin, cedula }) {
    const retiro = store.retirosDe(soloDigitos(cedula)).find((r) => pinCorrecto(pin, r));
    if (!retiro) return { ok: false, error: 'PIN o cédula incorrectos' };
    if (YA_NO_SIRVE[retiro.estado]) return { ok: false, error: YA_NO_SIRVE[retiro.estado] };

    if (retiro.estado === 'activo') {
        if (new Date(retiro.vence) < new Date()) {
            store.cambiarEstadoRetiro(retiro.id, 'activo', 'vencido');
            return { ok: false, error: YA_NO_SIRVE.vencido };
        }
        // El saldo se revisa otra vez: un PIN nunca puede sacar más de lo que hay a nombre de esa cédula.
        const persona = await identificar({ cedula: retiro.cedula });
        const disponible = persona ? BigInt((await calcularSaldo(persona)).value) : 0n;
        if (disponible < BigInt(retiro.monto.value)) {
            store.cambiarEstadoRetiro(retiro.id, 'activo', 'anulado');
            return { ok: false, error: 'Este PIN ya no es válido: responde RETIRAR por SMS para pedir uno nuevo' };
        }
        if (!store.cambiarEstadoRetiro(retiro.id, 'activo', 'pagando')) {
            return { ok: false, error: 'Este retiro ya se está procesando' };
        }
        const { custodia } = wallets();
        try {
            const { id } = await pagarConPermiso({ custodia, retiro });
            store.cambiarEstadoRetiro(retiro.id, 'pagando', 'pagando', { pagoOpId: id });
        } catch (error) {
            console.error(`Retiro ${retiro.id}:`, error);
            store.cambiarEstadoRetiro(retiro.id, 'pagando', 'activo', { error: error.message });
            return { ok: false, error: mensajeParaUsuario(error, 'retiro') };
        }
    }

    const actual = store.obtenerRetiro(retiro.id);
    const resultado = await esperarEntrega(actual);
    if (resultado === 'entregado') {
        store.cambiarEstadoRetiro(retiro.id, 'pagando', 'entregado');
        await enviarSms(retiro.celular, `La Cajita: retiraste ${formatear(retiro.monto)} en efectivo. Gracias por usar La Cajita.`);
        // Comprobante para el cajero: el pago real de Open Payments Custodia → Corresponsal.
        return {
            ok: true,
            estado: 'entregado',
            monto: retiro.monto,
            incomingPayment: actual.cobroId,
            outgoingPayment: actual.pagoOpId ?? null
        };
    }
    if (resultado === 'fallido') {
        store.cambiarEstadoRetiro(retiro.id, 'pagando', 'activo', { error: 'La Custodia no pudo pagar el retiro' });
        return { ok: false, error: 'La Custodia no pudo pagar el retiro. Intenta de nuevo en un momento' };
    }
    return { ok: false, estado: 'procesando', error: 'El pago al corresponsal sigue en proceso: vuelve a validar en unos segundos' };
}
