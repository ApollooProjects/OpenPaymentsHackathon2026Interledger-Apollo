// Mismas funciones que el módulo op real, sin red. Se activa con OP_MOCK=1.
import { randomUUID } from 'node:crypto';

const BASE = 'https://mock.interledger-test.dev';
const MONEDA = { assetCode: 'COP', assetScale: 2 };
const cobros = new Map();

export async function obtenerWallet(walletUrl) {
    return {
        id: walletUrl,
        publicName: walletUrl.split('/').pop(),
        authServer: `${BASE}/auth`,
        resourceServer: `${BASE}/resources`,
        ...MONEDA
    };
}

export async function crearCobro({ walletUrl, monto, metadata = {}, expiresAt } = {}) {
    const id = `${BASE}/incoming-payments/${randomUUID()}`;
    cobros.set(id, {
        walletUrl,
        esperado: monto ? String(monto.value) : null,
        recibido: 0n,
        metadata,
        expiresAt: expiresAt ?? null,
        completo: false
    });
    return { id, walletUrl };
}

export async function listarCobros({ walletUrl, cedula } = {}) {
    return [...cobros.entries()]
        .filter(([, cobro]) => cobro.walletUrl === walletUrl)
        .filter(([, cobro]) => cedula === undefined || cobro.metadata?.cedula === cedula)
        .map(([id, cobro]) => ({
            id,
            recibido: { value: cobro.recibido.toString(), ...MONEDA },
            completo: cobro.completo,
            metadata: cobro.metadata
        }));
}

export async function rotar({ token, manageUrl }) {
    return { token: `mock-token-${randomUUID()}`, manageUrl: manageUrl ?? `${BASE}/token/${randomUUID()}` };
}

export async function consultarCobro(id) {
    const cobro = cobros.get(id);
    if (!cobro) throw new Error(`[mock] cobro no encontrado: ${id}`);
    return { id, recibido: { value: cobro.recibido.toString(), ...MONEDA }, completo: cobro.completo };
}

// Monto mágico para probar el camino de error: un pago de 13 (= $0,13) falla como si no hubiera saldo.
const MONTO_QUE_FALLA = '13';
const pagosSalientes = new Map();

export async function pagar({ walletUrl, token, cobroId, monto }) {
    const cobro = cobros.get(cobroId);
    if (!cobro) throw new Error(`[mock] cobro no encontrado: ${cobroId}`);
    if (!token) throw new Error('[mock] falta el token del permiso');
    const id = `${BASE}/outgoing-payments/${randomUUID()}`;
    const fallido = String(monto.value) === MONTO_QUE_FALLA;
    pagosSalientes.set(id, { fallido, valor: String(monto.value) });
    if (!fallido) {
        cobro.recibido += BigInt(monto.value);
        if (cobro.esperado !== null && cobro.recibido >= BigInt(cobro.esperado)) cobro.completo = true;
    }
    return { id, walletUrl };
}

export async function consultarPago({ id }) {
    const pago = pagosSalientes.get(id);
    if (!pago) throw new Error(`[mock] pago saliente no encontrado: ${id}`);
    return {
        id,
        fallido: pago.fallido,
        enviado: { value: pago.fallido ? '0' : pago.valor, ...MONEDA },
        debito: { value: pago.valor, ...MONEDA }
    };
}

// Simula la pantalla de consentimiento: redirige directo al finishUri como si el usuario hubiera aceptado.
export async function pedirPermiso({ walletUrl, tope, interval, finishUri, nonce }) {
    const redirect = new URL(finishUri);
    redirect.searchParams.set('interact_ref', `mock-ref-${randomUUID()}`);
    redirect.searchParams.set('hash', 'mock-hash');
    return {
        redirectUrl: redirect.toString(),
        continueUri: `${BASE}/continue/${randomUUID()}`,
        continueToken: 'mock-continue-token',
        interactNonce: 'mock-interact-nonce'
    };
}

export async function continuarPermiso({ continueUri, continueToken, interactRef }) {
    return { token: `mock-token-${randomUUID()}`, manageUrl: `${BASE}/token/${randomUUID()}` };
}

export function verificarHash() {
    return true;
}
