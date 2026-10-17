// Mismas funciones que el módulo op real, sin red. Se activa con OP_MOCK=1.
import { randomUUID } from 'node:crypto';

const BASE = 'https://mock.interledger-test.dev';
const MONEDA = { assetCode: 'COP', assetScale: 2 };
const EUR = { assetCode: 'EUR', assetScale: 2 };
const cobros = new Map();

// Como en la demo, las wallets "remitente" están en EUR; las demás en COP.
const monedaDe = (walletUrl) => (String(walletUrl).includes('remitente') ? EUR : MONEDA);

export async function obtenerWallet(walletUrl) {
    return {
        id: walletUrl,
        publicName: walletUrl.split('/').pop(),
        authServer: `${BASE}/auth`,
        resourceServer: `${BASE}/resources`,
        ...monedaDe(walletUrl)
    };
}

// Tasa de prueba: 1 EUR = 4.500 COP, menos 1 % de comisión (ambas monedas con assetScale 2).
const COP_POR_EUR = 4500n;
const quotes = new Map();

export async function cotizar({ walletUrl, cobroId, debito, recibe }) {
    const cobro = cobros.get(cobroId);
    if (!cobro) throw new Error(`[mock] cobro no encontrado: ${cobroId}`);
    const origen = monedaDe(walletUrl);
    const tasa = origen.assetCode === 'EUR' ? COP_POR_EUR : 1n;
    let debitado;
    let recibido;
    if (debito) {
        debitado = BigInt(debito.value);
        recibido = (debitado * tasa * 99n) / 100n;
    } else if (recibe) {
        recibido = BigInt(recibe.value);
        debitado = (recibido * 100n + tasa * 99n - 1n) / (tasa * 99n);
    } else {
        if (cobro.esperado === null) throw new Error('[mock] sin debito, el cobro necesita monto fijo');
        recibido = BigInt(cobro.esperado) - cobro.recibido;
        debitado = (recibido * 100n + tasa * 99n - 1n) / (tasa * 99n);
    }
    const quoteId = `${BASE}/quotes/${randomUUID()}`;
    quotes.set(quoteId, { cobroId, recibido });
    return {
        quoteId,
        debito: { value: debitado.toString(), ...origen },
        recibe: { value: recibido.toString(), ...MONEDA },
        vence: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    };
}

export async function pagarConCotizacion({ walletUrl, token, quoteId }) {
    const quote = quotes.get(quoteId);
    if (!quote) throw new Error(`[mock] quote no encontrada: ${quoteId}`);
    if (!token) throw new Error('[mock] falta el token del permiso');
    const cobro = cobros.get(quote.cobroId);
    cobro.recibido += quote.recibido;
    if (cobro.esperado !== null && cobro.recibido >= BigInt(cobro.esperado)) cobro.completo = true;
    return { id: `${BASE}/outgoing-payments/${randomUUID()}` };
}

export async function crearCobro({ walletUrl, monto, metadata = {}, expiresAt } = {}) {
    const id = `${BASE}/incoming-payments/${randomUUID()}`;
    cobros.set(id, {
        walletUrl,
        esperado: monto ? String(monto.value) : null,
        recibido: 0n,
        metadata,
        expiresAt: expiresAt ?? null,
        creado: new Date().toISOString(),
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
            creado: cobro.creado,
            metadata: cobro.metadata
        }));
}

export async function rotar({ token, manageUrl }) {
    if (tokensRevocados.has(token)) throw Object.assign(new Error('[mock] token revocado'), { status: 401 });
    return { token: `mock-token-${randomUUID()}`, manageUrl: manageUrl ?? `${BASE}/token/${randomUUID()}` };
}

export async function cerrarCobro(id) {
    const cobro = cobros.get(id);
    if (!cobro) throw new Error(`[mock] cobro no encontrado: ${id}`);
    cobro.completo = true;
}

export async function consultarCobro(id) {
    const cobro = cobros.get(id);
    if (!cobro) throw new Error(`[mock] cobro no encontrado: ${id}`);
    return { id, recibido: { value: cobro.recibido.toString(), ...MONEDA }, completo: cobro.completo };
}

// Monto mágico para probar el camino de error: un pago de 13 (= $0,13) falla como si no hubiera saldo.
const MONTO_QUE_FALLA = '13';
const pagosSalientes = new Map();

// Tokens de prueba: los que empiezan por "mock-vencido" responden 401 (hay que rotar); los revocados, 401 siempre.
const tokensRevocados = new Set();
const tokenDelGrant = new Map();

function errorHttp(status, mensaje) {
    return Object.assign(new Error(mensaje), { status });
}

export async function pagar({ walletUrl, token, cobroId, monto }) {
    const cobro = cobros.get(cobroId);
    if (!cobro) throw new Error(`[mock] cobro no encontrado: ${cobroId}`);
    if (!token) throw new Error('[mock] falta el token del permiso');
    if (token.startsWith('mock-vencido') || tokensRevocados.has(token)) throw errorHttp(401, '[mock] token inválido');
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
    const token = `mock-token-${randomUUID()}`;
    tokenDelGrant.set(continueUri, token);
    return { token, manageUrl: `${BASE}/token/${randomUUID()}`, continueUri, continueToken };
}

export async function revocarPermiso({ continueUri }) {
    const token = tokenDelGrant.get(continueUri);
    if (token) tokensRevocados.add(token);
}

export function verificarHash() {
    return true;
}
