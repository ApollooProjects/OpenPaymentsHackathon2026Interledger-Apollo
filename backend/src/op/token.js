import { obtenerCliente } from './client.js';

export async function rotar({ token, manageUrl }) {
    const op = await obtenerCliente();
    const nuevo = await op.token.rotate({ url: manageUrl, accessToken: token });
    return { token: nuevo.access_token.value, manageUrl: nuevo.access_token.manage };
}
