// Pestaña Vendedor (H1, H2, H3, H4, H6, H7): configurar el reparto, ver saldo y barra del proveedor,
// retirar en efectivo y generar QR personalizados (monto, meseros, vigencia).
// Sin reparto configurado muestra el QR estático de la capa 1 (/#vendedor?qr=<id>, por defecto "demo").
import {
    alAbrirPestana, aMonto, crearQr, crearReparto, formatearMonto, obtenerQr, obtenerReparto, parametrosHash,
    retirarReparto, urlImagenQr, MONEDA_DEMO
} from './api.js';
import { pasoAPaso } from './pasos.js';
import { aWalletUrl, esWalletUrl } from './wallet.js';

const seccion = document.getElementById('vendedor');
const $ = (selector) => seccion.querySelector(selector);

const formConfigurar = $('[data-configurar]');
const panel = $('[data-panel]');
const personalizado = $('[data-personalizado]');
const formQr = personalizado.querySelector('form');
const aviso = $('[data-aviso]');
const avisoForm = $('[data-aviso-form]');
const tarjetaQr = $('.dos-columnas > .qr');
const asistente = pasoAPaso(formConfigurar);

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
    if (texto) elemento.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
        $('[data-ventas]').textContent = estado.ventas === 1 ? '1 venta' : `${estado.ventas} ventas`;
        $('[data-pagado]').textContent = formatearMonto(estado.proveedor.pagado);
        $('[data-deuda]').textContent = estado.proveedor.deuda ? formatearMonto(estado.proveedor.deuda) : 'sin deuda';
        const falta = deuda > pagado ? deuda - pagado : 0n;
        $('[data-falta]').textContent = falta > 0n ? `Faltan ${formatearMonto({ ...estado.proveedor.pagado, value: falta.toString() })} para saldar la deuda.` : '';
        $('[data-falta]').hidden = falta === 0n;
        $('[data-barra]').max = Number(deuda) || 1;
        $('[data-barra]').value = Number(pagado);
        $('[data-saldada]').hidden = !(deuda > 0n && pagado >= deuda);
        mostrarPendiente(estado.retiroPendiente);
        if (aviso.textContent.includes('No pudimos mostrar tus ventas')) mostrarAviso(aviso, '');
    } catch (error) {
        mostrarAviso(aviso, `⚠ No pudimos mostrar tus ventas. Intenta otra vez. (${error.message})`);
    }
}

// PIN pedido y todavía sin cobrar: se muestra junto al botón para que se vea que el retiro sí quedó listo.
let pendiente = null;
function mostrarPendiente(retiro) {
    pendiente ??= $('[data-retirar]').insertAdjacentElement('beforebegin', document.createElement('p'));
    pendiente.hidden = !retiro;
    // Con un PIN activo la explicación de cómo retirar ya está en el aviso del PIN.
    $('[data-ayuda-retiro]').hidden = Boolean(retiro) || reparto?.conCuenta;
    if (!retiro) return;
    const vence = new Date(retiro.vence).toLocaleString('es-CO', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    pendiente.className = 'pin-activo';
    pendiente.textContent = `🔑 Tienes un PIN listo para sacar ${formatearMonto(retiro.monto)}. Vence ${vence.replace(/\.$/, '')}. Llévalo con tu cédula a cualquier corresponsal.`;
}

function mostrarPanel() {
    formConfigurar.hidden = true;
    tarjetaQr.hidden = false;
    panel.hidden = false;
    personalizado.hidden = false;
    $('[data-cambiar]').hidden = false;
    $('[data-nombre]').textContent = reparto.conCuenta ? `Ventas de ${reparto.vendedor}` : `Cajita de ${reparto.vendedor}`;
    // Con cuenta el dinero ya está en su wallet: no hay nada que retirar (H7).
    $('[data-retirar]').hidden = reparto.conCuenta;
    $('[data-ayuda-retiro]').hidden = reparto.conCuenta;
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
    mostrarAviso(avisoForm, '');
    asistente.ir(0, { enfocar: false });
    marcarObligatorios();
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
    // Mientras configura, la única acción es el formulario; el QR simple solo se ve si el enlace lo pide.
    tarjetaQr.hidden = !params.get('qr');
    const qrId = params.get('qr') || 'demo';
    mostrarQr(qrId, 'QR del puesto');
    try {
        const qr = await obtenerQr(qrId);
        $('[data-qr-nombre]').textContent = `QR de ${qr.vendedor}`;
    } catch { /* se queda el texto genérico */ }
});

// ---------- Configurar el reparto (H1, H2) ----------

function marcarObligatorios() {
    const campos = formConfigurar.elements;
    const conCuenta = campos.conCuenta.value === 'si';
    $('[data-sin-cuenta]').hidden = conCuenta;
    $('[data-con-cuenta]').hidden = !conCuenta;
    campos.cedula.required = !conCuenta;
    campos.celular.required = !conCuenta;
    campos.walletVendedor.required = conCuenta;
    // Ahorro: si escribe el porcentaje, la billetera de ahorro pasa a ser obligatoria.
    campos.ahorroWallet.required = Number(campos.ahorroPorcentaje.value || 0) > 0;
}

formConfigurar.addEventListener('change', marcarObligatorios);
formConfigurar.addEventListener('input', marcarObligatorios);

formConfigurar.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const campos = formConfigurar.elements;
    const conCuenta = campos.conCuenta.value === 'si';
    const textoDeuda = campos.deuda.value.trim();
    const deuda = textoDeuda ? aMonto(textoDeuda, MONEDA_DEMO) : null;
    const cuerpo = {
        vendedor: campos.vendedor.value.trim(),
        conCuenta,
        proveedorWallet: aWalletUrl(campos.proveedorWallet.value),
        porcentaje: Number(campos.porcentaje.value),
        deuda: deuda?.value,   // el backend la recibe en centavos
    };
    const pctAhorro = Number(campos.ahorroPorcentaje.value || 0);
    if (pctAhorro > 0) {
        cuerpo.ahorroPorcentaje = pctAhorro;
        cuerpo.ahorroWallet = aWalletUrl(campos.ahorroWallet.value);
        if (!esWalletUrl(cuerpo.ahorroWallet)) return mostrarAviso(avisoForm, '⚠ Para ahorrar escribe también la billetera de ahorro. Debe empezar por https:// o por $');
    }
    if (conCuenta) cuerpo.vendedorWallet = aWalletUrl(campos.walletVendedor.value);
    else Object.assign(cuerpo, { cedula: campos.cedula.value.replace(/\D/g, ''), celular: campos.celular.value.replace(/\D/g, '') });

    if (textoDeuda && !deuda) return mostrarAviso(avisoForm, '⚠ Escribe lo que le debes solo con números (ejemplo: 40000). Si no le debes nada, déjalo vacío.');
    if (conCuenta && !esWalletUrl(cuerpo.vendedorWallet)) return mostrarAviso(avisoForm, '⚠ La dirección de tu billetera debe empezar por https:// o por $');
    if (!conCuenta && (!cuerpo.cedula || !cuerpo.celular)) return mostrarAviso(avisoForm, '⚠ Escribe tu cédula y tu celular: los necesitas para sacar tu dinero.');

    mostrarAviso(avisoForm, '');
    const boton = formConfigurar.querySelector('button[type=submit]');
    boton.setAttribute('aria-busy', 'true');
    try {
        const { id, qrId } = await crearReparto(cuerpo);
        reparto = { id, qrId, vendedor: cuerpo.vendedor, conCuenta, cedula: cuerpo.cedula, celular: cuerpo.celular };
        guardarReparto(reparto);
        location.hash = 'vendedor';
        mostrarPanel();
    } catch (error) {
        mostrarAviso(avisoForm, `⚠ No pudimos guardar tus datos. Revisa las billeteras e intenta otra vez. (${error.message})`);
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
            Object.assign(document.createElement('strong'), { textContent: '✅ Listo: te enviamos un mensaje con tu PIN.' }),
            Object.assign(document.createElement('span'), { textContent: 'Lleva el PIN y tu cédula a un corresponsal y te entregan todo tu dinero.' }),
            Object.assign(document.createElement('a'), { href: `#celular?numero=${reparto.celular}`, textContent: 'Ver el mensaje con el PIN' })
        );
        avisoRetiro.dataset.ok = 'true';
        avisoRetiro.hidden = false;
        actualizarPanel();
    } catch (error) {
        delete avisoRetiro.dataset.ok;
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
    // "wallet" → partes iguales; "wallet=70" → por porcentaje (C5.1). El backend valida que sumen 100.
    const meseros = campos.meseros.value.split(/[\s,]+/).filter(Boolean).map((texto) => {
        const [wallet, porcentaje] = texto.trim().split('=');
        const url = aWalletUrl(wallet);
        return porcentaje === undefined ? url : { wallet: url, porcentaje: Number(porcentaje.replace('%', '')) };
    });
    if (meseros.some((m) => !esWalletUrl(typeof m === 'string' ? m : m.wallet))) return mostrarAviso(aviso, '⚠ Cada billetera de mesero debe empezar por https:// o por $');

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
            meseros.length
                ? `propina para ${meseros.length} mesero${meseros.length > 1 ? 's' : ''}${typeof meseros[0] === 'object' ? ` (${meseros.map((m) => `${m.porcentaje} %`).join(' / ')})` : ''}`
                : null,
            vigenteHasta ? `vence ${new Date(vigenteHasta).toLocaleString('es-CO')}` : 'sin vigencia',
        ].filter(Boolean).join(' · ');
        nuevo.hidden = false;
        mostrarAviso(aviso, '');
    } catch (error) {
        mostrarAviso(aviso, `⚠ No pudimos crear el QR. Intenta otra vez. (${error.message})`);
    }
});
