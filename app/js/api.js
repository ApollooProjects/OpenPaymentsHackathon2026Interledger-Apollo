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
    pagarQr: (qrId, cuerpo) => pedir('POST', `/pagar/${encodeURIComponent(qrId)}`, cuerpo),
    verPago: (pagoId) => pedir('GET', `/pagos/${encodeURIComponent(pagoId)}`),
    cotizarRemesa: (datos) => pedir('POST', '/remesas/cotizar', datos),
    enviarRemesa: (cotizacionId) => pedir('POST', '/remesas', { cotizacionId }),
    pedirRetiro: (cedula) => pedir('POST', '/retiros', { cedula })
};

export const api = apiReal;
export { ErrorApi };
