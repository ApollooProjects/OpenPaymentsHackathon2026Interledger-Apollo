import { createHash } from 'node:crypto';
import { isFinalizedGrantWithAccessToken, isPendingGrant } from '@interledger/open-payments';
import { obtenerCliente, obtenerWallet, montoDeWallet } from './client.js';

export async function pedirPermiso({ walletUrl, tope, interval, finishUri, nonce }) {
    const wallet = await obtenerWallet(walletUrl);
    const op = await obtenerCliente();
    const grant = await op.grant.request(
        { url: wallet.authServer },
        {
            access_token: {
                access: [
                    {
                        type: 'outgoing-payment',
                        actions: ['create', 'read'],
                        identifier: wallet.id,
                        limits: {
                            debitAmount: montoDeWallet(wallet, tope),
                            ...(interval && { interval })
                        }
                    }
                ]
            },
            interact: {
                start: ['redirect'],
                finish: { method: 'redirect', uri: finishUri, nonce }
            }
        }
    );
    if (!isPendingGrant(grant)) throw new Error('El grant de outgoing-payment no pidió consentimiento');

    return {
        redirectUrl: grant.interact.redirect,
        continueUri: grant.continue.uri,
        continueToken: grant.continue.access_token.value,
        interactNonce: grant.interact.finish,
        authServerUrl: wallet.authServer
    };
}

export async function continuarPermiso({ continueUri, continueToken, interactRef }) {
    const op = await obtenerCliente();
    const grant = await op.grant.continue(
        { url: continueUri, accessToken: continueToken },
        { interact_ref: interactRef }
    );
    if (!isFinalizedGrantWithAccessToken(grant)) throw new Error('El grant de outgoing-payment no quedó finalizado');

    return {
        token: grant.access_token.value,
        manageUrl: grant.access_token.manage,
        continueUri: grant.continue?.uri ?? continueUri,
        continueToken: grant.continue?.access_token?.value ?? continueToken
    };
}

// Cancelar el grant (DELETE a su URI de continuación): el permiso deja de servir para nuevos pagos.
export async function revocarPermiso({ continueUri, continueToken }) {
    const op = await obtenerCliente();
    await op.grant.cancel({ url: continueUri, accessToken: continueToken });
}

export function verificarHash({ clientNonce, interactNonce, interactRef, authServerUrl, hash }) {
    if (!hash) return false;
    const esperado = createHash('sha256')
        .update(`${clientNonce}\n${interactNonce}\n${interactRef}\n${authServerUrl}`)
        .digest('base64')
        .replace(/=+$/, '');
    return esperado === hash.replace(/ /g, '+').replace(/=+$/, '');
}
