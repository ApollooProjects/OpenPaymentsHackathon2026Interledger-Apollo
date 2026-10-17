// Pestaña Vendedor (H1, H2, H3, H4, H6, H7): configurar el reparto, ver saldo y barra del proveedor,
// retirar en efectivo y generar QR personalizados (monto, meseros, vigencia).
// Sin reparto configurado muestra el QR estático de la capa 1 (/#vendedor?qr=<id>, por defecto "demo").
import {
    alAbrirPestana, aMonto, crearQr, crearReparto, formatearMonto, obtenerQr, obtenerReparto, parametrosHash,
    retirarReparto, urlImagenQr, MONEDA_DEMO
} from './api.js';

const seccion = document.getElementById('vendedor');
const $ = (selector) => seccion.querySelector(selector);

const formConfigurar = $('[data-configurar]');
const panel = $('[data-panel]');
const personalizado = $('[data-personalizado]');
const formQr = personalizado.querySelector('form');
const aviso = $('[data-aviso]');

let reparto = null;   // { id, qrId, vendedor, conCuenta, cedula, celular }
let temporizador = null;

function leerReparto() {
    try { return JSON.parse(localStorage.getItem('cajita.reparto') || 'null'); } catch { return null; }
}

function guardarReparto(datos) {
    try { localStorage.setItem('cajita.reparto', JSON.stringify(datos)); } catch { /* sin almacenamiento */ }
}

function mostrarAviso(elemento, texto) {
    elemento.textContent = texto;
    elemento.hidden = !texto;
}

function mostrarQr(qrId, nombre) {
    const destino = `${location.origin}${location.search}#cliente?qr=${encodeURIComponent(qrId)}`;
    $('[data-qr]').src = urlImagenQr(qrId);
    $('[data-enlace]').href = destino;
    $('[data-enlace]').textContent = destino;
    $('[data-qr-nombre]').textContent = nombre;
}

async function actualizarPanel() {
    if (!reparto) return;
    try {
        const estado = await obtenerReparto(reparto.id);
        const pagado = BigInt(estado.proveedor.pagado.value);
        // Sin deuda (null) la barra muestra solo lo que ya recibió el proveedor.
        const deuda = estado.proveedor.deuda ? BigInt(estado.proveedor.deuda.value) : 0n;
        $('[data-saldo]').textContent = formatearMonto(estado.saldo);
        $('[data-ventas]').textContent = estado.ventas;
        $('[data-pagado]').textContent = formatearMonto(estado.proveedor.pagado);
        $('[data-deuda]').textContent = estado.proveedor.deuda ? formatearMonto(estado.proveedor.deuda) : 'sin deuda';
        $('[data-barra]').max = Number(deuda) || 1;
        $('[data-barra]').value = Number(pagado);
        $('[data-saldada]').hidden = !(deuda > 0n && pagado >= deuda);
        mostrarPendiente(estado.retiroPendiente);
        mostrarAviso(aviso, '');
    } catch (error) {
        mostrarAviso(aviso, `⚠ No pudimos mostrar tus ventas. Intenta otra vez. (${error.message})`);
    }
}

// PIN pedido y todavía sin cobrar: se muestra junto al botón para que se vea que el retiro sí quedó listo.
let pendiente = null;
function mostrarPendiente(retiro) {
    pendiente ??= $('[data-retirar]').insertAdjacentElement('beforebegin', document.createElement('p'));
    pendiente.hidden = !retiro;
    if (!retiro) return;
    const vence = new Date(retiro.vence).toLocaleString('es-CO', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    pendiente.textContent = `🔑 PIN activo por ${formatearMonto(retiro.monto)} · vence ${vence}. Llévalo con tu cédula a cualquier corresponsal.`;
}

function mostrarPanel() {
    formConfigurar.hidden = true;
    panel.hidden = false;
    personalizado.hidden = false;
    $('[data-cambiar]').hidden = false;
    $('[data-nombre]').textContent = reparto.conCuenta ? `Ventas de ${reparto.vendedor}` : `Cajita de ${reparto.vendedor}`;
    // Con cuenta el dinero ya está en su wallet: no hay nada que retirar (H7).
    $('[data-retirar]').hidden = reparto.conCuenta;
    mostrarQr(reparto.qrId, `QR de ${reparto.vendedor}`);
    actualizarPanel();
    clearInterval(temporizador);
    temporizador = setInterval(() => {
        if (parametrosHash().pestana === 'vendedor') actualizarPanel();
        else clearInterval(temporizador);
    }, 5000);
}

function mostrarConfigurar() {
    clearInterval(temporizador);
    panel.hidden = true;
    personalizado.hidden = true;
    $('[data-cambiar]').hidden = true;
    formConfigurar.hidden = false;
}

alAbrirPestana('vendedor', async (params) => {
    mostrarAviso(aviso, '');
    if (params.get('reparto') === 'nuevo') {
        reparto = null;
        mostrarConfigurar();
        return;
    }
    reparto = leerReparto();
    if (reparto) {
        mostrarPanel();
        return;
    }
    // Sin reparto: QR estático de la capa 1 y el formulario para configurar uno.
    mostrarConfigurar();
    const qrId = params.get('qr') || 'demo';
    mostrarQr(qrId, 'QR del puesto');
    try {
        const qr = await obtenerQr(qrId);
        $('[data-qr-nombre]').textContent = `QR de ${qr.vendedor}`;
    } catch { /* se queda el texto genérico */ }
});

// ---------- Configurar el reparto (H1, H2) ----------

formConfigurar.addEventListener('change', () => {
    const conCuenta = formConfigurar.elements.conCuenta.value === 'si';
    $('[data-sin-cuenta]').hidden = conCuenta;
    $('[data-con-cuenta]').hidden = !conCuenta;
});

formConfigurar.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const campos = formConfigurar.elements;
    const conCuenta = campos.conCuenta.value === 'si';
    const textoDeuda = campos.deuda.value.trim();
    const deuda = textoDeuda ? aMonto(textoDeuda, MONEDA_DEMO) : null;
    const cuerpo = {
        vendedor: campos.vendedor.value.trim(),
        conCuenta,
        proveedorWallet: campos.proveedorWallet.value.trim(),
        porcentaje: Number(campos.porcentaje.value),
        deuda: deuda?.value,   // el backend la recibe en centavos
    };
    if (conCuenta) cuerpo.vendedorWallet = campos.walletVendedor.value.trim().replace(/^\$/, 'https://');
    else Object.assign(cuerpo, { cedula: campos.cedula.value.replace(/\D/g, ''), celular: campos.celular.value.replace(/\D/g, '') });

    if (textoDeuda && !deuda) return mostrarAviso(aviso, '⚠ Escribe lo que le debes solo con números (ejemplo: 40000). Si no le debes nada, déjalo vacío.');
    if (conCuenta && !cuerpo.vendedorWallet.startsWith('https://')) return mostrarAviso(aviso, '⚠ La dirección de tu billetera debe empezar por https:// o por $');
    if (!conCuenta && (!cuerpo.cedula || !cuerpo.celular)) return mostrarAviso(aviso, '⚠ Escribe tu cédula y tu celular: los necesitas para sacar tu dinero.');

    const boton = formConfigurar.querySelector('button');
    boton.setAttribute('aria-busy', 'true');
    try {
        const { id, qrId } = await crearReparto(cuerpo);
        reparto = { id, qrId, vendedor: cuerpo.vendedor, conCuenta, cedula: cuerpo.cedula, celular: cuerpo.celular };
        guardarReparto(reparto);
        location.hash = 'vendedor';
        mostrarPanel();
    } catch (error) {
        mostrarAviso(aviso, `⚠ No pudimos guardar tus datos. Revisa las billeteras e intenta otra vez. (${error.message})`);
    } finally {
        boton.removeAttribute('aria-busy');
    }
});

// ---------- Retirar (H7) ----------

$('[data-retirar]').addEventListener('click', async () => {
    const boton = $('[data-retirar]');
    const avisoRetiro = $('[data-aviso-retiro]');
    boton.setAttribute('aria-busy', 'true');
    boton.disabled = true;
    try {
        const resultado = await retirarReparto(reparto.id);
        if (resultado.ok === false) throw new Error(resultado.error);
        avisoRetiro.replaceChildren(
            '✅ Listo: te enviamos un mensaje con tu PIN. ',
            Object.assign(document.createElement('a'), { href: `#celular?numero=${reparto.celular}`, textContent: 'Ver el mensaje' })
        );
        avisoRetiro.hidden = false;
        actualizarPanel();
    } catch (error) {
        mostrarAviso(avisoRetiro, `⚠ No pudimos hacer el retiro. Intenta otra vez. (${error.message})`);
    } finally {
        boton.removeAttribute('aria-busy');
        boton.disabled = false;
    }
});

// ---------- QR personalizado (H4, H5b) ----------

formQr.elements.vigencia.addEventListener('change', () => {
    $('[data-fecha]').hidden = formQr.elements.vigencia.value !== 'fecha';
});

function vigenciaElegida() {
    const opcion = formQr.elements.vigencia.value;
    if (opcion === 'hoy') {
        const fin = new Date();
        fin.setHours(23, 59, 59, 0);
        return fin.toISOString();
    }
    if (opcion === 'turno') return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    if (opcion === 'fecha' && formQr.elements.vigenteHasta.value) return new Date(formQr.elements.vigenteHasta.value).toISOString();
    return null;
}

formQr.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const campos = formQr.elements;
    const meseros = campos.meseros.value.split(/[\s,]+/).map((m) => m.trim().replace(/^\$/, 'https://')).filter(Boolean);
    if (meseros.some((m) => !m.startsWith('https://'))) return mostrarAviso(aviso, '⚠ Cada billetera de mesero debe empezar por https:// o por $');

    const cuerpo = { vendedor: reparto.vendedor, repartoId: reparto.id, tipo: 'personalizado' };
    if (campos.monto.value.trim()) {
        cuerpo.monto = aMonto(campos.monto.value, MONEDA_DEMO);
        if (!cuerpo.monto) return mostrarAviso(aviso, '⚠ Escribe el monto solo con números. Ejemplo: 9000');
    }
    if (campos.descripcion.value.trim()) cuerpo.descripcion = campos.descripcion.value.trim();
    if (meseros.length) cuerpo.meseros = meseros;
    const vigenteHasta = vigenciaElegida();
    if (vigenteHasta) cuerpo.vigenteHasta = vigenteHasta;

    try {
        const { qrId, url } = await crearQr(cuerpo);
        const destino = url || `${location.origin}${location.search}#cliente?qr=${encodeURIComponent(qrId)}`;
        const nuevo = $('[data-qr-nuevo]');
        nuevo.querySelector('img').src = urlImagenQr(qrId);
        $('[data-enlace-nuevo]').href = destino;
        $('[data-enlace-nuevo]').textContent = destino;
        $('[data-qr-detalle]').textContent = [
            cuerpo.monto ? `${formatearMonto(cuerpo.monto)} · un solo pago` : 'El cliente escribe el monto',
            meseros.length ? `propina para ${meseros.length} mesero${meseros.length > 1 ? 's' : ''}` : null,
            vigenteHasta ? `vence ${new Date(vigenteHasta).toLocaleString('es-CO')}` : 'sin vigencia',
        ].filter(Boolean).join(' · ');
        nuevo.hidden = false;
        mostrarAviso(aviso, '');
    } catch (error) {
        mostrarAviso(aviso, `⚠ No pudimos crear el QR. Intenta otra vez. (${error.message})`);
    }
});
