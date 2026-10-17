// Cobrar (mi QR), Pagar (escanear o pegar), Enviar al exterior, Retirar en efectivo y seguimiento de un pago.
import { icono } from './iconos.js';
import { esc, dinero, aUnidadMinima, formatearCampoMonto, horaRestante, toast, conEspera, abrirHoja, copiar, qrSvg, enmascarar } from './ui.js';
import { chipEstado, comprobanteHtml } from './pantallas-cuenta.js';

const atras = (href = '#/inicio', etiqueta = 'Volver') => `<a class="icono-boton" href="${href}" aria-label="${esc(etiqueta)}">${icono('atras')}</a>`;
const aDolarIlp = (url) => String(url ?? '').replace(/^https:\/\//, '$');

// Billetera con la que paga la persona: la suya si la tiene; si recibe en efectivo, la última que usó para pagar.
const billeteraPagadora = (usuario) => usuario.wallet ?? localStorage.getItem('cajita_pagador') ?? '';

// Moneda de una billetera: la guardada al registrarla; si no, se pregunta al servidor de la billetera (Open Payments
// sirve la wallet address como JSON público); si falla, se asume COP con escala 2.
async function monedaDe(wallet) {
    try {
        const guardada = JSON.parse(localStorage.getItem('cajita_billetera') ?? 'null');
        if (guardada?.wallet === wallet && guardada.assetCode) return guardada;
    } catch { /* sigue */ }
    try {
        const r = await fetch(wallet, { headers: { Accept: 'application/json' } });
        const w = await r.json();
        if (w.assetCode) return { assetCode: w.assetCode, assetScale: w.assetScale };
    } catch { /* sigue */ }
    return { assetCode: 'COP', assetScale: 2 };
}

// ---------------------------------------------------------------- Cobrar
export async function cobrar({ raiz, api, usuario, vigente }) {
    raiz.innerHTML = `
        <div class="encabezado">${atras()}<h1>Cobrar</h1></div>
        <section class="tarjeta centro">
            <div class="qr-caja" id="qr" aria-busy="true"><div class="esqueleto" style="aspect-ratio:1"></div></div>
            <p class="qr-quien">${esc(usuario.nombre ?? '')}</p>
            <p class="suave" id="leyenda" style="margin:0">Muestra este código para que te paguen</p>
        </section>
        <div class="pila-abajo">
            <button class="boton" type="button" id="compartir">${icono('compartir')} Compartir mi enlace de cobro</button>
            <button class="boton secundario" type="button" id="con-monto">${icono('mas')} Cobrar un monto exacto</button>
        </div>
        <div class="aviso info">${icono(usuario.tipo === 'efectivo' ? 'cedula' : 'billetera')}
            <p>${usuario.tipo === 'efectivo'
                ? `Lo que te paguen queda a nombre de tu cédula ${esc(enmascarar(usuario.cedula))}. Te avisamos por SMS y lo retiras en efectivo.`
                : 'Lo que te paguen llega directo a tu billetera.'}</p>
        </div>`;

    let actual = null;
    const pintar = (qr, monto, concepto) => {
        actual = qr;
        const caja = raiz.querySelector('#qr');
        caja.innerHTML = qrSvg(qr.enlace, qr.id);
        caja.setAttribute('role', 'img');
        caja.setAttribute('aria-label', monto ? `Código QR para cobrar ${dinero(monto)}` : 'Código QR para cobrarte');
        caja.removeAttribute('aria-busy');
        raiz.querySelector('#leyenda').innerHTML = monto
            ? `Cobro de <strong>${esc(dinero(monto))}</strong>${concepto ? ` · ${esc(concepto)}` : ''}. Sirve para un solo pago.`
            : 'Muestra este código para que te paguen el monto que quieran';
    };

    const { qr } = await api.miQr();
    if (!vigente()) return;
    pintar(qr);

    raiz.querySelector('#compartir').addEventListener('click', async () => {
        const datos = { title: 'La Cajita', text: `Págale a ${usuario.nombre ?? 'esta persona'} con La Cajita`, url: actual.enlace };
        if (navigator.share) {
            try { await navigator.share(datos); return; } catch (e) { if (e.name === 'AbortError') return; }
        }
        copiar(actual.enlace, 'Enlace de cobro copiado');
    });

    raiz.querySelector('#con-monto').addEventListener('click', () => {
        const hoja = abrirHoja(`
            <form id="form-monto" novalidate>
                <h2>¿Cuánto vas a cobrar?</h2>
                <div class="campo"><label for="monto" class="oculto-visual">Monto en pesos</label>
                    <div class="con-prefijo"><span class="prefijo" aria-hidden="true">$</span><input class="entrada monto-grande" id="monto" inputmode="numeric" placeholder="0" autocomplete="off"></div>
                    <span class="mensaje-error" id="error-monto" aria-live="polite"></span></div>
                <div class="campo"><label for="concepto">¿Por qué? <span class="suave">(opcional)</span></label><input class="entrada" id="concepto" maxlength="40" placeholder="Ej.: 2 empanadas"></div>
                <div class="pila"><button class="boton" type="submit">Crear QR</button><button class="boton fantasma" type="button" data-cerrar>Cancelar</button></div>
            </form>`, { etiqueta: 'Cobrar un monto exacto' });
        const campo = hoja.querySelector('#monto');
        formatearCampoMonto(campo);
        campo.focus();
        hoja.querySelector('#form-monto').addEventListener('submit', async (e) => {
            e.preventDefault();
            const valor = aUnidadMinima(campo.value, 2);
            if (!valor) { hoja.querySelector('#error-monto').textContent = 'Escribe un monto mayor que cero.'; return; }
            const concepto = hoja.querySelector('#concepto').value.trim() || undefined;
            await conEspera(e.submitter, async () => {
                try {
                    const r = await api.miQr({ monto: valor, concepto });
                    hoja.close();
                    pintar(r.qr, { value: valor, assetCode: 'COP', assetScale: 2 }, concepto);
                    toast('QR listo para cobrar');
                } catch (err) {
                    hoja.querySelector('#error-monto').textContent = err.message;
                }
            });
        });
    });
}

// ---------------------------------------------------------------- Pagar
const qrDeTexto = (texto) => {
    const t = String(texto ?? '').trim();
    const m = t.match(/[?&#]qr=([\w-]+)/) ?? t.match(/\/qr\/([\w-]+)/) ?? t.match(/^([\w-]{6,})$/);
    return m ? m[1] : null;
};

export async function pagar(ctx, qrId) {
    if (qrId) return confirmarPago(ctx, qrId);
    const { raiz, ir } = ctx;
    const puedeEscanear = 'BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia;
    raiz.innerHTML = `
        <div class="encabezado">${atras()}<h1>Pagar</h1></div>
        ${puedeEscanear ? `
            <div class="camara" id="camara" hidden><video id="video" playsinline muted aria-label="Vista de la cámara"></video><span class="mira" aria-hidden="true"></span></div>
            <div class="pila" id="zona-escanear">
                <button class="boton" type="button" id="escanear">${icono('escanear')} Escanear código QR</button>
            </div>
            <p class="centro suave" style="margin:20px 0 12px">o</p>` : `
            <div class="aviso info" style="margin-top:0">${icono('celular')}<p>Abre la cámara de tu celular y apunta al QR: se abrirá el pago. También puedes pegar aquí el enlace.</p></div>`}
        <form id="form" novalidate style="margin-top:16px">
            <div class="campo">
                <label for="enlace">Enlace de cobro</label>
                <input class="entrada" id="enlace" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://…/#cliente?qr=…" aria-describedby="error">
                <span class="mensaje-error" id="error" aria-live="polite"></span>
            </div>
            <button class="boton ${puedeEscanear ? 'secundario' : ''}" type="submit">${icono('enlace')} Continuar con el enlace</button>
        </form>`;

    raiz.querySelector('#form').addEventListener('submit', (e) => {
        e.preventDefault();
        const id = qrDeTexto(raiz.querySelector('#enlace').value);
        if (!id) { raiz.querySelector('#error').textContent = 'Ese enlace no es de un cobro de La Cajita.'; return; }
        ir(`pagar/${id}`);
    });

    if (!puedeEscanear) return;
    let flujo = null;
    const parar = () => flujo?.getTracks().forEach((t) => t.stop());
    window.addEventListener('hashchange', parar, { once: true });
    raiz.querySelector('#escanear').addEventListener('click', async () => {
        try {
            flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        } catch {
            toast('No pudimos abrir la cámara. Pega el enlace del cobro.', { tipo: 'error' });
            return;
        }
        const video = raiz.querySelector('#video');
        raiz.querySelector('#camara').hidden = false;
        raiz.querySelector('#zona-escanear').innerHTML = `<button class="boton secundario" type="button" id="cancelar">Cancelar</button>`;
        raiz.querySelector('#cancelar').addEventListener('click', () => { parar(); pagar(ctx); });
        video.srcObject = flujo;
        await video.play();
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        const buscar = async () => {
            if (!video.isConnected || !flujo.active) return;
            try {
                const [codigo] = await detector.detect(video);
                const id = codigo && qrDeTexto(codigo.rawValue);
                if (id) { parar(); navigator.vibrate?.(60); return ir(`pagar/${id}`); }
            } catch { /* cuadro sin QR */ }
            requestAnimationFrame(buscar);
        };
        buscar();
    });
}

// Abre la ventana de consentimiento de la billetera y lleva a la pantalla que sigue el pago.
// La ventana se abre en el mismo clic (antes de esperar al servidor) para que el navegador no la bloquee.
function abrirVentanaConsentimiento() {
    try { return window.open('', '_blank'); } catch { return null; }
}
function seguirPago({ ir }, respuesta, ventana) {
    if (respuesta.redirectUrl) {
        sessionStorage.setItem('cajita_pago_pendiente', respuesta.pagoId);
        if (ventana && !ventana.closed) {
            ventana.location.href = respuesta.redirectUrl;
            return ir(`pago/${respuesta.pagoId}`);
        }
        location.href = respuesta.redirectUrl;
        return;
    }
    ventana?.close();
    ir(`pago/${respuesta.pagoId}`);
}

async function confirmarPago(ctx, qrId) {
    const { raiz, api, usuario, vigente } = ctx;
    const qr = await api.verQr(qrId);
    if (!vigente()) return;
    const montoFijo = qr.monto;
    raiz.innerHTML = `
        <div class="encabezado">${atras('#/pagar')}<h1>Confirma el pago</h1></div>
        <section class="tarjeta">
            <div class="total">
                <div class="estado-grande">${icono('tienda')}</div>
                <p class="suave" style="margin:0">Vas a pagarle a</p>
                <h2 style="font-size:1.4rem;margin:2px 0 8px">${esc(qr.vendedor ?? 'Comercio')}</h2>
                ${montoFijo ? `<div class="monto">${esc(dinero(montoFijo))}</div>` : ''}
                ${qr.descripcion ? `<p class="suave" style="margin:0">${esc(qr.descripcion)}</p>` : ''}
            </div>
            <form id="form" novalidate>
                ${montoFijo ? '' : `
                <div class="campo"><label for="monto">¿Cuánto vas a pagar?</label>
                    <div class="con-prefijo"><span class="prefijo" aria-hidden="true">$</span><input class="entrada monto-grande" id="monto" inputmode="numeric" placeholder="0" autocomplete="off"></div></div>`}
                <div class="campo">
                    <label for="pagador">Pagas desde tu billetera</label>
                    <input class="entrada" id="pagador" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(aDolarIlp(billeteraPagadora(usuario)))}" placeholder="$ilp.interledger-test.dev/tu-nombre" ${usuario.wallet ? 'readonly' : ''}>
                    <span class="ayuda">${usuario.wallet ? 'Tu billetera te pedirá autorizar el pago.' : 'Recibes en efectivo: para pagar necesitas una billetera digital.'}</span>
                </div>
                <dl class="datos">
                    <div><dt>Llega a</dt><dd>${qr.destino === 'efectivo' ? 'Efectivo, a su cédula' : 'Su billetera'}</dd></div>
                    ${qr.usado ? '<div><dt>Estado</dt><dd>Ya fue pagado</dd></div>' : ''}
                </dl>
                <span class="mensaje-error" id="error" aria-live="polite"></span>
                <div class="pila-abajo"><button class="boton" type="submit" id="pagar" ${qr.usado ? 'disabled' : ''}>${montoFijo ? `Pagar ${esc(dinero(montoFijo))}` : 'Pagar'}</button></div>
            </form>
        </section>`;
    const campoMonto = raiz.querySelector('#monto');
    const boton = raiz.querySelector('#pagar');
    if (campoMonto) {
        formatearCampoMonto(campoMonto);
        campoMonto.addEventListener('input', () => {
            const v = aUnidadMinima(campoMonto.value, 2);
            boton.textContent = v ? `Pagar ${dinero({ value: v, assetCode: 'COP', assetScale: 2 })}` : 'Pagar';
        });
        campoMonto.focus();
    }
    raiz.querySelector('#form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const error = raiz.querySelector('#error');
        const pagador = raiz.querySelector('#pagador').value.trim();
        const monto = montoFijo ? undefined : aUnidadMinima(campoMonto.value, 2);
        if (!montoFijo && !monto) { error.textContent = 'Escribe cuánto vas a pagar.'; campoMonto.focus(); return; }
        if (!pagador) { error.textContent = 'Escribe la dirección de tu billetera.'; return; }
        const ventana = abrirVentanaConsentimiento();
        await conEspera(boton, async () => {
            try {
                if (!usuario.wallet) localStorage.setItem('cajita_pagador', pagador);
                const r = await api.pagarQr(qrId, { pagador, monto });
                seguirPago(ctx, r, ventana);
            } catch (err) {
                ventana?.close();
                error.textContent = err.message;
            }
        });
    });
}

// ---------------------------------------------------------------- Seguimiento de un pago
export async function pago({ raiz, api, vigente }, pagoId) {
    let intentos = 0;
    const pintar = (p) => {
        const listo = p.estado === 'completado';
        const mal = ['fallido', 'rechazado', 'cancelado'].includes(p.estado);
        raiz.innerHTML = `
            <div class="encabezado">${atras('#/inicio', 'Ir al inicio')}</div>
            <section class="tarjeta" aria-live="polite">
                <div class="total">
                    <div class="estado-grande ${listo ? '' : mal ? 'mal' : 'espera'}">${icono(listo ? 'check' : mal ? 'alerta' : 'reloj')}</div>
                    <h1 style="font-size:1.3rem">${listo ? '¡Pago enviado!' : mal ? 'El pago no se hizo' : 'Autoriza el pago en tu billetera'}</h1>
                    <div class="monto">${esc(dinero(p.total))}</div>
                    ${chipEstado(p.estado)}
                    ${!listo && !mal ? '<p class="suave" style="margin-top:12px">Se abrió una ventana de tu billetera. Cuando aceptes, esta pantalla se actualiza sola.</p>' : ''}
                    ${mal && p.error ? `<p class="suave" style="margin-top:12px">${esc(p.error)}</p>` : ''}
                </div>
                <dl class="datos">${(p.destinos ?? []).map((d) => `<div><dt>Para</dt><dd>${esc(d.nombre ?? '')} · ${esc(dinero(d.monto))}</dd></div>`).join('')}</dl>
                <details class="comprobante"><summary>${icono('escudo', 'chev')}&nbsp; Comprobante de Open Payments</summary>${comprobanteHtml(p)}</details>
            </section>
            <div class="pila-abajo"><a class="boton" href="#/inicio">${listo ? 'Listo' : 'Volver al inicio'}</a></div>`;
        return listo || mal;
    };
    const revisar = async () => {
        if (!vigente()) return;
        let p;
        try { p = await api.verPago(pagoId); } catch (err) { if (intentos === 0) throw err; return setTimeout(revisar, 3000); }
        if (!vigente()) return;
        const abierto = raiz.querySelector('details.comprobante')?.open;
        const terminado = pintar(p);
        if (abierto) raiz.querySelector('details.comprobante').open = true;
        if (terminado) { sessionStorage.removeItem('cajita_pago_pendiente'); return; }
        if (++intentos < 150) setTimeout(revisar, 2000);
    };
    await revisar();
}

// ---------------------------------------------------------------- Enviar al exterior
export function enviar(ctx) {
    const { raiz, api, usuario } = ctx;
    let modo = 'envio';
    let destino = 'efectivo';
    let cotizacion = null;
    raiz.innerHTML = `
        <div class="encabezado">${atras()}<h1>Enviar dinero</h1></div>
        <p class="suave">Envía desde tu billetera, en cualquier moneda, a alguien en Colombia. Le llega a su billetera o en efectivo con su cédula.</p>
        <form id="form" novalidate>
            <div class="campo">
                <label for="remitente">Envías desde tu billetera</label>
                <input class="entrada" id="remitente" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(aDolarIlp(billeteraPagadora(usuario)))}" placeholder="$ilp.interledger-test.dev/tu-nombre" ${usuario.wallet ? 'readonly' : ''}>
            </div>
            <h2 style="margin-top:8px">¿Cómo lo recibe?</h2>
            <div class="segmento" role="group" aria-label="Cómo recibe">
                <button type="button" data-destino="efectivo" aria-pressed="true">En efectivo</button>
                <button type="button" data-destino="billetera" aria-pressed="false">En su billetera</button>
            </div>
            <div id="campos-destino"></div>
            <h2 style="margin-top:8px">¿Cuánto?</h2>
            <div class="segmento" role="group" aria-label="Cómo calcular el monto">
                <button type="button" data-modo="envio" aria-pressed="true">Yo envío</button>
                <button type="button" data-modo="recibe" aria-pressed="false">Que reciba</button>
            </div>
            <div class="campo">
                <label for="monto" id="rotulo-monto"></label>
                <div class="con-prefijo"><span class="prefijo" id="moneda-monto" aria-hidden="true">$</span><input class="entrada monto-grande" id="monto" inputmode="decimal" placeholder="0" autocomplete="off"></div>
                <span class="ayuda" id="ayuda-monto"></span>
            </div>
            <span class="mensaje-error" id="error" aria-live="polite"></span>
            <div class="pila-abajo"><button class="boton" type="submit" id="cotizar">Ver cuánto llega</button></div>
        </form>`;

    const camposDestino = raiz.querySelector('#campos-destino');
    const pintarDestino = () => {
        camposDestino.innerHTML = destino === 'efectivo' ? `
            <div class="campo"><label for="celular">Celular de quien recibe</label><input class="entrada" id="celular" type="tel" inputmode="numeric" placeholder="300 123 4567" maxlength="12"><span class="ayuda">Le avisamos por SMS cuando llegue.</span></div>
            <div class="campo"><label for="cedula">Cédula de quien recibe</label><input class="entrada" id="cedula" inputmode="numeric" placeholder="1020459183" maxlength="10"><span class="ayuda">La necesitará para retirar en el corresponsal.</span></div>` : `
            <div class="campo"><label for="wallet-destino">Billetera de quien recibe</label><input class="entrada" id="wallet-destino" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="$ilp.interledger-test.dev/mama"></div>`;
    };
    const moneda = { assetCode: 'COP', assetScale: 2 };
    const pintarModo = async () => {
        const rem = raiz.querySelector('#remitente').value.trim();
        if (rem) Object.assign(moneda, await monedaDe(rem.replace(/^\$/, 'https://')));
        const enCop = modo === 'recibe';
        raiz.querySelector('#rotulo-monto').textContent = enCop ? 'Monto exacto que debe recibir (pesos)' : `Monto que envías (${moneda.assetCode})`;
        raiz.querySelector('#moneda-monto').textContent = enCop ? '$' : moneda.assetCode;
        raiz.querySelector('#ayuda-monto').textContent = enCop ? 'Tú pagas la comisión: le llega exactamente esto.' : 'La comisión se descuenta de lo que envías.';
    };
    pintarDestino();
    pintarModo();

    raiz.querySelectorAll('[data-destino]').forEach((b) => b.addEventListener('click', () => {
        destino = b.dataset.destino;
        raiz.querySelectorAll('[data-destino]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        pintarDestino();
    }));
    raiz.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => {
        modo = b.dataset.modo;
        raiz.querySelectorAll('[data-modo]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        pintarModo();
    }));
    raiz.querySelector('#remitente').addEventListener('change', pintarModo);

    raiz.querySelector('#form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const error = raiz.querySelector('#error');
        error.textContent = '';
        const remitente = raiz.querySelector('#remitente').value.trim();
        const escala = modo === 'recibe' ? 2 : moneda.assetScale;
        const monto = aUnidadMinima(raiz.querySelector('#monto').value, escala);
        const datos = { remitente, nombreRemitente: usuario.nombre, monto, modo };
        if (destino === 'efectivo') {
            datos.celular = raiz.querySelector('#celular').value.replace(/\D/g, '');
            datos.cedula = raiz.querySelector('#cedula').value.replace(/\D/g, '');
            if (datos.celular.length !== 10) { error.textContent = 'Escribe los 10 dígitos del celular de quien recibe.'; return; }
            if (datos.cedula.length < 6) { error.textContent = 'Escribe la cédula de quien recibe.'; return; }
        } else {
            datos.destinatarioWallet = raiz.querySelector('#wallet-destino').value.trim();
            if (!datos.destinatarioWallet) { error.textContent = 'Escribe la billetera de quien recibe.'; return; }
        }
        if (!remitente) { error.textContent = 'Escribe la dirección de tu billetera.'; return; }
        if (!monto) { error.textContent = 'Escribe un monto mayor que cero.'; return; }
        await conEspera(e.submitter, async () => {
            try {
                if (!usuario.wallet) localStorage.setItem('cajita_pagador', remitente);
                cotizacion = await api.cotizarRemesa(datos);
                mostrarCotizacion(ctx, cotizacion, datos);
            } catch (err) {
                error.textContent = err.message;
            }
        });
    });
}

function mostrarCotizacion(ctx, c, datos) {
    const hoja = abrirHoja(`
        <h2>Revisa antes de enviar</h2>
        <dl class="datos">
            <div><dt>Envías</dt><dd>${esc(dinero(c.cobra))}</dd></div>
            <div><dt>Recibe</dt><dd style="color:var(--exito);font-size:1.2rem">${esc(dinero(c.llega))}</dd></div>
            <div><dt>Para</dt><dd>${datos.destinatarioWallet ? esc(datos.destinatarioWallet) : `Efectivo · cédula ${esc(enmascarar(datos.cedula))}`}</dd></div>
            ${c.vence ? `<div><dt>Precio válido por</dt><dd id="vence">${esc(horaRestante(c.vence))}</dd></div>` : ''}
        </dl>
        <span class="mensaje-error" id="error-envio" aria-live="polite"></span>
        <div class="pila-abajo" style="margin-top:20px">
            <button class="boton" type="button" id="confirmar">Enviar ${esc(dinero(c.cobra))}</button>
            <button class="boton fantasma" type="button" data-cerrar>Cambiar algo</button>
        </div>`, { etiqueta: 'Revisa antes de enviar' });
    const boton = hoja.querySelector('#confirmar');
    boton.focus();
    boton.addEventListener('click', async () => {
        const ventana = abrirVentanaConsentimiento();
        await conEspera(boton, async () => {
            try {
                const r = await ctx.api.enviarRemesa(c.cotizacionId);
                hoja.close();
                seguirPago(ctx, r, ventana);
            } catch (err) {
                ventana?.close();
                hoja.querySelector('#error-envio').textContent = err.message;
            }
        });
    });
}

// ---------------------------------------------------------------- Retirar en efectivo
export async function retirar({ raiz, api, usuario, vigente }) {
    if (usuario.tipo !== 'efectivo') {
        raiz.innerHTML = `
            <div class="encabezado">${atras()}<h1>Retirar en efectivo</h1></div>
            <div class="vacio">
                <div class="ico-grande">${icono('billetera')}</div>
                <h2>Tu dinero está en tu billetera</h2>
                <p class="suave">El retiro en efectivo es para quien recibe con su cédula. Si quieres recibir así, cámbialo en tu perfil.</p>
                <a class="boton secundario" href="#/perfil">Ir a mi perfil</a>
            </div>`;
        return;
    }
    const r = await api.resumen();
    if (!vigente()) return;
    const saldo = r.saldo ?? { value: '0', assetCode: 'COP', assetScale: 2 };
    const sinSaldo = BigInt(saldo.value || 0) === 0n;
    const pendiente = r.retiroPendiente;
    raiz.innerHTML = `
        <div class="encabezado">${atras()}<h1>Retirar en efectivo</h1></div>
        <section class="tarjeta saldo">
            <div class="etiqueta">Vas a retirar todo tu saldo</div>
            <div class="monto">${esc(dinero(saldo))}</div>
            <p class="detalle">Cédula ${esc(enmascarar(usuario.cedula))}</p>
        </section>
        ${pendiente ? `
            <div class="aviso">${icono('candado')}<p><strong>Ya tienes un PIN activo por ${esc(dinero(pendiente.monto))}</strong>Vence en ${esc(horaRestante(pendiente.vence))}. Si pides otro, el anterior deja de servir.</p></div>` : ''}
        <section class="seccion" aria-labelledby="como">
            <h2 id="como">Cómo funciona</h2>
            <ol class="pasos-lista">
                <li><span>Toca <strong>Pedir PIN</strong>. Te llega por SMS al +57 ${esc(enmascarar(usuario.celular))}.</span></li>
                <li><span>Ve a un corresponsal con tu <strong>cédula</strong> y el <strong>PIN</strong>.</span></li>
                <li><span>Te entregan el dinero en efectivo. Te avisamos por SMS.</span></li>
            </ol>
        </section>
        <div class="pila-abajo">
            <button class="boton" type="button" id="pedir" ${sinSaldo ? 'disabled' : ''}>${icono('celular')} ${pendiente ? 'Pedir un PIN nuevo' : 'Pedir PIN por SMS'}</button>
            ${sinSaldo ? '<p class="suave centro chico">Aún no tienes saldo para retirar. Te avisaremos por SMS cuando te llegue dinero.</p>' : ''}
        </div>`;
    raiz.querySelector('#pedir').addEventListener('click', (e) => conEspera(e.currentTarget, async () => {
        try {
            const res = await api.pedirRetiro(usuario.cedula);
            abrirHoja(`
                <div class="total">
                    <div class="estado-grande">${icono('check')}</div>
                    <h2>Te enviamos el PIN por SMS</h2>
                    <div class="monto">${esc(dinero(res.monto))}</div>
                    <p class="suave">Vence en ${esc(horaRestante(res.vence))}. No compartas tu PIN con nadie: solo dáselo al corresponsal junto con tu cédula.</p>
                </div>
                <a class="boton" href="#/inicio" data-cerrar>Entendido</a>`, { etiqueta: 'PIN enviado' });
        } catch (err) {
            toast(err.message, { tipo: 'error' });
        }
    }));
}
