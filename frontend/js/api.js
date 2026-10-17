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
        // 404 sin mensaje del backend = la ruta todavía no existe en este servidor (otra capa sin fusionar).
        const porDefecto = respuesta.status === 404 ? 'esta función todavía no está disponible en el servidor' : `Error ${respuesta.status}`;
        const error = new Error(datos.error || porDefecto);
        error.status = respuesta.status;
        throw error;
    }
    return datos;
}

// ---------- Datos falsos (misma forma que el contrato) ----------

// El estado falso vive en sessionStorage para que el reparto, los QR y los pagos rápidos se vean entre pestañas.
function estadoMock() {
    try {
        return JSON.parse(sessionStorage.getItem('cajita.mock') || 'null') || { repartos: {}, qrs: {}, permiso: null, pagos: {} };
    } catch {
        return { repartos: {}, qrs: {}, permiso: null, pagos: {} };
    }
}

function guardarMock(estado) {
    try { sessionStorage.setItem('cajita.mock', JSON.stringify(estado)); } catch { /* sin almacenamiento */ }
}

const pesos = (valor) => ({ value: String(valor), ...MONEDA_DEMO });

const mock = {
    qr(qrId) {
        const guardado = estadoMock().qrs[qrId];
        if (guardado?.vigenteHasta && new Date(guardado.vigenteHasta) < new Date()) {
            const error = new Error('Este QR ya venció');
            error.status = 410;
            throw error;
        }
        return guardado || {
            qrId, vendedor: 'Doña Rita', tipo: 'estatico', monto: null, meseros: [], vigenteHasta: null, propina: false,
        };
    },
    pagar(qrId, { monto, propina, pagosRapidos }) {
        const estado = estadoMock();
        const qr = estado.qrs[qrId] || mock.qr(qrId);
        const reparto = Object.values(estado.repartos).find((r) => r.qrId === qrId || r.id === qr.repartoId);
        const total = BigInt(monto.value) + BigInt(propina?.value || 0);
        const destinos = [];
        let paraVendedor = BigInt(monto.value);

        if (reparto) {
            const falta = BigInt(reparto.deuda) - BigInt(reparto.pagado);
            const parte = (BigInt(monto.value) * BigInt(reparto.porcentaje)) / 100n;
            const alProveedor = falta > 0n ? (parte < falta ? parte : falta) : 0n;
            if (alProveedor > 0n) destinos.push({ nombre: 'Proveedor', monto: pesos(alProveedor) });
            paraVendedor -= alProveedor;
            reparto.pagado = (BigInt(reparto.pagado) + alProveedor).toString();
            reparto.saldo = (BigInt(reparto.saldo) + paraVendedor).toString();
            reparto.ventas += 1;
        }
        destinos.unshift({ nombre: reparto?.vendedor || qr.vendedor, monto: pesos(paraVendedor) });
        const meseros = qr.meseros || [];
        if (propina && meseros.length) {
            const cada = BigInt(propina.value) / BigInt(meseros.length);
            meseros.forEach((_, i) => destinos.push({ nombre: `Mesero ${i + 1}`, monto: pesos(cada) }));
        }

        const pagoId = `mock-${Date.now()}`;
        estado.pagos[pagoId] = { estado: 'completado', total: pesos(total), destinos };

        // Pagos rápidos vigentes y con tope suficiente: sale sin consentimiento.
        const permiso = estado.permiso;
        if (permiso?.activo && BigInt(permiso.restante.value) >= total) {
            permiso.restante = pesos(BigInt(permiso.restante.value) - total);
            guardarMock(estado);
            return { pagoId, estado: 'completado' };
        }
        if (pagosRapidos?.tope) {
            estado.permiso = { activo: true, tope: pagosRapidos.tope, restante: pesos(BigInt(pagosRapidos.tope.value) - total) };
        }
        guardarMock(estado);
        return { redirectUrl: `/?mock=1#recibo?pago=${pagoId}` };
    },
    pago(pagoId) {
        return estadoMock().pagos[pagoId]
            || { estado: 'completado', total: pesos(300000), destinos: [{ nombre: 'Doña Rita', monto: pesos(300000) }] };
    },
    crearReparto(cuerpo) {
        const estado = estadoMock();
        const id = `mock-reparto-${Date.now()}`;
        const qrId = `mock-qr-${Date.now()}`;
        estado.repartos[id] = {
            id, qrId, vendedor: cuerpo.vendedor, conCuenta: cuerpo.conCuenta, cedula: cuerpo.cedula, celular: cuerpo.celular,
            porcentaje: cuerpo.porcentaje, deuda: cuerpo.deuda.value, pagado: '0', saldo: '0', ventas: 0,
        };
        estado.qrs[qrId] = {
            qrId, repartoId: id, vendedor: cuerpo.vendedor, tipo: 'estatico', monto: null, meseros: [], vigenteHasta: null, propina: false,
        };
        guardarMock(estado);
        return { id, qrId };
    },
    reparto(id) {
        const r = estadoMock().repartos[id];
        if (!r) {
            const error = new Error('Reparto no encontrado');
            error.status = 404;
            throw error;
        }
        return { saldo: pesos(r.saldo), ventas: r.ventas, proveedor: { pagado: pesos(r.pagado), deuda: pesos(r.deuda) } };
    },
    crearQr(cuerpo) {
        const estado = estadoMock();
        const qrId = `mock-qr-${Date.now()}`;
        estado.qrs[qrId] = {
            qrId,
            repartoId: cuerpo.repartoId,
            vendedor: cuerpo.vendedor,
            tipo: 'personalizado',
            monto: cuerpo.monto || null,
            meseros: cuerpo.meseros || [],
            vigenteHasta: cuerpo.vigenteHasta || null,
            propina: (cuerpo.meseros || []).length > 0,
        };
        guardarMock(estado);
        return { qrId, url: `${location.origin}/?mock=1#cliente?qr=${qrId}` };
    },
    retirar() {
        return { ok: true };
    },
    permiso() {
        return estadoMock().permiso || { activo: false };
    },
    cancelarPermiso() {
        const estado = estadoMock();
        estado.permiso = null;
        guardarMock(estado);
        return { ok: true };
    },
};

// Envuelve el mock para que sus errores (410, 404) lleguen igual que los del backend.
function conMock(fn) {
    try {
        return Promise.resolve(fn());
    } catch (error) {
        return Promise.reject(error);
    }
}

// ---------- Contrato HTTP ----------

export function obtenerQr(qrId) {
    if (usaMock()) return conMock(() => mock.qr(qrId));
    return pedir('GET', `/qr/${encodeURIComponent(qrId)}`);
}

// cuerpo: { pagador, monto, propina?, clienteId, pagosRapidos?: { tope } }
// → { redirectUrl } (hay que aprobar) o { pagoId, estado } (pagos rápidos vigentes, sin consentimiento)
export function iniciarPago(qrId, cuerpo) {
    if (usaMock()) return conMock(() => mock.pagar(qrId, cuerpo));
    return pedir('POST', `/pagar/${encodeURIComponent(qrId)}`, cuerpo);
}

export function obtenerPago(pagoId) {
    if (usaMock()) return conMock(() => mock.pago(pagoId));
    return pedir('GET', `/pagos/${encodeURIComponent(pagoId)}`);
}

// Capa 3 (C3.3): { vendedor, conCuenta, walletVendedor?, cedula?, celular?, proveedorWallet, porcentaje, deuda: Monto, meseros? }
export function crearReparto(cuerpo) {
    if (usaMock()) return conMock(() => mock.crearReparto(cuerpo));
    return pedir('POST', '/repartos', cuerpo);
}

// → { saldo: Monto, ventas, proveedor: { pagado: Monto, deuda: Monto } }
export function obtenerReparto(id) {
    if (usaMock()) return conMock(() => mock.reparto(id));
    return pedir('GET', `/repartos/${encodeURIComponent(id)}`);
}

// Capa 3 (C3.5): { vendedor, repartoId?, tipo: 'personalizado', monto?, descripcion?, meseros?: [walletUrl], vigenteHasta? }
export function crearQr(cuerpo) {
    if (usaMock()) return conMock(() => mock.crearQr(cuerpo));
    return pedir('POST', '/qr', cuerpo);
}

// Retiro desde la app (H7): mismo retiro que RETIRAR por SMS; el PIN llega a la bandeja del celular.
export function solicitarRetiro({ cedula, celular }) {
    if (usaMock()) return conMock(() => mock.retirar());
    return pedir('POST', '/retiros', { cedula, celular });
}

// Capa 3 (C3.6, propuesto): → { activo, tope?: Monto, restante?: Monto }. Sin la ruta todavía, se asume inactivo.
export async function obtenerPermiso(clienteId) {
    if (usaMock()) return mock.permiso();
    try {
        return await pedir('GET', `/permisos/${encodeURIComponent(clienteId)}`);
    } catch (error) {
        if (error.status === 404) return { activo: false };
        throw error;
    }
}

export function cancelarPermiso(clienteId) {
    if (usaMock()) return conMock(() => mock.cancelarPermiso());
    return pedir('DELETE', `/permisos/${encodeURIComponent(clienteId)}`);
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
