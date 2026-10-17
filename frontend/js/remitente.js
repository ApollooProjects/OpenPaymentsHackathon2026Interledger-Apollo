// Pestaña Remitente (H10): celular + cédula (o wallet) + monto → "te cobran X, llegan Y" → Enviar → consentimiento.
// La cotización la hace Open Payments (quote) con el cambio de moneda; el aviso por SMS (H11) lo manda el backend.
import { alAbrirPestana, cotizarRemesa, enviarRemesa, formatearMonto } from './api.js';

const seccion = document.getElementById('remitente');
const formulario = seccion.querySelector('[data-cotizar]');
const cotizacion = seccion.querySelector('[data-cotizacion]');
const botonEnviar = seccion.querySelector('[data-enviar]');
const aviso = seccion.querySelector('[data-aviso]');

let cotizacionActual = null;

function mostrarAviso(texto) {
    aviso.textContent = texto;
    aviso.hidden = !texto;
}

function remitenteGuardado() {
    try { return localStorage.getItem('cajita.remitente') || ''; } catch { return ''; }
}

function recordarRemitente(valor) {
    try { localStorage.setItem('cajita.remitente', valor); } catch { /* sin almacenamiento */ }
}

// "50" o "50,25" → { value: "5000" | "5025", assetScale: 2 }. La moneda la pone el backend según la wallet.
function aMontoRemitente(texto) {
    const limpio = String(texto).trim().replace(/\./g, '').replace(',', '.');
    const numero = Number(limpio);
    if (!limpio || !Number.isFinite(numero) || numero <= 0) return null;
    return { value: Math.round(numero * 100).toString(), assetScale: 2 };
}

function volverAlFormulario() {
    cotizacionActual = null;
    cotizacion.hidden = true;
    formulario.hidden = false;
}

alAbrirPestana('remitente', () => {
    mostrarAviso('');
    formulario.elements.remitente.value = formulario.elements.remitente.value || remitenteGuardado();
    volverAlFormulario();
});

formulario.addEventListener('change', () => {
    const conCuenta = formulario.elements.conCuenta.value === 'si';
    seccion.querySelector('[data-sin-cuenta]').hidden = conCuenta;
    seccion.querySelector('[data-con-cuenta]').hidden = !conCuenta;
});

formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarAviso('');
    const campos = formulario.elements;
    const conCuenta = campos.conCuenta.value === 'si';
    const remitente = campos.remitente.value.trim().replace(/^\$/, 'https://');
    const monto = aMontoRemitente(campos.monto.value);

    if (!remitente.startsWith('https://')) return mostrarAviso('Tu wallet address empieza por https:// o $.');
    if (!monto) return mostrarAviso('Escribe un monto válido.');

    const cuerpo = { remitente, monto };
    if (campos.nombre.value.trim()) cuerpo.nombreRemitente = campos.nombre.value.trim();
    if (conCuenta) {
        cuerpo.destinatarioWallet = campos.destinatarioWallet.value.trim().replace(/^\$/, 'https://');
        if (!cuerpo.destinatarioWallet.startsWith('https://')) return mostrarAviso('La wallet de tu familiar empieza por https:// o $.');
    } else {
        cuerpo.celular = campos.celular.value.replace(/\D/g, '');
        cuerpo.cedula = campos.cedula.value.replace(/\D/g, '');
        if (cuerpo.celular.length < 7 || !cuerpo.cedula) return mostrarAviso('Escribe el celular y la cédula de quien recibe.');
    }
    recordarRemitente(remitente);

    const boton = formulario.querySelector('button[type=submit]');
    boton.setAttribute('aria-busy', 'true');
    boton.disabled = true;
    try {
        cotizacionActual = await cotizarRemesa(cuerpo);
        seccion.querySelector('[data-cobra]').textContent = formatearMonto(cotizacionActual.cobra);
        seccion.querySelector('[data-llega]').textContent = formatearMonto(cotizacionActual.llega);
        seccion.querySelector('[data-a-quien]').textContent = conCuenta
            ? 'a la wallet de tu familiar.'
            : `a nombre de la cédula ${cuerpo.cedula}. Le avisamos por SMS al ${cuerpo.celular}.`;
        const tasa = Number(cotizacionActual.llega.value) / 10 ** cotizacionActual.llega.assetScale
            / (Number(cotizacionActual.cobra.value) / 10 ** cotizacionActual.cobra.assetScale);
        seccion.querySelector('[data-tasa]').textContent = cotizacionActual.cobra.assetCode === cotizacionActual.llega.assetCode
            ? 'Misma moneda: sin cambio.'
            : `1 ${cotizacionActual.cobra.assetCode} ≈ ${tasa.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ${cotizacionActual.llega.assetCode}, ya incluye lo que cobra la red.`;
        formulario.hidden = true;
        cotizacion.hidden = false;
    } catch (error) {
        mostrarAviso(`No se pudo cotizar: ${error.message}`);
    } finally {
        boton.removeAttribute('aria-busy');
        boton.disabled = false;
    }
});

seccion.querySelector('[data-cambiar]').addEventListener('click', volverAlFormulario);

botonEnviar.addEventListener('click', async () => {
    if (!cotizacionActual) return;
    mostrarAviso('');
    botonEnviar.setAttribute('aria-busy', 'true');
    botonEnviar.disabled = true;
    try {
        const { redirectUrl } = await enviarRemesa({ cotizacionId: cotizacionActual.cotizacionId });
        location.href = redirectUrl;   // pantalla de consentimiento de la wallet del remitente
    } catch (error) {
        if (error.status === 404 || error.status === 409 || error.status === 410) volverAlFormulario();   // cotización inexistente, usada o vencida
        mostrarAviso(`No se pudo enviar: ${error.message}`);
    } finally {
        botonEnviar.removeAttribute('aria-busy');
        botonEnviar.disabled = false;
    }
});
