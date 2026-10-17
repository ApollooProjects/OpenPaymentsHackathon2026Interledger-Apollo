// Punto aliado La Cajita: el tendero escribe cédula + PIN → POST /retiros/validar → la Custodia le paga a este
// punto por Open Payments (Custodia → Corresponsal) → solo si el pago se confirma, se muestra "Entrega $X".

const CLAVE_HISTORIAL = 'cajita-corresponsal-historial';
const ESPERA_MS = 2500;
const REINTENTOS_PROCESANDO = 6;

const $ = (selector) => document.querySelector(selector);
const pasos = [...document.querySelectorAll('[data-paso]')];
const formulario = $('[data-formulario]');
const campoCedula = formulario.elements.cedula;
const campoPin = formulario.elements.pin;
const botonRevisar = $('[data-revisar]');
const anuncio = $('[data-anuncio]');

const soloDigitos = (texto) => String(texto ?? '').replace(/\D/g, '');
const mascaraCedula = (cedula) => `•••• ${soloDigitos(cedula).slice(-4)}`;
const fragmentoId = (url) => String(url ?? '').split('/').filter(Boolean).pop() ?? '';

// Misma regla que el backend (retiros.formatear): el monto viene con el assetCode/assetScale de la wallet.
function formatear(monto) {
    if (!monto) return '';
    return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: monto.assetCode || 'COP',
        maximumFractionDigits: monto.assetCode === 'COP' ? 0 : 2
    }).format(Number(monto.value) / 10 ** (monto.assetScale ?? 0));
}

const formatoHora = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit' });
const formatoFechaHora = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
const claveDia = (fecha) => new Date(fecha).toLocaleDateString('en-CA');

// ---------- Pantallas ----------

function mostrarPaso(nombre) {
    for (const paso of pasos) paso.hidden = paso.dataset.paso !== nombre;
    const titulo = document.querySelector(`[data-paso="${nombre}"] h1, [data-paso="${nombre}"] h2`);
    if (nombre !== 'datos') titulo?.focus();
    window.scrollTo({ top: 0, behavior: 'instant' });
}

function anunciar(texto) {
    anuncio.textContent = '';
    requestAnimationFrame(() => { anuncio.textContent = texto; });
}

function nuevoRetiro({ conservar = false } = {}) {
    if (!conservar) formulario.reset();
    limpiarErroresCampos();
    mostrarPaso('datos');
    (conservar ? campoPin : campoCedula).focus();
    if (conservar) campoPin.select();
}

// ---------- Validación local ----------

function errorCampo(campo, texto) {
    const nodo = document.querySelector(`[data-error-de="${campo.name}"]`);
    nodo.textContent = texto;
    nodo.hidden = !texto;
    campo.setAttribute('aria-invalid', texto ? 'true' : 'false');
}

function limpiarErroresCampos() {
    errorCampo(campoCedula, '');
    errorCampo(campoPin, '');
}

function validarCampos() {
    const cedula = soloDigitos(campoCedula.value);
    const pin = soloDigitos(campoPin.value);
    limpiarErroresCampos();
    let primero = null;
    if (cedula.length < 5 || cedula.length > 12) {
        errorCampo(campoCedula, cedula ? 'Revisa la cédula: debe tener entre 5 y 12 dígitos.' : 'Escribe la cédula de la persona.');
        primero ??= campoCedula;
    }
    if (pin.length !== 8) {
        errorCampo(campoPin, pin ? `El PIN tiene 8 dígitos (van ${pin.length}).` : 'Escribe el PIN que le llegó por SMS.');
        primero ??= campoPin;
    }
    if (primero) {
        primero.focus();
        return null;
    }
    return { cedula, pin };
}

// Cédula: solo dígitos. PIN: 0000-0000 mientras se escribe (también si lo pegan con o sin guion).
campoCedula.addEventListener('input', () => {
    campoCedula.value = soloDigitos(campoCedula.value).slice(0, 12);
});
campoPin.addEventListener('input', () => {
    const digitos = soloDigitos(campoPin.value).slice(0, 8);
    campoPin.value = digitos.length > 4 ? `${digitos.slice(0, 4)}-${digitos.slice(4)}` : digitos;
});
campoCedula.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter') {
        evento.preventDefault();
        campoPin.focus();
    }
});

// ---------- Llamada al backend ----------

async function validarRetiro({ cedula, pin }) {
    let respuesta;
    try {
        respuesta = await fetch('/retiros/validar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cedula, pin })
        });
    } catch {
        return { ok: false, status: 0, error: '' };
    }
    const datos = await respuesta.json().catch(() => ({}));
    return { status: respuesta.status, ...datos };
}

// El backend responde el error en texto para la persona; aquí se traduce a qué debe hacer el tendero.
function clasificar(respuesta) {
    const texto = String(respuesta.error ?? '');
    if (respuesta.status === 202 || respuesta.estado === 'procesando' || /se está procesando/i.test(texto)) return 'procesando';
    if (respuesta.status === 0) return 'red';
    if (/incorrect/i.test(texto)) return 'pin';
    if (/venci/i.test(texto)) return 'vencido';
    if (/ya se usó|ya se entregó/i.test(texto)) return 'retirado';
    if (/reemplaz|ya no es válido/i.test(texto)) return 'reemplazado';
    if (respuesta.status >= 500 || /custodia|no pudimos completar|comunicarnos|intenta de nuevo/i.test(texto)) return 'custodia';
    return 'otro';
}

const ERRORES = {
    pin: {
        titulo: 'PIN o cédula incorrectos',
        accion: 'Pídele a la persona que revise el último SMS de La Cajita y su documento, y escríbelos otra vez.',
        primario: ['Corregir datos', () => nuevoRetiro({ conservar: true })],
        secundario: ['Nuevo retiro', () => nuevoRetiro()]
    },
    vencido: {
        titulo: 'El PIN venció',
        accion: 'El PIN dura 24 horas. La persona debe responder RETIRAR al SMS de La Cajita para recibir uno nuevo. Su dinero sigue a su nombre.',
        primario: ['Atender a otro cliente', () => nuevoRetiro()]
    },
    retirado: {
        titulo: 'Este retiro ya se entregó',
        accion: 'Ese PIN ya se usó y el dinero ya salió. No lo entregues otra vez.',
        primario: ['Atender a otro cliente', () => nuevoRetiro()]
    },
    reemplazado: {
        titulo: 'Ese PIN ya no sirve',
        accion: 'La persona pidió un PIN más reciente. Debe usar el último que le llegó por SMS o responder RETIRAR para pedir uno nuevo.',
        primario: ['Escribir otro PIN', () => nuevoRetiro({ conservar: true })],
        secundario: ['Nuevo retiro', () => nuevoRetiro()]
    },
    procesando: {
        titulo: 'El pago sigue en proceso',
        accion: 'La Custodia todavía está pagándole a este punto. Vuelve a revisar en unos segundos con los mismos datos.',
        noEntregues: 'Todavía no entregues dinero.',
        primario: ['Revisar de nuevo', () => revisar(ultimoIntento)],
        secundario: ['Nuevo retiro', () => nuevoRetiro()]
    },
    custodia: {
        titulo: 'La Custodia no pudo pagar',
        accion: 'El dinero sigue a nombre de la persona y su PIN sigue sirviendo. Intenta de nuevo en un momento.',
        primario: ['Intentar de nuevo', () => revisar(ultimoIntento)],
        secundario: ['Nuevo retiro', () => nuevoRetiro()]
    },
    red: {
        titulo: 'Sin conexión con La Cajita',
        accion: 'Revisa el internet de este equipo y vuelve a revisar con los mismos datos.',
        primario: ['Intentar de nuevo', () => revisar(ultimoIntento)],
        secundario: ['Nuevo retiro', () => nuevoRetiro()]
    },
    otro: {
        titulo: 'No se pudo validar el retiro',
        accion: 'Revisa la cédula y el PIN con la persona e intenta otra vez.',
        primario: ['Corregir datos', () => nuevoRetiro({ conservar: true })],
        secundario: ['Nuevo retiro', () => nuevoRetiro()]
    }
};

let accionesError = {};

function mostrarError(tipo, respuesta) {
    const config = ERRORES[tipo];
    const tarjeta = $('[data-paso="error"]');
    tarjeta.dataset.tipo = tipo;
    $('[data-no-entregues]').innerHTML = `<strong>${config.noEntregues ?? 'No entregues dinero.'}</strong>`;
    $('[data-error-titulo]').textContent = config.titulo;
    $('[data-error-accion]').textContent = config.accion;
    const detalle = respuesta.error && respuesta.error !== config.titulo ? `Mensaje del sistema: ${respuesta.error}` : '';
    $('[data-error-detalle]').textContent = detalle;
    $('[data-error-detalle]').hidden = !detalle;

    const primario = $('[data-error-primario]');
    const secundario = $('[data-error-secundario]');
    primario.textContent = config.primario[0];
    accionesError = { primario: config.primario[1], secundario: config.secundario?.[1] };
    secundario.hidden = !config.secundario;
    if (config.secundario) secundario.textContent = config.secundario[0];

    mostrarPaso('error');
    anunciar(`${config.noEntregues ?? 'No entregues dinero.'} ${config.titulo}.`);
}

$('[data-error-primario]').addEventListener('click', () => accionesError.primario?.());
$('[data-error-secundario]').addEventListener('click', () => accionesError.secundario?.());

// ---------- Flujo ----------

let ultimoIntento = null;
let retiroActual = null;
let ocupado = false;

async function revisar(datos) {
    if (ocupado || !datos) return;
    ocupado = true;
    ultimoIntento = datos;
    botonRevisar.disabled = true;
    $('[data-texto-espera]').textContent = 'La Custodia le está pagando a este punto por Open Payments.';
    mostrarPaso('revisando');
    anunciar('Confirmando el pago. Todavía no entregues dinero.');
    try {
        // 202 = el pago al corresponsal sigue en proceso: se vuelve a validar sola unas veces antes de pedir al tendero.
        let respuesta;
        for (let intento = 0; intento < REINTENTOS_PROCESANDO; intento += 1) {
            respuesta = await validarRetiro(datos);
            if (respuesta.ok || clasificar(respuesta) !== 'procesando') break;
            $('[data-texto-espera]').textContent = 'El pago sigue en proceso. Esperando la confirmación…';
            await new Promise((listo) => setTimeout(listo, ESPERA_MS));
        }
        // Solo un "entregado" explícito del backend habilita la entrega del efectivo.
        if (respuesta.ok && respuesta.estado === 'entregado' && respuesta.monto) {
            mostrarEntrega(datos, respuesta);
        } else {
            mostrarError(respuesta.ok ? 'otro' : clasificar(respuesta), respuesta);
        }
    } finally {
        ocupado = false;
        botonRevisar.disabled = false;
    }
}

function mostrarEntrega(datos, respuesta) {
    retiroActual = {
        id: respuesta.retiroId ?? null,
        cedula: mascaraCedula(datos.cedula),
        monto: respuesta.monto,
        incomingPayment: respuesta.incomingPayment ?? null,
        outgoingPayment: respuesta.outgoingPayment ?? null,
        fecha: respuesta.fecha ?? new Date().toISOString()
    };
    formulario.reset();
    ultimoIntento = null;
    $('[data-monto]').textContent = formatear(retiroActual.monto);
    $('[data-cedula-mascara]').textContent = retiroActual.cedula;
    // El retiro queda en el historial apenas el pago se confirma: el dinero ya salió de la Custodia hacia este punto.
    guardarEnHistorial(retiroActual);
    mostrarPaso('entregar');
    anunciar(`Pago confirmado. Entrega ${formatear(retiroActual.monto)} en efectivo.`);
}

function mostrarComprobante() {
    const r = retiroActual;
    if (!r) return nuevoRetiro();
    $('[data-comp-monto]').textContent = formatear(r.monto);
    $('[data-comp-hora]').textContent = formatoFechaHora.format(new Date(r.fecha));
    $('[data-comp-cedula]').textContent = r.cedula;
    const filas = [
        ['[data-comp-retiro]', r.id],
        ['[data-comp-pago]', r.outgoingPayment],
        ['[data-comp-cobro]', r.incomingPayment]
    ];
    for (const [selector, valor] of filas) {
        const nodo = $(selector);
        nodo.textContent = valor ? fragmentoId(valor) : '';
        nodo.title = valor ?? '';
        nodo.closest('div').hidden = !valor;
    }
    mostrarPaso('comprobante');
}

formulario.addEventListener('submit', (evento) => {
    evento.preventDefault();
    const datos = validarCampos();
    if (datos) revisar(datos);
});
$('[data-ya-entregue]').addEventListener('click', mostrarComprobante);
$('[data-siguiente]').addEventListener('click', () => {
    retiroActual = null;
    nuevoRetiro();
});

// ---------- Historial del punto (solo este navegador) ----------

function leerHistorial() {
    try {
        const lista = JSON.parse(localStorage.getItem(CLAVE_HISTORIAL) ?? '[]');
        return Array.isArray(lista) ? lista : [];
    } catch {
        return [];
    }
}

let historialEnMemoria = leerHistorial();

function guardarEnHistorial(retiro) {
    const semana = Date.now() - 7 * 24 * 60 * 60 * 1000;
    historialEnMemoria = [retiro, ...historialEnMemoria.filter((r) => new Date(r.fecha).getTime() > semana)];
    try {
        localStorage.setItem(CLAVE_HISTORIAL, JSON.stringify(historialEnMemoria));
    } catch {
        // Sin almacenamiento (modo privado): el historial vive solo mientras la pestaña esté abierta.
    }
    pintarHistorial();
}

function pintarHistorial() {
    const hoy = claveDia(new Date());
    const deHoy = historialEnMemoria.filter((r) => claveDia(r.fecha) === hoy);
    const lista = $('[data-historial]');
    lista.replaceChildren(...deHoy.map((r) => {
        const item = document.createElement('li');
        const hora = Object.assign(document.createElement('span'), { className: 'historial-hora', textContent: formatoHora.format(new Date(r.fecha)) });
        const cedula = Object.assign(document.createElement('span'), { className: 'historial-cedula', textContent: r.cedula });
        if (r.outgoingPayment) {
            cedula.append(Object.assign(document.createElement('small'), {
                textContent: `Pago …${fragmentoId(r.outgoingPayment).slice(-8)}`,
                title: r.outgoingPayment
            }));
        }
        const monto = Object.assign(document.createElement('span'), { className: 'historial-monto', textContent: formatear(r.monto) });
        item.append(hora, cedula, monto);
        return item;
    }));
    $('[data-historial-vacio]').hidden = deHoy.length > 0;
    $('[data-cuenta]').textContent = `${deHoy.length} ${deHoy.length === 1 ? 'retiro' : 'retiros'}`;

    const base = deHoy[0]?.monto ?? { value: '0', assetCode: 'COP', assetScale: 2 };
    const total = deHoy
        .filter((r) => r.monto.assetCode === base.assetCode && r.monto.assetScale === base.assetScale)
        .reduce((suma, r) => suma + BigInt(r.monto.value), 0n);
    $('[data-total-dia]').textContent = formatear({ ...base, value: total.toString() });
}

pintarHistorial();
campoCedula.focus();
