// Pestaña Cliente (H3, H5, H5b, H5c): escanea el QR → escribe el monto → (propina) → Pagar → consentimiento en su wallet.
// Con pagos rápidos activos la compra sale sin volver a aprobar.
import { aWalletUrl, esWalletUrl } from './wallet.js';
import {
    activarPagosRapidos, alAbrirPestana, aMonto, cancelarPermiso, formatearMonto, iniciarPago, idCliente, obtenerPermiso,
    obtenerQr, MONEDA_DEMO
} from './api.js';

// Tope semanal de los pagos rápidos (SDD H5c: "hasta $20.000 por semana").
const TOPE_RAPIDOS = aMonto('20000', MONEDA_DEMO);

const seccion = document.getElementById('cliente');
const titulo = seccion.querySelector('[data-vendedor]');
const formulario = seccion.querySelector('form');
const campoMonto = formulario.elements.monto;
const campoPagador = formulario.elements.pagador;
const campoPropinaOtra = formulario.elements.propinaOtra;
const bloquePropina = seccion.querySelector('[data-propina]');
const activarRapidos = seccion.querySelector('[data-activar-rapidos]');
const bloqueRapidos = seccion.querySelector('[data-rapidos]');
const textoTotal = seccion.querySelector('[data-total]');
const boton = formulario.querySelector('button[type=submit]');
const aviso = seccion.querySelector('[data-aviso]');
const sinQr = seccion.querySelector('[data-sin-qr]');
const billetera = seccion.querySelector('[data-billetera]');
const destinoPago = seccion.querySelector('[data-destino-pago]');

// QR de transferencia entre personas: quien paga ve claro si el dinero llega a una cuenta o en efectivo.
function pintarDestino(qr) {
    const transferencia = qr && ['transferencia', 'efectivo'].includes(qr.tipo);
    destinoPago.hidden = !transferencia;
    if (!transferencia) return;
    destinoPago.textContent = qr.destino === 'efectivo'
        ? `${qr.vendedor} lo recibe en efectivo: el dinero queda guardado a su nombre y lo retira en un corresponsal con su cédula.`
        : `El dinero llega directo a la billetera de ${qr.vendedor}${qr.walletDestino ? ` (${qr.walletDestino.split('/').filter(Boolean).pop()})` : ''}.`;
}

// Guía cuando no hay QR que pagar (sin QR, vencido, ya usado o inexistente).
function mostrarSinQr(motivo) {
    sinQr.querySelector('[data-sin-qr-motivo]').replaceChildren(Object.assign(document.createElement('strong'), { textContent: motivo }));
    sinQr.hidden = false;
}

// Con la billetera ya conocida se muestra en una línea («Pagas desde …/laura · Cambiar») para no distraer.
function pintarBilletera() {
    const valor = campoPagador.value.trim();
    const conocida = /^(https:\/\/|\$)\S+\/\S+/.test(valor);
    billetera.querySelector('[data-billetera-corta]').textContent = conocida ? valor.split('/').filter(Boolean).pop() : 'tu billetera';
    if (conocida && document.activeElement !== campoPagador) billetera.open = false;
    if (!conocida) billetera.open = true;
}
campoPagador.addEventListener('change', pintarBilletera);

let qrActual = null;
let permisoActual = { activo: false };

seccion.querySelector('[data-tope]').textContent = formatearMonto(TOPE_RAPIDOS);

function mostrarAviso(texto) {
    aviso.textContent = texto;
    aviso.hidden = !texto;
    if (texto) aviso.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function recordarPagador(valor) {
    try { localStorage.setItem('cajita.pagador', valor); } catch { /* sin almacenamiento */ }
}

function pagadorGuardado() {
    try { return localStorage.getItem('cajita.pagador') || ''; } catch { return ''; }
}

// Mientras el cliente aprueba los pagos rápidos en su wallet se guarda la compra que estaba haciendo,
// para volver a ella y pagar con un toque.
function guardarCompraPendiente(datos) {
    try { sessionStorage.setItem('cajita.compraPendiente', JSON.stringify(datos)); } catch { /* sin almacenamiento */ }
}

function tomarCompraPendiente() {
    try {
        const datos = JSON.parse(sessionStorage.getItem('cajita.compraPendiente') || 'null');
        sessionStorage.removeItem('cajita.compraPendiente');
        return datos;
    } catch {
        return null;
    }
}

const AVISOS_RAPIDOS = {
    activo: '⚡ Listo: pagos rápidos activos. Toca Pagar y sale sin volver a aprobar.',
    rechazado: 'No aceptaste los pagos rápidos. Puedes pagar igual: tu billetera te pedirá confirmar esta compra.',
    fallido: '⚠ No pudimos activar los pagos rápidos. Puedes pagar igual: tu billetera te pedirá confirmar esta compra.',
};

function montoBase() {
    return qrActual?.monto || aMonto(campoMonto.value, MONEDA_DEMO);
}

// Propina en la misma moneda que el monto: 10 %, 15 % u otro valor escrito.
function propinaElegida(base) {
    if (bloquePropina.hidden || !base) return null;
    const opcion = formulario.elements.propina.value;
    if (opcion === 'otro') return aMonto(campoPropinaOtra.value, base);
    const porcentaje = BigInt(opcion);
    if (porcentaje === 0n) return null;
    return { ...base, value: ((BigInt(base.value) * porcentaje) / 100n).toString() };
}

function actualizarTotal() {
    const base = montoBase();
    const propina = propinaElegida(base);
    campoPropinaOtra.hidden = formulario.elements.propina.value !== 'otro';
    if (!base) {
        textoTotal.textContent = '';
        boton.textContent = 'Pagar';
        return;
    }
    const total = { ...base, value: (BigInt(base.value) + BigInt(propina?.value || 0)).toString() };
    const rapido = permisoActual.activo && permisoActual.disponible && BigInt(permisoActual.disponible.value) >= BigInt(total.value);
    textoTotal.textContent = propina
        ? `Total: ${formatearMonto(total)} (${formatearMonto(base)} + ${formatearMonto(propina)} de propina)`
        : `Total: ${formatearMonto(total)}`;
    boton.textContent = rapido ? `⚡ Pagar ${formatearMonto(total)} sin volver a aprobar` : `Pagar ${formatearMonto(total)}`;
}

async function cargarPermiso() {
    try {
        permisoActual = await obtenerPermiso(idCliente());
    } catch {
        permisoActual = { activo: false };
    }
    bloqueRapidos.hidden = !permisoActual.activo;
    activarRapidos.hidden = permisoActual.activo;
    if (permisoActual.activo) {
        seccion.querySelector('[data-restante]').textContent = formatearMonto(permisoActual.disponible);
        seccion.querySelector('[data-tope-activo]').textContent = formatearMonto(permisoActual.tope);
    }
    actualizarTotal();
}

alAbrirPestana('cliente', async (params) => {
    const resultadoRapidos = params.get('pagosRapidos');
    const pendiente = resultadoRapidos ? tomarCompraPendiente() : null;
    // Vuelta de activar pagos rápidos: retomar el QR y el monto que estaba pagando.
    if (resultadoRapidos && !params.get('qr') && pendiente?.qrId) {
        guardarCompraPendiente(pendiente);
        location.hash = `cliente?qr=${encodeURIComponent(pendiente.qrId)}&pagosRapidos=${encodeURIComponent(resultadoRapidos)}`;
        return;
    }
    const qrId = params.get('qr');
    qrActual = null;
    mostrarAviso('');
    formulario.hidden = true;
    bloqueRapidos.hidden = true;
    sinQr.hidden = true;
    pintarDestino(null);
    campoPagador.value = campoPagador.value || pagadorGuardado();
    pintarBilletera();

    if (!qrId) {
        titulo.textContent = 'Escanea el QR del vendedor para pagar.';
        mostrarSinQr('Para pagar necesitas el código QR del puesto.');
        return;
    }

    titulo.textContent = 'Cargando…';
    try {
        qrActual = await obtenerQr(qrId);
    } catch (error) {
        titulo.textContent = error.status === 410 ? 'Este QR ya venció.' : 'No encontramos este QR.';
        mostrarSinQr('Pídele al vendedor que te muestre su código QR otra vez y vuelve a escanearlo.');
        return;
    }

    if (qrActual.usado) {
        titulo.textContent = 'Este QR ya se pagó: sirve para un solo pago.';
        mostrarSinQr('Si quieres pagar otra vez, pídele al vendedor un código QR nuevo.');
        return;
    }
    titulo.textContent = qrActual.descripcion
        ? `Pagarle a ${qrActual.vendedor} · ${qrActual.descripcion}`
        : `Pagarle a ${qrActual.vendedor}`;
    pintarDestino(qrActual);
    if (qrActual.monto) {
        campoMonto.value = formatearMonto(qrActual.monto);
        campoMonto.readOnly = true;
    } else {
        campoMonto.value = '';
        campoMonto.readOnly = false;
    }
    // La propina solo tiene sentido si el QR trae meseros a quienes repartirla (H5b).
    bloquePropina.hidden = !(qrActual.propina || qrActual.meseros?.length);
    formulario.elements.propina.value = '0';
    campoPropinaOtra.value = '';
    formulario.elements.pagosRapidos.checked = false;
    if (pendiente && !qrActual.monto) campoMonto.value = pendiente.monto || '';
    if (pendiente?.propina) {
        formulario.elements.propina.value = pendiente.propina;
        campoPropinaOtra.value = pendiente.propinaOtra || '';
    }
    formulario.hidden = false;
    await cargarPermiso();
    if (resultadoRapidos) mostrarAviso(AVISOS_RAPIDOS[resultadoRapidos] || `Pagos rápidos: ${resultadoRapidos}`);
});

formulario.addEventListener('input', actualizarTotal);
formulario.addEventListener('change', actualizarTotal);

seccion.querySelector('[data-cancelar-rapidos]').addEventListener('click', async () => {
    try {
        await cancelarPermiso(idCliente());
        mostrarAviso('Cancelaste los pagos rápidos. La próxima compra te pedirá aprobación.');
    } catch (error) {
        mostrarAviso(`⚠ No pudimos cancelar los pagos rápidos. Intenta otra vez. (${error.message})`);
    }
    await cargarPermiso();
});

formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarAviso('');

    const monto = montoBase();
    if (!monto) {
        mostrarAviso('⚠ Escribe cuánto vas a pagar, solo con números. Ejemplo: 3000');
        return;
    }
    const propina = propinaElegida(monto);
    if (formulario.elements.propina.value === 'otro' && !bloquePropina.hidden && !propina) {
        mostrarAviso('⚠ Escribe cuánto de propina, solo con números (ejemplo: 1000), o elige otra opción.');
        return;
    }
    const pagador = aWalletUrl(campoPagador.value);
    if (!esWalletUrl(pagador)) {
        billetera.open = true;
        mostrarAviso('⚠ La dirección de tu billetera debe empezar por https:// o por $');
        return;
    }
    recordarPagador(pagador);

    const cuerpo = { pagador, monto, clienteId: idCliente() };
    if (propina) cuerpo.propina = propina;

    boton.setAttribute('aria-busy', 'true');
    boton.disabled = true;
    try {
        // Activar pagos rápidos es un consentimiento aparte (tope semanal); al volver, la compra sale con un toque.
        if (!permisoActual.activo && formulario.elements.pagosRapidos.checked) {
            guardarCompraPendiente({
                qrId: qrActual.qrId,
                monto: campoMonto.value,
                propina: formulario.elements.propina.value,
                propinaOtra: campoPropinaOtra.value,
            });
            const { redirectUrl } = await activarPagosRapidos({ clienteId: idCliente(), pagador, tope: TOPE_RAPIDOS });
            location.href = redirectUrl;
            return;
        }
        const respuesta = await iniciarPago(qrActual.qrId, cuerpo);
        if (respuesta.redirectUrl) {
            location.href = respuesta.redirectUrl;   // pantalla de consentimiento de su wallet
        } else {
            location.hash = `recibo?pago=${encodeURIComponent(respuesta.pagoId)}`;   // pagos rápidos: sin consentimiento
        }
    } catch (error) {
        billetera.open = true;
        mostrarAviso(`⚠ No pudimos iniciar el pago. ${error.message.replace(/\.?$/, '.')}`);
    } finally {
        boton.removeAttribute('aria-busy');
        boton.disabled = false;
    }
});
