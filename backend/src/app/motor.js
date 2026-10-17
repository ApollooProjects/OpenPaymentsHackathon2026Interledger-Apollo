import { randomBytes, randomUUID } from 'node:crypto';
import * as op from '../op/index.js';
import * as store from './store.js';

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
        destinos.push({ ...destino, walletUrl: wallet.id, monto, cobroId });
    }

    const tope = { value: sumar(destinos).toString(), assetCode: pagador.assetCode, assetScale: pagador.assetScale };
    const clientNonce = randomBytes(16).toString('hex');
    const permiso = await op.pedirPermiso({
        walletUrl: pagador.id,
        tope,
        finishUri: `${urlPublica()}/op/finish?pago=${pagoId}`,
        nonce: clientNonce
    });

    store.crearPago({ id: pagoId, estado: ESTADOS.ESPERANDO, pagador: pagador.id, plan: { ...plan, destinos, tope } });
    store.actualizarPago(pagoId, {
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

export async function terminarPago({ pagoId, interactRef, hash, resultado }) {
    const pago = store.obtenerPago(pagoId);
    if (!pago) throw new Error(`Pago no encontrado: ${pagoId}`);
    if (pago.estado !== ESTADOS.ESPERANDO) return resumen(pago);

    if (!interactRef) {
        const error = resultado === 'grant_rejected' ? 'El cliente rechazó el pago' : 'La wallet no devolvió interact_ref';
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
        return resumen(store.actualizarPago(pagoId, { estado: ESTADOS.FALLIDO, error: 'El hash de la redirección no es válido' }));
    }

    store.actualizarPago(pagoId, { estado: ESTADOS.PROCESANDO });
    try {
        const { token } = await op.continuarPermiso({
            continueUri: permiso.continueUri,
            continueToken: permiso.continueToken,
            interactRef
        });

        const destinos = [];
        for (const destino of pago.plan.destinos) {
            const { id } = await op.pagar({ walletUrl: pago.pagador, token, cobroId: destino.cobroId, monto: destino.monto });
            destinos.push({ ...destino, pagoOpId: id });
        }
        store.actualizarPago(pagoId, { estado: ESTADOS.ENVIADO, plan: { ...pago.plan, destinos } });
    } catch (error) {
        return resumen(store.actualizarPago(pagoId, { estado: ESTADOS.FALLIDO, error: error.message }));
    }

    return resumen(await confirmar(pagoId, { intentos: 5 }));
}

// Los pagos salientes se liquidan un instante después de crearse: se confirma leyendo cada cobro.
export async function confirmar(pagoId, { intentos = 1 } = {}) {
    let pago = store.obtenerPago(pagoId);
    for (let i = 0; i < intentos && pago.estado === ESTADOS.ENVIADO; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 1000));
        const destinos = [];
        for (const destino of pago.plan.destinos) {
            const cobro = await op.consultarCobro(destino.cobroId);
            destinos.push({ ...destino, recibido: cobro.recibido, completo: cobro.completo });
        }
        const listo = destinos.every((d) => d.completo);
        pago = store.actualizarPago(pagoId, {
            estado: listo ? ESTADOS.COMPLETADO : ESTADOS.ENVIADO,
            plan: { ...pago.plan, destinos }
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
        destinos: pago.plan.destinos.map((d) => ({ nombre: d.nombre, monto: d.monto, completo: d.completo ?? false })),
        origen: pago.plan.origen ?? null,
        error: pago.error ?? null
    };
}
