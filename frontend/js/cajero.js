// Pestaña Cajero (H13): el corresponsal escribe cédula + PIN → la Custodia le paga al Corresponsal → "Entregado".
import { formatearMonto, validarRetiro } from './api.js';

const seccion = document.getElementById('cajero');
const formulario = seccion.querySelector('form');
const boton = formulario.querySelector('button');
const resultado = seccion.querySelector('[data-resultado]');

function mostrar(texto, entregado = false, detalle = '') {
    resultado.hidden = false;
    resultado.replaceChildren(Object.assign(document.createElement('span'), { textContent: texto }));
    if (detalle) resultado.append(Object.assign(document.createElement('small'), { textContent: detalle }));
    resultado.dataset.entregado = entregado;
}

formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const cedula = formulario.elements.cedula.value.replace(/\D/g, '');
    const pin = formulario.elements.pin.value.trim();
    if (!cedula || !pin) return mostrar('⚠ Escribe la cédula y el PIN de la persona.');

    boton.setAttribute('aria-busy', 'true');
    boton.disabled = true;
    mostrar('⏳ Revisando el PIN…', 'espera');
    try {
        // Si el pago al corresponsal sigue en proceso (202), se vuelve a validar cada 2 s (máximo 10 veces).
        for (let intento = 0; intento < 10; intento += 1) {
            const respuesta = await validarRetiro({ pin, cedula });
            if (respuesta.ok) {
                const comprobante = respuesta.outgoingPayment
                    ? `Comprobante Open Payments: …${respuesta.outgoingPayment.slice(-8)} (Custodia → Corresponsal). Comisión del corresponsal en la demo: $ 0.`
                    : '';
                mostrar(`✅ PIN correcto. Entrega ${formatearMonto(respuesta.monto)} en efectivo.`, true, comprobante);
                if (respuesta.outgoingPayment) resultado.title = respuesta.outgoingPayment;
                formulario.reset();
                return;
            }
            if (respuesta.status !== 202) {
                mostrar(`❌ ${respuesta.error || 'No se pudo validar el retiro'}`, false, 'No entregues dinero. Revisa la cédula y el PIN con la persona e intenta otra vez.');
                return;
            }
            mostrar('⏳ El pago al corresponsal sigue en proceso…', 'espera');
            await new Promise((listo) => setTimeout(listo, 2000));
        }
        mostrar('⏳ El pago sigue en proceso. Toca el botón otra vez en un momento.', 'espera', 'Todavía no entregues el dinero.');
    } catch (error) {
        mostrar(`❌ No pudimos revisar el retiro. Intenta otra vez. (${error.message})`);
    } finally {
        boton.removeAttribute('aria-busy');
        boton.disabled = false;
    }
});
