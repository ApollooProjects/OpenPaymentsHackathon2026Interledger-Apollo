// Enrutador de la app: rutas con hash (#/inicio, #/cobrar…), sesión y barra de navegación.
import { api } from './api.js';
import { icono } from './iconos.js';
import { esc } from './ui.js';
import * as acceso from './pantallas-acceso.js';
import * as cuenta from './pantallas-cuenta.js';
import * as acciones from './pantallas-acciones.js';

const raiz = document.getElementById('pantalla');
const barra = document.getElementById('barra');
const marco = document.getElementById('marco');

// publica: no pide sesión · onboarding: sesión sin registro terminado · el resto: sesión con registro completo.
const RUTAS = [
    { patron: /^$/, pantalla: acceso.portada, publica: true },
    { patron: /^entrar$/, pantalla: acceso.entrar, publica: true },
    { patron: /^codigo$/, pantalla: acceso.codigo, publica: true },
    { patron: /^bienvenida(?:\/(\w+))?$/, pantalla: acceso.bienvenida, onboarding: true },
    { patron: /^inicio$/, pantalla: cuenta.inicio, menu: 'inicio' },
    { patron: /^movimientos$/, pantalla: cuenta.movimientos, menu: 'movimientos' },
    { patron: /^movimiento\/([\w-]+)$/, pantalla: cuenta.movimiento, menu: 'movimientos' },
    { patron: /^perfil$/, pantalla: cuenta.perfil, menu: 'perfil' },
    { patron: /^cobrar$/, pantalla: acciones.cobrar, menu: 'cobrar' },
    { patron: /^pagar(?:\/([\w-]+))?$/, pantalla: acciones.pagar, menu: 'pagar' },
    { patron: /^enviar$/, pantalla: acciones.enviar, menu: 'inicio' },
    { patron: /^retirar$/, pantalla: acciones.retirar, menu: 'inicio' },
    { patron: /^pago\/([\w-]+)$/, pantalla: acciones.pago, menu: 'movimientos' }
];

const MENU = [
    { id: 'inicio', texto: 'Inicio', icono: 'inicio' },
    { id: 'movimientos', texto: 'Movimientos', icono: 'lista' },
    { id: 'pagar', texto: 'Pagar', icono: 'escanear', central: true },
    { id: 'cobrar', texto: 'Cobrar', icono: 'qr' },
    { id: 'perfil', texto: 'Perfil', icono: 'usuario' }
];

const estado = { usuario: undefined };

export const ir = (ruta) => {
    const destino = `#/${ruta}`;
    if (location.hash === destino) mostrar();
    else location.hash = destino;
};

async function cargarUsuario() {
    try {
        estado.usuario = (await api.yo()).usuario;
    } catch {
        estado.usuario = null;
    }
    return estado.usuario;
}

function pintarBarra(activo) {
    barra.innerHTML = `
        <a class="marca marca-barra" href="#/inicio"><span class="logo">${icono('caja')}</span>La Cajita</a>
        ${MENU.map((m) => `
            <a href="#/${m.id}" class="${m.central ? 'central' : ''}" ${m.id === activo ? 'aria-current="page"' : ''}>
                ${m.central ? `<span class="burbuja">${icono(m.icono)}</span>` : icono(m.icono)}
                <span>${esc(m.texto)}</span>
            </a>`).join('')}`;
}

let enCurso = 0;
async function mostrar() {
    const turno = ++enCurso;
    const ruta = location.hash.replace(/^#\/?/, '').split('?')[0];
    const coincidencia = RUTAS.map((r) => ({ r, m: ruta.match(r.patron) })).find((x) => x.m);
    if (!coincidencia) return ir('');
    const { r, m } = coincidencia;

    if (estado.usuario === undefined) await cargarUsuario();
    const u = estado.usuario;

    // Guardas de sesión y registro.
    if (!r.publica && !u) return ir('');
    if (u && !u.tipo && !r.onboarding) return ir('bienvenida');
    if (u && u.tipo && (r.publica || r.onboarding)) return ir('inicio');

    const conBarra = Boolean(r.menu);
    barra.hidden = !conBarra;
    marco.classList.toggle('con-barra', conBarra);
    raiz.classList.toggle('sin-barra', !conBarra);
    if (conBarra) pintarBarra(r.menu);

    raiz.innerHTML = '<div class="cargando-pantalla" role="status"><span class="oculto-visual">Cargando…</span></div>';
    const ctx = {
        raiz,
        api,
        usuario: u,
        ir,
        vigente: () => turno === enCurso,
        recargarUsuario: async () => { await cargarUsuario(); return estado.usuario; },
        olvidarUsuario: () => { estado.usuario = null; }
    };
    try {
        await r.pantalla(ctx, ...m.slice(1));
    } catch (error) {
        console.error(error);
        if (error.status === 401) { estado.usuario = null; return ir(''); }
        raiz.innerHTML = `<div class="vacio"><div class="ico-grande">${icono('alerta')}</div><h2>No pudimos cargar esta pantalla</h2><p class="suave">${esc(error.message)}</p><button class="boton secundario" type="button" id="reintentar">Intentar de nuevo</button></div>`;
        raiz.querySelector('#reintentar').addEventListener('click', mostrar);
    }
    if (turno !== enCurso) return;
    // Lleva el foco al título para lectores de pantalla y teclado.
    const titulo = raiz.querySelector('h1');
    if (titulo) { titulo.setAttribute('tabindex', '-1'); titulo.focus({ preventScroll: true }); }
    window.scrollTo(0, 0);
}

window.addEventListener('hashchange', mostrar);
mostrar();
