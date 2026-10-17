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

export async function consultarPago({ id, token }) {
    const op = await obtenerCliente();
    const pago = await op.outgoingPayment.get({ url: id, accessToken: token });
    return { id: pago.id, fallido: pago.failed, enviado: pago.sentAmount, debito: pago.debitAmount };
}
