import { obtenerCliente, obtenerWallet, montoDeWallet } from './client.js';

// Sin quote: con incomingPayment + debitAmount el servidor cotiza solo.
export async function pagar({ walletUrl, token, cobroId, monto }) {
    const wallet = await obtenerWallet(walletUrl);
    const op = await obtenerCliente();
    const pago = await op.outgoingPayment.create(
        { url: wallet.resourceServer, accessToken: token },
        {
            walletAddress: wallet.id,
            incomingPayment: cobroId,
            debitAmount: montoDeWallet(wallet, monto)
        }
    );
    return { id: pago.id };
}
