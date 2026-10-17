// Pestaña Cajero (H13): el corresponsal escribe cédula + PIN → la Custodia le paga al Corresponsal → "Entregado".
import { formatearMonto, validarRetiro } from './api.js';

const seccion = document.getElementById('cajero');
const formulario = seccion.querySelector('form');
const boton = formulario.querySelector('button');
const resultado = seccion.querySelector('[data-resultado]');

function mostrar(texto, entregado = false) {
    resultado.hidden = false;
    resultado.textContent = texto;
    resultado.style.borderLeft = entregado ? '6px solid #2e7d32' : '';
}

formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const cedula = formulario.elements.cedula.value.replace(/\D/g, '');
    const pin = formulario.elements.pin.value.trim();
    if (!cedula || !pin) return;

    boton.setAttribute('aria-busy', 'true');
    boton.disabled = true;
    mostrar('⏳ Validando y pagando el retiro…');
    try {
        // Si el pago al corresponsal sigue en proceso (202), se vuelve a validar cada 2 s (máximo 10 veces).
        for (let intento = 0; intento < 10; intento += 1) {
            const respuesta = await validarRetiro({ pin, cedula });
            if (respuesta.ok) {
                const comprobante = respuesta.outgoingPayment
                    ? ` Comprobante Open Payments: …${respuesta.outgoingPayment.slice(-8)} (Custodia → Corresponsal). Comisión del corresponsal en la demo: $ 0.`
                    : '';
                mostrar(`✅ Entregado: ${formatearMonto(respuesta.monto)} en efectivo.${comprobante}`, true);
                if (respuesta.outgoingPayment) resultado.title = respuesta.outgoingPayment;
                formulario.reset();
                return;
            }
            if (respuesta.status !== 202) {
                mostrar(`❌ ${respuesta.error || 'No se pudo validar el retiro'}`);
                return;
            }
            mostrar('⏳ El pago al corresponsal sigue en proceso…');
            await new Promise((listo) => setTimeout(listo, 2000));
        }
        mostrar('⏳ El pago sigue en proceso. Vuelve a validar en un momento.');
    } catch (error) {
        mostrar(`❌ No pudimos contactar el servicio: ${error.message}`);
    } finally {
        boton.removeAttribute('aria-busy');
        boton.disabled = false;
    }
});
