// Cuánto le toca a cada destino de una venta (P1). Función pura: montos enteros en la unidad mínima (centavos).
// Los destinos que quedan en 0 se omiten, porque Open Payments no acepta pagos de 0.
import { aWalletUrl, esWalletUrl } from './wallet.js';

function entero(valor, nombre) {
    const texto = String(valor ?? 0);
    if (!/^\d+$/.test(texto)) throw new Error(`${nombre} debe ser un entero mayor o igual a 0`);
    return BigInt(texto);
}

function porcentajeValido(valor, nombre) {
    const pct = Number(valor);
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new Error(`${nombre} debe ser un entero entre 0 y 100`);
    return pct;
}

function leerMeseros(meseros, { exigirWallet }) {
    if (!Array.isArray(meseros)) throw new Error('meseros debe ser una lista');
    const lista = meseros.map((m) => {
        let wallet = String(typeof m === 'string' ? m : m?.wallet ?? '').trim();
        if (exigirWallet) {
            wallet = aWalletUrl(wallet);
            if (!esWalletUrl(wallet)) throw new Error('Cada mesero debe tener una billetera que empiece por https:// o por $');
        }
        const porcentaje = typeof m === 'object' && m?.porcentaje !== undefined && m?.porcentaje !== null && m?.porcentaje !== ''
            ? porcentajeValido(m.porcentaje, 'El porcentaje de cada mesero')
            : null;
        return { wallet, porcentaje };
    });
    const conPorcentaje = lista.filter((m) => m.porcentaje !== null).length;
    if (conPorcentaje === 0) return lista.map((m) => m.wallet);
    if (conPorcentaje !== lista.length) throw new Error('Si un mesero tiene porcentaje, todos deben tenerlo');
    if (lista.reduce((t, m) => t + m.porcentaje, 0) !== 100) throw new Error('Los porcentajes de los meseros deben sumar 100');
    return lista;
}

// Un mesero es su wallet (partes iguales) o { wallet, porcentaje } (C5.1). Si uno trae porcentaje, todos deben
// traerlo y sumar 100. Devuelve el formato que se guarda: textos sin porcentaje, objetos con porcentaje.
export function normalizarMeseros(meseros = []) {
    return leerMeseros(meseros, { exigirWallet: true });
}

const walletDe = (mesero) => (typeof mesero === 'string' ? mesero : mesero.wallet);

export function calcularReparto({ total, propina = 0, porcentaje = 35, deudaPendiente = null, meseros = [], ahorro = 0 }) {
    const venta = entero(total, 'total');
    const extra = entero(propina, 'propina');
    const pct = porcentajeValido(porcentaje, 'porcentaje');
    const pctAhorro = porcentajeValido(ahorro, 'ahorro');
    const lista = leerMeseros(meseros, { exigirWallet: false });

    // Sin deuda configurada, el porcentaje aplica siempre; con deuda, nunca se le paga de más al proveedor.
    let proveedor = (venta * BigInt(pct)) / 100n;
    if (deudaPendiente !== null && deudaPendiente !== undefined) {
        const falta = entero(deudaPendiente, 'deudaPendiente');
        if (proveedor > falta) proveedor = falta;
    }

    // C5.2: el ahorro sale de la parte del vendedor en cada venta (no de la propina).
    const ahorrado = ((venta - proveedor) * BigInt(pctAhorro)) / 100n;

    const destinos = [
        { destino: 'proveedor', valor: proveedor },
        { destino: 'vendedor', valor: venta - proveedor - ahorrado },
        { destino: 'ahorro', valor: ahorrado }
    ];

    if (lista.length === 0) {
        destinos[1].valor += extra;
    } else {
        // Partes iguales o por porcentaje; los centavos que sobran van a los primeros meseros para que la suma sea exacta.
        const partes = lista.map((m) => (typeof m === 'string' ? extra / BigInt(lista.length) : (extra * BigInt(m.porcentaje)) / 100n));
        let sobrante = extra - partes.reduce((t, p) => t + p, 0n);
        lista.forEach((mesero, i) => {
            const centavo = sobrante > 0n ? 1n : 0n;
            sobrante -= centavo;
            destinos.push({ destino: walletDe(mesero), valor: partes[i] + centavo });
        });
    }

    return destinos
        .filter((d) => d.valor > 0n)
        .map((d) => ({ destino: d.destino, valor: Number(d.valor) }));
}
