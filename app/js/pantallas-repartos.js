// Repartos automáticos: reglas que se aplican solas a cada pago que recibes (abonar a una deuda, compartir un
// extra con otras personas, apartar un ahorro). Lista, asistente para crear, detalle con QR y lo que me llega.
import { icono } from './iconos.js';
import { esc, dinero, aUnidadMinima, formatearCampoMonto, fechaCorta, grupoDeFecha, toast, conEspera, abrirHoja, copiar, qrSvg, monedaGuardada } from './ui.js';

const atras = (href, etiqueta = 'Volver') => `<a class="icono-boton" href="${href}" aria-label="${esc(etiqueta)}">${icono('atras')}</a>`;
const aDolarIlp = (url) => String(url ?? '').replace(/^https:\/\//, '$');

// Moneda en la que recibe el usuario: la de su billetera (guardada al registrarla) o pesos en efectivo.
const monedaDelUsuario = (usuario) => (usuario.tipo === 'billetera' ? monedaGuardada(usuario.wallet) : null) ?? { assetCode: 'COP', assetScale: 2 };
const monto = (valor, moneda) => ({ value: String(valor), ...moneda });

const REGLAS = {
    deuda: { ico: 'candado', titulo: 'Abonar a una deuda', corto: 'Deuda' },
    compartir: { ico: 'usuarios', titulo: 'Compartir con otras personas', corto: 'Compartir' },
    ahorro: { ico: 'alcancia', titulo: 'Apartar un ahorro', corto: 'Ahorro' }
};

// Misma cuenta que hace el backend (reparto.js): la deuda sale del pago sin pasarse de lo que falta, el ahorro sale
// de lo que queda y el extra se divide en partes iguales entre las personas (si no hay personas, es tuyo).
export function calcular({ total, extra = 0n, deuda, ahorro, personas = 0 }) {
    const pago = BigInt(total);
    let aDeuda = 0n;
    if (deuda?.porcentaje) {
        aDeuda = (pago * BigInt(deuda.porcentaje)) / 100n;
        const tope = valorDe(deuda.falta ?? deuda.total);
        if (tope != null && aDeuda > BigInt(tope)) aDeuda = BigInt(tope);
    }
    const aAhorro = ahorro?.porcentaje ? ((pago - aDeuda) * BigInt(ahorro.porcentaje)) / 100n : 0n;
    const cadaPersona = personas > 0 ? BigInt(extra) / BigInt(personas) : 0n;
    const tuyo = pago - aDeuda - aAhorro + (personas > 0 ? 0n : BigInt(extra));
    return { aDeuda, aAhorro, cadaPersona, tuyo };
}

const enLista = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}` : xs[0] ?? '');
// Los montos de la API llegan como { value, … }; los del borrador, como texto en centavos.
const valorDe = (m) => (m == null ? null : typeof m === 'object' ? m.value : m);

const chipsReglas = (reglas) => Object.keys(REGLAS).filter((k) => reglas?.[k])
    .map((k) => `<span class="chip">${esc(REGLAS[k].corto)}</span>`).join(' ');

// ---------------------------------------------------------------- Lista (pestañas: mis repartos / lo que me llega)
const pestanas = (activa) => `
    <nav class="segmento" aria-label="Secciones de repartos">
        <a href="#/repartos" ${activa === 'mios' ? 'aria-current="page"' : ''}>Mis repartos</a>
        <a href="#/repartos/recibido" ${activa === 'recibido' ? 'aria-current="page"' : ''}>Lo que me llega</a>
    </nav>`;

export async function repartos({ raiz, api, vigente }) {
    raiz.innerHTML = `
        <div class="encabezado">${atras('#/inicio', 'Ir al inicio')}<h1>Repartos automáticos</h1></div>
        ${pestanas('mios')}
        <div id="lista"><div class="esqueleto" style="height:220px"></div></div>`;
    const { repartos: lista = [] } = await api.repartos();
    if (!vigente()) return;
    const zona = raiz.querySelector('#lista');
    if (!lista.length) {
        zona.innerHTML = `
            <div class="vacio">
                <div class="ico-grande">${icono('repartir')}</div>
                <h2>Divide automáticamente cada pago que recibes</h2>
                <p class="suave">Por ejemplo: de cada pago, un 35 % para pagar una deuda y un 10 % a tu ahorro. Lo demás es tuyo.</p>
                <a class="boton" href="#/repartos/nuevo">${icono('mas')} Crear un reparto</a>
            </div>`;
        return;
    }
    zona.innerHTML = `
        <ul class="lista">${lista.map((r) => `
            <li><a class="fila" href="#/reparto/${encodeURIComponent(r.id)}">
                <span class="ico entra">${icono('repartir')}</span>
                <span class="cuerpo"><span class="titulo">${esc(r.nombre)}</span>
                    <span class="sub">${esc(dinero(r.paraTi ?? r.recibido))} para ti · ${r.ventas ?? 0} ${r.ventas === 1 ? 'pago' : 'pagos'}</span>
                    <span class="chips-fila">${chipsReglas(r.reglas)}</span></span>
                ${icono('chevron', 'chev')}
            </a></li>`).join('')}
        </ul>
        <div class="pila-abajo"><a class="boton secundario" href="#/repartos/nuevo">${icono('mas')} Crear otro reparto</a></div>`;
}

const REGLA_RECIBIDA = { deuda: 'Abono a tu deuda', compartir: 'Te compartieron', ahorro: 'Tu ahorro' };

export async function recibido({ raiz, api, vigente }) {
    raiz.innerHTML = `
        <div class="encabezado">${atras('#/inicio', 'Ir al inicio')}<h1>Repartos automáticos</h1></div>
        ${pestanas('recibido')}
        <div id="lista"><div class="esqueleto" style="height:220px"></div></div>`;
    const { movimientos = [] } = await api.recibidoPorRepartos();
    if (!vigente()) return;
    const zona = raiz.querySelector('#lista');
    if (!movimientos.length) {
        zona.innerHTML = `
            <div class="vacio">
                <div class="ico-grande">${icono('cobrar')}</div>
                <h2>Aún no te llega nada por repartos</h2>
                <p class="suave">Cuando alguien te incluya en su reparto (para abonarte una deuda, compartir contigo o guardar un ahorro), aquí verás cada pago.</p>
            </div>`;
        return;
    }
    const grupos = new Map();
    for (const m of movimientos) {
        const g = grupoDeFecha(m.fecha);
        if (!grupos.has(g)) grupos.set(g, []);
        grupos.get(g).push(m);
    }
    zona.innerHTML = [...grupos].map(([g, ms]) => `
        <h2 class="grupo-fecha">${esc(g)}</h2>
        <ul class="lista">${ms.map((m, i) => `
            <li><button class="fila" type="button" data-i="${movimientos.indexOf(m)}">
                <span class="ico entra">${icono(REGLAS[m.regla]?.ico ?? 'cobrar')}</span>
                <span class="cuerpo"><span class="titulo">${esc(REGLA_RECIBIDA[m.regla] ?? 'Recibiste')}</span>
                    <span class="sub">De «${esc(m.de)}»${m.persona && m.persona !== m.de ? ` de ${esc(m.persona)}` : ''} · ${esc(fechaCorta(m.fecha))}</span></span>
                <span class="valor entra"><span class="oculto-visual">Recibiste</span>+ ${esc(dinero(m.monto))}</span>
            </button></li>`).join('')}
        </ul>`).join('');
    zona.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
        const m = movimientos[Number(b.dataset.i)];
        const hoja = abrirHoja(`
            <div class="total">
                <div class="estado-grande">${icono(REGLAS[m.regla]?.ico ?? 'cobrar')}</div>
                <h2>${esc(REGLA_RECIBIDA[m.regla] ?? 'Recibiste')}</h2>
                <div class="monto">${esc(dinero(m.monto))}</div>
            </div>
            <dl class="datos">
                <div><dt>Del reparto</dt><dd>${esc(m.de)}</dd></div>
                ${m.persona && m.persona !== m.de ? `<div><dt>De parte de</dt><dd>${esc(m.persona)}</dd></div>` : ''}
                <div><dt>Fecha</dt><dd>${esc(new Date(m.fecha).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' }))}</dd></div>
            </dl>
            ${m.comprobante ? `<details class="comprobante"><summary>${icono('escudo', 'chev')}&nbsp; Comprobante de Open Payments</summary><p class="tecnico">${esc(m.comprobante)}</p></details>` : ''}
            <div class="pila-abajo">
                ${m.comprobante ? `<button class="boton secundario" type="button" id="copiar">${icono('copiar')} Copiar comprobante</button>` : ''}
                <button class="boton fantasma" type="button" data-cerrar>Cerrar</button>
            </div>`, { etiqueta: 'Detalle de lo recibido' });
        hoja.querySelector('#copiar')?.addEventListener('click', () => copiar(m.comprobante, 'Comprobante copiado'));
    }));
}

// ---------------------------------------------------------------- Asistente para crear un reparto
// Tres pasos: nombre → reglas (cada una opcional, con ejemplo en vivo) → revisar. El borrador vive en memoria.
let borrador = null;
const nuevoBorrador = () => ({
    paso: 1,
    nombre: '',
    deuda: { activa: false, wallet: '', porcentaje: '35', total: '' },
    compartir: { activa: false, personas: [{ nombre: '', wallet: '' }, { nombre: '', wallet: '' }] },
    ahorro: { activa: false, wallet: '', porcentaje: '10' }
});

const EJEMPLO = 1_000_000n; // $ 10.000 en centavos (las monedas de la app tienen escala 2)
const EXTRA = 100_000n; // $ 1.000

export function nuevo(ctx) {
    if (!borrador || location.hash.includes('?')) borrador = nuevoBorrador();
    pintarPaso(ctx);
}

function pintarPaso(ctx) {
    const { raiz } = ctx;
    const b = borrador;
    const volver = b.paso === 1
        ? atras('#/repartos', 'Cancelar y volver a repartos')
        : `<button class="icono-boton" type="button" id="paso-atras" aria-label="Paso anterior">${icono('atras')}</button>`;
    const titulos = { 1: 'Ponle un nombre', 2: '¿Qué hacemos con cada pago?', 3: 'Revisa tu reparto' };
    raiz.innerHTML = `
        <div class="encabezado">${volver}<p class="suave" style="margin:0">Paso ${b.paso} de 3</p></div>
        <div class="progreso" aria-hidden="true">${[1, 2, 3].map((n) => `<span class="${n <= b.paso ? 'lleno' : ''}"></span>`).join('')}</div>
        <h1>${titulos[b.paso]}</h1>
        <form id="form" novalidate></form>`;
    raiz.querySelector('#paso-atras')?.addEventListener('click', () => { b.paso -= 1; pintarPaso(ctx); });
    const form = raiz.querySelector('#form');
    if (b.paso === 1) pasoNombre(ctx, form);
    if (b.paso === 2) pasoReglas(ctx, form);
    if (b.paso === 3) pasoRevisar(ctx, form);
    const titulo = raiz.querySelector('h1');
    titulo.setAttribute('tabindex', '-1');
    titulo.focus({ preventScroll: true });
    window.scrollTo(0, 0);
}

function pasoNombre(ctx, form) {
    const b = borrador;
    form.innerHTML = `
        <p class="suave">Así lo reconoces tú. Quien te paga lo ve al escanear tu QR.</p>
        <div class="campo">
            <label for="nombre">Nombre del reparto</label>
            <input class="entrada" id="nombre" maxlength="40" autocomplete="off" value="${esc(b.nombre)}" aria-describedby="error-nombre">
            <span class="mensaje-error" id="error-nombre" aria-live="polite"></span>
        </div>
        <div class="sugerencias" role="group" aria-label="Ideas de nombre">
            ${['Mi puesto', 'Arriendo compartido', 'Ventas del fin de semana'].map((s) => `<button class="chip-boton" type="button" data-sugerencia="${esc(s)}">${esc(s)}</button>`).join('')}
        </div>
        <div class="pila-abajo"><button class="boton" type="submit">Continuar</button></div>`;
    const campo = form.querySelector('#nombre');
    form.querySelectorAll('[data-sugerencia]').forEach((x) => x.addEventListener('click', () => { campo.value = x.dataset.sugerencia; campo.focus(); }));
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        b.nombre = campo.value.trim();
        if (!b.nombre) {
            campo.setAttribute('aria-invalid', 'true');
            form.querySelector('#error-nombre').textContent = 'Escribe un nombre. Ejemplo: Mi puesto.';
            campo.focus();
            return;
        }
        b.paso = 2;
        pintarPaso(ctx);
    });
}

function tarjetaRegla(clave, activa, descripcion, campos) {
    const r = REGLAS[clave];
    return `
        <section class="regla ${activa ? 'activa' : ''}" data-regla="${clave}">
            <button class="opcion" type="button" aria-pressed="${activa}" aria-controls="campos-${clave}" data-alternar="${clave}">
                <span class="ico">${icono(r.ico)}</span>
                <span><strong>${esc(r.titulo)}</strong><span class="suave">${esc(descripcion)}</span></span>
                <span class="interruptor" aria-hidden="true"></span>
            </button>
            <div class="campos-regla" id="campos-${clave}" ${activa ? '' : 'hidden'}>${campos}</div>
        </section>`;
}

const campoWallet = (id, rotulo, valor, ayuda = '') => `
    <div class="campo"><label for="${id}">${esc(rotulo)}</label>
        <input class="entrada" id="${id}" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="url" placeholder="$ilp.interledger-test.dev/nombre" value="${esc(valor)}">
        ${ayuda ? `<span class="ayuda">${esc(ayuda)}</span>` : ''}</div>`;
const campoPorcentaje = (id, rotulo, valor) => `
    <div class="campo"><label for="${id}">${esc(rotulo)}</label>
        <div class="con-sufijo"><input class="entrada" id="${id}" inputmode="numeric" maxlength="3" autocomplete="off" value="${esc(valor)}"><span class="sufijo" aria-hidden="true">%</span></div></div>`;

function pasoReglas(ctx, form) {
    const b = borrador;
    const moneda = monedaDelUsuario(ctx.usuario);
    form.innerHTML = `
        <p class="suave">Activa las que quieras. Se aplican solas cada vez que te pagan con el QR de este reparto.</p>
        <div class="pila">
            ${tarjetaRegla('deuda', b.deuda.activa, 'Un % de cada pago va a alguien hasta completar lo que le debes.', `
                ${campoWallet('deuda-wallet', '¿A quién le debes? (su billetera)', b.deuda.wallet)}
                <div class="dos-columnas">
                    ${campoPorcentaje('deuda-pct', '% de cada pago', b.deuda.porcentaje)}
                    <div class="campo"><label for="deuda-total">¿Cuánto debes en total?</label>
                        <div class="con-prefijo"><span class="prefijo" aria-hidden="true">$</span><input class="entrada" id="deuda-total" inputmode="numeric" autocomplete="off" placeholder="200.000" value="${esc(b.deuda.total)}"></div></div>
                </div>
                <p class="ejemplo" id="ejemplo-deuda" aria-live="polite"></p>`)}
            ${tarjetaRegla('compartir', b.compartir.activa, 'Quien te paga puede agregar un extra, y se divide entre varias personas.', `
                <div id="personas"></div>
                <button class="boton fantasma" type="button" id="agregar-persona">${icono('mas')} Agregar otra persona</button>
                <p class="ejemplo" id="ejemplo-compartir" aria-live="polite"></p>`)}
            ${tarjetaRegla('ahorro', b.ahorro.activa, 'Un % de lo que te queda va a otra billetera, para guardarlo.', `
                ${campoWallet('ahorro-wallet', 'Billetera de tu ahorro', b.ahorro.wallet, 'Tiene que ser otra billetera, distinta a donde recibes.')}
                ${campoPorcentaje('ahorro-pct', '% de lo que te queda', b.ahorro.porcentaje)}
                <p class="ejemplo" id="ejemplo-ahorro" aria-live="polite"></p>`)}
        </div>
        <span class="mensaje-error" id="error" aria-live="polite"></span>
        <div class="pila-abajo"><button class="boton" type="submit">Ver cómo queda</button></div>`;

    const pintarPersonas = () => {
        form.querySelector('#personas').innerHTML = b.compartir.personas.map((p, i) => `
            <fieldset class="persona">
                <legend>Persona ${i + 1}</legend>
                ${b.compartir.personas.length > 1 ? `<button class="icono-boton quitar" type="button" data-quitar="${i}" aria-label="Quitar a la persona ${i + 1}">${icono('cerrar')}</button>` : ''}
                <div class="campo"><label for="persona-nombre-${i}">Nombre</label><input class="entrada" id="persona-nombre-${i}" data-persona="${i}" data-dato="nombre" maxlength="30" autocomplete="off" value="${esc(p.nombre)}"></div>
                <div class="campo"><label for="persona-wallet-${i}">Billetera</label><input class="entrada" id="persona-wallet-${i}" data-persona="${i}" data-dato="wallet" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="url" placeholder="$ilp.interledger-test.dev/nombre" value="${esc(p.wallet)}"></div>
            </fieldset>`).join('');
        form.querySelectorAll('[data-quitar]').forEach((x) => x.addEventListener('click', () => {
            leer();
            b.compartir.personas.splice(Number(x.dataset.quitar), 1);
            pintarPersonas();
            ejemplos();
        }));
    };

    const v = (id) => form.querySelector(`#${id}`)?.value.trim() ?? '';
    const leer = () => {
        Object.assign(b.deuda, { wallet: v('deuda-wallet'), porcentaje: v('deuda-pct'), total: v('deuda-total') });
        Object.assign(b.ahorro, { wallet: v('ahorro-wallet'), porcentaje: v('ahorro-pct') });
        form.querySelectorAll('[data-persona]').forEach((x) => { b.compartir.personas[Number(x.dataset.persona)][x.dataset.dato] = x.value.trim(); });
    };
    const pct = (texto) => { const n = Number(texto); return Number.isInteger(n) && n > 0 && n <= 100 ? n : null; };
    const d = (valor) => esc(dinero(monto(valor, moneda)));
    const ejemplos = () => {
        leer();
        const pd = pct(b.deuda.porcentaje) ?? 0;
        const total = aUnidadMinima(b.deuda.total, moneda.assetScale);
        const cd = calcular({ total: EJEMPLO, deuda: { porcentaje: pd } });
        form.querySelector('#ejemplo-deuda').innerHTML = pd
            ? `De un pago de <strong>${d(EJEMPLO)}</strong>, <strong>${d(cd.aDeuda)}</strong> van a la deuda${total ? ` hasta completar <strong>${d(total)}</strong>` : ''}. Después, todo vuelve a ser tuyo.`
            : 'Escribe un porcentaje entre 1 y 100.';
        const n = b.compartir.personas.filter((p) => p.nombre || p.wallet).length || b.compartir.personas.length;
        form.querySelector('#ejemplo-compartir').innerHTML = `Si te pagan <strong>${d(EJEMPLO)}</strong> con <strong>${d(EXTRA)}</strong> de extra, ${n === 1 ? 'esa persona recibe' : `cada una de las ${n} personas recibe`} <strong>${d(EXTRA / BigInt(n))}</strong>. El extra es aparte: no se descuenta de lo tuyo.`;
        const pa = pct(b.ahorro.porcentaje) ?? 0;
        const ca = calcular({ total: EJEMPLO, deuda: b.deuda.activa ? { porcentaje: pd } : null, ahorro: { porcentaje: pa } });
        form.querySelector('#ejemplo-ahorro').innerHTML = pa
            ? `De un pago de <strong>${d(EJEMPLO)}</strong>, <strong>${d(ca.aAhorro)}</strong> van a tu ahorro${b.deuda.activa && pd ? ' (después de abonar a la deuda)' : ''}.`
            : 'Escribe un porcentaje entre 1 y 100.';
    };

    pintarPersonas();
    ejemplos();
    formatearCampoMonto(form.querySelector('#deuda-total'));
    form.addEventListener('input', ejemplos);
    form.querySelector('#agregar-persona').addEventListener('click', () => {
        leer();
        b.compartir.personas.push({ nombre: '', wallet: '' });
        pintarPersonas();
        ejemplos();
        form.querySelector(`#persona-nombre-${b.compartir.personas.length - 1}`).focus();
    });
    form.querySelectorAll('[data-alternar]').forEach((x) => x.addEventListener('click', () => {
        const clave = x.dataset.alternar;
        b[clave].activa = !b[clave].activa;
        x.setAttribute('aria-pressed', String(b[clave].activa));
        x.closest('.regla').classList.toggle('activa', b[clave].activa);
        form.querySelector(`#campos-${clave}`).hidden = !b[clave].activa;
        ejemplos();
        if (b[clave].activa) form.querySelector(`#campos-${clave} input`)?.focus();
    }));

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        leer();
        const error = form.querySelector('#error');
        const falla = (texto, id) => { error.textContent = texto; if (id) form.querySelector(`#${id}`)?.focus(); };
        if (!b.deuda.activa && !b.compartir.activa && !b.ahorro.activa) return falla('Activa al menos una regla.');
        if (b.deuda.activa) {
            if (!b.deuda.wallet) return falla('Escribe la billetera de a quién le debes.', 'deuda-wallet');
            if (!pct(b.deuda.porcentaje)) return falla('El % para la deuda debe estar entre 1 y 100.', 'deuda-pct');
            if (!aUnidadMinima(b.deuda.total, moneda.assetScale)) return falla('Escribe cuánto debes en total.', 'deuda-total');
        }
        if (b.compartir.activa) {
            const i = b.compartir.personas.findIndex((p) => !p.nombre || !p.wallet);
            if (i >= 0) return falla(`Completa el nombre y la billetera de la persona ${i + 1}.`, b.compartir.personas[i].nombre ? `persona-wallet-${i}` : `persona-nombre-${i}`);
        }
        if (b.ahorro.activa) {
            if (!b.ahorro.wallet) return falla('Escribe la billetera de tu ahorro.', 'ahorro-wallet');
            if (!pct(b.ahorro.porcentaje)) return falla('El % de ahorro debe estar entre 1 y 100.', 'ahorro-pct');
        }
        b.paso = 3;
        pintarPaso(ctx);
    });
}

// Lo que se manda a POST /yo/repartos (los montos en la unidad mínima de la moneda del usuario).
function cuerpoDelBorrador(moneda) {
    const b = borrador;
    return {
        nombre: b.nombre,
        ...(b.deuda.activa && { deuda: { wallet: b.deuda.wallet, porcentaje: Number(b.deuda.porcentaje), total: aUnidadMinima(b.deuda.total, moneda.assetScale) } }),
        ...(b.compartir.activa && { compartir: { personas: b.compartir.personas.map(({ nombre, wallet }) => ({ nombre, wallet })) } }),
        ...(b.ahorro.activa && { ahorro: { wallet: b.ahorro.wallet, porcentaje: Number(b.ahorro.porcentaje) } })
    };
}

// Filas «a dónde va» de un pago de ejemplo; sirve para la vista previa y para el detalle.
function filasVistaPrevia({ total, extra, reglas, moneda, usuario }) {
    const personas = reglas.compartir?.personas ?? [];
    const c = calcular({ total, extra, deuda: reglas.deuda, ahorro: reglas.ahorro, personas: personas.length });
    const d = (valor) => esc(dinero(monto(valor, moneda)));
    const filas = [];
    if (reglas.deuda) filas.push([REGLAS.deuda.ico, 'A la deuda', aDolarIlp(reglas.deuda.wallet), c.aDeuda]);
    personas.forEach((p) => filas.push([REGLAS.compartir.ico, p.nombre || aDolarIlp(p.wallet), p.porcentaje ? `${p.porcentaje} % del extra` : 'Parte del extra',
        p.porcentaje ? (BigInt(extra) * BigInt(p.porcentaje)) / 100n : c.cadaPersona]));
    if (reglas.ahorro) filas.push([REGLAS.ahorro.ico, 'A tu ahorro', aDolarIlp(reglas.ahorro.wallet), c.aAhorro]);
    filas.push(['usuario', 'Para ti', usuario.tipo === 'efectivo' ? 'En efectivo, a tu cédula' : 'En tu billetera', c.tuyo]);
    return `<ul class="lista">${filas.map(([ico, titulo, sub, valor]) => `
        <li><div class="fila">
            <span class="ico ${titulo === 'Para ti' ? 'entra' : ''}">${icono(ico)}</span>
            <span class="cuerpo"><span class="titulo">${esc(titulo)}</span><span class="sub" style="overflow-wrap:anywhere">${esc(sub)}</span></span>
            <span class="valor ${titulo === 'Para ti' ? 'entra' : ''}">${d(valor)}</span>
        </div></li>`).join('')}</ul>`;
}

function frasePrevia({ total, extra, reglas, moneda }) {
    const personas = reglas.compartir?.personas ?? [];
    const c = calcular({ total, extra, deuda: reglas.deuda, ahorro: reglas.ahorro, personas: personas.length });
    const d = (valor) => dinero(monto(valor, moneda));
    const partes = [];
    if (reglas.deuda) partes.push(`${d(c.aDeuda)} a la deuda`);
    if (reglas.ahorro) partes.push(`${d(c.aAhorro)} a tu ahorro`);
    partes.push(`${d(c.tuyo)} para ti`);
    const inicio = personas.length ? `De un pago de ${d(total)} con ${d(extra)} de extra` : `De un pago de ${d(total)}`;
    const compartir = personas.length ? ` El extra se divide: ${d(c.cadaPersona)} para cada persona.` : '';
    return `${inicio}: ${partes.join(', ').replace(/, ([^,]*)$/, ' y $1')}.${compartir}`;
}

function pasoRevisar(ctx, form) {
    const b = borrador;
    const moneda = monedaDelUsuario(ctx.usuario);
    const cuerpo = cuerpoDelBorrador(moneda);
    const reglas = { deuda: cuerpo.deuda, compartir: cuerpo.compartir, ahorro: cuerpo.ahorro };
    const conExtra = Boolean(reglas.compartir); // el ejemplo suma un extra del 10 % solo si hay con quién compartirlo
    form.innerHTML = `
        <section class="tarjeta">
            <h2 style="margin:0 0 4px">${esc(b.nombre)}</h2>
            <p class="suave" id="frase">${esc(frasePrevia({ total: EJEMPLO, extra: conExtra ? EXTRA : 0n, reglas, moneda }))}</p>
            <div class="campo" style="margin-bottom:12px"><label for="ejemplo">Prueba con otro monto</label>
                <div class="con-prefijo"><span class="prefijo" aria-hidden="true">$</span><input class="entrada" id="ejemplo" inputmode="numeric" autocomplete="off" value="10.000"></div></div>
            <div id="filas" aria-live="polite">${filasVistaPrevia({ total: EJEMPLO, extra: conExtra ? EXTRA : 0n, reglas, moneda, usuario: ctx.usuario })}</div>
            ${reglas.deuda ? `<p class="suave chico" style="margin:12px 0 0">Cuando completes los ${esc(dinero(monto(reglas.deuda.total, moneda)))} de la deuda, deja de descontarse.</p>` : ''}
        </section>
        <span class="mensaje-error" id="error" aria-live="polite"></span>
        <div class="pila-abajo">
            <button class="boton" type="submit">${icono('check')} Crear reparto</button>
            <button class="boton fantasma" type="button" id="cambiar">Cambiar las reglas</button>
        </div>`;
    const campo = form.querySelector('#ejemplo');
    formatearCampoMonto(campo);
    campo.addEventListener('input', () => {
        const total = BigInt(aUnidadMinima(campo.value, moneda.assetScale) ?? 0);
        const extra = conExtra ? total / 10n : 0n;
        form.querySelector('#filas').innerHTML = filasVistaPrevia({ total, extra, reglas, moneda, usuario: ctx.usuario });
        form.querySelector('#frase').textContent = frasePrevia({ total, extra, reglas, moneda });
    });
    form.querySelector('#cambiar').addEventListener('click', () => { b.paso = 2; pintarPaso(ctx); });
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await conEspera(e.submitter, async () => {
            try {
                const { reparto } = await ctx.api.crearReparto(cuerpo);
                borrador = null;
                toast('Reparto creado');
                ctx.ir(`reparto/${reparto.id}`);
            } catch (err) {
                form.querySelector('#error').textContent = err.message;
            }
        });
    });
}

// ---------------------------------------------------------------- Detalle
export async function detalle(ctx, id) {
    const { raiz, api, usuario, vigente } = ctx;
    const { repartos: lista = [] } = await api.repartos();
    if (!vigente()) return;
    const r = lista.find((x) => String(x.id) === id);
    if (!r) {
        raiz.innerHTML = `<div class="encabezado">${atras('#/repartos')}</div>
            <div class="vacio"><h1 style="font-size:1.2rem">No encontramos ese reparto</h1><a class="boton secundario" href="#/repartos">Ver mis repartos</a></div>`;
        return;
    }
    const moneda = { assetCode: r.recibido?.assetCode ?? 'COP', assetScale: r.recibido?.assetScale ?? 2 };
    const { deuda, compartir, ahorro } = r.reglas ?? {};
    const monedaDeuda = deuda?.total?.assetCode ? { assetCode: deuda.total.assetCode, assetScale: deuda.total.assetScale } : moneda;
    const sinDatoDeuda = deuda && (deuda.pagado == null || deuda.falta == null);
    const pagado = deuda ? BigInt(valorDe(deuda.pagado) ?? 0) : 0n;
    const falta = deuda ? BigInt(valorDe(deuda.falta) ?? 0) : 0n;
    const totalDeuda = deuda ? BigInt(valorDe(deuda.total) ?? 0) : 0n;
    const avance = totalDeuda > 0n ? Number((pagado * 100n) / totalDeuda) : 0;
    const dd = (v) => esc(dinero(monto(v, monedaDeuda)));
    raiz.innerHTML = `
        <div class="encabezado">${atras('#/repartos', 'Volver a repartos')}<h1>${esc(r.nombre)}</h1></div>
        <div class="cifras">
            <div class="tarjeta"><span class="suave chico">Recibido</span><strong>${esc(dinero(r.recibido))}</strong><span class="suave chico">en ${r.ventas ?? 0} ${r.ventas === 1 ? 'pago' : 'pagos'}</span></div>
            <div class="tarjeta"><span class="suave chico">Para ti</span><strong>${esc(dinero(r.paraTi ?? r.recibido))}</strong><span class="suave chico">${usuario.tipo === 'efectivo' ? 'En efectivo' : 'En tu billetera'}</span></div>
        </div>
        ${deuda ? `
        <section class="tarjeta" aria-labelledby="titulo-deuda" style="margin-top:16px">
            <h2 id="titulo-deuda" style="font-size:1.05rem">${icono(REGLAS.deuda.ico, 'ico-titulo')} Deuda · ${esc(deuda.porcentaje)} % de cada pago</h2>
            ${sinDatoDeuda ? `<p class="suave" style="margin:8px 0 0">Total ${dd(totalDeuda)}. No pudimos consultar cuánto llevas pagado; inténtalo en un momento.</p>` : `
            <div class="barra-avance" role="progressbar" aria-label="Avance de la deuda" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${avance}" aria-valuetext="Pagado ${dd(pagado)} de ${dd(totalDeuda)}"><span style="width:${avance}%"></span></div>
            <div class="avance-pie"><span><strong>${dd(pagado)}</strong> pagado de ${dd(totalDeuda)}</span><span>Falta <strong>${dd(falta)}</strong></span></div>
            ${falta === 0n ? '<p class="chip ok" style="margin-top:10px">¡Deuda completa! Ya no se descuenta.</p>' : ''}`}
        </section>` : ''}
        <section class="tarjeta centro" style="margin-top:16px">
            <div class="qr-caja" id="qr" role="img" aria-label="Código QR del reparto ${esc(r.nombre)}">${qrSvg(r.qr.enlace, r.qr.id)}</div>
            <p class="suave" id="leyenda" style="margin:14px 0 0">Cada pago con este QR se reparte solo.</p>
        </section>
        <div class="pila-abajo">
            <button class="boton" type="button" id="compartir">${icono('compartir')} Compartir el QR</button>
            <button class="boton secundario" type="button" id="qr-monto">${icono('mas')} Crear QR con monto o detalle</button>
        </div>
        <section class="seccion" aria-labelledby="titulo-reglas">
            <h2 id="titulo-reglas" class="grupo-fecha" style="margin-top:0">Así se reparte un pago de ${esc(dinero(monto(EJEMPLO, moneda)))}</h2>
            ${filasVistaPrevia({ total: EJEMPLO, extra: compartir ? EXTRA : 0n, reglas: { deuda: deuda && (sinDatoDeuda ? { ...deuda, falta: deuda.total } : deuda), compartir, ahorro }, moneda, usuario })}
            ${compartir ? `<p class="suave chico" style="margin-top:8px">Con ${esc(dinero(monto(EXTRA, moneda)))} de extra, que se divide entre ${esc(enLista(compartir.personas.map((p) => p.nombre || aDolarIlp(p.wallet))))}.</p>` : ''}
        </section>`;

    let actual = r.qr;
    raiz.querySelector('#compartir').addEventListener('click', async () => {
        const datos = { title: 'La Cajita', text: `Paga a «${r.nombre}» con La Cajita`, url: actual.enlace };
        if (navigator.share) {
            try { await navigator.share(datos); return; } catch (e) { if (e.name === 'AbortError') return; }
        }
        copiar(actual.enlace, 'Enlace copiado');
    });
    raiz.querySelector('#qr-monto').addEventListener('click', () => {
        const hoja = abrirHoja(`
            <form id="form-qr" novalidate>
                <h2>QR con monto o detalle</h2>
                <p class="suave">Llena lo que quieras. El pago se reparte igual.</p>
                <div class="campo"><label for="monto">Monto <span class="suave">(opcional)</span></label>
                    <div class="con-prefijo"><span class="prefijo" aria-hidden="true">$</span><input class="entrada" id="monto" inputmode="numeric" placeholder="0" autocomplete="off"></div></div>
                <div class="campo"><label for="detalle">Detalle <span class="suave">(opcional)</span></label><input class="entrada" id="detalle" maxlength="40" placeholder="Ej.: Arriendo de octubre"></div>
                ${compartir ? `
                <label class="casilla"><input type="checkbox" id="pedir-extra" checked><span><strong>Pedir un extra para compartir</strong><span class="suave">Quien paga elige cuánto agregar; se divide entre ${compartir.personas.length} ${compartir.personas.length === 1 ? 'persona' : 'personas'}.</span></span></label>` : ''}
                <span class="mensaje-error" id="error-qr" aria-live="polite"></span>
                <div class="pila"><button class="boton" type="submit">Crear QR</button><button class="boton fantasma" type="button" data-cerrar>Cancelar</button></div>
            </form>`, { etiqueta: 'Crear QR con monto o detalle' });
        const campo = hoja.querySelector('#monto');
        formatearCampoMonto(campo);
        campo.focus();
        hoja.querySelector('#form-qr').addEventListener('submit', async (e) => {
            e.preventDefault();
            const texto = campo.value.trim();
            const valor = texto ? aUnidadMinima(texto, moneda.assetScale) : undefined;
            if (texto && !valor) { hoja.querySelector('#error-qr').textContent = 'Escribe un monto mayor que cero.'; return; }
            const detalleQr = hoja.querySelector('#detalle').value.trim() || undefined;
            const pedirExtra = hoja.querySelector('#pedir-extra')?.checked ?? false;
            if (!valor && !detalleQr && !pedirExtra) { hoja.querySelector('#error-qr').textContent = 'Escribe un monto o un detalle.'; return; }
            await conEspera(e.submitter, async () => {
                try {
                    const { qr } = await api.qrDeReparto(r.id, { monto: valor, detalle: detalleQr, compartir: pedirExtra });
                    hoja.close();
                    actual = qr;
                    const caja = raiz.querySelector('#qr');
                    caja.innerHTML = qrSvg(qr.enlace, qr.id);
                    caja.setAttribute('aria-label', `Código QR${valor ? ` por ${dinero(monto(valor, moneda))}` : ''} del reparto ${r.nombre}`);
                    const partes = [valor && `<strong>${esc(dinero(monto(valor, moneda)))}</strong>`, detalleQr && esc(detalleQr), pedirExtra && 'pide un extra para compartir'].filter(Boolean);
                    raiz.querySelector('#leyenda').innerHTML = `${partes.join(' · ')}.${valor ? ' Sirve para un solo pago.' : ''} <button class="enlace-boton" type="button" id="volver-fijo">Volver al QR de siempre</button>`;
                    raiz.querySelector('#volver-fijo').addEventListener('click', () => {
                        actual = r.qr;
                        caja.innerHTML = qrSvg(r.qr.enlace, r.qr.id);
                        caja.setAttribute('aria-label', `Código QR del reparto ${r.nombre}`);
                        raiz.querySelector('#leyenda').textContent = 'Cada pago con este QR se reparte solo.';
                    });
                    toast('QR listo');
                } catch (err) {
                    hoja.querySelector('#error-qr').textContent = err.message;
                }
            });
        });
    });
}
