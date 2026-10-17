// H5c: el cliente autoriza una vez un tope semanal y después paga con un toque, sin pantalla de consentimiento.
// El permiso es un grant de outgoing-payment con limits.debitAmount (tope) + interval R/<inicio>/P1W, guardado por cliente.
import { randomBytes } from 'node:crypto';
import * as op from '../op/index.js';
import * as store from './store.js';
import { aWalletUrl, esWalletUrl } from './wallet.js';

const SEMANA_MS = 7 * 24 * 60 * 60 * 1000;

function urlPublica() {
    return (process.env.PUBLIC_URL || `http://localhost:${Number(process.env.PORT) || 3000}`).replace(/\/$/, '');
}

// finishPath: a dónde vuelve el consentimiento (la app producto usa el suyo; la demo, el de siempre).
export async function activar({ clienteId, pagador, tope, finishPath = '/op/finish-permiso' }) {
    if (!String(clienteId ?? '').trim()) throw new Error('Falta el clienteId');
    const walletUrl = aWalletUrl(pagador);
    if (!esWalletUrl(walletUrl)) throw new Error('Falta la billetera de quien paga');
    const valor = typeof tope === 'object' && tope !== null ? tope.value : tope;
    if (!/^\d+$/.test(String(valor ?? '')) || BigInt(valor) <= 0n) throw new Error('El tope debe ser un entero positivo en centavos');

    const wallet = await op.obtenerWallet(walletUrl);
    const inicio = new Date().toISOString();
    const clientNonce = randomBytes(16).toString('hex');
    const permiso = await op.pedirPermiso({
        walletUrl: wallet.id,
        tope: { value: String(valor) },
        interval: `R/${inicio}/P1W`,
        finishUri: `${urlPublica()}${finishPath}?cliente=${encodeURIComponent(clienteId)}`,
        nonce: clientNonce
    });

    store.guardarPagosRapidos({
        clienteId,
        wallet: wallet.id,
        tope: { value: String(valor), assetCode: wallet.assetCode, assetScale: wallet.assetScale },
        inicio,
        estado: 'pendiente',
        datos: {
            continueUri: permiso.continueUri,
            continueToken: permiso.continueToken,
            interactNonce: permiso.interactNonce,
            clientNonce,
            authServer: wallet.authServer
        }
    });
    return { redirectUrl: permiso.redirectUrl };
}

export async function terminarActivacion({ clienteId, interactRef, hash, resultado }) {
    const pendiente = store.obtenerPagosRapidos(clienteId);
    if (!pendiente || pendiente.estado !== 'pendiente') return pendiente?.estado ?? 'desconocido';
    const guardar = (estado, datos = pendiente.datos) => store.guardarPagosRapidos({ ...pendiente, estado, datos }).estado;

    if (!interactRef) return guardar(resultado === 'grant_rejected' ? 'rechazado' : 'fallido');

    const { datos } = pendiente;
    const hashValido = await op.verificarHash({
        clientNonce: datos.clientNonce,
        interactNonce: datos.interactNonce,
        interactRef,
        authServerUrl: datos.authServer,
        hash
    });
    if (!hashValido) return guardar('fallido');

    const permiso = await op.continuarPermiso({ continueUri: datos.continueUri, continueToken: datos.continueToken, interactRef });
    return guardar('activo', permiso);
}

// La semana corre desde el inicio del interval, igual que la cuenta que lleva la wallet.
function inicioDeSemana(inicio) {
    const semanas = Math.floor((Date.now() - Date.parse(inicio)) / SEMANA_MS);
    return new Date(Date.parse(inicio) + semanas * SEMANA_MS);
}

export function estado(clienteId) {
    const permiso = store.obtenerPagosRapidos(clienteId);
    if (!permiso) return { activo: false, estado: 'sin_permiso' };

    const desde = inicioDeSemana(permiso.inicio);
    const gastado = store.pagosRapidosDesde(clienteId, desde.toISOString())
        .reduce((total, pago) => total + BigInt(pago.plan.tope.value), 0n);
    const disponible = BigInt(permiso.tope.value) - gastado;
    const moneda = { assetCode: permiso.tope.assetCode, assetScale: permiso.tope.assetScale };

    return {
        activo: permiso.estado === 'activo',
        estado: permiso.estado,
        wallet: permiso.wallet,
        tope: permiso.tope,
        gastado: { value: gastado.toString(), ...moneda },
        disponible: { value: (disponible > 0n ? disponible : 0n).toString(), ...moneda },
        renueva: new Date(desde.getTime() + SEMANA_MS).toISOString()
    };
}

// El motor lo usa antes de pedir consentimiento: solo sirve si es de esta wallet y alcanza el tope de la semana.
export function permisoUsable(clienteId, pagadorWallet, total) {
    if (!clienteId) return null;
    const permiso = store.obtenerPagosRapidos(clienteId);
    if (!permiso || permiso.estado !== 'activo' || permiso.wallet !== pagadorWallet) return null;
    if (BigInt(estado(clienteId).disponible.value) < BigInt(total)) return null;
    return permiso;
}

export function actualizarToken(clienteId, { token, manageUrl }) {
    const permiso = store.obtenerPagosRapidos(clienteId);
    store.guardarPagosRapidos({ ...permiso, datos: { ...permiso.datos, token, manageUrl } });
}

export function marcarVencido(clienteId) {
    const permiso = store.obtenerPagosRapidos(clienteId);
    if (permiso?.estado === 'activo') store.guardarPagosRapidos({ ...permiso, estado: 'vencido' });
}

export async function cancelar(clienteId) {
    const permiso = store.obtenerPagosRapidos(clienteId);
    if (!permiso || permiso.estado === 'cancelado') return { ok: false, error: 'No hay pagos rápidos activos' };
    if (permiso.estado === 'activo') {
        try {
            await op.revocarPermiso({ continueUri: permiso.datos.continueUri, continueToken: permiso.datos.continueToken });
        } catch (error) {
            console.warn(`No se pudo revocar el grant de ${clienteId}: ${error.message}`);
        }
    }
    store.guardarPagosRapidos({ ...permiso, estado: 'cancelado' });
    return { ok: true };
}
