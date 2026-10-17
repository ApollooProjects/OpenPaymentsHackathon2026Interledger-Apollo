// Pestaña Celular (H9, H12): bandeja de SMS simulada de un celular básico.
// Quien no usa la app (vendedor de P2, destinatario de remesas) responde aquí SALDO, RETIRAR o MENU.
// Se puede abrir directo con /#celular?numero=<celular>.
import { alAbrirPestana, parametrosHash } from './api.js';

const seccion = document.getElementById('celular');
const formNumero = seccion.querySelector('[data-numero]');
const pantalla = seccion.querySelector('[data-pantalla]');
const formMensaje = seccion.querySelector('[data-mensaje]');
const aviso = seccion.querySelector('[data-aviso]');

let numeroActual = null;
let temporizador = null;
let ultimaCantidad = -1;

function numeroGuardado() {
    try { return localStorage.getItem('cajita.celular') || ''; } catch { return ''; }
}

function recordarNumero(numero) {
    try { localStorage.setItem('cajita.celular', numero); } catch { /* sin almacenamiento */ }
}

function hora(iso) {
    return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

function pintar(mensajes) {
    if (mensajes.length === ultimaCantidad) return;
    ultimaCantidad = mensajes.length;
    if (mensajes.length === 0) {
        pantalla.replaceChildren(Object.assign(document.createElement('p'), {
            className: 'vacio',
            textContent: 'Todavía no tienes mensajes. Toca «Menú» para empezar.'
        }));
        return;
    }
    pantalla.replaceChildren(...mensajes.map((sms) => {
        const burbuja = document.createElement('div');
        burbuja.className = `sms ${sms.dir}`;
        const texto = document.createElement('p');
        texto.textContent = sms.texto;
        const pie = document.createElement('small');
        pie.textContent = `${sms.dir === 'entrante' ? 'Tú' : 'La Cajita'} · ${hora(sms.hora)}`;
        burbuja.append(texto, pie);
        return burbuja;
    }));
    pantalla.scrollTop = pantalla.scrollHeight;
}

async function actualizar() {
    if (!numeroActual) return;
    try {
        const respuesta = await fetch(`/sms/${encodeURIComponent(numeroActual)}`);
        if (!respuesta.ok) throw new Error((await respuesta.json().catch(() => ({}))).error || `Error ${respuesta.status}`);
        pintar(await respuesta.json());
        aviso.hidden = true;
    } catch (error) {
        aviso.textContent = `⚠ No pudimos mostrar tus mensajes. Intenta otra vez. (${error.message})`;
        aviso.hidden = false;
    }
}

function abrir(numero) {
    numeroActual = numero.replace(/\D/g, '');
    ultimaCantidad = -1;
    formNumero.elements.numero.value = numeroActual;
    formMensaje.hidden = !numeroActual;
    pantalla.hidden = !numeroActual;
    if (!numeroActual) return;
    recordarNumero(numeroActual);
    actualizar();
}

// Mientras la pestaña está abierta, la bandeja se actualiza cada 3 s (llegan avisos de pagos y PIN).
function vigilar() {
    clearInterval(temporizador);
    temporizador = setInterval(() => {
        if (parametrosHash().pestana === 'celular') actualizar();
        else clearInterval(temporizador);
    }, 3000);
}

alAbrirPestana('celular', (params) => {
    abrir(params.get('numero') || numeroActual || numeroGuardado());
    vigilar();
});

formNumero.addEventListener('submit', (evento) => {
    evento.preventDefault();
    abrir(formNumero.elements.numero.value);
    if (numeroActual) document.querySelector('.telefono').scrollIntoView({ block: 'start' });
});

formMensaje.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const campo = formMensaje.elements.texto;
    const texto = campo.value.trim();
    if (!texto || !numeroActual) return;
    const boton = formMensaje.querySelector('button');
    boton.disabled = true;
    try {
        const respuesta = await fetch('/sms/entrante', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ celular: numeroActual, texto })
        });
        if (!respuesta.ok) throw new Error((await respuesta.json().catch(() => ({}))).error || `Error ${respuesta.status}`);
        campo.value = '';
        await actualizar();
    } catch (error) {
        aviso.textContent = `⚠ No pudimos enviar tu mensaje. Intenta otra vez. (${error.message})`;
        aviso.hidden = false;
    } finally {
        boton.disabled = false;
        campo.focus();
    }
});

seccion.querySelectorAll('[data-atajo]').forEach((boton) => {
    boton.addEventListener('click', () => {
        formMensaje.elements.texto.value = boton.dataset.atajo;
        formMensaje.requestSubmit();
    });
});
