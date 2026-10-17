import { Router } from 'express';
import * as store from '../store.js';
import { resumenReparto } from '../repartos.js';

export const rutasCobros = Router();

const aUrl = (wallet) => String(wallet ?? '').trim().replace(/^\$/, 'https://');

// Perfil de demo (mesero o proveedor): lo que le ha llegado a su wallet según los pagos ya registrados.
// Sin autenticación: solo lee datos que el backend ya tiene, a partir de la wallet address (pública).
rutasCobros.get('/cobros', async (req, res) => {
    const wallet = aUrl(req.query.wallet);
    if (!wallet.startsWith('https://')) return res.status(400).json({ error: 'Falta la billetera' });

    const movimientos = [];
    let total = null;
    for (const pago of store.pagosHacia(wallet).filter((p) => p.estado === 'completado')) {
        const origen = pago.plan.origen ?? {};
        const de = origen.tipo === 'remesa'
            ? `Remesa de ${origen.nombreRemitente || 'el exterior'}`
            : (origen.qrId && store.obtenerQr(origen.qrId)?.vendedor) || 'Pago con QR';
        for (const destino of pago.plan.destinos.filter((d) => d.walletUrl === wallet)) {
            movimientos.push({ fecha: pago.creado, de, concepto: destino.nombre, monto: destino.monto });
            total = { ...destino.monto, value: (BigInt(total?.value ?? 0) + BigInt(destino.monto.value)).toString() };
        }
    }

    // Proveedor: la deuda del reparto más reciente de cada vendedor (los demás son repartos viejos de prueba).
    const deudas = [];
    const vistos = new Set();
    for (const reparto of store.repartosDelProveedor(wallet)) {
        if (vistos.has(reparto.vendedor) || deudas.length >= 3) continue;
        vistos.add(reparto.vendedor);
        try {
            const resumen = await resumenReparto(reparto.id);
            if (resumen) deudas.push({ vendedor: resumen.vendedor, pagado: resumen.proveedor.pagado, deuda: resumen.proveedor.deuda });
        } catch (error) {
            console.error(`No se pudo resumir el reparto ${reparto.id}: ${error.message}`);
        }
    }

    res.json({ wallet, total, movimientos: movimientos.slice(0, 30), deudas });
});
