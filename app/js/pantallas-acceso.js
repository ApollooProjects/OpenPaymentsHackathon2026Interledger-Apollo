// Portada, entrar con celular, código de 6 dígitos y registro (nombre → cómo recibir).
import { icono } from './iconos.js';
import { esc, toast, conEspera, montarCodigo, celularBonito } from './ui.js';

const CLAVE_CELULAR = 'cajita_celular';
const ESPERA_REENVIO = 30;

export function portada({ raiz }) {
    raiz.innerHTML = `
        <div class="portada">
            <header><span class="marca"><span class="logo">${icono('caja')}</span>La Cajita</span></header>
            <section class="heroe" aria-labelledby="titulo-portada">
                <div class="ilustracion" aria-hidden="true">
                    <span class="moneda m1">$</span><span class="moneda m2">$</span><span class="moneda m3">$</span>
                    <span class="caja">${icono('caja')}</span>
                </div>
                <h1 id="titulo-portada">Recibe, paga y envía dinero, <em>con o sin cuenta de banco</em></h1>
                <p class="suave">Solo necesitas tu celular. Si no tienes cuenta, retiras en efectivo con tu cédula.</p>
                <ul class="beneficios">
                    <li>${icono('qr')} Cobra con tu QR</li>
                    <li>${icono('enviar')} Recibe dinero del exterior</li>
                    <li>${icono('retirar')} Retira en un corresponsal cerca de ti</li>
                </ul>
            </section>
            <div class="pila">
                <a class="boton" href="#/entrar">Crear cuenta</a>
                <a class="boton fantasma" href="#/entrar">Ya tengo cuenta: entrar</a>
            </div>
        </div>`;
    raiz.classList.add('sin-barra');
}

function encabezadoAtras(href, titulo = '') {
    return `<div class="encabezado"><a class="icono-boton" href="${href}" aria-label="Volver">${icono('atras')}</a>${titulo ? `<span class="suave">${esc(titulo)}</span>` : ''}</div>`;
}

export function entrar({ raiz, api, ir }) {
    const anterior = sessionStorage.getItem(CLAVE_CELULAR) ?? '';
    raiz.innerHTML = `
        ${encabezadoAtras('#/')}
        <h1>¿Cuál es tu celular?</h1>
        <p class="suave">Te enviaremos un código por SMS para entrar. No necesitas contraseña.</p>
        <form id="form" novalidate>
            <div class="campo">
                <label for="celular">Número de celular</label>
                <div class="con-prefijo">
                    <span class="prefijo" aria-hidden="true">+57</span>
                    <input class="entrada" id="celular" name="celular" type="tel" inputmode="numeric" autocomplete="tel-national"
                        placeholder="300 123 4567" maxlength="12" value="${esc(celularBonito(anterior))}" aria-describedby="error-celular">
                </div>
                <span class="mensaje-error" id="error-celular" aria-live="polite"></span>
            </div>
            <div class="pila-abajo">
                <button class="boton" type="submit">Enviar código</button>
                <p class="suave chico centro">Al continuar aceptas recibir mensajes de La Cajita en este número.</p>
            </div>
        </form>`;
    const campo = raiz.querySelector('#celular');
    const error = raiz.querySelector('#error-celular');
    campo.addEventListener('input', () => {
        campo.value = celularBonito(campo.value);
        campo.removeAttribute('aria-invalid');
        error.textContent = '';
    });
    raiz.querySelector('#form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const celular = campo.value.replace(/\D/g, '');
        if (celular.length !== 10 || !celular.startsWith('3')) {
            campo.setAttribute('aria-invalid', 'true');
            error.textContent = 'Escribe los 10 dígitos de tu celular. Empieza por 3.';
            campo.focus();
            return;
        }
        await conEspera(e.submitter, async () => {
            try {
                const r = await api.pedirCodigo(celular);
                sessionStorage.setItem(CLAVE_CELULAR, celular);
                sessionStorage.setItem('cajita_enviado_a', r.enviadoA ?? '');
                sessionStorage.setItem('cajita_codigo_hora', String(Date.now()));
                if (r.codigoDePrueba) toast(`Modo de prueba: tu código es ${r.codigoDePrueba}`, { ms: 8000 });
                ir('codigo');
            } catch (err) {
                error.textContent = err.message;
                campo.setAttribute('aria-invalid', 'true');
            }
        });
    });
}

export function codigo({ raiz, api, ir, recargarUsuario }) {
    const celular = sessionStorage.getItem(CLAVE_CELULAR);
    if (!celular) return ir('entrar');
    const enviadoA = sessionStorage.getItem('cajita_enviado_a') || `•••• ${celular.slice(-4)}`;
    raiz.innerHTML = `
        ${encabezadoAtras('#/entrar')}
        <h1>Escribe el código</h1>
        <p class="suave">Te lo enviamos por SMS al <strong>${esc(enviadoA)}</strong>. Vence en 5 minutos.</p>
        <form id="form" novalidate>
            <div class="campo">
                <span class="rotulo" id="rotulo-codigo">Código de 6 dígitos</span>
                <div class="codigo" id="codigo" role="group" aria-labelledby="rotulo-codigo"></div>
                <span class="mensaje-error" id="error" aria-live="polite"></span>
            </div>
            <div class="pila-abajo">
                <button class="boton" type="submit" id="entrar">Entrar</button>
                <button class="boton fantasma" type="button" id="reenviar" disabled>Reenviar código</button>
                <a class="boton fantasma" href="#/entrar">Cambiar número</a>
            </div>
        </form>`;
    const grupo = raiz.querySelector('#codigo');
    const error = raiz.querySelector('#error');
    const boton = raiz.querySelector('#entrar');
    const enviar = async () => {
        const valor = campoCodigo.valor();
        if (valor.length !== 6) {
            error.textContent = 'Faltan dígitos del código.';
            grupo.setAttribute('aria-invalid', 'true');
            return;
        }
        await conEspera(boton, async () => {
            try {
                await api.entrar(celular, valor);
                sessionStorage.removeItem(CLAVE_CELULAR);
                const usuario = await recargarUsuario();
                ir(usuario?.tipo ? 'inicio' : 'bienvenida');
            } catch (err) {
                error.textContent = err.message;
                grupo.setAttribute('aria-invalid', 'true');
                campoCodigo.limpiar();
            }
        });
    };
    const campoCodigo = montarCodigo(grupo, () => { error.textContent = ''; enviar(); });
    campoCodigo.enfocar();
    raiz.querySelector('#form').addEventListener('submit', (e) => { e.preventDefault(); enviar(); });

    // Reenvío con cuenta regresiva de 30 s.
    const reenviar = raiz.querySelector('#reenviar');
    const tic = () => {
        const pasados = Math.floor((Date.now() - Number(sessionStorage.getItem('cajita_codigo_hora') || 0)) / 1000);
        const faltan = ESPERA_REENVIO - pasados;
        if (!reenviar.isConnected) return;
        reenviar.disabled = faltan > 0;
        reenviar.textContent = faltan > 0 ? `Reenviar código en ${faltan} s` : 'Reenviar código';
        if (faltan > 0) setTimeout(tic, 1000);
    };
    tic();
    reenviar.addEventListener('click', () => conEspera(reenviar, async () => {
        try {
            const r = await api.pedirCodigo(celular);
            sessionStorage.setItem('cajita_codigo_hora', String(Date.now()));
            toast(r.codigoDePrueba ? `Código reenviado (prueba: ${r.codigoDePrueba})` : 'Te enviamos un código nuevo');
        } catch (err) {
            toast(err.message, { tipo: 'error' });
        }
    }).then(tic));
}

function progreso(paso) {
    return `<div class="progreso" role="progressbar" aria-label="Paso ${paso} de 2" aria-valuemin="1" aria-valuemax="2" aria-valuenow="${paso}">
        <span class="lleno"></span><span class="${paso >= 2 ? 'lleno' : ''}"></span></div>`;
}

// Registro: nombre → ¿cómo quieres recibir? → billetera o cédula.
export function bienvenida(ctx, paso) {
    const { raiz, usuario } = ctx;
    if (!paso && usuario?.nombre) return ctx.ir('bienvenida/recibir');
    if (!paso) return pasoNombre(ctx);
    if (paso === 'recibir') return pasoRecibir(ctx);
    if (paso === 'billetera') return pasoBilletera(ctx);
    if (paso === 'efectivo') return pasoEfectivo(ctx);
    raiz.innerHTML = '';
    ctx.ir('bienvenida');
}

function pasoNombre({ raiz, api, ir, recargarUsuario, usuario }) {
    raiz.innerHTML = `
        ${progreso(1)}
        <h1>¡Hola! ¿Cómo te llamas?</h1>
        <p class="suave">Así te verán las personas que te paguen.</p>
        <form id="form" novalidate>
            <div class="campo">
                <label for="nombre">Tu nombre o el de tu negocio</label>
                <input class="entrada" id="nombre" autocomplete="name" maxlength="40" placeholder="Ej.: Ana Gómez" value="${esc(usuario?.nombre ?? '')}" aria-describedby="error">
                <span class="mensaje-error" id="error" aria-live="polite"></span>
            </div>
            <div class="pila-abajo"><button class="boton" type="submit">Continuar</button></div>
        </form>`;
    const campo = raiz.querySelector('#nombre');
    campo.focus();
    raiz.querySelector('#form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (campo.value.trim().length < 2) {
            raiz.querySelector('#error').textContent = 'Escribe tu nombre.';
            campo.setAttribute('aria-invalid', 'true');
            return;
        }
        await conEspera(e.submitter, async () => {
            try {
                await api.cambiarNombre(campo.value.trim());
                await recargarUsuario();
                ir('bienvenida/recibir');
            } catch (err) {
                raiz.querySelector('#error').textContent = err.message;
            }
        });
    });
}

function pasoRecibir(ctx) {
    const { raiz, usuario } = ctx;
    raiz.innerHTML = `
        ${progreso(2)}
        <div class="encabezado" style="margin-bottom:8px"><a class="icono-boton" href="#/bienvenida" aria-label="Volver a tu nombre" id="volver">${icono('atras')}</a></div>
        <h1>${esc(usuario?.nombre?.split(' ')[0] ?? 'Hola')}, ¿cómo quieres recibir tu dinero?</h1>
        <p class="suave">Puedes cambiarlo después desde tu perfil.</p>
        <div class="opciones">
            <a class="opcion" href="#/bienvenida/billetera">
                <span class="ico">${icono('billetera')}</span>
                <span><strong>Tengo billetera digital</strong><span class="suave">El dinero llega directo a tu billetera. Pegas su dirección y listo.</span></span>
            </a>
            <a class="opcion" href="#/bienvenida/efectivo">
                <span class="ico">${icono('retirar')}</span>
                <span><strong>Recibir en efectivo</strong><span class="suave">No necesitas cuenta de banco. Lo guardamos a nombre de tu cédula y lo retiras en un corresponsal.</span></span>
            </a>
        </div>`;
    // El nombre ya está guardado: volver lleva a editarlo.
    raiz.querySelector('#volver').addEventListener('click', (e) => { e.preventDefault(); pasoNombre(ctx); });
}

function pasoBilletera({ raiz, api, ir, recargarUsuario }) {
    raiz.innerHTML = `
        ${progreso(2)}
        <div class="encabezado" style="margin-bottom:8px"><a class="icono-boton" href="#/bienvenida/recibir" aria-label="Volver">${icono('atras')}</a></div>
        <h1>Pega la dirección de tu billetera</h1>
        <p class="suave">La encuentras en tu billetera como «dirección de pago» o «wallet address».</p>
        <form id="form" novalidate>
            <div class="campo">
                <label for="wallet">Dirección de la billetera</label>
                <input class="entrada" id="wallet" autocomplete="off" autocapitalize="off" spellcheck="false"
                    placeholder="$ilp.interledger-test.dev/ana" aria-describedby="ayuda error">
                <span class="ayuda" id="ayuda">Puede empezar por $ o por https://</span>
                <span class="mensaje-error" id="error" aria-live="polite"></span>
            </div>
            <div class="pila-abajo">
                <button class="boton" type="submit">Usar esta billetera</button>
                <button class="boton fantasma" type="button" id="pegar">${icono('copiar')} Pegar del portapapeles</button>
            </div>
        </form>`;
    const campo = raiz.querySelector('#wallet');
    campo.focus();
    raiz.querySelector('#pegar').addEventListener('click', async () => {
        try { campo.value = (await navigator.clipboard.readText()).trim(); campo.focus(); }
        catch { toast('No pudimos leer el portapapeles. Pega con el teclado.', { tipo: 'error' }); }
    });
    raiz.querySelector('#form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const error = raiz.querySelector('#error');
        if (!campo.value.trim()) { error.textContent = 'Pega la dirección de tu billetera.'; campo.setAttribute('aria-invalid', 'true'); return; }
        await conEspera(e.submitter, async () => {
            try {
                const r = await api.usarBilletera(campo.value.trim());
                if (r.billetera) localStorage.setItem('cajita_billetera', JSON.stringify({ wallet: r.usuario.wallet, ...r.billetera }));
                await recargarUsuario();
                toast(r.billetera?.publicName ? `Billetera de ${r.billetera.publicName} conectada` : 'Billetera conectada');
                ir('inicio');
            } catch (err) {
                error.textContent = err.message;
                campo.setAttribute('aria-invalid', 'true');
            }
        });
    });
}

function pasoEfectivo({ raiz, api, ir, recargarUsuario }) {
    raiz.innerHTML = `
        ${progreso(2)}
        <div class="encabezado" style="margin-bottom:8px"><a class="icono-boton" href="#/bienvenida/recibir" aria-label="Volver">${icono('atras')}</a></div>
        <h1>¿Cuál es tu número de cédula?</h1>
        <p class="suave">El dinero que te envíen quedará guardado a nombre de tu cédula. Para retirarlo la presentas en el corresponsal.</p>
        <form id="form" novalidate>
            <div class="campo">
                <label for="cedula">Número de cédula</label>
                <input class="entrada" id="cedula" inputmode="numeric" autocomplete="off" maxlength="13" placeholder="1020 459 183" aria-describedby="error">
                <span class="mensaje-error" id="error" aria-live="polite"></span>
            </div>
            <div class="aviso info">${icono('escudo')}<p>Tu cédula solo se usa para entregarte tu dinero. Nunca la mostramos completa.</p></div>
            <div class="pila-abajo"><button class="boton" type="submit">Continuar</button></div>
        </form>`;
    const campo = raiz.querySelector('#cedula');
    campo.focus();
    campo.addEventListener('input', () => { campo.value = campo.value.replace(/\D/g, '').slice(0, 10); });
    raiz.querySelector('#form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const error = raiz.querySelector('#error');
        const cedula = campo.value.replace(/\D/g, '');
        if (cedula.length < 6) { error.textContent = 'La cédula debe tener entre 6 y 10 dígitos.'; campo.setAttribute('aria-invalid', 'true'); return; }
        await conEspera(e.submitter, async () => {
            try {
                await api.usarEfectivo(cedula);
                await recargarUsuario();
                toast('Listo. Ya puedes recibir dinero en efectivo');
                ir('inicio');
            } catch (err) {
                error.textContent = err.message;
                campo.setAttribute('aria-invalid', 'true');
            }
        });
    });
}
