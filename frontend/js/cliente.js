// Pestaña Cliente (H3, H5, H5b, H5c): escanea el QR → escribe el monto → (propina) → Pagar → consentimiento en su wallet.
// Con pagos rápidos activos la compra sale sin volver a aprobar.
import {
    alAbrirPestana, aMonto, cancelarPermiso, formatearMonto, iniciarPago, idCliente, obtenerPermiso, obtenerQr, MONEDA_DEMO
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

let qrActual = null;
let permisoActual = { activo: false };

seccion.querySelector('[data-tope]').textContent = formatearMonto(TOPE_RAPIDOS);

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
        return;
    }
    const total = { ...base, value: (BigInt(base.value) + BigInt(propina?.value || 0)).toString() };
    const rapido = permisoActual.activo && permisoActual.restante && BigInt(permisoActual.restante.value) >= BigInt(total.value);
    textoTotal.textContent = propina
        ? `Total: ${formatearMonto(total)} (${formatearMonto(base)} + ${formatearMonto(propina)} de propina)`
        : `Total: ${formatearMonto(total)}`;
    boton.textContent = rapido ? `⚡ Pagar ${formatearMonto(total)} sin volver a aprobar` : 'Pagar';
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
        seccion.querySelector('[data-restante]').textContent = formatearMonto(permisoActual.restante);
        seccion.querySelector('[data-tope-activo]').textContent = formatearMonto(permisoActual.tope);
    }
    actualizarTotal();
}

alAbrirPestana('cliente', async (params) => {
    const qrId = params.get('qr');
    qrActual = null;
    mostrarAviso('');
    formulario.hidden = true;
    bloqueRapidos.hidden = true;
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
    // La propina solo tiene sentido si el QR trae meseros a quienes repartirla (H5b).
    bloquePropina.hidden = !(qrActual.propina || qrActual.meseros?.length);
    formulario.elements.propina.value = '0';
    campoPropinaOtra.value = '';
    formulario.hidden = false;
    await cargarPermiso();
});

formulario.addEventListener('input', actualizarTotal);
formulario.addEventListener('change', actualizarTotal);

seccion.querySelector('[data-cancelar-rapidos]').addEventListener('click', async () => {
    try {
        await cancelarPermiso(idCliente());
        mostrarAviso('Cancelaste los pagos rápidos. La próxima compra te pedirá aprobación.');
    } catch (error) {
        mostrarAviso(`No se pudieron cancelar los pagos rápidos: ${error.message}`);
    }
    await cargarPermiso();
});

formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarAviso('');

    const monto = montoBase();
    if (!monto) {
        mostrarAviso('Escribe un monto válido.');
        return;
    }
    const propina = propinaElegida(monto);
    if (formulario.elements.propina.value === 'otro' && !bloquePropina.hidden && !propina) {
        mostrarAviso('Escribe un valor de propina válido o elige otra opción.');
        return;
    }
    const pagador = campoPagador.value.trim().replace(/^\$/, 'https://');
    if (!pagador.startsWith('https://')) {
        mostrarAviso('Tu wallet address empieza por https:// o $.');
        return;
    }
    recordarPagador(pagador);

    const cuerpo = { pagador, monto, clienteId: idCliente() };
    if (propina) cuerpo.propina = propina;
    if (!permisoActual.activo && formulario.elements.pagosRapidos.checked) cuerpo.pagosRapidos = { tope: TOPE_RAPIDOS };

    boton.setAttribute('aria-busy', 'true');
    boton.disabled = true;
    try {
        const respuesta = await iniciarPago(qrActual.qrId, cuerpo);
        if (respuesta.redirectUrl) {
            location.href = respuesta.redirectUrl;   // pantalla de consentimiento de su wallet
        } else {
            location.hash = `recibo?pago=${encodeURIComponent(respuesta.pagoId)}`;   // pagos rápidos: sin consentimiento
        }
    } catch (error) {
        mostrarAviso(`No se pudo iniciar el pago: ${error.message}`);
    } finally {
        boton.removeAttribute('aria-busy');
        boton.disabled = false;
    }
});
