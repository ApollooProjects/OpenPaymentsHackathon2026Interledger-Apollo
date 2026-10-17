// Dirección de billetera tal como la escriba la persona → URL de Open Payments.
// Acepta la forma de la Test Wallet ($ilp.interledger-test.dev/ana), la URL (https://ilp…/ana),
// sin esquema (ilp…/ana) o con http://, con espacios o mayúsculas en el dominio.
export function aWalletUrl(texto) {
    let limpio = String(texto ?? '').trim().replace(/\s+/g, '');
    if (!limpio) return '';
    if (limpio.startsWith('$')) limpio = limpio.slice(1);
    limpio = limpio.replace(/^https?:\/\//i, '');
    const [dominio, ...ruta] = limpio.split('/');
    return `https://${dominio.toLowerCase()}${ruta.length ? `/${ruta.join('/')}` : ''}`.replace(/\/+$/, '');
}

export const esWalletUrl = (url) => /^https:\/\/[^/]+\.[^/]+\/.+/.test(url);
