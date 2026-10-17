import { isFinalizedGrantWithAccessToken } from '@interledger/open-payments';
import { obtenerCliente, obtenerWallet, montoDeWallet } from './client.js';

// El grant de quote no es interactivo; se reutiliza por servidor de autorización hasta poco antes de vencer.
const grants = new Map();

async function tokenQuote(authServer) {
    const guardado = grants.get(authServer);
    if (guardado && guardado.vence > Date.now()) return guardado.token;

    const op = await obtenerCliente();
    const grant = await op.grant.request(
        { url: authServer },
        { access_token: { access: [{ type: 'quote', actions: ['create', 'read'] }] } }
    );
    if (!isFinalizedGrantWithAccessToken(grant)) throw new Error('El grant de quote no quedó finalizado');

    const segundos = grant.access_token.expires_in ?? 600;
    grants.set(authServer, { token: grant.access_token.value, vence: Date.now() + (segundos - 30) * 1000 });
    return grant.access_token.value;
}

// Cuánto se le debita a quien paga (en su moneda) y cuánto recibe el cobro (en la moneda del cobro).
// Con debito: "envío X" (debitAmount). Con recibe: "que reciba exactamente Y" (receiveAmount, en la moneda del cobro).
// Sin ninguno, el cobro debe tener monto fijo y la quote cubre lo que le falta.
export async function cotizar({ walletUrl, cobroId, debito, recibe }) {
    const wallet = await obtenerWallet(walletUrl);
    const op = await obtenerCliente();
    const quote = await op.quote.create(
        { url: wallet.resourceServer, accessToken: await tokenQuote(wallet.authServer) },
        {
            walletAddress: wallet.id,
            receiver: cobroId,
            method: 'ilp',
            ...(debito && { debitAmount: montoDeWallet(wallet, debito) }),
            ...(recibe && { receiveAmount: { value: String(recibe.value), assetCode: recibe.assetCode, assetScale: recibe.assetScale } })
        }
    );
    return { quoteId: quote.id, debito: quote.debitAmount, recibe: quote.receiveAmount, vence: quote.expiresAt ?? null };
}

export async function pagarConCotizacion({ walletUrl, token, quoteId }) {
    const wallet = await obtenerWallet(walletUrl);
    const op = await obtenerCliente();
    const pago = await op.outgoingPayment.create(
        { url: wallet.resourceServer, accessToken: token },
        { walletAddress: wallet.id, quoteId }
    );
    return { id: pago.id };
}
