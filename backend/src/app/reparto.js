// Cuánto le toca a cada destino de una venta (P1). Función pura: montos enteros en la unidad mínima (centavos).
// Los destinos que quedan en 0 se omiten, porque Open Payments no acepta pagos de 0.

function entero(valor, nombre) {
    const texto = String(valor ?? 0);
    if (!/^\d+$/.test(texto)) throw new Error(`${nombre} debe ser un entero mayor o igual a 0`);
    return BigInt(texto);
}

export function calcularReparto({ total, propina = 0, porcentaje = 35, deudaPendiente = null, meseros = [] }) {
    const venta = entero(total, 'total');
    const extra = entero(propina, 'propina');
    const pct = Number(porcentaje);
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new Error('porcentaje debe ser un entero entre 0 y 100');

    // Sin deuda configurada, el porcentaje aplica siempre; con deuda, nunca se le paga de más al proveedor.
    let proveedor = (venta * BigInt(pct)) / 100n;
    if (deudaPendiente !== null && deudaPendiente !== undefined) {
        const falta = entero(deudaPendiente, 'deudaPendiente');
        if (proveedor > falta) proveedor = falta;
    }

    const destinos = [
        { destino: 'proveedor', valor: proveedor },
        { destino: 'vendedor', valor: venta - proveedor }
    ];

    if (meseros.length === 0) {
        destinos[1].valor += extra;
    } else {
        // Partes iguales; los centavos que sobran van a los primeros meseros para que la suma sea exacta.
        const n = BigInt(meseros.length);
        const base = extra / n;
        const sobrante = extra % n;
        meseros.forEach((mesero, i) => {
            destinos.push({ destino: mesero, valor: base + (BigInt(i) < sobrante ? 1n : 0n) });
        });
    }

    return destinos
        .filter((d) => d.valor > 0n)
        .map((d) => ({ destino: d.destino, valor: Number(d.valor) }));
}
