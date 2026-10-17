// Pestaña Remitente (H10): celular + cédula (o wallet) + monto → "te cobran X, llegan Y" → Enviar → consentimiento.
// La cotización la hace Open Payments (quote) con el cambio de moneda; el aviso por SMS (H11) lo manda el backend.
import { alAbrirPestana, cotizarRemesa, enviarRemesa, formatearMonto } from './api.js';
import { pasoAPaso } from './pasos.js';

const seccion = document.getElementById('remitente');
const formulario = seccion.querySelector('[data-cotizar]');
const cotizacion = seccion.querySelector('[data-cotizacion]');
const botonEnviar = seccion.querySelector('[data-enviar]');
const aviso = seccion.querySelector('[data-aviso]');
pasoAPaso(formulario, { total: 3 });

let cotizacionActual = null;

function mostrarAviso(texto) {
    aviso.textContent = texto;
    aviso.hidden = !texto;
    if (texto) aviso.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function remitenteGuardado() {
    try { return localStorage.getItem('cajita.remitente') || ''; } catch { return ''; }
}

function recordarRemitente(valor) {
    try { localStorage.setItem('cajita.remitente', valor); } catch { /* sin almacenamiento */ }
}

// "50", "50,25", "50.25" o "1.250,50" → { value: "5000" | "5025" | "125050", assetScale: 2 }. La moneda la pone el backend.
// Un separador seguido de 1 o 2 dígitos al final es el decimal (quien envía desde afuera escribe "50.25"); los demás son de miles.
function aMontoRemitente(texto) {
    const crudo = String(texto).trim().replace(/[^\d.,]/g, '');
    const decimal = /[.,](\d{1,2})$/.exec(crudo);
    const entero = (decimal ? crudo.slice(0, decimal.index) : crudo).replace(/[.,]/g, '');
    const limpio = decimal ? `${entero || '0'}.${decimal[1]}` : entero;
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

function marcarObligatorios() {
    const campos = formulario.elements;
    const conCuenta = campos.conCuenta.value === 'si';
    seccion.querySelector('[data-sin-cuenta]').hidden = conCuenta;
    seccion.querySelector('[data-con-cuenta]').hidden = !conCuenta;
    campos.celular.required = !conCuenta;
    campos.cedula.required = !conCuenta;
    campos.destinatarioWallet.required = conCuenta;
    // "Que reciba exactamente": el monto se escribe en la moneda de quien recibe (pesos).
    const recibe = campos.modo.value === 'recibe';
    seccion.querySelector('[data-monto-titulo]').textContent = recibe ? '¿Cuánto quieres que le llegue?' : '¿Cuánto vas a enviar?';
    seccion.querySelector('[data-monto-ayuda]').textContent = recibe
        ? 'En pesos colombianos, solo números. Ejemplo: 200000'
        : 'En tu moneda, solo números. Ejemplo: 50';
}

formulario.addEventListener('change', marcarObligatorios);
marcarObligatorios();

formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarAviso('');
    const campos = formulario.elements;
    const conCuenta = campos.conCuenta.value === 'si';
    const remitente = campos.remitente.value.trim().replace(/^\$/, 'https://');
    const monto = aMontoRemitente(campos.monto.value);

    if (!remitente.startsWith('https://')) return mostrarAviso('⚠ La dirección de tu billetera debe empezar por https:// o por $');
    const modo = campos.modo.value === 'recibe' ? 'recibe' : 'envio';
    if (!monto) {
        return mostrarAviso(modo === 'recibe'
            ? '⚠ Escribe cuántos pesos quieres que le lleguen, solo con números. Ejemplo: 200000'
            : '⚠ Escribe cuánto vas a enviar, solo con números. Ejemplo: 50');
    }

    const cuerpo = { remitente, monto, modo };
    if (campos.nombre.value.trim()) cuerpo.nombreRemitente = campos.nombre.value.trim();
    if (conCuenta) {
        cuerpo.destinatarioWallet = campos.destinatarioWallet.value.trim().replace(/^\$/, 'https://');
        if (!cuerpo.destinatarioWallet.startsWith('https://')) return mostrarAviso('⚠ La billetera de tu familiar debe empezar por https:// o por $');
    } else {
        cuerpo.celular = campos.celular.value.replace(/\D/g, '');
        cuerpo.cedula = campos.cedula.value.replace(/\D/g, '');
        if (cuerpo.celular.length < 7 || !cuerpo.cedula) return mostrarAviso('⚠ Escribe el celular y la cédula de quien recibe.');
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
            ? 'Le llegan directo a la billetera de tu familiar.'
            : `Quedan a nombre de la cédula ${cuerpo.cedula}. Le avisamos con un mensaje al ${cuerpo.celular} y lo saca en efectivo con su cédula.`;
        botonEnviar.textContent = `Enviar ${formatearMonto(cotizacionActual.cobra)}`;
        const tasa = Number(cotizacionActual.llega.value) / 10 ** cotizacionActual.llega.assetScale
            / (Number(cotizacionActual.cobra.value) / 10 ** cotizacionActual.cobra.assetScale);
        seccion.querySelector('[data-tasa]').textContent = cotizacionActual.cobra.assetCode === cotizacionActual.llega.assetCode
            ? 'Misma moneda: sin cambio.'
            : `Cambio: 1 ${cotizacionActual.cobra.assetCode} ≈ ${tasa.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ${cotizacionActual.llega.assetCode}, ya con la comisión incluida. `
                + (modo === 'recibe'
                    ? 'Tú pagas el cambio y la comisión de la red: a tu familiar le llega exactamente lo que pediste.'
                    : 'La comisión la pagas tú: a tu familiar le llega exactamente ese monto, sin descuentos.');
        formulario.hidden = true;
        cotizacion.hidden = false;
        cotizacion.scrollIntoView({ block: 'nearest' });
        botonEnviar.focus({ preventScroll: true });
    } catch (error) {
        mostrarAviso(`⚠ No pudimos calcular cuánto le llega. ${error.message.replace(/\.?$/, '.')}`);
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
        mostrarAviso(`⚠ No pudimos enviar el dinero. ${error.message.replace(/\.?$/, '.')} Revisa los datos e intenta otra vez.`);
    } finally {
        botonEnviar.removeAttribute('aria-busy');
        botonEnviar.disabled = false;
    }
});
