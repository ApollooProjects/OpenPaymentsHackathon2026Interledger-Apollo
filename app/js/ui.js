// Utilidades de interfaz: formato de montos, escape, toasts, hoja inferior y campo de código.
import { icono } from './iconos.js';

export const esc = (texto) => String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SIMBOLOS = { COP: '$', USD: 'US$', EUR: '€', MXN: 'MX$', GBP: '£' };

// { value: "300000", assetCode: "COP", assetScale: 2 } → "$ 3.000" (sin decimales si son cero).
export function dinero(monto) {
    if (!monto || monto.value == null) return '—';
    const escala = Number(monto.assetScale ?? 2);
    const valor = Number(monto.value) / 10 ** escala;
    const decimales = Number.isInteger(valor) ? 0 : Math.min(escala, 2);
    const numero = valor.toLocaleString('es-CO', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
    const codigo = monto.assetCode ?? 'COP';
    return `${SIMBOLOS[codigo] ?? codigo} ${numero}`;
}

// Lo que escribe la persona ("3.000", "3000,50") → valor entero en la unidad mínima.
export function aUnidadMinima(texto, escala = 2) {
    const limpio = String(texto ?? '').trim().replace(/\s|\$/g, '');
    if (!limpio) return null;
    let normal = limpio;
    if (/,\d{1,2}$/.test(normal)) normal = normal.replace(/\./g, '').replace(',', '.');
    else normal = normal.replace(/[.,](?=\d{3}(\D|$))/g, '');
    const numero = Number(normal);
    if (!Number.isFinite(numero) || numero <= 0) return null;
    return String(Math.round(numero * 10 ** escala));
}

// Formatea en vivo un campo de monto en pesos: "3000" → "3.000".
export function formatearCampoMonto(input) {
    input.addEventListener('input', () => {
        const digitos = input.value.replace(/\D/g, '').replace(/^0+/, '');
        input.value = digitos ? Number(digitos).toLocaleString('es-CO') : '';
    });
}

export const enmascarar = (texto, visibles = 4) => {
    const s = String(texto ?? '');
    return s.length <= visibles ? s : `•••• ${s.slice(-visibles)}`;
};

export const celularBonito = (celular) => {
    const d = String(celular ?? '').replace(/\D/g, '').slice(-10);
    return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : d;
};

export function fechaCorta(iso) {
    const fecha = new Date(iso);
    if (Number.isNaN(fecha.getTime())) return '';
    return fecha.toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function grupoDeFecha(iso) {
    const fecha = new Date(iso);
    const hoy = new Date();
    const dia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diferencia = Math.round((dia(hoy) - dia(fecha)) / 86_400_000);
    if (diferencia === 0) return 'Hoy';
    if (diferencia === 1) return 'Ayer';
    return fecha.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function horaRestante(iso) {
    const ms = new Date(iso) - Date.now();
    if (!(ms > 0)) return 'vencido';
    const minutos = Math.round(ms / 60_000);
    if (minutos < 60) return `${minutos} min`;
    const horas = Math.floor(minutos / 60);
    return horas < 48 ? `${horas} h` : `${Math.floor(horas / 24)} días`;
}

// Moneda de una billetera guardada al registrarla ({ wallet, assetCode, assetScale } en localStorage), o null.
export function monedaGuardada(wallet) {
    try {
        const guardada = JSON.parse(localStorage.getItem('cajita_billetera') ?? 'null');
        if (guardada?.assetCode && (!wallet || guardada.wallet === wallet)) return { assetCode: guardada.assetCode, assetScale: Number(guardada.assetScale ?? 2) };
    } catch { /* sin dato */ }
    return null;
}

// ---------- Toasts ----------
export function toast(mensaje, { tipo = 'ok', ms = 3800 } = {}) {
    const zona = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = `toast ${tipo === 'error' ? 'error' : ''}`;
    el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
    el.innerHTML = `${icono(tipo === 'error' ? 'alerta' : 'check')}<span>${esc(mensaje)}</span>`;
    zona.append(el);
    setTimeout(() => el.remove(), ms);
}

// ---------- Hoja inferior ----------
// Abre un <dialog> con el HTML dado; devuelve el elemento. Se cierra con Esc, tocando afuera o con [data-cerrar].
export function abrirHoja(html, { etiqueta = 'Detalle' } = {}) {
    const dialogo = document.createElement('dialog');
    dialogo.className = 'hoja';
    dialogo.setAttribute('aria-label', etiqueta);
    dialogo.innerHTML = `<div class="asa" aria-hidden="true"></div>${html}`;
    document.body.append(dialogo);
    dialogo.addEventListener('click', (e) => {
        if (e.target === dialogo || e.target.closest('[data-cerrar]')) dialogo.close();
    });
    dialogo.addEventListener('close', () => dialogo.remove());
    dialogo.showModal();
    return dialogo;
}

// ---------- Botón en espera ----------
export async function conEspera(boton, tarea) {
    const textoOriginal = boton.innerHTML;
    boton.disabled = true;
    boton.classList.add('cargando');
    boton.setAttribute('aria-busy', 'true');
    try {
        return await tarea();
    } finally {
        boton.disabled = false;
        boton.classList.remove('cargando');
        boton.removeAttribute('aria-busy');
        boton.innerHTML = textoOriginal;
    }
}

// ---------- Campo de código de 6 dígitos ----------
// contenedor: <div class="codigo">; alCompletar(codigo) se llama al llenar las 6 casillas.
export function montarCodigo(contenedor, alCompletar) {
    contenedor.innerHTML = Array.from({ length: 6 }, (_, i) =>
        `<input inputmode="numeric" pattern="[0-9]*" maxlength="1" ${i === 0 ? 'autocomplete="one-time-code"' : 'autocomplete="off"'} aria-label="Dígito ${i + 1} de 6">`
    ).join('');
    const casillas = [...contenedor.querySelectorAll('input')];
    const valor = () => casillas.map((c) => c.value).join('');
    const revisar = () => { if (valor().length === 6) alCompletar(valor()); };
    const repartir = (texto, desde) => {
        const digitos = texto.replace(/\D/g, '').slice(0, 6 - desde).split('');
        digitos.forEach((d, i) => { casillas[desde + i].value = d; });
        casillas[Math.min(desde + digitos.length, 5)].focus();
        revisar();
    };
    casillas.forEach((casilla, i) => {
        casilla.addEventListener('input', () => {
            const v = casilla.value.replace(/\D/g, '');
            if (v.length > 1) return repartir(v, i);
            casilla.value = v;
            if (v && i < 5) casillas[i + 1].focus();
            contenedor.removeAttribute('aria-invalid');
            revisar();
        });
        casilla.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !casilla.value && i > 0) { casillas[i - 1].focus(); casillas[i - 1].value = ''; }
            if (e.key === 'ArrowLeft' && i > 0) casillas[i - 1].focus();
            if (e.key === 'ArrowRight' && i < 5) casillas[i + 1].focus();
        });
        casilla.addEventListener('paste', (e) => {
            e.preventDefault();
            repartir((e.clipboardData || window.clipboardData).getData('text'), i);
        });
    });
    return {
        enfocar: () => casillas[0].focus(),
        limpiar: () => { casillas.forEach((c) => { c.value = ''; }); casillas[0].focus(); },
        valor
    };
}

// Copia texto y avisa.
export async function copiar(texto, aviso = 'Copiado') {
    try {
        await navigator.clipboard.writeText(texto);
        toast(aviso);
    } catch {
        window.prompt('Copia este texto:', texto);
    }
}

// Dibuja un QR como SVG con la librería del CDN (qrcode-generator); si no cargó, usa la imagen del backend.
export function qrSvg(texto, qrId) {
    if (window.qrcode) {
        const qr = window.qrcode(0, 'M');
        qr.addData(texto);
        qr.make();
        return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    }
    return qrId ? `<img src="/qr/${encodeURIComponent(qrId)}/imagen" alt="">` : '';
}
