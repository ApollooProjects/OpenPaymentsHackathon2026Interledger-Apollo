// Mensajes para las personas: los errores del SDK de Open Payments ("Error making Open Payments GET request")
// y los internos del motor no se muestran tal cual. El detalle técnico queda en el log del servidor.

const INTERNOS = {
    'La wallet no devolvió interact_ref': 'Tu billetera no confirmó el pago',
    'El hash de la redirección no es válido': 'No pudimos verificar la respuesta de la billetera. Intenta de nuevo'
};

const POR_CONTEXTO = {
    pago: {
        GET: 'No encontramos esa billetera. Revisa la dirección: empieza por https:// o por $',
        POST: 'La billetera no aceptó el pago. Revisa el saldo e intenta de nuevo'
    },
    remesa: {
        GET: 'No encontramos esa billetera. Revisa la dirección: empieza por https:// o por $',
        POST: 'No se pudo cotizar el envío. Prueba con un monto mayor o intenta de nuevo en un momento'
    },
    reparto: {
        GET: 'No encontramos alguna de las billeteras. Revisa las direcciones: empiezan por https:// o por $',
        POST: 'La billetera del proveedor no aceptó el cobro. Intenta de nuevo en un momento'
    },
    retiro: {
        GET: 'No pudimos completar el retiro en este momento. El dinero sigue a tu nombre: intenta de nuevo',
        POST: 'No pudimos completar el retiro en este momento. El dinero sigue a tu nombre: intenta de nuevo'
    }
};

export function mensajeParaUsuario(error, contexto = 'pago') {
    const mensaje = String(error?.message ?? error ?? '');
    if (INTERNOS[mensaje]) return INTERNOS[mensaje];
    const metodo = /Open Payments (GET|POST|DELETE)/.exec(mensaje)?.[1];
    const textos = POR_CONTEXTO[contexto] ?? POR_CONTEXTO.pago;
    if (metodo) return textos[metodo] ?? textos.POST;
    if (contexto === 'retiro' && mensaje.startsWith('Falta')) return textos.POST;
    if (mensaje === 'fetch failed') return 'No pudimos comunicarnos con la billetera. Intenta de nuevo en un momento';
    return mensaje || 'Algo salió mal. Intenta de nuevo en un momento';
}
