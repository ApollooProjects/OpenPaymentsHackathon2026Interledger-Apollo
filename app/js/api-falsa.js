// API falsa: cumple el contrato de development/raul-app-producto-contrato.md guardando todo en localStorage.
// Solo para desarrollar la app sin el backend de cuentas. El código por SMS siempre es 123456.
const CLAVE = 'cajita_api_falsa';
const CODIGO = '123456';
const COP = (pesos) => ({ value: String(pesos * 100), assetCode: 'COP', assetScale: 2 });

const leer = () => {
    try { return JSON.parse(localStorage.getItem(CLAVE)) ?? { usuarios: {}, sesion: null, qrs: {}, pagos: {}, cotizaciones: {} }; }
    catch { return { usuarios: {}, sesion: null, qrs: {}, pagos: {}, cotizaciones: {} }; }
};
const guardar = (estado) => localStorage.setItem(CLAVE, JSON.stringify(estado));
const id = () => crypto.randomUUID();
const espera = (ms = 450) => new Promise((r) => setTimeout(r, ms));
const hace = (minutos) => new Date(Date.now() - minutos * 60_000).toISOString();

export function crearApiFalsa(ErrorApi) {
    const falla = (status, mensaje) => { throw new ErrorApi(mensaje, status, { error: mensaje }); };
    const usuarioActual = (estado) => {
        const u = estado.sesion && estado.usuarios[estado.sesion];
        if (!u) falla(401, 'Tu sesión terminó. Vuelve a entrar.');
        return u;
    };
    const limpiar = (u) => {
        const { movimientos, saldo, retiroPendiente, qr, ...publico } = u;
        return publico;
    };

    console.info('%cLa Cajita: usando la API falsa (código de prueba 123456)', 'color:#0B6B4F;font-weight:bold');

    return {
        modo: 'falsa',

        async pedirCodigo(celular) {
            await espera();
            const d = String(celular ?? '').replace(/\D/g, '').slice(-10);
            if (d.length !== 10 || !d.startsWith('3')) falla(400, 'Escribe un celular de 10 dígitos que empiece por 3');
            return { ok: true, enviadoA: `•••• ${d.slice(-4)}`, codigoDePrueba: CODIGO };
        },

        async entrar(celular, codigo) {
            await espera();
            if (codigo !== CODIGO) falla(400, 'El código no es correcto. Revisa el SMS e inténtalo otra vez.');
            const d = String(celular).replace(/\D/g, '').slice(-10);
            const estado = leer();
            let u = Object.values(estado.usuarios).find((x) => x.celular === d);
            if (!u) {
                u = { id: id(), celular: d, nombre: null, tipo: null, wallet: null, cedula: null, creado: new Date().toISOString(), movimientos: [], saldo: null, retiroPendiente: null, qr: null };
                estado.usuarios[u.id] = u;
            }
            estado.sesion = u.id;
            guardar(estado);
            return { usuario: limpiar(u) };
        },

        async salir() {
            const estado = leer();
            estado.sesion = null;
            guardar(estado);
            return { ok: true };
        },

        async yo() {
            await espera(150);
            return { usuario: limpiar(usuarioActual(leer())) };
        },

        async cambiarNombre(nombre) {
            await espera();
            const estado = leer();
            const u = usuarioActual(estado);
            const limpio = String(nombre ?? '').trim();
            if (limpio.length < 2) falla(400, 'Escribe tu nombre');
            u.nombre = limpio.slice(0, 40);
            guardar(estado);
            return { usuario: limpiar(u) };
        },

        async usarBilletera(wallet) {
            await espera(700);
            let w = String(wallet ?? '').trim().replace(/\s+/g, '').replace(/^\$/, '').replace(/^https?:\/\//i, '');
            if (!/^[^/]+\.[^/]+\/.+/.test(w)) falla(400, 'Esa dirección de billetera no existe. Cópiala tal cual de tu billetera.');
            w = `https://${w}`;
            const estado = leer();
            const u = usuarioActual(estado);
            Object.assign(u, { tipo: 'billetera', wallet: w, cedula: null });
            if (!u.movimientos.length) {
                u.movimientos = [
                    { id: id(), fecha: hace(95), tipo: 'recibido', monto: COP(12000), contraparte: 'Carlos Ruiz', estado: 'completado', comprobante: 'https://ilp.interledger-test.dev/incoming-payments/demo-1' },
                    { id: id(), fecha: hace(60 * 26), tipo: 'enviado', monto: COP(8500), contraparte: 'Panadería La Espiga', estado: 'completado', comprobante: 'https://ilp.interledger-test.dev/outgoing-payments/demo-2' }
                ];
            }
            guardar(estado);
            return { usuario: limpiar(u), billetera: { assetCode: 'COP', assetScale: 2, publicName: u.nombre } };
        },

        async usarEfectivo(cedula) {
            await espera();
            const c = String(cedula ?? '').replace(/\D/g, '');
            if (c.length < 6 || c.length > 10) falla(400, 'La cédula debe tener entre 6 y 10 dígitos');
            const estado = leer();
            const u = usuarioActual(estado);
            Object.assign(u, { tipo: 'efectivo', cedula: c, wallet: null, saldo: COP(45000) });
            if (!u.movimientos.length) {
                u.movimientos = [
                    { id: id(), fecha: hace(40), tipo: 'recibido', monto: COP(30000), contraparte: 'Remesa de Laura (España)', estado: 'completado', comprobante: 'https://ilp.interledger-test.dev/incoming-payments/demo-3' },
                    { id: id(), fecha: hace(60 * 30), tipo: 'recibido', monto: COP(15000), contraparte: 'Venta con QR', estado: 'completado', comprobante: 'https://ilp.interledger-test.dev/incoming-payments/demo-4' }
                ];
            }
            guardar(estado);
            return { usuario: limpiar(u) };
        },

        async resumen() {
            await espera(300);
            const u = usuarioActual(leer());
            if (u.retiroPendiente && new Date(u.retiroPendiente.vence) < new Date()) u.retiroPendiente = null;
            return {
                saldo: u.tipo === 'efectivo' ? u.saldo : null,
                retiroPendiente: u.retiroPendiente,
                movimientos: [...u.movimientos].sort((a, b) => b.fecha.localeCompare(a.fecha)),
                qr: u.qr
            };
        },

        async miQr({ monto, concepto } = {}) {
            await espera();
            const estado = leer();
            const u = usuarioActual(estado);
            const qrId = id().slice(0, 8);
            const qr = { id: qrId, enlace: `${location.origin}/#cliente?qr=${qrId}` };
            estado.qrs[qrId] = { qrId, vendedor: u.nombre, monto: monto ? { value: String(monto), assetCode: 'COP', assetScale: 2 } : null, descripcion: concepto ?? null, destino: u.tipo === 'efectivo' ? 'efectivo' : 'cuenta', duenio: u.id };
            if (!monto) u.qr = qr;
            guardar(estado);
            return { qr };
        },

        async verQr(qrId) {
            await espera();
            const qr = leer().qrs[qrId];
            if (qrId === 'demo') return { qrId, vendedor: 'Doña Rita', monto: COP(3000), descripcion: 'Empanadas', destino: 'efectivo' };
            if (!qr) falla(404, 'QR no encontrado');
            return qr;
        },

        async pagarQr(qrId, { pagador, monto }) {
            await espera(800);
            if (!pagador) falla(400, 'Falta la billetera de quien paga');
            const estado = leer();
            const u = usuarioActual(estado);
            const qr = estado.qrs[qrId] ?? (qrId === 'demo' ? { vendedor: 'Doña Rita', monto: COP(3000) } : null);
            if (!qr) falla(404, 'QR no encontrado');
            const total = qr.monto ?? { value: String(monto), assetCode: 'COP', assetScale: 2 };
            const pagoId = id();
            estado.pagos[pagoId] = {
                pagoId, estado: 'completado', total, pagador, metodo: 'directo', creado: new Date().toISOString(),
                destinos: [{ nombre: qr.vendedor, monto: total, completo: true, walletUrl: 'https://ilp.interledger-test.dev/cajita-custodia', incomingPayment: `https://ilp.interledger-test.dev/incoming-payments/${pagoId}`, outgoingPayment: `https://ilp.interledger-test.dev/outgoing-payments/${pagoId}` }],
                origen: { tipo: 'qr', qrId }
            };
            u.movimientos.push({ id: id(), fecha: new Date().toISOString(), tipo: 'enviado', monto: total, contraparte: qr.vendedor, estado: 'completado', comprobante: pagoId, pagoId });
            const duenio = qr.duenio && estado.usuarios[qr.duenio];
            if (duenio && duenio.id !== u.id) duenio.movimientos.push({ id: id(), fecha: new Date().toISOString(), tipo: 'recibido', monto: total, contraparte: u.nombre, estado: 'completado', comprobante: pagoId, pagoId });
            guardar(estado);
            return { pagoId, estado: 'completado' };
        },

        async verPago(pagoId) {
            await espera(300);
            const pago = leer().pagos[pagoId];
            if (!pago) falla(404, 'Pago no encontrado');
            return pago;
        },

        async cotizarRemesa({ monto, modo, celular, cedula, destinatarioWallet }) {
            await espera(900);
            if (!destinatarioWallet && (!celular || !cedula)) falla(400, 'Falta el celular o la cédula de quien recibe');
            const tasa = 4200; // 1 EUR ≈ 4.200 COP en la falsa
            const v = BigInt(monto);
            let cobra, llega;
            if (modo === 'recibe') {
                llega = { value: String(v), assetCode: 'COP', assetScale: 2 };
                cobra = { value: String(v / BigInt(tasa) + 100n), assetCode: 'EUR', assetScale: 2 };
            } else {
                cobra = { value: String(v), assetCode: 'EUR', assetScale: 2 };
                llega = { value: String((v - 100n) * BigInt(tasa)), assetCode: 'COP', assetScale: 2 };
            }
            const estado = leer();
            const cotizacionId = id();
            estado.cotizaciones[cotizacionId] = { cobra, llega, destino: destinatarioWallet || `Cédula ••••${String(cedula).slice(-4)}` };
            guardar(estado);
            return { cotizacionId, cobra, llega, vence: new Date(Date.now() + 5 * 60_000).toISOString() };
        },

        async enviarRemesa(cotizacionId) {
            await espera(900);
            const estado = leer();
            const u = usuarioActual(estado);
            const c = estado.cotizaciones[cotizacionId];
            if (!c) falla(404, 'Cotización no encontrada');
            const pagoId = id();
            estado.pagos[pagoId] = {
                pagoId, estado: 'completado', total: c.cobra, pagador: u.wallet, metodo: 'cotizado', creado: new Date().toISOString(),
                destinos: [{ nombre: c.destino, monto: c.llega, completo: true, walletUrl: 'https://ilp.interledger-test.dev/cajita-custodia', incomingPayment: `https://ilp.interledger-test.dev/incoming-payments/${pagoId}`, outgoingPayment: `https://ilp.interledger-test.dev/outgoing-payments/${pagoId}`, quoteId: `https://ilp.interledger-test.dev/quotes/${pagoId}` }],
                origen: { tipo: 'remesa' }
            };
            u.movimientos.push({ id: id(), fecha: new Date().toISOString(), tipo: 'enviado', monto: c.cobra, contraparte: `Envío a ${c.destino}`, estado: 'completado', comprobante: pagoId, pagoId });
            guardar(estado);
            return { pagoId, estado: 'completado' };
        },

        async pedirRetiro(cedula) {
            await espera(800);
            const estado = leer();
            const u = usuarioActual(estado);
            if (u.cedula !== cedula) falla(404, 'No hay dinero a tu nombre');
            if (!u.saldo || u.saldo.value === '0') falla(404, 'No tienes saldo para retirar');
            const vence = new Date(Date.now() + 24 * 3_600_000).toISOString();
            u.retiroPendiente = { monto: u.saldo, vence };
            guardar(estado);
            return { ok: true, retiroId: id(), monto: u.saldo, vence };
        }
    };
}
