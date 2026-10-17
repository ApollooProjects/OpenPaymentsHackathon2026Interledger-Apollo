import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuthenticatedClient } from '@interledger/open-payments';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let cliente;

export async function obtenerCliente() {
    if (!cliente) {
        const { OP_CLIENT_WALLET_ADDRESS, OP_KEY_ID, OP_PRIVATE_KEY_PATH } = process.env;
        if (!OP_CLIENT_WALLET_ADDRESS || !OP_KEY_ID || !OP_PRIVATE_KEY_PATH) {
            throw new Error('Faltan OP_CLIENT_WALLET_ADDRESS, OP_KEY_ID u OP_PRIVATE_KEY_PATH en el .env');
        }
        cliente = createAuthenticatedClient({
            walletAddressUrl: OP_CLIENT_WALLET_ADDRESS,
            keyId: OP_KEY_ID,
            privateKey: path.resolve(raiz, OP_PRIVATE_KEY_PATH)
        });
    }
    return cliente;
}

export async function obtenerWallet(walletUrl) {
    const op = await obtenerCliente();
    return op.walletAddress.get({ url: walletUrl });
}

export function montoDeWallet(wallet, monto) {
    if (monto.assetCode && monto.assetCode !== wallet.assetCode) {
        throw new Error(`La wallet ${wallet.id} es ${wallet.assetCode}, no ${monto.assetCode}`);
    }
    if (monto.assetScale !== undefined && monto.assetScale !== wallet.assetScale) {
        throw new Error(`La wallet ${wallet.id} usa assetScale ${wallet.assetScale}, no ${monto.assetScale}`);
    }
    return { value: String(monto.value), assetCode: wallet.assetCode, assetScale: wallet.assetScale };
}
