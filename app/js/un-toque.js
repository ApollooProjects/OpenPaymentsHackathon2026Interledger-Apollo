// Pagos con un toque: apruebas una vez en tu billetera un tope por semana y después pagas sin autorizar cada pago.
// Por dentro es un permiso (grant) de Open Payments con límite de débito e intervalo semanal (/permisos del backend).
import { icono } from './iconos.js';
import { esc, dinero, conEspera, abrirHoja, toast, monedaGuardada } from './ui.js';

export const TOPES = ['5000000', '10000000', '20000000']; // $ 50.000, $ 100.000 y $ 200.000 en centavos

const monedaDe = (pagador) => monedaGuardada(pagador) ?? { assetCode: 'COP', assetScale: 2 };
export const textoTope = (pagador, valor = TOPES[0]) => dinero({ value: valor, ...monedaDe(pagador) });

export async function estado(api, usuario) {
    try { return await api.estadoUnToque(usuario.id); } catch { return { activo: false, estado: 'sin_permiso' }; }
}

const fechaLarga = (iso) => new Date(iso).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });

// Hoja para elegir el tope y aprobarlo en la billetera. alTerminar(estado) se llama cuando la billetera responde.
export function activar({ api, usuario }, { pagador, alTerminar } = {}) {
    const moneda = monedaDe(pagador);
    let elegido = TOPES[0];
    const hoja = abrirHoja(`
        <div class="total" style="padding-bottom:4px">
            <div class="estado-grande">${icono('rayo')}</div>
            <h2>Pagos con un toque</h2>
            <p class="suave">Apruebas una sola vez en tu billetera. Después pagas sin volver a autorizar, hasta el tope de cada semana.</p>
        </div>
        <div class="segmento" role="group" aria-label="Tope por semana" style="grid-template-columns:repeat(3,1fr)">
            ${TOPES.map((t) => `<button type="button" data-tope="${t}" aria-pressed="${t === elegido}">${esc(dinero({ value: t, ...moneda }))}</button>`).join('')}
        </div>
        <p class="suave chico" id="resumen-tope" aria-live="polite"></p>
        <span class="mensaje-error" id="error-toque" aria-live="polite"></span>
        <div class="pila">
            <button class="boton" type="button" id="aprobar"></button>
            <button class="boton fantasma" type="button" data-cerrar>Ahora no</button>
        </div>`, { etiqueta: 'Activar pagos con un toque' });
    const pintar = () => {
        const tope = dinero({ value: elegido, ...moneda });
        hoja.querySelector('#aprobar').textContent = `Aprobar hasta ${tope} por semana`;
        hoja.querySelector('#resumen-tope').textContent = `Puedes desactivarlo cuando quieras en tu perfil. Desde ${pagador.replace(/^https:\/\//, '$')}.`;
        hoja.querySelectorAll('[data-tope]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.tope === elegido)));
    };
    pintar();
    hoja.querySelectorAll('[data-tope]').forEach((x) => x.addEventListener('click', () => { elegido = x.dataset.tope; pintar(); }));
    const boton = hoja.querySelector('#aprobar');
    boton.addEventListener('click', async () => {
        // La ventana de la billetera se abre en el mismo clic para que el navegador no la bloquee.
        let ventana = null;
        try { ventana = window.open('', '_blank'); } catch { /* sin ventana nueva */ }
        await conEspera(boton, async () => {
            try {
                const { redirectUrl } = await api.activarUnToque(usuario.id, pagador, elegido);
                if (ventana && !ventana.closed) ventana.location.href = redirectUrl;
                else { location.href = redirectUrl; return; }
                hoja.close();
                toast('Aprueba el tope en la ventana de tu billetera');
                esperarRespuesta({ api, usuario }, alTerminar);
            } catch (err) {
                ventana?.close();
                hoja.querySelector('#error-toque').textContent = err.message;
            }
        });
    });
    return hoja;
}

// Sondea el estado del permiso mientras la persona aprueba en su billetera (hasta 3 minutos).
function esperarRespuesta({ api, usuario }, alTerminar) {
    let intentos = 0;
    const revisar = async () => {
        const e = await estado(api, usuario);
        if (e.estado === 'pendiente' && ++intentos < 72) return setTimeout(revisar, 2500);
        if (e.activo) toast(`Listo: pagos con un toque hasta ${dinero(e.tope)} por semana`);
        else if (e.estado !== 'pendiente') toast('No se activaron los pagos con un toque', { tipo: 'error' });
        alTerminar?.(e);
    };
    setTimeout(revisar, 2500);
}

// Sección del perfil: estado, disponible de la semana y desactivar.
export async function seccionPerfil(ctx, contenedor) {
    const { api, usuario, vigente } = ctx;
    const pagador = usuario.wallet;
    const pintar = async () => {
        const e = await estado(api, usuario);
        if (!vigente()) return;
        if (e.activo) {
            contenedor.innerHTML = `
                <ul class="lista">
                    <li><div class="fila">
                        <span class="ico entra">${icono('rayo')}</span>
                        <span class="cuerpo"><span class="titulo">Activos hasta ${esc(dinero(e.tope))} por semana</span>
                            <span class="sub">Te quedan ${esc(dinero(e.disponible))} · se renueva el ${esc(fechaLarga(e.renueva))}</span></span>
                    </div></li>
                    <li><button class="fila" type="button" id="desactivar">
                        <span class="ico">${icono('cerrar')}</span><span class="cuerpo"><span class="titulo" style="color:var(--error)">Desactivar pagos con un toque</span></span>
                    </button></li>
                </ul>`;
            contenedor.querySelector('#desactivar').addEventListener('click', () => {
                const hoja = abrirHoja(`
                    <h2>¿Desactivar pagos con un toque?</h2>
                    <p class="suave">Tu billetera deja de aceptar pagos sin autorización. Desde ahora aprobarás cada pago.</p>
                    <div class="pila"><button class="boton peligro" type="button" id="confirmar">Desactivar</button><button class="boton fantasma" type="button" data-cerrar>Cancelar</button></div>`, { etiqueta: 'Desactivar pagos con un toque' });
                const boton = hoja.querySelector('#confirmar');
                boton.addEventListener('click', () => conEspera(boton, async () => {
                    try {
                        await api.cancelarUnToque(usuario.id);
                        hoja.close();
                        toast('Pagos con un toque desactivados');
                        pintar();
                    } catch (err) {
                        toast(err.message, { tipo: 'error' });
                    }
                }));
            });
            return;
        }
        contenedor.innerHTML = `
            <ul class="lista"><li><button class="fila" type="button" id="activar" ${pagador ? '' : 'disabled'}>
                <span class="ico">${icono('rayo')}</span>
                <span class="cuerpo"><span class="titulo">Activar pagos con un toque</span>
                    <span class="sub">${pagador ? `Apruebas una vez hasta ${esc(textoTope(pagador))} por semana y pagas sin autorizar cada vez.` : 'Necesitas recibir en una billetera para usarlos.'}</span></span>
                ${pagador ? icono('chevron', 'chev') : ''}
            </button></li></ul>`;
        contenedor.querySelector('#activar').addEventListener('click', () => activar(ctx, { pagador, alTerminar: pintar }));
    };
    await pintar();
}
