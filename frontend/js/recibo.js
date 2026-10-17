// Pestaña Recibo (H5): muestra el resultado del pago al volver de la wallet (/#recibo?pago=<id>).
import { alAbrirPestana, formatearMonto, obtenerPago } from './api.js';

const seccion = document.getElementById('recibo');
const estado = seccion.querySelector('[data-estado]');
const total = seccion.querySelector('[data-total]');
const lista = seccion.querySelector('[data-destinos]');
const comprobante = seccion.querySelector('[data-comprobante]');
const tituloReparto = seccion.querySelector('[data-reparto-titulo]');
const sinPago = seccion.querySelector('[data-sin-pago]');
const seguir = seccion.querySelector('[data-seguir]');

// Botón para seguir después del pago: a la pantalla de inicio del perfil (Pagar, Enviar dinero…).
function mostrarSeguir() {
    const inicio = window.LaCajita?.perfil()?.pestanas[0];
    const textos = { cliente: 'Hacer otro pago', remitente: 'Enviar más dinero' };
    seguir.href = `#${inicio || 'perfil'}`;
    seguir.textContent = textos[inicio] || 'Volver al inicio';
    seguir.hidden = false;
}

const ESTADOS_FINALES = ['completado', 'fallido', 'rechazado'];
const TEXTOS = {
    completado: '✅ Pago completado',
    fallido: '❌ El pago falló',
    rechazado: '❌ El pago fue rechazado',
};

// Detalle (con la URL completa al pasar el dedo o el mouse) para ver en el recibo que todo corrió en Open Payments.
const corto = (url) => {
    const partes = String(url).split('/').filter(Boolean);
    const ultimo = partes.pop() || '';
    return ultimo.length > 12 ? `${partes.pop() || ''}/…${ultimo.slice(-8)}` : `${partes.pop() || ''}/${ultimo}`;
};

function lineaOp(etiqueta, url) {
    const fila = document.createElement('li');
    const codigo = Object.assign(document.createElement('code'), { textContent: corto(url), title: url });
    fila.append(`${etiqueta}: `, codigo);
    return fila;
}

let consulta = 0;
let detalle = null;
let nota = null;

function pintar(pago) {
    const llegaron = (pago.destinos || []).filter((d) => d.completo).length;
    const parcial = pago.estado === 'fallido' && llegaron > 0;
    estado.textContent = parcial ? '⚠️ Pago parcial: una parte llegó y otra no' : TEXTOS[pago.estado] || '⏳ Procesando tu pago… espera unos segundos.';
    comprobante.dataset.final = parcial ? 'parcial' : pago.estado;
    sinPago.hidden = true;
    total.textContent = pago.total ? formatearMonto(pago.total) : '';
    const terminado = ESTADOS_FINALES.includes(pago.estado);
    if (terminado) mostrarSeguir();
    tituloReparto.hidden = (pago.destinos || []).length < 2;
    lista.replaceChildren(...(pago.destinos || []).map((destino) => {
        const fila = document.createElement('li');
        const marca = !terminado ? '' : destino.completo ? '✅ ' : '❌ ';
        fila.textContent = `${marca}${destino.nombre}: ${formatearMonto(destino.monto)}`;
        return fila;
    }));

    nota ??= seccion.appendChild(document.createElement('p'));
    const partes = [];
    if (pago.creado) partes.push(new Date(pago.creado).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }));
    if (pago.metodo === 'rapido') partes.push('⚡ pago rápido: sin volver a aprobar');
    if (pago.metodo === 'consentimiento') partes.push('aprobado en tu billetera');
    if (pago.error && pago.estado !== 'completado') partes.push(`Motivo: ${pago.error}`);
    nota.textContent = partes.join(' · ');

    // "Ver en Open Payments": quién pagó y, por cada parte, la wallet, el incoming payment y el outgoing payment.
    detalle ??= seccion.appendChild(document.createElement('details'));
    const items = [];
    if (pago.pagador) items.push(lineaOp('Wallet que paga', pago.pagador));
    for (const destino of pago.destinos || []) {
        const sub = document.createElement('li');
        sub.append(Object.assign(document.createElement('strong'), { textContent: destino.nombre }));
        const ul = document.createElement('ul');
        if (destino.walletUrl) ul.append(lineaOp('Wallet', destino.walletUrl));
        if (destino.incomingPayment) ul.append(lineaOp('Incoming payment', destino.incomingPayment));
        if (destino.quoteId) ul.append(lineaOp('Quote', destino.quoteId));
        if (destino.outgoingPayment) ul.append(lineaOp('Outgoing payment', destino.outgoingPayment));
        sub.append(ul);
        items.push(sub);
    }
    detalle.hidden = items.length === 0;
    detalle.replaceChildren(
        Object.assign(document.createElement('summary'), { textContent: 'Ver el detalle técnico (Open Payments)' }),
        Object.assign(document.createElement('ul'), {}),
    );
    detalle.lastChild.append(...items);
}

alAbrirPestana('recibo', async (params) => {
    const pagoId = params.get('pago');
    const esta = ++consulta;
    lista.replaceChildren();
    total.textContent = '';
    if (nota) nota.textContent = '';
    if (detalle) detalle.hidden = true;
    delete comprobante.dataset.final;
    tituloReparto.hidden = true;
    seguir.hidden = true;
    sinPago.hidden = Boolean(pagoId);

    if (!pagoId) {
        estado.textContent = 'Todavía no hay un pago para mostrar.';
        mostrarSeguir();
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
