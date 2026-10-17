import { isFinalizedGrantWithAccessToken } from '@interledger/open-payments';
import { obtenerCliente, obtenerWallet, montoDeWallet } from './client.js';

// Los grants de incoming no son interactivos; se reutilizan hasta poco antes de que venzan (600 s).
const grants = new Map();

async function tokenIncoming(authServer, acciones) {
    const clave = `${authServer}|${acciones.join(',')}`;
    const guardado = grants.get(clave);
    if (guardado && guardado.vence > Date.now()) return guardado.token;

    const op = await obtenerCliente();
    const grant = await op.grant.request(
        { url: authServer },
        { access_token: { access: [{ type: 'incoming-payment', actions: acciones }] } }
    );
    if (!isFinalizedGrantWithAccessToken(grant)) throw new Error('El grant de incoming-payment no quedó finalizado');

    const segundos = grant.access_token.expires_in ?? 600;
    grants.set(clave, { token: grant.access_token.value, vence: Date.now() + (segundos - 30) * 1000 });
    return grant.access_token.value;
}

export async function crearCobro({ walletUrl, monto, metadata = {}, expiresAt } = {}) {
    const wallet = await obtenerWallet(walletUrl);
    const op = await obtenerCliente();
    const accessToken = await tokenIncoming(wallet.authServer, ['create', 'read']);

    const cobro = await op.incomingPayment.create(
        { url: wallet.resourceServer, accessToken },
        {
            walletAddress: wallet.id,
            metadata,
            ...(monto && { incomingAmount: montoDeWallet(wallet, monto) }),
            ...(expiresAt && { expiresAt: new Date(expiresAt).toISOString() })
        }
    );
    return { id: cobro.id, walletUrl: wallet.id };
}

// Solo con el id: la vista pública del cobro dice qué servidor de autorización hay que pedirle.
export async function consultarCobro(id) {
    const op = await obtenerCliente();
    const publico = await op.incomingPayment.getPublic({ url: id });
    const accessToken = await tokenIncoming(publico.authServer, ['create', 'read']);
    const cobro = await op.incomingPayment.get({ url: id, accessToken });
    return { id: cobro.id, recibido: cobro.receivedAmount, completo: cobro.completed };
}

export async function listarCobros({ walletUrl, cedula } = {}) {
    const wallet = await obtenerWallet(walletUrl);
    const op = await obtenerCliente();
    const accessToken = await tokenIncoming(wallet.authServer, ['list', 'read']);

    const cobros = [];
    let cursor;
    do {
        const pagina = await op.incomingPayment.list(
            { url: wallet.resourceServer, walletAddress: wallet.id, accessToken },
            { first: 100, ...(cursor && { cursor }) }
        );
        cobros.push(...pagina.result);
        cursor = pagina.pagination.hasNextPage ? pagina.pagination.endCursor : undefined;
    } while (cursor);

    return cobros
        .filter((cobro) => cedula === undefined || cobro.metadata?.cedula === cedula)
        .map((cobro) => ({
            id: cobro.id,
            recibido: cobro.receivedAmount,
            completo: cobro.completed,
            metadata: cobro.metadata ?? {}
        }));
}
