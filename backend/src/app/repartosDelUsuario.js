// App producto: «Repartos automáticos» de quien tiene sesión. Por dentro es el reparto P1 de la demo:
//   Abonar a una deuda       → proveedor + porcentaje + deuda
//   Compartir con otras…     → meseros (el extra que agrega quien paga se divide entre ellas)
//   Apartar un ahorro        → ahorroWallet + ahorroPorcentaje
// Con billetera, su parte va a su wallet; en efectivo, a su cajita en la Custodia (a nombre de su cédula).
import * as op from '../op/index.js';
import * as store from './store.js';
import * as cuentas from './cuentas.js';
import { crearReparto } from './repartos.js';
import { crearQrPersonalizado } from './qr.js';
import { aWalletUrl, esWalletUrl } from './wallet.js';

const { ErrorCuenta } = cuentas;
const MAX_PERSONAS = 10;

function custodia() {
    if (!process.env.CUSTODIA_WALLET) throw new Error('Falta CUSTODIA_WALLET en el .env');
    return aWalletUrl(process.env.CUSTODIA_WALLET);
}

// --- Puras (con pruebas) ---

function porcentaje(valor, que) {
    const pct = Number(valor);
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) throw new ErrorCuenta(`El porcentaje ${que} debe ser un número entero entre 1 y 100`);
    return pct;
}

function wallet(valor, que) {
    const url = aWalletUrl(String(valor ?? '').trim());
    if (!esWalletUrl(url)) throw new ErrorCuenta(`Escribe la billetera ${que}. Ejemplo: $ilp.interledger-test.dev/ana`);
    return url;
}

function centavos(entrada, que) {
    const value = typeof entrada === 'object' && entrada !== null ? entrada.value : entrada;
    if (!/^\d+$/.test(String(value ?? '')) || BigInt(value) <= 0n) throw new ErrorCuenta(`${que} debe ser un entero positivo en centavos`);
    return String(value);
}

const presente = (valor) => valor !== undefined && valor !== null && valor !== false;

// Valida las reglas que escribe la persona y las deja limpias para guardar. destino = la wallet que recibe
// su parte (su billetera o la Custodia): ninguna regla puede mandar dinero ahí mismo.
export function leerReglas({ nombre, deuda, compartir, ahorro } = {}, { destino } = {}) {
    const limpio = String(nombre ?? '').trim().replace(/\s+/g, ' ');
    if (!limpio) throw new ErrorCuenta('Ponle un nombre al reparto');
    if (limpio.length > 60) throw new ErrorCuenta('El nombre es muy largo (máximo 60 letras)');

    const reglas = { deuda: null, compartir: null, ahorro: null };
    if (presente(deuda)) {
        reglas.deuda = {
            wallet: wallet(deuda.wallet, 'de a quién le debes'),
            porcentaje: porcentaje(deuda.porcentaje, 'de la deuda'),
            total: centavos(deuda.total, 'El total de la deuda')
        };
    }
    if (presente(compartir)) {
        const personas = Array.isArray(compartir.personas) ? compartir.personas.filter(Boolean) : [];
        if (personas.length === 0) throw new ErrorCuenta('Agrega al menos una persona para compartir');
        if (personas.length > MAX_PERSONAS) throw new ErrorCuenta(`Puedes compartir con máximo ${MAX_PERSONAS} personas`);
        const lista = personas.map((p, i) => {
            const persona = typeof p === 'string' ? { wallet: p } : p;
            const fila = {
                nombre: String(persona.nombre ?? '').trim().slice(0, 40) || `Persona ${i + 1}`,
                wallet: wallet(persona.wallet, `de la persona ${i + 1}`)
            };
            if (presente(persona.porcentaje) && persona.porcentaje !== '') fila.porcentaje = porcentaje(persona.porcentaje, `de la persona ${i + 1}`);
            return fila;
        });
        const conPorcentaje = lista.filter((p) => p.porcentaje !== undefined).length;
        if (conPorcentaje > 0 && conPorcentaje < lista.length) throw new ErrorCuenta('Si una persona tiene porcentaje, todas deben tenerlo');
        if (conPorcentaje > 0 && lista.reduce((t, p) => t + p.porcentaje, 0) !== 100) throw new ErrorCuenta('Los porcentajes de las personas deben sumar 100');
        if (new Set(lista.map((p) => p.wallet)).size !== lista.length) throw new ErrorCuenta('Hay una billetera repetida entre las personas');
        reglas.compartir = { personas: lista, modo: conPorcentaje > 0 ? 'porcentaje' : 'iguales' };
    }
    if (presente(ahorro)) {
        reglas.ahorro = { wallet: wallet(ahorro.wallet, 'del ahorro'), porcentaje: porcentaje(ahorro.porcentaje, 'del ahorro') };
    }
    if (!reglas.deuda && !reglas.compartir && !reglas.ahorro) throw new ErrorCuenta('Agrega al menos una regla: deuda, compartir o ahorro');

    if (destino) {
        if (reglas.deuda?.wallet === destino) throw new ErrorCuenta('La deuda tiene que ir a la billetera de otra persona');
        if (reglas.ahorro?.wallet === destino) throw new ErrorCuenta('El ahorro tiene que ir a otra billetera, no a la que recibe tus pagos');
        if (reglas.compartir?.personas.some((p) => p.wallet === destino)) throw new ErrorCuenta('No puedes compartir contigo mismo: quita tu billetera de la lista');
    }
    return { nombre: limpio, reglas };
}

// Las wallets de cada persona tal como las guarda el QR: textos (partes iguales) u objetos con porcentaje.
export function meserosDe(reglas) {
    return (reglas.compartir?.personas ?? []).map((p) => (p.porcentaje !== undefined ? { wallet: p.wallet, porcentaje: p.porcentaje } : p.wallet));
}

// Argumentos para crearReparto. Sin deuda, el «proveedor» es la misma wallet que recibe con 0 %:
// calcularReparto omite las partes en 0, así que nunca se le manda nada.
export function argumentosDeReparto({ nombre, reglas }, { vendedor, conCuenta, vendedorWallet, cedula, celular, destino }) {
    return {
        vendedor,
        conCuenta,
        ...(conCuenta ? { vendedorWallet } : { cedula, celular }),
        proveedorWallet: reglas.deuda?.wallet ?? destino,
        porcentaje: reglas.deuda?.porcentaje ?? 0,
        deuda: reglas.deuda?.total ?? null,
        meseros: meserosDe(reglas),
        ahorroWallet: reglas.ahorro?.wallet ?? null,
        ahorroPorcentaje: reglas.ahorro?.porcentaje ?? 0
    };
}

// Qué regla de un reparto le mandó dinero a una wallet (para «Lo que me llega por repartos»).
const REGLA_POR_ROL = { proveedor: 'deuda', mesero: 'compartir', ahorro: 'ahorro' };

export function rolDelDestino(destino, reparto) {
    if (destino.rol) return destino.rol;
    // Pagos anteriores a C5 no guardaban el rol: se deduce del nombre, igual que resumenReparto.
    if (destino.nombre === 'Proveedor') return 'proveedor';
    if (destino.nombre === 'Ahorro') return 'ahorro';
    return destino.nombre === reparto?.vendedor ? 'vendedor' : 'mesero';
}

export const reglaDelRol = (rol) => REGLA_POR_ROL[rol] ?? null;

// --- Con la base y Open Payments ---

function datosDelUsuario(usuario) {
    if (usuario.tipo === 'billetera') {
        return { conCuenta: true, vendedorWallet: usuario.wallet, destino: usuario.wallet };
    }
    if (usuario.tipo === 'efectivo') {
        return { conCuenta: false, cedula: usuario.cedula, celular: usuario.celular, destino: custodia() };
    }
    throw new ErrorCuenta('Primero elige cómo quieres recibir el dinero: billetera o efectivo');
}

// Cada wallet de las reglas existe y usa la moneda de la que recibe; si no, el pago fallaría al cobrar.
async function validarWallets(reglas, destino) {
    const moneda = await op.obtenerWallet(destino);
    const wallets = [
        reglas.deuda && { url: reglas.deuda.wallet, que: 'de la deuda' },
        reglas.ahorro && { url: reglas.ahorro.wallet, que: 'del ahorro' },
        ...(reglas.compartir?.personas ?? []).map((p) => ({ url: p.wallet, que: `de ${p.nombre}` }))
    ].filter(Boolean);
    for (const { url, que } of wallets) {
        let datos;
        try {
            datos = await op.obtenerWallet(url);
        } catch {
            throw new ErrorCuenta(`No encontramos la billetera ${que}: ${url}`);
        }
        if (datos.assetCode !== moneda.assetCode) {
            throw new ErrorCuenta(`La billetera ${que} está en ${datos.assetCode} y tus pagos llegan en ${moneda.assetCode}`);
        }
    }
    return moneda;
}

export async function crear(usuario, cuerpo) {
    const datos = datosDelUsuario(usuario);
    const { nombre, reglas } = leerReglas(cuerpo, { destino: datos.destino });
    await validarWallets(reglas, datos.destino);
    const vendedor = usuario.nombre || `Celular ${cuentas.ocultarCelular(usuario.celular)}`;
    let creado;
    try {
        creado = await crearReparto(argumentosDeReparto({ nombre, reglas }, { ...datos, vendedor }));
    } catch (error) {
        console.error('POST /yo/repartos:', error);
        throw new ErrorCuenta(/Open Payments|fetch failed/.test(error.message)
            ? 'No pudimos crear el reparto en este momento. Revisa las billeteras e intenta de nuevo'
            : error.message);
    }
    cuentas.ligarReparto({ usuarioId: usuario.id, repartoId: creado.id, nombre, reglas });
    return creado.id;
}

const monedaDe = async (url, cache) => {
    if (!cache.has(url)) cache.set(url, op.obtenerWallet(url).then((w) => ({ assetCode: w.assetCode, assetScale: w.assetScale })));
    return cache.get(url);
};

// Lo que muestra la app de cada reparto. recibido = lo que pagaron en total por este reparto (todas las partes);
// paraTi = lo que te quedó; ventas = pagos completados. La deuda se consulta en el testnet (su incoming payment).
export async function resumen(ligado, { enlace, cache = new Map() }) {
    const reparto = store.obtenerReparto(ligado.repartoId);
    if (!reparto) return null;
    const qrEstatico = store.obtenerQr(reparto.qrId);
    const moneda = await monedaDe(qrEstatico.walletUrl, cache);

    const ventas = store.pagosDelReparto(reparto.id).filter((pago) => pago.estado === 'completado');
    let recibido = 0n;
    let paraTi = 0n;
    for (const pago of ventas) {
        for (const destino of pago.plan.destinos) {
            recibido += BigInt(destino.monto.value);
            if (rolDelDestino(destino, reparto) === 'vendedor') paraTi += BigInt(destino.monto.value);
        }
    }

    const { reglas } = ligado;
    let deuda = null;
    if (reglas.deuda) {
        const monedaDeuda = await monedaDe(reglas.deuda.wallet, cache);
        let pagado = 0n;
        if (reparto.deudaCobroId) {
            try {
                pagado = BigInt((await op.consultarCobro(reparto.deudaCobroId)).recibido.value);
            } catch (error) {
                console.error(`No se pudo consultar la deuda del reparto ${reparto.id}: ${error.message}`);
                pagado = null;
            }
        }
        const total = BigInt(reglas.deuda.total);
        deuda = {
            wallet: reglas.deuda.wallet,
            porcentaje: reglas.deuda.porcentaje,
            total: { value: total.toString(), ...monedaDeuda },
            // null si el testnet no respondió: la app muestra el total sin el avance.
            pagado: pagado === null ? null : { value: pagado.toString(), ...monedaDeuda },
            falta: pagado === null ? null : { value: (total > pagado ? total - pagado : 0n).toString(), ...monedaDeuda }
        };
    }

    return {
        id: reparto.id,
        nombre: ligado.nombre,
        qr: { id: reparto.qrId, enlace: enlace(reparto.qrId) },
        reglas: { deuda, compartir: reglas.compartir, ahorro: reglas.ahorro },
        recibido: { value: recibido.toString(), ...moneda },
        paraTi: { value: paraTi.toString(), ...moneda },
        ventas: ventas.length,
        creado: ligado.creado
    };
}

export async function crearQr(usuario, repartoId, { monto, detalle, compartir } = {}) {
    const ligado = cuentas.repartoDelUsuario(usuario.id, repartoId);
    if (!ligado) throw new ErrorCuenta('No encontramos ese reparto', 404);
    const reparto = store.obtenerReparto(repartoId);
    const valor = presente(monto) && monto !== '' ? centavos(monto, 'El monto') : null;
    // Por defecto el QR comparte si el reparto tiene personas; compartir: false lo quita para este QR.
    const conCompartir = compartir !== false && Boolean(ligado.reglas.compartir);
    let creado;
    try {
        creado = await crearQrPersonalizado({
            repartoId,
            monto: valor,
            descripcion: String(detalle ?? '').trim().slice(0, 80) || null,
            meseros: conCompartir ? meserosDe(ligado.reglas) : []
        });
    } catch (error) {
        throw new ErrorCuenta(error.message);
    }
    const moneda = valor ? await op.obtenerWallet(store.obtenerQr(reparto.qrId).walletUrl) : null;
    return {
        id: creado.qrId,
        monto: valor ? { value: valor, assetCode: moneda.assetCode, assetScale: moneda.assetScale } : null,
        compartir: conCompartir
    };
}

// Lo que le llegó a la wallet del usuario como deuda, compartido o ahorro de repartos (de otros o de la demo).
export function recibidoPorRepartos(usuario) {
    if (usuario.tipo !== 'billetera' || !usuario.wallet) return { movimientos: [], total: null };
    const wallet = usuario.wallet;
    const movimientos = [];
    let total = null;
    for (const pago of store.pagosHacia(wallet).filter((p) => p.estado === 'completado')) {
        const reparto = pago.plan.origen?.qrId ? store.repartoDelQr(pago.plan.origen.qrId) : null;
        if (!reparto) continue;
        const de = cuentas.nombreDeReparto(reparto.id) ?? reparto.vendedor;
        for (const destino of pago.plan.destinos.filter((d) => d.walletUrl === wallet)) {
            const regla = reglaDelRol(rolDelDestino(destino, reparto));
            if (!regla) continue;
            // El cobro de la deuda es compartido entre ventas: su `recibido` es el acumulado, no lo de este pago.
            const monto = destino.compartido ? destino.monto : (destino.recibido ?? destino.monto);
            movimientos.push({
                id: `${pago.id}:${regla}`,
                fecha: pago.creado,
                monto,
                de,
                persona: reparto.vendedor,
                regla,
                comprobante: destino.pagoOpId ?? destino.cobroId ?? null
            });
            total = { ...monto, value: (BigInt(total?.value ?? 0) + BigInt(monto.value)).toString() };
        }
    }
    movimientos.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    return { movimientos, total };
}
