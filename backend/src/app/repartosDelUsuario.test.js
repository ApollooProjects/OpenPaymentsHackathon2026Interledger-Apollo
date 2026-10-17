import { test } from 'node:test';
import assert from 'node:assert/strict';

// Base en memoria y Open Payments simulado: las pruebas no tocan data/cajita.sqlite ni el testnet.
process.env.CAJITA_DB = ':memory:';
process.env.OP_MOCK = '1';
process.env.SESION_SECRETO = 'secreto-de-prueba';
process.env.CUSTODIA_WALLET = 'https://ilp.interledger-test.dev/custodia-prueba';
const r = await import('./repartosDelUsuario.js');
const cuentas = await import('./cuentas.js');
const store = await import('./store.js');
const { calcularReparto } = await import('./reparto.js');

const ANA = 'https://ilp.interledger-test.dev/ana';
const PROVEEDOR = 'https://ilp.interledger-test.dev/proveedorapollo';
const M1 = 'https://ilp.interledger-test.dev/mesero1apollo';
const M2 = 'https://ilp.interledger-test.dev/mesero-2-apollo';
const AHORRO = 'https://ilp.interledger-test.dev/ahorro';

test('las tres reglas se leen y quedan limpias', () => {
    const { nombre, reglas } = r.leerReglas({
        nombre: '  Ventas   del puesto ',
        deuda: { wallet: '$ilp.interledger-test.dev/proveedorapollo', porcentaje: '35', total: { value: '50000' } },
        compartir: { personas: [{ nombre: 'Leo', wallet: M1 }, { wallet: M2 }] },
        ahorro: { wallet: AHORRO, porcentaje: 10 }
    }, { destino: ANA });
    assert.equal(nombre, 'Ventas del puesto');
    assert.deepEqual(reglas.deuda, { wallet: PROVEEDOR, porcentaje: 35, total: '50000' });
    assert.deepEqual(reglas.compartir, { personas: [{ nombre: 'Leo', wallet: M1 }, { nombre: 'Persona 2', wallet: M2 }], modo: 'iguales' });
    assert.deepEqual(reglas.ahorro, { wallet: AHORRO, porcentaje: 10 });
});

test('compartir por porcentaje exige que todas lo tengan y sumen 100', () => {
    const { reglas } = r.leerReglas({ nombre: 'Grupo', compartir: { personas: [{ wallet: M1, porcentaje: 70 }, { wallet: M2, porcentaje: 30 }] } });
    assert.equal(reglas.compartir.modo, 'porcentaje');
    assert.deepEqual(r.meserosDe(reglas), [{ wallet: M1, porcentaje: 70 }, { wallet: M2, porcentaje: 30 }]);
    assert.throws(() => r.leerReglas({ nombre: 'G', compartir: { personas: [{ wallet: M1, porcentaje: 70 }, { wallet: M2 }] } }), /todas/);
    assert.throws(() => r.leerReglas({ nombre: 'G', compartir: { personas: [{ wallet: M1, porcentaje: 70 }, { wallet: M2, porcentaje: 20 }] } }), /sumar 100/);
    assert.throws(() => r.leerReglas({ nombre: 'G', compartir: { personas: [M1, M1] } }), /repetida/);
    assert.throws(() => r.leerReglas({ nombre: 'G', compartir: { personas: [] } }), /al menos una persona/);
});

test('reglas inválidas dan mensajes para la persona, sin hablar de proveedor ni meseros', () => {
    const casos = [
        [{ deuda: { wallet: PROVEEDOR, porcentaje: 35, total: 1000 } }, /nombre/],
        [{ nombre: 'X' }, /al menos una regla/],
        [{ nombre: 'X', deuda: { wallet: PROVEEDOR, porcentaje: 0, total: 1000 } }, /entre 1 y 100/],
        [{ nombre: 'X', deuda: { wallet: PROVEEDOR, porcentaje: 35, total: '10.5' } }, /centavos/],
        [{ nombre: 'X', deuda: { wallet: 'no-es-wallet', porcentaje: 35, total: 1000 } }, /billetera/],
        [{ nombre: 'X', ahorro: { wallet: AHORRO, porcentaje: 101 } }, /entre 1 y 100/]
    ];
    for (const [cuerpo, error] of casos) {
        assert.throws(() => r.leerReglas(cuerpo), (e) => {
            assert.ok(e instanceof cuentas.ErrorCuenta);
            assert.match(e.message, error);
            assert.doesNotMatch(e.message, /proveedor|mesero|propina/i);
            return true;
        });
    }
});

test('ninguna regla puede mandar dinero a la misma wallet que recibe', () => {
    assert.throws(() => r.leerReglas({ nombre: 'X', deuda: { wallet: ANA, porcentaje: 35, total: 1000 } }, { destino: ANA }), /otra persona/);
    assert.throws(() => r.leerReglas({ nombre: 'X', ahorro: { wallet: ANA, porcentaje: 5 } }, { destino: ANA }), /otra billetera/);
    assert.throws(() => r.leerReglas({ nombre: 'X', compartir: { personas: [ANA] } }, { destino: ANA }), /contigo/);
});

test('con billetera: traduce a crearReparto con la wallet del usuario', () => {
    const leidas = r.leerReglas({
        nombre: 'Puesto',
        deuda: { wallet: PROVEEDOR, porcentaje: 35, total: 50000 },
        compartir: { personas: [M1, M2] },
        ahorro: { wallet: AHORRO, porcentaje: 10 }
    });
    assert.deepEqual(r.argumentosDeReparto(leidas, { vendedor: 'Ana', conCuenta: true, vendedorWallet: ANA, destino: ANA }), {
        vendedor: 'Ana', conCuenta: true, vendedorWallet: ANA,
        proveedorWallet: PROVEEDOR, porcentaje: 35, deuda: '50000',
        meseros: [M1, M2], ahorroWallet: AHORRO, ahorroPorcentaje: 10
    });
});

test('en efectivo y sin deuda: cédula y celular, y el porcentaje de deuda en 0 no le manda nada a nadie', () => {
    const custodia = 'https://ilp.interledger-test.dev/custodia-prueba';
    const leidas = r.leerReglas({ nombre: 'Grupo', ahorro: { wallet: AHORRO, porcentaje: 20 } });
    const args = r.argumentosDeReparto(leidas, { vendedor: 'Pedro', conCuenta: false, cedula: '1020304050', celular: '3001234567', destino: custodia });
    assert.equal(args.conCuenta, false);
    assert.equal(args.cedula, '1020304050');
    assert.equal(args.celular, '3001234567');
    assert.equal(args.vendedorWallet, undefined);
    assert.equal(args.proveedorWallet, custodia);
    assert.equal(args.porcentaje, 0);
    assert.equal(args.deuda, null);
    // Con 0 % la parte de la deuda no aparece: el reparto queda solo entre quien recibe y su ahorro.
    const partes = calcularReparto({ total: 10000, porcentaje: args.porcentaje, ahorro: args.ahorroPorcentaje });
    assert.deepEqual(partes, [{ destino: 'vendedor', valor: 8000 }, { destino: 'ahorro', valor: 2000 }]);
});

test('el rol de cada destino se traduce a la regla de la app', () => {
    assert.equal(r.reglaDelRol(r.rolDelDestino({ rol: 'proveedor' })), 'deuda');
    assert.equal(r.reglaDelRol(r.rolDelDestino({ rol: 'mesero' })), 'compartir');
    assert.equal(r.reglaDelRol(r.rolDelDestino({ rol: 'ahorro' })), 'ahorro');
    assert.equal(r.reglaDelRol(r.rolDelDestino({ rol: 'vendedor' })), null);
    // Pagos viejos sin rol: por el nombre.
    assert.equal(r.rolDelDestino({ nombre: 'Proveedor' }), 'proveedor');
    assert.equal(r.rolDelDestino({ nombre: 'Doña Rita' }, { vendedor: 'Doña Rita' }), 'vendedor');
    assert.equal(r.rolDelDestino({ nombre: 'Mesero 1' }, { vendedor: 'Doña Rita' }), 'mesero');
});

test('crear, listar y pedir QR con OP simulado; solo la dueña ve y usa su reparto', async () => {
    const db = (await import('./db.js')).db;
    const insertar = db.prepare("INSERT INTO usuarios (id, celular, nombre, tipo, wallet, creado) VALUES (?, ?, ?, 'billetera', ?, ?)");
    insertar.run('u-ana', '3000000001', 'Ana', ANA, new Date().toISOString());
    insertar.run('u-leo', '3000000002', 'Leo', M1, new Date().toISOString());
    const ana = cuentas.obtenerUsuario('u-ana');
    const leo = cuentas.obtenerUsuario('u-leo');

    const id = await r.crear(ana, {
        nombre: 'Puesto', deuda: { wallet: PROVEEDOR, porcentaje: 35, total: 50000 },
        compartir: { personas: [{ nombre: 'Leo', wallet: M1 }, M2] }, ahorro: { wallet: AHORRO, porcentaje: 10 }
    });
    const [ligado] = cuentas.repartosDelUsuario('u-ana');
    assert.equal(ligado.repartoId, id);
    assert.equal(cuentas.repartosDelUsuario('u-leo').length, 0);

    const resumen = await r.resumen(ligado, { enlace: (qrId) => `/#/pagar/${qrId}` });
    assert.equal(resumen.nombre, 'Puesto');
    assert.match(resumen.qr.id, /^r-/);
    assert.equal(resumen.ventas, 0);
    assert.deepEqual(resumen.recibido, { value: '0', assetCode: 'COP', assetScale: 2 });
    assert.deepEqual(resumen.reglas.deuda.falta, { value: '50000', assetCode: 'COP', assetScale: 2 });
    assert.deepEqual(store.obtenerQr(resumen.qr.id).meseros, [M1, M2]);

    const qr = await r.crearQr(ana, id, { monto: '20000', detalle: 'Pedido grande' });
    assert.deepEqual(qr.monto, { value: '20000', assetCode: 'COP', assetScale: 2 });
    assert.equal(qr.compartir, true);
    assert.equal(store.obtenerQr(qr.id).descripcion, 'Pedido grande');
    const sinCompartir = await r.crearQr(ana, id, { compartir: false });
    assert.deepEqual(store.obtenerQr(sinCompartir.id).meseros, []);
    await assert.rejects(r.crearQr(leo, id, {}), (e) => e.status === 404);

    // Una venta completada: a Leo le llega su parte como «compartir», con el nombre del reparto.
    store.crearPago({
        id: 'pago-1', estado: 'completado', pagador: 'https://ilp.interledger-test.dev/cliente',
        plan: {
            origen: { tipo: 'qr', qrId: qr.id },
            destinos: [
                { rol: 'proveedor', nombre: 'Proveedor', walletUrl: PROVEEDOR, monto: { value: '7000', assetCode: 'COP', assetScale: 2 } },
                { rol: 'vendedor', nombre: 'Ana', walletUrl: ANA, monto: { value: '11700', assetCode: 'COP', assetScale: 2 } },
                { rol: 'ahorro', nombre: 'Ahorro', walletUrl: AHORRO, monto: { value: '1300', assetCode: 'COP', assetScale: 2 } },
                { rol: 'mesero', nombre: 'Mesero 1', walletUrl: M1, monto: { value: '1000', assetCode: 'COP', assetScale: 2 }, pagoOpId: 'op-1' }
            ]
        }
    });
    const despues = await r.resumen(ligado, { enlace: String });
    assert.equal(despues.ventas, 1);
    assert.equal(despues.recibido.value, '21000');
    assert.equal(despues.paraTi.value, '11700');

    const deLeo = r.recibidoPorRepartos(leo);
    assert.equal(deLeo.movimientos.length, 1);
    assert.deepEqual(
        { de: deLeo.movimientos[0].de, regla: deLeo.movimientos[0].regla, comprobante: deLeo.movimientos[0].comprobante },
        { de: 'Puesto', regla: 'compartir', comprobante: 'op-1' }
    );
    assert.equal(deLeo.total.value, '1000');
    // A la dueña no le cuenta su propia parte como «recibido por repartos».
    assert.equal(r.recibidoPorRepartos(ana).movimientos.length, 0);
});
