// Pestaña Mis cobros / Mis propinas (perfiles Proveedor y Meseros): lo que le ha llegado a su wallet.
import { alAbrirPestana, formatearMonto, obtenerCobros, parametrosHash } from './api.js';

const seccion = document.getElementById('cobros');
const $ = (selector) => seccion.querySelector(selector);

let temporizador = null;
let walletMostrada = null;   // para descartar respuestas que llegan tarde de otro perfil

function mostrarAviso(texto) {
    $('[data-aviso]').textContent = texto;
    $('[data-aviso]').hidden = !texto;
}

function filaMovimiento(movimiento, esMesero) {
    const li = document.createElement('li');
    const fecha = new Date(movimiento.fecha).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    const concepto = esMesero ? 'propina' : 'abono de la venta';
    li.append(Object.assign(document.createElement('strong'), { textContent: formatearMonto(movimiento.monto) }),
        ` ${concepto} · ${movimiento.de} · `, Object.assign(document.createElement('small'), { textContent: fecha }));
    return li;
}

function filaDeuda(deuda) {
    const p = document.createElement('p');
    const pagado = BigInt(deuda.pagado.value);
    const total = deuda.deuda ? BigInt(deuda.deuda.value) : 0n;
    p.append(`${deuda.vendedor}: ${formatearMonto(deuda.pagado)} pagado`);
    if (total > 0n) {
        p.append(` de ${formatearMonto(deuda.deuda)}${pagado >= total ? ' ✔ deuda saldada' : ''}`);
        p.append(Object.assign(document.createElement('progress'), { max: Number(total), value: Number(pagado), ariaLabel: `Lo que te ha pagado ${deuda.vendedor}` }));
        if (pagado < total) p.append(Object.assign(document.createElement('small'), { className: 'pequeno', textContent: `Faltan ${formatearMonto({ ...deuda.deuda, value: (total - pagado).toString() })}.` }));
    } else {
        p.append(' · sin deuda pendiente');
    }
    return p;
}

async function actualizar() {
    const perfil = window.LaCajita?.perfil();
    if (!perfil) return;
    const esMesero = perfil.id.startsWith('mesero');
    $('h2').textContent = esMesero ? 'Mis propinas' : 'Lo que me han pagado';
    $('[data-ayuda-cobros]').textContent = esMesero
        ? 'Cuando un cliente deja propina con el QR de la mesa, tu parte te llega sola a tu billetera. Se actualiza solo.'
        : 'Cada vez que tu vendedora vende, una parte te llega sola hasta saldar lo que te debe. Se actualiza solo.';
    if (walletMostrada !== perfil.wallet) {
        walletMostrada = perfil.wallet;
        $('[data-total]').textContent = '…';
        $('[data-cuantos]').textContent = 'Cargando…';
        $('[data-deudas]').hidden = true;
        $('[data-movimientos]').replaceChildren();
    }
    try {
        const cobros = await obtenerCobros(perfil.wallet);
        if (window.LaCajita?.perfil()?.wallet !== perfil.wallet) return;
        $('[data-total]').textContent = cobros.total ? formatearMonto(cobros.total) : '$ 0';
        $('[data-cuantos]').textContent = cobros.movimientos.length
            ? `${cobros.movimientos.length} ${esMesero ? 'propina' : 'abono'}${cobros.movimientos.length > 1 ? 's' : ''} en tu billetera`
            : (esMesero
                ? 'Todavía no te han llegado propinas. Aparecerán aquí cuando un cliente pague con propina.'
                : 'Todavía no te han llegado pagos. Aparecerán aquí cuando tu vendedora haga su próxima venta.');
        $('[data-deudas]').hidden = esMesero || !cobros.deudas.length;
        $('[data-lista-deudas]').replaceChildren(...cobros.deudas.map(filaDeuda));
        $('[data-movimientos]').replaceChildren(...cobros.movimientos.map((m) => filaMovimiento(m, esMesero)));
        mostrarAviso('');
    } catch (error) {
        mostrarAviso(`⚠ No pudimos leer tu billetera. Lo intentamos otra vez en unos segundos. (${error.message})`);
    }
}

alAbrirPestana('cobros', () => {
    actualizar();
    clearInterval(temporizador);
    temporizador = setInterval(() => {
        if (parametrosHash().pestana === 'cobros') actualizar();
        else clearInterval(temporizador);
    }, 5000);
});
