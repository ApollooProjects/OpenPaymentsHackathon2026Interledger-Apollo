// Cliente de la API de La Cajita (contrato: auth, yo, resumen, QR, pagos, remesas y retiros).

class ErrorApi extends Error {
    constructor(mensaje, status, datos) {
        super(mensaje);
        this.status = status;
        this.datos = datos;
    }
}

async function pedir(metodo, ruta, cuerpo) {
    let respuesta;
    try {
        respuesta = await fetch(ruta, {
            method: metodo,
            credentials: 'same-origin',
            headers: cuerpo ? { 'Content-Type': 'application/json' } : {},
            body: cuerpo ? JSON.stringify(cuerpo) : undefined
        });
    } catch {
        throw new ErrorApi('No hay conexión. Revisa tu internet e inténtalo de nuevo.', 0);
    }
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok || datos.ok === false) {
        throw new ErrorApi(datos.error || 'Algo salió mal. Inténtalo de nuevo.', respuesta.status, datos);
    }
    return datos;
}

const apiReal = {
    modo: 'real',
    pedirCodigo: (celular) => pedir('POST', '/auth/codigo', { celular }),
    entrar: (celular, codigo) => pedir('POST', '/auth/entrar', { celular, codigo }),
    salir: () => pedir('POST', '/auth/salir'),
    yo: () => pedir('GET', '/yo'),
    cambiarNombre: (nombre) => pedir('PATCH', '/yo', { nombre }),
    usarBilletera: (wallet) => pedir('POST', '/yo/billetera', { wallet }),
    usarEfectivo: (cedula) => pedir('POST', '/yo/efectivo', { cedula }),
    resumen: () => pedir('GET', '/yo/resumen'),
    miQr: (datos) => pedir('POST', '/yo/qr', datos ?? {}),
    verQr: (qrId) => pedir('GET', `/qr/${encodeURIComponent(qrId)}`),
    pagarQr: (qrId, cuerpo) => pedir('POST', `/pagar/${encodeURIComponent(qrId)}`, { ...cuerpo, app: true }),
    verPago: (pagoId) => pedir('GET', `/pagos/${encodeURIComponent(pagoId)}`),
    cotizarRemesa: (datos) => pedir('POST', '/remesas/cotizar', datos),
    enviarRemesa: (cotizacionId) => pedir('POST', '/remesas', { cotizacionId, app: true }),
    pedirRetiro: (cedula) => pedir('POST', '/retiros', { cedula }),
    // Repartos automáticos (fase 2)
    repartos: () => pedir('GET', '/yo/repartos'),
    crearReparto: (datos) => pedir('POST', '/yo/repartos', datos),
    qrDeReparto: (id, datos) => pedir('POST', `/yo/repartos/${encodeURIComponent(id)}/qr`, datos ?? {}),
    recibidoPorRepartos: () => pedir('GET', '/yo/recibido-por-repartos'),
    // Pagos con un toque: permiso de Open Payments con tope semanal a nombre de la billetera del usuario.
    estadoUnToque: () => pedir('GET', '/yo/pagos-un-toque'),
    activarUnToque: (tope) => pedir('POST', '/yo/pagos-un-toque', { tope }),
    cancelarUnToque: () => pedir('DELETE', '/yo/pagos-un-toque')
};

export const api = apiReal;
export { ErrorApi };
