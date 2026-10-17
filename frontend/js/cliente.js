// Pestaña Cliente (H3, H5): escanea el QR → escribe el monto → Pagar → consentimiento en su wallet.
import { alAbrirPestana, aMonto, formatearMonto, iniciarPago, idCliente, obtenerQr, MONEDA_DEMO } from './api.js';

const seccion = document.getElementById('cliente');
const titulo = seccion.querySelector('[data-vendedor]');
const formulario = seccion.querySelector('form');
const campoMonto = formulario.elements.monto;
const campoPagador = formulario.elements.pagador;
const boton = formulario.querySelector('button');
const aviso = seccion.querySelector('[data-aviso]');

let qrActual = null;

function mostrarAviso(texto) {
    aviso.textContent = texto;
    aviso.hidden = !texto;
}

function recordarPagador(valor) {
    try { localStorage.setItem('cajita.pagador', valor); } catch { /* sin almacenamiento */ }
}

function pagadorGuardado() {
    try { return localStorage.getItem('cajita.pagador') || ''; } catch { return ''; }
}

alAbrirPestana('cliente', async (params) => {
    const qrId = params.get('qr');
    qrActual = null;
    mostrarAviso('');
    formulario.hidden = true;
    campoPagador.value = campoPagador.value || pagadorGuardado();

    if (!qrId) {
        titulo.textContent = 'Escanea el QR del vendedor para pagar.';
        return;
    }

    titulo.textContent = 'Cargando…';
    try {
        qrActual = await obtenerQr(qrId);
    } catch (error) {
        titulo.textContent = error.status === 410 ? 'Este QR ya venció.' : 'No encontramos este QR.';
        return;
    }

    titulo.textContent = `Pagarle a ${qrActual.vendedor}`;
    if (qrActual.monto) {
        campoMonto.value = formatearMonto(qrActual.monto);
        campoMonto.readOnly = true;
    } else {
        campoMonto.value = '';
        campoMonto.readOnly = false;
    }
    formulario.hidden = false;
});

formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarAviso('');

    const monto = qrActual.monto || aMonto(campoMonto.value, MONEDA_DEMO);
    if (!monto) {
        mostrarAviso('Escribe un monto válido.');
        return;
    }
    const pagador = campoPagador.value.trim();
    if (!pagador.startsWith('https://')) {
        mostrarAviso('Tu wallet address empieza por https:// (no por $).');
        return;
    }
    recordarPagador(pagador);

    boton.setAttribute('aria-busy', 'true');
    boton.disabled = true;
    try {
        const respuesta = await iniciarPago(qrActual.qrId, { pagador, monto, clienteId: idCliente() });
        if (respuesta.redirectUrl) {
            location.href = respuesta.redirectUrl;   // pantalla de consentimiento de su wallet
        } else {
            location.hash = `recibo?pago=${encodeURIComponent(respuesta.pagoId)}`;   // pagos rápidos
        }
    } catch (error) {
        mostrarAviso(`No se pudo iniciar el pago: ${error.message}`);
    } finally {
        boton.removeAttribute('aria-busy');
        boton.disabled = false;
    }
});
