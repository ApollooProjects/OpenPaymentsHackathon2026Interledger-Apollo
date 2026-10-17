import * as mock from './mock.js';
import * as incoming from './incoming.js';
import * as outgoing from './outgoing.js';
import * as grants from './grants.js';
import * as client from './client.js';

const real = { obtenerWallet: client.obtenerWallet, ...incoming, ...outgoing, ...grants };

// Se decide en cada llamada: los imports de ESM corren antes de que server.js cargue el .env.
function implementacion(nombre) {
    const modulo = process.env.OP_MOCK === '1' ? mock : real;
    const fn = modulo[nombre];
    if (!fn) throw new Error(`op.${nombre} todavía no está implementada (usa OP_MOCK=1 mientras tanto)`);
    return fn;
}

export const obtenerWallet = (...args) => implementacion('obtenerWallet')(...args);
export const crearCobro = (...args) => implementacion('crearCobro')(...args);
export const consultarCobro = (...args) => implementacion('consultarCobro')(...args);
export const pagar = (...args) => implementacion('pagar')(...args);
export const pedirPermiso = (...args) => implementacion('pedirPermiso')(...args);
export const continuarPermiso = (...args) => implementacion('continuarPermiso')(...args);
export const verificarHash = (...args) => implementacion('verificarHash')(...args);
