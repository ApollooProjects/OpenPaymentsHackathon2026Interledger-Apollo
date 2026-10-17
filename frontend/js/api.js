// Llamadas al backend (contrato HTTP de PLAN_DE_TRABAJO.md §2d) y utilidades comunes de las pestañas.
// Con ?mock=1 en la URL (o en el hash) se usan datos falsos con la misma forma del contrato.

// Todas las wallets de la demo están en COP con escala 2 (verificado en C0.1).
export const MONEDA_DEMO = { assetCode: 'COP', assetScale: 2 };

export function parametrosHash() {
    const [nombre, consulta = ''] = location.hash.slice(1).split('?');
    return { pestana: nombre || 'cliente', params: new URLSearchParams(consulta) };
}

export function usaMock() {
    return new URLSearchParams(location.search).get('mock') === '1'
        || parametrosHash().params.get('mock') === '1';
}

// Llama a fn cada vez que se abre la pestaña indicada.
export function alAbrirPestana(nombre, fn) {
    const revisar = () => {
        const { pestana, params } = parametrosHash();
        if (pestana === nombre) fn(params);
    };
    window.addEventListener('hashchange', revisar);
    revisar();
}

// "3.000" → { value: "300000", assetCode: "COP", assetScale: 2 }
export function aMonto(texto, moneda = MONEDA_DEMO) {
    const limpio = String(texto).trim().replace(/[^\d,]/g, '').replace(',', '.');
    const numero = Number(limpio);
    if (!limpio || !Number.isFinite(numero) || numero <= 0) return null;
    const value = Math.round(numero * 10 ** moneda.assetScale).toString();
    return { value, assetCode: moneda.assetCode, assetScale: moneda.assetScale };
}

// { value: "300000", assetCode: "COP", assetScale: 2 } → "$ 3.000"
export function formatearMonto(monto) {
    if (!monto) return '';
    const numero = Number(monto.value) / 10 ** monto.assetScale;
    return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: monto.assetCode,
        maximumFractionDigits: monto.assetCode === 'COP' ? 0 : 2,
    }).format(numero);
}

export function idCliente() {
    let id = null;
    try {
        id = localStorage.getItem('cajita.clienteId');
        if (!id) {
            id = crypto.randomUUID();
            localStorage.setItem('cajita.clienteId', id);
        }
    } catch {
        id = id || crypto.randomUUID();
    }
    return id;
}

async function pedir(metodo, ruta, cuerpo) {
    const respuesta = await fetch(ruta, {
        method: metodo,
        headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) {
        const error = new Error(datos.error || `Error ${respuesta.status}`);
        error.status = respuesta.status;
        throw error;
    }
    return datos;
}

// ---------- Datos falsos (misma forma que el contrato) ----------

const mock = {
    qr(qrId) {
        return {
            qrId,
            vendedor: 'Doña Rita',
            tipo: 'estatico',
            monto: null,
            meseros: [],
            vigenteHasta: null,
            propina: false,
        };
    },
    pagar(qrId, { monto }) {
        sessionStorage.setItem('cajita.mock.total', JSON.stringify(monto));
        return { redirectUrl: `/?mock=1#recibo?pago=mock-${Date.now()}` };
    },
    pago() {
        const total = JSON.parse(sessionStorage.getItem('cajita.mock.total') || 'null')
            || { value: '300000', ...MONEDA_DEMO };
        return { estado: 'completado', total, destinos: [{ nombre: 'Doña Rita', monto: total }] };
    },
};

// ---------- Contrato HTTP ----------

export function obtenerQr(qrId) {
    if (usaMock()) return Promise.resolve(mock.qr(qrId));
    return pedir('GET', `/qr/${encodeURIComponent(qrId)}`);
}

export function iniciarPago(qrId, cuerpo) {
    if (usaMock()) return Promise.resolve(mock.pagar(qrId, cuerpo));
    return pedir('POST', `/pagar/${encodeURIComponent(qrId)}`, cuerpo);
}

export function obtenerPago(pagoId) {
    if (usaMock()) return Promise.resolve(mock.pago(pagoId));
    return pedir('GET', `/pagos/${encodeURIComponent(pagoId)}`);
}

// Cajero (C2.3): PIN + cédula → paga Custodia → Corresponsal. 202 = el pago sigue en proceso.
export async function validarRetiro({ pin, cedula }) {
    if (usaMock()) return { ok: true, estado: 'entregado', monto: { value: '1500000', ...MONEDA_DEMO } };
    const respuesta = await fetch('/retiros/validar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, cedula }),
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (respuesta.status === 404 && !datos.error) datos.error = 'El servicio de retiros todavía no está disponible';
    return { status: respuesta.status, ...datos };
}

export function urlImagenQr(qrId) {
    return `/qr/${encodeURIComponent(qrId)}/imagen`;
}
