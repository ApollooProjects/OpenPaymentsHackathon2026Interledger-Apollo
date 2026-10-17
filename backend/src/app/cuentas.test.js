import { test } from 'node:test';
import assert from 'node:assert/strict';

// Base en memoria: las pruebas no tocan data/cajita.sqlite.
process.env.CAJITA_DB = ':memory:';
process.env.SESION_SECRETO = 'secreto-de-prueba';
const cuentas = await import('./cuentas.js');

test('el código tiene 6 dígitos', () => {
    for (let i = 0; i < 200; i++) assert.match(cuentas.generarCodigo(), /^\d{6}$/);
});

test('el código se verifica por su hash y queda ligado al celular', () => {
    const hash = cuentas.hashCodigo('3001234567', '042137');
    assert.notEqual(hash, '042137');
    assert.ok(cuentas.codigoCorrecto('3001234567', '042137', hash));
    assert.ok(cuentas.codigoCorrecto('3001234567', '042 137', hash));
    assert.ok(!cuentas.codigoCorrecto('3001234567', '042138', hash));
    assert.ok(!cuentas.codigoCorrecto('3009999999', '042137', hash));
    assert.ok(!cuentas.codigoCorrecto('3001234567', '042137', hash, 'otro-secreto'));
});

test('la cookie firmada se verifica y no se puede alterar', () => {
    const firmada = cuentas.firmar('token-abc');
    assert.equal(cuentas.verificarFirma(firmada), 'token-abc');
    assert.equal(cuentas.verificarFirma(firmada.replace('token-abc', 'token-abd')), null);
    assert.equal(cuentas.verificarFirma(`${firmada}0`), null);
    assert.equal(cuentas.verificarFirma(firmada, 'otro-secreto'), null);
    assert.equal(cuentas.verificarFirma('sin-firma'), null);
    assert.equal(cuentas.verificarFirma(''), null);
    assert.equal(cuentas.verificarFirma(undefined), null);
});

test('celular oculto', () => {
    assert.equal(cuentas.ocultarCelular('3024109037'), '•••• 9037');
});

test('código → entrar → sesión → salir', () => {
    const { enviadoA } = cuentas.pedirCodigo('+57 300 555 0101');
    assert.equal(enviadoA, '•••• 0101');
    assert.throws(() => cuentas.pedirCodigo('3005550101'), (e) => e.status === 429);
    assert.throws(() => cuentas.entrar({ celular: '3005550101', codigo: 'xxxxxx' }), /Te quedan 4 intentos/);
});

test('máximo 5 intentos: después ni el código correcto sirve', async () => {
    const { db } = await import('./db.js');
    const celular = '3005550202';
    cuentas.pedirCodigo(celular);
    // Se reemplaza el hash por uno conocido para poder probar el código correcto.
    db.prepare('UPDATE codigos_acceso SET hash = ? WHERE celular = ?').run(cuentas.hashCodigo(celular, '111111'), celular);
    for (let i = 0; i < 5; i++) assert.throws(() => cuentas.entrar({ celular, codigo: '000000' }));
    assert.throws(() => cuentas.entrar({ celular, codigo: '111111' }), /no es válido/);
});

test('entrar crea el usuario una vez y la sesión se cierra', async () => {
    const { db } = await import('./db.js');
    const celular = '3005550303';
    const abrir = () => {
        db.prepare('DELETE FROM codigos_acceso WHERE celular = ?').run(celular);
        cuentas.pedirCodigo(celular);
        db.prepare('UPDATE codigos_acceso SET hash = ? WHERE celular = ?').run(cuentas.hashCodigo(celular, '123456'), celular);
        return cuentas.entrar({ celular, codigo: '123456' });
    };
    const primera = abrir();
    assert.equal(primera.usuario.celular, celular);
    assert.equal(primera.usuario.tipo, null);
    assert.equal(cuentas.usuarioDeCookie(primera.cookie).id, primera.usuario.id);
    // El código no sirve dos veces.
    assert.throws(() => cuentas.entrar({ celular, codigo: '123456' }));
    const segunda = abrir();
    assert.equal(segunda.usuario.id, primera.usuario.id);
    cuentas.salir(primera.cookie);
    assert.equal(cuentas.usuarioDeCookie(primera.cookie), null);
    assert.equal(cuentas.usuarioDeCookie(segunda.cookie).id, primera.usuario.id);
});

test('efectivo: una cédula con otro celular no se deja tomar', async () => {
    const vinculos = await import('./vinculos.js');
    const { db } = await import('./db.js');
    vinculos.vincular({ cedula: '1020304050', celular: '3001234567' });
    db.prepare("INSERT INTO usuarios (id, celular, creado) VALUES ('u1', '3005550404', 'x')").run();
    assert.throws(() => cuentas.usarEfectivo('u1', '1020304050'), /otro celular/);
    assert.equal(cuentas.usarEfectivo('u1', '1.020.999.888').usuario.cedula, '1020999888');
    assert.equal(cuentas.obtenerUsuario('u1').tipo, 'efectivo');
});
