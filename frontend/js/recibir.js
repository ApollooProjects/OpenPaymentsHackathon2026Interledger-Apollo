// Recibir dinero (transferencia entre personas con QR). Quien cobra elige cómo le llega:
// - a su cuenta: POST /qr/transferencia, el pago va directo de wallet a wallet (sin reparto, sin Custodia, sin SMS);
// - en efectivo: POST /personas, el dinero queda en la Custodia a nombre de su cédula y sigue SMS → RETIRAR → PIN → Cajero.
// Quien paga abre el QR en la pestaña Cliente (#cliente?qr=…), igual que el de un puesto.
import { aWalletUrl, esWalletUrl } from './wallet.js';
import { alAbrirPestana, aMonto, crearQrTransferencia, formatearMonto, MONEDA_DEMO, registrarPersona, urlImagenQr } from './api.js';

const seccion = document.getElementById('recibir');
const formulario = seccion.querySelector('[data-pedir]');
const campos = formulario.elements;
const aviso = seccion.querySelector('[data-aviso]');
const resultado = seccion.querySelector('[data-qr-listo]');
const boton = formulario.querySelector('button[type=submit]');
const compartir = seccion.querySelector('[data-compartir]');

const DESPUES = {
    cuenta: [
        'Quien te va a pagar escanea el código con la cámara de su celular.',
        'Confirma el pago en su billetera.',
        'El dinero llega directo a tu billetera. Lo ves en tu cuenta en unos segundos.',
    ],
    efectivo: [
        'Quien te va a pagar escanea el código con la cámara de su celular y confirma en su billetera.',
        'Te llega un mensaje de texto al celular cuando el dinero esté listo.',
        'Responde RETIRAR y te mandamos un PIN.',
        'Ve a cualquier corresponsal con tu PIN y tu cédula, y te entregan todo tu saldo en efectivo.',
    ],
};

function destinoElegido() {
    return campos.destino.value;
}

function pintarOpcion() {
    const efectivo = destinoElegido() === 'efectivo';
    formulario.querySelector('[data-cuenta]').hidden = efectivo;
    formulario.querySelector('[data-efectivo]').hidden = !efectivo;
}

function mostrarAviso(texto) {
    aviso.textContent = texto;
    aviso.hidden = !texto;
    if (texto) aviso.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// Lo que ya se sabe del perfil (nombre y billetera), sin pisar lo escrito.
function rellenarDesdePerfil() {
    const perfil = window.LaCajita?.perfil();
    if (!perfil) return;
    if (!campos.nombre.value) campos.nombre.value = perfil.nombre;
    if (!campos.wallet.value && perfil.wallet) campos.wallet.value = perfil.wallet;
}

function mostrarResultado(qr, destino) {
    const enlace = seccion.querySelector('[data-enlace-qr]');
    const url = qr.url || `${location.origin}/#cliente?qr=${encodeURIComponent(qr.qrId)}`;
    seccion.querySelector('[data-titulo-qr]').textContent = destino === 'efectivo'
        ? `Código QR para pagarle a ${qr.nombre} en efectivo`
        : `Código QR para pagarle a ${qr.nombre} a su cuenta`;
    const monto = seccion.querySelector('[data-monto-qr]');
    const concepto = campos.concepto.value.trim();
    monto.textContent = [qr.monto ? formatearMonto(qr.monto) : '', concepto].filter(Boolean).join(' · ');
    monto.hidden = !monto.textContent;
    const imagen = seccion.querySelector('[data-imagen-qr]');
    imagen.src = urlImagenQr(qr.qrId);
    imagen.alt = `Código QR para pagarle a ${qr.nombre}`;
    enlace.href = url;
    enlace.textContent = url;
    compartir.dataset.url = url;
    compartir.dataset.texto = qr.monto
        ? `Págame ${formatearMonto(qr.monto)}${concepto ? ` (${concepto})` : ''} con La Cajita`
        : `Págame${concepto ? ` (${concepto})` : ''} con La Cajita`;
    seccion.querySelector('[data-despues]').replaceChildren(
        ...DESPUES[destino].map((texto) => Object.assign(document.createElement('li'), { textContent: texto })));
    formulario.hidden = true;
    resultado.hidden = false;
    resultado.focus();
}

formulario.addEventListener('change', pintarOpcion);

formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarAviso('');
    const destino = destinoElegido();
    const nombre = campos.nombre.value.trim();
    const textoMonto = campos.monto.value.trim();
    const monto = textoMonto ? aMonto(textoMonto, MONEDA_DEMO) : null;
    const concepto = campos.concepto.value.trim();

    if (!nombre) return mostrarAviso('⚠ Escribe tu nombre: quien paga lo verá.');
    if (textoMonto && !monto) return mostrarAviso('⚠ Escribe el monto solo con números (ejemplo: 20000) o déjalo vacío.');

    let cuerpo;
    if (destino === 'cuenta') {
        const wallet = aWalletUrl(campos.wallet.value);
        if (!esWalletUrl(wallet)) return mostrarAviso('⚠ Escribe la dirección de tu billetera. Ejemplo: $ilp.interledger-test.dev/mateo');
        cuerpo = { nombre, wallet };
    } else {
        const celular = campos.celular.value.replace(/\D/g, '');
        const cedula = campos.cedula.value.replace(/\D/g, '');
        if (celular.length < 10) return mostrarAviso('⚠ Escribe tu celular de 10 números. Ejemplo: 3001234567');
        if (!cedula) return mostrarAviso('⚠ Escribe tu cédula, solo con números.');
        cuerpo = { nombre, celular, cedula };
    }
    if (monto) cuerpo.monto = monto;
    if (concepto) cuerpo.concepto = concepto;

    boton.setAttribute('aria-busy', 'true');
    boton.disabled = true;
    try {
        const qr = destino === 'cuenta' ? await crearQrTransferencia(cuerpo) : await registrarPersona(cuerpo);
        mostrarResultado(qr, destino);
    } catch (error) {
        mostrarAviso(`⚠ No pudimos crear tu código QR. ${error.message.replace(/\.?$/, '.')}`);
    } finally {
        boton.removeAttribute('aria-busy');
        boton.disabled = false;
    }
});

compartir.addEventListener('click', async () => {
    const { url, texto } = compartir.dataset;
    try {
        if (navigator.share) {
            await navigator.share({ title: 'La Cajita', text: texto, url });
            return;
        }
        await navigator.clipboard.writeText(`${texto}: ${url}`);
        compartir.textContent = '✔ Enlace copiado';
        setTimeout(() => { compartir.textContent = 'Compartir enlace'; }, 2500);
    } catch {
        /* La persona cerró el menú de compartir o el navegador no deja copiar: el enlace sigue a la vista. */
    }
});

seccion.querySelector('[data-otro]').addEventListener('click', () => {
    resultado.hidden = true;
    formulario.hidden = false;
    campos.monto.value = '';
    campos.concepto.value = '';
    campos.monto.focus();
});

alAbrirPestana('recibir', () => {
    rellenarDesdePerfil();
    pintarOpcion();
});
