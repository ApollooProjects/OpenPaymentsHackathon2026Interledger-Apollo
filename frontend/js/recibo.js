// Pestaña Recibo (H5): muestra el resultado del pago al volver de la wallet (/#recibo?pago=<id>).
import { alAbrirPestana, formatearMonto, obtenerPago } from './api.js';

const seccion = document.getElementById('recibo');
const estado = seccion.querySelector('[data-estado]');
const total = seccion.querySelector('[data-total]');
const lista = seccion.querySelector('[data-destinos]');

const ESTADOS_FINALES = ['completado', 'fallido', 'rechazado'];
const TEXTOS = {
    completado: '✅ Pago completado',
    fallido: '❌ El pago falló',
    rechazado: '❌ El pago fue rechazado',
};

let consulta = 0;

function pintar(pago) {
    estado.textContent = TEXTOS[pago.estado] || `⏳ Procesando (${pago.estado})…`;
    total.textContent = pago.total ? formatearMonto(pago.total) : '';
    lista.replaceChildren(...(pago.destinos || []).map((destino) => {
        const fila = document.createElement('li');
        fila.textContent = `${destino.nombre}: ${formatearMonto(destino.monto)}`;
        return fila;
    }));
}

alAbrirPestana('recibo', async (params) => {
    const pagoId = params.get('pago');
    const esta = ++consulta;
    lista.replaceChildren();
    total.textContent = '';

    if (!pagoId) {
        estado.textContent = 'Todavía no hay un pago para mostrar.';
        return;
    }

    estado.textContent = '⏳ Consultando el pago…';
    // Mientras el pago no termine, se vuelve a consultar cada 2 s (máximo 30 veces).
    for (let intento = 0; intento < 30 && esta === consulta; intento += 1) {
        try {
            const pago = await obtenerPago(pagoId);
            if (esta !== consulta) return;
            pintar(pago);
            if (ESTADOS_FINALES.includes(pago.estado)) return;
        } catch (error) {
            estado.textContent = `No pudimos consultar el pago: ${error.message}`;
            return;
        }
        await new Promise((listo) => setTimeout(listo, 2000));
    }
});
