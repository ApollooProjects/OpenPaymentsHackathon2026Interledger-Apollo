// Inicio, movimientos (lista y detalle con comprobante de Open Payments) y perfil.
import { icono } from './iconos.js';
import * as unToque from './un-toque.js';
import { esc, dinero, fechaCorta, grupoDeFecha, horaRestante, enmascarar, celularBonito, abrirHoja, conEspera, toast, copiar } from './ui.js';

let ultimoResumen = null;

async function cargarResumen(api) {
    ultimoResumen = await api.resumen();
    return ultimoResumen;
}

const TIPOS = {
    recibido: { ico: 'cobrar', clase: 'entra', signo: '+', titulo: (m) => `De ${m.contraparte || 'alguien'}` },
    enviado: { ico: 'pagar', clase: 'sale', signo: '−', titulo: (m) => `A ${m.contraparte || 'alguien'}` },
    retiro: { ico: 'retirar', clase: 'retiro', signo: '−', titulo: () => 'Retiro en efectivo' }
};

const ESTADOS = {
    completado: ['ok', 'Listo'], entregado: ['ok', 'Entregado'], pagado: ['ok', 'Pagado'],
    procesando: ['espera', 'En proceso'], pendiente: ['espera', 'Pendiente'], activo: ['espera', 'PIN activo'], enviado: ['espera', 'En camino'], pagando: ['espera', 'En proceso'],
    fallido: ['mal', 'No se pudo'], rechazado: ['mal', 'Rechazado'], vencido: ['mal', 'Vencido'], anulado: ['mal', 'Anulado']
};
export const chipEstado = (estado) => {
    const [clase, texto] = ESTADOS[estado] ?? ['', estado ?? ''];
    return texto ? `<span class="chip ${clase}">${esc(texto)}</span>` : '';
};

function filaMovimiento(m) {
    const t = TIPOS[m.tipo] ?? TIPOS.recibido;
    return `<li><a class="fila" href="#/movimiento/${encodeURIComponent(m.id)}">
        <span class="ico ${t.clase}">${icono(t.ico)}</span>
        <span class="cuerpo"><span class="titulo">${esc(t.titulo(m))}</span><span class="sub">${esc(fechaCorta(m.fecha))}${m.estado && !['completado', 'entregado'].includes(m.estado) ? ` · ${esc((ESTADOS[m.estado] ?? [, m.estado])[1])}` : ''}</span></span>
        <span class="valor ${t.clase === 'entra' ? 'entra' : ''}"><span class="oculto-visual">${m.tipo === 'recibido' ? 'Recibiste' : 'Salieron'}</span>${t.signo} ${esc(dinero(m.monto))}</span>
    </a></li>`;
}

function vacioMovimientos(usuario) {
    return `<div class="vacio">
        <div class="ico-grande">${icono('lista')}</div>
        <h3>Aún no tienes movimientos</h3>
        <p class="suave">${usuario.tipo === 'efectivo' ? 'Comparte tu QR o tu número para que te envíen dinero.' : 'Comparte tu QR para cobrar o paga escaneando uno.'}</p>
        <a class="boton secundario" href="#/cobrar">${icono('qr')} Ver mi QR</a>
    </div>`;
}

function saludo() {
    const h = new Date().getHours();
    return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

export async function inicio({ raiz, api, usuario, vigente }) {
    // «Doña Rosa» se saluda completo; «Ana Gómez», solo por el nombre.
    const partes = (usuario.nombre ?? '').trim().split(/\s+/);
    const nombre = /^(don|doña|sr\.?|sra\.?|el|la)$/i.test(partes[0] ?? '') ? partes.slice(0, 2).join(' ') : partes[0];
    raiz.innerHTML = `
        <div class="encabezado">
            <div><p class="suave" style="margin:0">${saludo()},</p><h1 style="font-size:1.6rem">${esc(nombre || 'hola')}</h1></div>
            <a class="icono-boton derecha" href="#/perfil" aria-label="Tu perfil">${icono('usuario')}</a>
        </div>
        <div id="tarjeta"><div class="esqueleto" style="height:150px;border-radius:20px"></div></div>
        <div id="aviso"></div>
        <nav class="acciones" aria-label="Acciones principales">
            <a class="accion" href="#/pagar"><span class="circulo">${icono('pagar')}</span>Pagar</a>
            <a class="accion" href="#/cobrar"><span class="circulo">${icono('cobrar')}</span>Cobrar</a>
            <a class="accion" href="#/enviar"><span class="circulo">${icono('enviar')}</span>Enviar</a>
            <a class="accion" href="#/retirar"><span class="circulo">${icono('retirar')}</span>Retirar</a>
        </nav>
        <a class="tarjeta entrada-repartos" href="#/repartos">
            <span class="ico">${icono('repartir')}</span>
            <span class="cuerpo"><strong>Repartos automáticos</strong><span class="suave">Divide automáticamente cada pago que recibes</span></span>
            ${icono('chevron', 'chev')}
        </a>
        <section class="seccion" aria-labelledby="titulo-ultimos">
            <div class="seccion-titulo"><h2 id="titulo-ultimos">Últimos movimientos</h2><a href="#/movimientos">Ver todos</a></div>
            <div id="ultimos"><div class="esqueleto" style="height:200px"></div></div>
        </section>`;

    const r = await cargarResumen(api);
    if (!vigente()) return;

    raiz.querySelector('#tarjeta').innerHTML = usuario.tipo === 'efectivo'
        ? `<section class="tarjeta saldo" aria-label="Tu saldo">
                <div class="etiqueta">Disponible para retirar en efectivo</div>
                <div class="monto">${esc(dinero(r.saldo ?? { value: '0', assetCode: 'COP', assetScale: 2 }))}</div>
                <p class="detalle">A nombre de tu cédula ${esc(enmascarar(usuario.cedula))}</p>
           </section>`
        : `<section class="tarjeta saldo" aria-label="Tu billetera">
                <div class="etiqueta">Tu dinero llega directo a tu billetera</div>
                <p class="detalle billetera" style="margin-top:8px">${esc(usuario.wallet?.replace(/^https:\/\//, '$') ?? '')}</p>
                <p class="detalle" style="margin-top:8px">Consulta el saldo en la app de tu billetera.</p>
           </section>`;

    if (r.retiroPendiente) {
        raiz.querySelector('#aviso').innerHTML = `
            <a class="aviso" href="#/retirar" style="text-decoration:none">
                ${icono('candado')}
                <p><strong>Tienes un PIN de retiro activo por ${esc(dinero(r.retiroPendiente.monto))}</strong>
                Vence en ${esc(horaRestante(r.retiroPendiente.vence))}. Llévalo con tu cédula a un corresponsal.</p>
            </a>`;
    }

    const ultimos = (r.movimientos ?? []).slice(0, 5);
    raiz.querySelector('#ultimos').innerHTML = ultimos.length
        ? `<ul class="lista">${ultimos.map(filaMovimiento).join('')}</ul>`
        : vacioMovimientos(usuario);
}

export async function movimientos({ raiz, api, usuario, vigente }) {
    raiz.innerHTML = `<div class="encabezado"><h1>Movimientos</h1><a class="derecha enlace-chico" href="#/repartos/recibido">${icono('repartir')} Por repartos</a></div><div id="lista"><div class="esqueleto" style="height:300px"></div></div>`;
    const r = await cargarResumen(api);
    if (!vigente()) return;
    const lista = r.movimientos ?? [];
    if (!lista.length) { raiz.querySelector('#lista').innerHTML = vacioMovimientos(usuario); return; }
    const grupos = new Map();
    for (const m of lista) {
        const g = grupoDeFecha(m.fecha);
        if (!grupos.has(g)) grupos.set(g, []);
        grupos.get(g).push(m);
    }
    raiz.querySelector('#lista').innerHTML = [...grupos].map(([g, ms]) => `
        <h2 class="grupo-fecha">${esc(g)}</h2>
        <ul class="lista">${ms.map(filaMovimiento).join('')}</ul>`).join('');
}

const esUrl = (t) => /^https?:\/\//.test(String(t ?? ''));

// Datos técnicos del pago de Open Payments (GET /pagos/:id): incoming, outgoing y quote de cada destino.
export function comprobanteHtml(pago) {
    if (!pago) return '';
    const filas = (pago.destinos ?? []).map((d) => `
        <div class="tarjeta" style="padding:14px;box-shadow:none;margin-top:10px">
            <p style="margin:0 0 6px"><strong>${esc(d.nombre ?? 'Destino')}</strong> · ${esc(dinero(d.monto))} ${d.completo ? chipEstado('completado') : d.fallido ? chipEstado('fallido') : chipEstado('procesando')}</p>
            ${d.walletUrl ? `<p class="tecnico" style="margin:0">Billetera: ${esc(d.walletUrl)}</p>` : ''}
            ${d.incomingPayment ? `<p class="tecnico" style="margin:0">Incoming payment: ${esc(d.incomingPayment)}</p>` : ''}
            ${d.outgoingPayment ? `<p class="tecnico" style="margin:0">Outgoing payment: ${esc(d.outgoingPayment)}</p>` : ''}
            ${d.quoteId ? `<p class="tecnico" style="margin:0">Quote: ${esc(d.quoteId)}</p>` : ''}
        </div>`).join('');
    return `${pago.pagador ? `<p class="tecnico">Pagador: ${esc(pago.pagador)}</p>` : ''}${filas}<p class="tecnico" style="margin-top:8px">Pago: ${esc(pago.pagoId)}</p>`;
}

export async function movimiento({ raiz, api, vigente }, id) {
    const r = ultimoResumen ?? await cargarResumen(api);
    const m = (r.movimientos ?? []).find((x) => x.id === id);
    if (!vigente()) return;
    if (!m) {
        raiz.innerHTML = `<div class="encabezado"><a class="icono-boton" href="#/movimientos" aria-label="Volver">${icono('atras')}</a></div>
            <div class="vacio"><h1 style="font-size:1.2rem">No encontramos ese movimiento</h1><a class="boton secundario" href="#/movimientos">Ver movimientos</a></div>`;
        return;
    }
    const t = TIPOS[m.tipo] ?? TIPOS.recibido;
    // Los movimientos de billetera tienen el id del pago (GET /pagos/:id); los de efectivo, el del cobro de Open Payments.
    const pagoId = m.pagoId ?? (!esUrl(m.id) ? m.id : null);
    raiz.innerHTML = `
        <div class="encabezado"><a class="icono-boton" href="#/movimientos" aria-label="Volver a movimientos">${icono('atras')}</a></div>
        <section class="tarjeta">
            <div class="total">
                <div class="estado-grande ${(ESTADOS[m.estado] ?? ['ok'])[0] === 'ok' ? '' : (ESTADOS[m.estado] ?? [])[0] === 'mal' ? 'mal' : 'espera'}">${icono(t.ico)}</div>
                <h1 style="font-size:1.15rem">${esc(m.tipo === 'recibido' ? 'Recibiste' : m.tipo === 'retiro' ? 'Retiraste' : 'Enviaste')}</h1>
                <div class="monto">${esc(dinero(m.monto))}</div>
                ${chipEstado(m.estado)}
            </div>
            <dl class="datos">
                <div><dt>${m.tipo === 'recibido' ? 'De' : m.tipo === 'retiro' ? 'Dónde' : 'Para'}</dt><dd>${esc(m.tipo === 'retiro' ? (m.contraparte || 'Corresponsal') : (m.contraparte || '—'))}</dd></div>
                <div><dt>Fecha</dt><dd>${esc(new Date(m.fecha).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' }))}</dd></div>
                <div><dt>Referencia</dt><dd class="tecnico" style="font-weight:600">${esc(String(m.id).split('/').pop().slice(0, 8).toUpperCase())}</dd></div>
            </dl>
            <details class="comprobante" id="comprobante">
                <summary>${icono('escudo', 'chev')}&nbsp; Comprobante de Open Payments</summary>
                <div id="detalle-op">${pagoId ? '<p class="suave chico">Cargando…</p>' : `<p class="tecnico">${esc(m.comprobante ?? m.id)}</p>`}</div>
            </details>
        </section>
        <div class="pila-abajo">
            ${m.comprobante ? `<button class="boton secundario" type="button" id="copiar">${icono('copiar')} Copiar comprobante</button>` : ''}
        </div>`;
    raiz.querySelector('#copiar')?.addEventListener('click', () => copiar(m.comprobante, 'Comprobante copiado'));
    if (pagoId) {
        raiz.querySelector('#comprobante').addEventListener('toggle', async function cargar(e) {
            if (!e.target.open) return;
            e.target.removeEventListener('toggle', cargar);
            try {
                raiz.querySelector('#detalle-op').innerHTML = comprobanteHtml(await api.verPago(pagoId));
            } catch (err) {
                raiz.querySelector('#detalle-op').innerHTML = `<p class="tecnico">${esc(m.comprobante ?? m.id)}</p>`;
            }
        });
    }
}

export function perfil(ctx) {
    const { raiz, api, usuario, ir, recargarUsuario, olvidarUsuario } = ctx;
    const inicial = (usuario.nombre ?? '?').trim().charAt(0).toUpperCase();
    const tema = localStorage.getItem('cajita_tema') ?? 'sistema';
    raiz.innerHTML = `
        <div class="encabezado"><h1>Perfil</h1></div>
        <section class="tarjeta" style="display:flex;gap:16px;align-items:center">
            <span aria-hidden="true" style="width:64px;height:64px;border-radius:22px;display:grid;place-items:center;background:var(--primario);color:var(--primario-texto);font-size:1.8rem;font-weight:800">${esc(inicial)}</span>
            <div style="min-width:0"><h2 style="margin:0">${esc(usuario.nombre ?? 'Sin nombre')}</h2><p class="suave" style="margin:0">+57 ${esc(celularBonito(usuario.celular))}</p></div>
            <button class="icono-boton derecha" type="button" id="editar" aria-label="Cambiar tu nombre" style="margin-left:auto">${icono('editar')}</button>
        </section>
        <section class="seccion" aria-labelledby="titulo-recibir">
            <h2 id="titulo-recibir" class="grupo-fecha" style="margin-top:0">Cómo recibes</h2>
            <ul class="lista">
                <li><div class="fila">
                    <span class="ico entra">${icono(usuario.tipo === 'efectivo' ? 'cedula' : 'billetera')}</span>
                    <span class="cuerpo">
                        <span class="titulo">${usuario.tipo === 'efectivo' ? 'En efectivo con tu cédula' : 'En tu billetera'}</span>
                        <span class="sub" style="overflow-wrap:anywhere">${esc(usuario.tipo === 'efectivo' ? `Cédula ${enmascarar(usuario.cedula)}` : (usuario.wallet ?? '').replace(/^https:\/\//, '$'))}</span>
                    </span>
                </div></li>
                <li><a class="fila" href="#/bienvenida/recibir" id="cambiar-recibir">
                    <span class="ico">${icono('editar')}</span><span class="cuerpo"><span class="titulo">Cambiar cómo recibo</span></span>${icono('chevron', 'chev')}
                </a></li>
            </ul>
        </section>
        <section class="seccion" aria-labelledby="titulo-toque">
            <h2 id="titulo-toque" class="grupo-fecha" style="margin-top:0">Pagos con un toque</h2>
            <div id="un-toque"><div class="esqueleto" style="height:72px"></div></div>
        </section>
        <section class="seccion" aria-labelledby="titulo-pref">
            <h2 id="titulo-pref" class="grupo-fecha" style="margin-top:0">Apariencia</h2>
            <div class="segmento" role="group" aria-label="Tema" style="grid-template-columns:repeat(3,1fr)">
                ${[['sistema', 'Automático'], ['claro', 'Claro'], ['oscuro', 'Oscuro']].map(([v, t]) => `<button type="button" data-tema="${v}" aria-pressed="${tema === v}">${t}</button>`).join('')}
            </div>
        </section>
        <section class="seccion" aria-labelledby="titulo-ayuda">
            <h2 id="titulo-ayuda" class="grupo-fecha" style="margin-top:0">Seguridad</h2>
            <div class="aviso info">${icono('escudo')}<p>Nunca te pediremos tu PIN ni tu código por llamada. Los pagos viajan por Open Payments y tú autorizas cada uno en tu billetera.</p></div>
        </section>
        <div class="pila-abajo"><button class="boton peligro" type="button" id="salir">${icono('salir')} Cerrar sesión</button></div>`;

    // Cambiar cómo recibo vuelve al paso del registro: ese paso exige tipo nulo, así que se maneja desde aquí.
    raiz.querySelector('#cambiar-recibir').addEventListener('click', (e) => {
        e.preventDefault();
        const hoja = abrirHoja(`
            <h2>Cambiar cómo recibes</h2>
            <p class="suave">Elige la nueva forma. Lo que ya recibiste no cambia.</p>
            <div class="opciones">
                <button class="opcion" type="button" data-opcion="billetera"><span class="ico">${icono('billetera')}</span><span><strong>En mi billetera</strong><span class="suave">Pega la dirección de tu billetera.</span></span></button>
                <button class="opcion" type="button" data-opcion="efectivo"><span class="ico">${icono('retirar')}</span><span><strong>En efectivo</strong><span class="suave">Con tu cédula, en un corresponsal.</span></span></button>
            </div>
            <form id="form-cambio" novalidate style="margin-top:18px" hidden>
                <div class="campo"><label for="valor-cambio" id="rotulo-cambio"></label><input class="entrada" id="valor-cambio" autocomplete="off" autocapitalize="off"><span class="mensaje-error" id="error-cambio" aria-live="polite"></span></div>
                <button class="boton" type="submit">Guardar</button>
            </form>
            <button class="boton fantasma" type="button" data-cerrar style="margin-top:8px">Cancelar</button>`, { etiqueta: 'Cambiar cómo recibes' });
        let opcion = null;
        hoja.querySelectorAll('[data-opcion]').forEach((b) => b.addEventListener('click', () => {
            opcion = b.dataset.opcion;
            hoja.querySelectorAll('[data-opcion]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
            const form = hoja.querySelector('#form-cambio');
            form.hidden = false;
            hoja.querySelector('#rotulo-cambio').textContent = opcion === 'billetera' ? 'Dirección de la billetera' : 'Número de cédula';
            const campo = hoja.querySelector('#valor-cambio');
            campo.inputMode = opcion === 'billetera' ? 'url' : 'numeric';
            campo.placeholder = opcion === 'billetera' ? '$ilp.interledger-test.dev/ana' : '1020459183';
            campo.focus();
        }));
        hoja.querySelector('#form-cambio').addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const valor = hoja.querySelector('#valor-cambio').value.trim();
            await conEspera(ev.submitter, async () => {
                try {
                    if (opcion === 'billetera') {
                        const r = await api.usarBilletera(valor);
                        if (r.billetera) localStorage.setItem('cajita_billetera', JSON.stringify({ wallet: r.usuario.wallet, ...r.billetera }));
                    } else {
                        await api.usarEfectivo(valor.replace(/\D/g, ''));
                    }
                    await recargarUsuario();
                    hoja.close();
                    toast('Guardado');
                    ir('perfil');
                } catch (err) {
                    hoja.querySelector('#error-cambio').textContent = err.message;
                }
            });
        });
    });

    raiz.querySelector('#editar').addEventListener('click', () => {
        const hoja = abrirHoja(`
            <form id="form-nombre" novalidate>
                <h2>Tu nombre</h2>
                <div class="campo"><label for="nuevo-nombre">Tu nombre</label><input class="entrada" id="nuevo-nombre" maxlength="40" value="${esc(usuario.nombre ?? '')}"><span class="mensaje-error" id="error-nombre" aria-live="polite"></span></div>
                <div class="pila"><button class="boton" type="submit">Guardar</button><button class="boton fantasma" type="button" data-cerrar>Cancelar</button></div>
            </form>`, { etiqueta: 'Cambiar tu nombre' });
        hoja.querySelector('#nuevo-nombre').focus();
        hoja.querySelector('#form-nombre').addEventListener('submit', async (ev) => {
            ev.preventDefault();
            await conEspera(ev.submitter, async () => {
                try {
                    await api.cambiarNombre(hoja.querySelector('#nuevo-nombre').value.trim());
                    await recargarUsuario();
                    hoja.close();
                    toast('Nombre actualizado');
                    ir('perfil');
                } catch (err) {
                    hoja.querySelector('#error-nombre').textContent = err.message;
                }
            });
        });
    });

    unToque.seccionPerfil(ctx, raiz.querySelector('#un-toque')).catch(() => { raiz.querySelector('#un-toque').innerHTML = ''; });

    raiz.querySelectorAll('[data-tema]').forEach((b) => b.addEventListener('click', () => {
        localStorage.setItem('cajita_tema', b.dataset.tema);
        aplicarTema();
        raiz.querySelectorAll('[data-tema]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));

    raiz.querySelector('#salir').addEventListener('click', (e) => conEspera(e.currentTarget, async () => {
        try { await api.salir(); } catch { /* la cookie igual se descarta */ }
        olvidarUsuario();
        localStorage.removeItem('cajita_billetera');
        toast('Cerraste sesión');
        ir('');
    }));
}

export function aplicarTema() {
    const tema = localStorage.getItem('cajita_tema');
    if (tema === 'claro') document.documentElement.dataset.tema = 'claro';
    else if (tema === 'oscuro') document.documentElement.dataset.tema = 'oscuro';
    else delete document.documentElement.dataset.tema;
}
aplicarTema();
