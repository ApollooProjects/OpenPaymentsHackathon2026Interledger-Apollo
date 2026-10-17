import { randomBytes, randomUUID } from 'node:crypto';
import * as op from '../op/index.js';
import * as store from './store.js';
import * as pagosRapidos from './pagosRapidos.js';
import { mensajeParaUsuario } from './errores.js';

export const ESTADOS = {
    ESPERANDO: 'esperando_consentimiento',
    PROCESANDO: 'procesando',
    ENVIADO: 'enviado',
    COMPLETADO: 'completado',
    RECHAZADO: 'rechazado',
    FALLIDO: 'fallido'
};

const alCompletar = [];

export function onPagoCompletado(fn) {
    alCompletar.push(fn);
}

function urlPublica() {
    return (process.env.PUBLIC_URL || `http://localhost:${Number(process.env.PORT) || 3000}`).replace(/\/$/, '');
}

function sumar(destinos) {
    return destinos.reduce((total, destino) => total + BigInt(destino.monto.value), 0n);
}

export async function iniciarPago(plan) {
    if (!plan?.pagador) throw new Error('El plan necesita un pagador');
    if (!Array.isArray(plan.destinos) || plan.destinos.length === 0) throw new Error('El plan necesita al menos un destino');

    const pagoId = randomUUID();
    const pagador = await op.obtenerWallet(plan.pagador);

    const destinos = [];
    for (const destino of plan.destinos) {
        const wallet = await op.obtenerWallet(destino.walletUrl);
        const monto = { value: String(destino.monto.value), assetCode: wallet.assetCode, assetScale: wallet.assetScale };
        const cobroId = destino.cobroId ?? (await op.crearCobro({
            walletUrl: wallet.id,
            monto,
            metadata: { pagoId, destino: destino.nombre, ...destino.metadata }
        })).id;
        destinos.push({ ...destino, walletUrl: wallet.id, monto, cobroId, compartido: Boolean(destino.cobroId) });
    }

    const total = plan.cotizar
        ? destinos.reduce((suma, destino) => suma + BigInt(destino.debito.value), 0n)
        : sumar(destinos);
    const tope = { value: total.toString(), assetCode: pagador.assetCode, assetScale: pagador.assetScale };

    // Pagos rápidos (H5c): con permiso vigente y tope suficiente, la compra sale sin pantalla de consentimiento.
    const rapido = pagosRapidos.permisoUsable(plan.clienteId, pagador.id, tope.value);
    if (rapido) {
        store.crearPago({ id: pagoId, estado: ESTADOS.PROCESANDO, pagador: pagador.id, plan: { ...plan, destinos, tope, metodo: 'rapido' } });
        if (await pagarConPermisoGuardado(pagoId, rapido)) {
            const pago = await confirmar(pagoId, { intentos: 5 });
            return { pagoId, estado: pago.estado };
        }
        pagosRapidos.marcarVencido(plan.clienteId);
    }

    const clientNonce = randomBytes(16).toString('hex');
    const permiso = await op.pedirPermiso({
        walletUrl: pagador.id,
        tope,
        finishUri: `${urlPublica()}/op/finish?pago=${pagoId}`,
        nonce: clientNonce
    });

    const datosPago = { estado: ESTADOS.ESPERANDO, plan: { ...plan, destinos, tope, metodo: 'consentimiento' } };
    if (!store.obtenerPago(pagoId)) store.crearPago({ id: pagoId, pagador: pagador.id, ...datosPago });
    store.actualizarPago(pagoId, {
        ...datosPago,
        permiso: {
            continueUri: permiso.continueUri,
            continueToken: permiso.continueToken,
            interactNonce: permiso.interactNonce,
            clientNonce,
            authServer: pagador.authServer
        }
    });

    return { pagoId, redirectUrl: permiso.redirectUrl };
}

// Paga cada destino con el mismo token. Si renovar existe, un token vencido (401, o 403 "Inactive Token" del testnet) rota el token y reintenta ese destino.
// El error lleva cuántos destinos alcanzaron a pagarse, para saber si todavía se puede pedir consentimiento.
async function pagarDestinos(pago, token, renovar) {
    const destinos = [];
    for (const destino of pago.plan.destinos) {
        try {
            // Un cobro compartido (cajita, deuda del proveedor) recibe de muchas ventas: se anota cuánto tenía antes.
            const recibidoAntes = destino.compartido ? (await op.consultarCobro(destino.cobroId)).recibido.value : undefined;
            const pagarCon = (t) => (destino.quoteId
                ? op.pagarConCotizacion({ walletUrl: pago.pagador, token: t, quoteId: destino.quoteId })
                : op.pagar({ walletUrl: pago.pagador, token: t, cobroId: destino.cobroId, monto: destino.monto }));
            let saliente;
            try {
                saliente = await pagarCon(token);
            } catch (error) {
                if ((error.status !== 401 && error.status !== 403) || !renovar) throw error;
                token = await renovar();
                saliente = await pagarCon(token);
            }
            destinos.push({ ...destino, pagoOpId: saliente.id, recibidoAntes });
        } catch (error) {
            throw Object.assign(error, { pagados: destinos.length });
        }
    }
    return { destinos, token };
}

// Devuelve false si el permiso no sirvió antes de mover dinero: entonces se pide consentimiento normal.
async function pagarConPermisoGuardado(pagoId, rapido) {
    const pago = store.obtenerPago(pagoId);
    let { token, manageUrl } = rapido.datos;
    const renovar = async () => {
        ({ token, manageUrl } = await op.rotar({ token, manageUrl }));
        pagosRapidos.actualizarToken(rapido.clienteId, { token, manageUrl });
        return token;
    };
    try {
        const resultado = await pagarDestinos(pago, token, renovar);
        store.actualizarPago(pagoId, {
            estado: ESTADOS.ENVIADO,
            plan: { ...pago.plan, destinos: resultado.destinos },
            permiso: { token: resultado.token, manageUrl, rapido: true }
        });
        return true;
    } catch (error) {
        if (error.pagados === 0) return false;
        console.error(`Pago rápido ${pagoId}:`, error);
        store.actualizarPago(pagoId, { estado: ESTADOS.FALLIDO, error: mensajeParaUsuario(error, 'pago') });
        return true;
    }
}

export async function terminarPago({ pagoId, interactRef, hash, resultado }) {
    const pago = store.obtenerPago(pagoId);
    if (!pago) throw new Error(`Pago no encontrado: ${pagoId}`);
    if (pago.estado !== ESTADOS.ESPERANDO) return resumen(pago);

    if (!interactRef) {
        const error = resultado === 'grant_rejected' ? 'Rechazaste el pago en tu billetera' : 'Tu billetera no confirmó el pago';
        return resumen(store.actualizarPago(pagoId, { estado: ESTADOS.RECHAZADO, error }));
    }

    const { permiso } = pago;
    const hashValido = await op.verificarHash({
        clientNonce: permiso.clientNonce,
        interactNonce: permiso.interactNonce,
        interactRef,
        authServerUrl: permiso.authServer,
        hash
    });
    if (!hashValido) {
        return resumen(store.actualizarPago(pagoId, { estado: ESTADOS.FALLIDO, error: 'No pudimos verificar la respuesta de la billetera. Intenta de nuevo' }));
    }

    store.actualizarPago(pagoId, { estado: ESTADOS.PROCESANDO });
    try {
        const { token, manageUrl } = await op.continuarPermiso({
            continueUri: permiso.continueUri,
            continueToken: permiso.continueToken,
            interactRef
        });
        // El mismo token (con acción read) sirve después para saber si un pago saliente falló.
        store.actualizarPago(pagoId, { permiso: { ...permiso, token, manageUrl } });

        const { destinos } = await pagarDestinos(pago, token);
        store.actualizarPago(pagoId, { estado: ESTADOS.ENVIADO, plan: { ...pago.plan, destinos } });
    } catch (error) {
        console.error(`Pago ${pagoId}:`, error);
        return resumen(store.actualizarPago(pagoId, { estado: ESTADOS.FALLIDO, error: mensajeParaUsuario(error, 'pago') }));
    }

    return resumen(await confirmar(pagoId, { intentos: 5 }));
}

async function salienteFallido(pago, destino) {
    if (!destino.pagoOpId || !pago.permiso?.token) return false;
    try {
        const saliente = await op.consultarPago({ id: destino.pagoOpId, token: pago.permiso.token });
        return saliente.fallido;
    } catch {
        return false;
    }
}

// Los pagos salientes se liquidan un instante después de crearse: se confirma leyendo cada cobro.
// Si un cobro no se completa, se revisa el pago saliente: la wallet lo marca failed (p. ej. sin saldo).
export async function confirmar(pagoId, { intentos = 1 } = {}) {
    let pago = store.obtenerPago(pagoId);
    for (let i = 0; i < intentos && pago.estado === ESTADOS.ENVIADO; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 1000));
        const destinos = [];
        for (const destino of pago.plan.destinos) {
            const cobro = await op.consultarCobro(destino.cobroId);
            const llego = destino.compartido
                ? BigInt(cobro.recibido.value) - BigInt(destino.recibidoAntes ?? 0) >= BigInt(destino.monto.value)
                : cobro.completo;
            const fallido = !llego && (await salienteFallido(pago, destino));
            destinos.push({ ...destino, recibido: cobro.recibido, completo: llego, fallido });
        }
        const listo = destinos.every((d) => d.completo);
        const conFalla = destinos.filter((d) => d.fallido).map((d) => d.nombre);
        let estado = ESTADOS.ENVIADO;
        if (listo) estado = ESTADOS.COMPLETADO;
        else if (conFalla.length) estado = ESTADOS.FALLIDO;
        pago = store.actualizarPago(pagoId, {
            estado,
            plan: { ...pago.plan, destinos },
            ...(conFalla.length && {
                error: `La wallet de quien paga no pudo enviar el dinero a ${conFalla.join(', ')} (¿saldo insuficiente?)`
            })
        });
        if (listo) for (const fn of alCompletar) await fn(resumen(pago));
    }
    return pago;
}

export function resumen(pago) {
    return {
        pagoId: pago.id,
        estado: pago.estado,
        total: pago.plan.tope,
        // Prueba visible de Open Payments para el recibo: wallets, incoming payment de cada parte y outgoing que la pagó.
        pagador: pago.pagador ?? null,
        metodo: pago.plan.metodo ?? null,
        creado: pago.creado ?? null,
        destinos: pago.plan.destinos.map((d) => ({
            nombre: d.nombre,
            monto: d.monto,
            completo: d.completo ?? false,
            fallido: d.fallido ?? false,
            walletUrl: d.walletUrl ?? null,
            incomingPayment: d.cobroId ?? null,
            outgoingPayment: d.pagoOpId ?? null,
            quoteId: d.quoteId ?? null
        })),
        origen: pago.plan.origen ?? null,
        error: pago.error ?? null
    };
}
