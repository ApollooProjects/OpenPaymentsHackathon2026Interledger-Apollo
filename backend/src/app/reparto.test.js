import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularReparto } from './reparto.js';

const suma = (destinos) => destinos.reduce((t, d) => t + d.valor, 0);
const de = (destinos, nombre) => destinos.find((d) => d.destino === nombre)?.valor ?? 0;

test('ejemplo del contrato (§2d)', () => {
    assert.deepEqual(
        calcularReparto({ total: 3000, propina: 300, porcentaje: 35, deudaPendiente: 6000, meseros: ['m1', 'm2'] }),
        [
            { destino: 'proveedor', valor: 1050 },
            { destino: 'vendedor', valor: 1950 },
            { destino: 'm1', valor: 150 },
            { destino: 'm2', valor: 150 }
        ]
    );
});

test('35 % al proveedor', () => {
    const r = calcularReparto({ total: 300000, deudaPendiente: 4000000 });
    assert.equal(de(r, 'proveedor'), 105000);
    assert.equal(de(r, 'vendedor'), 195000);
});

test('al proveedor solo lo que le falta de la deuda', () => {
    const r = calcularReparto({ total: 300000, deudaPendiente: 50000 });
    assert.equal(de(r, 'proveedor'), 50000);
    assert.equal(de(r, 'vendedor'), 250000);
});

test('deuda saldada: 100 % al vendedor y sin pago de 0 al proveedor', () => {
    const r = calcularReparto({ total: 300000, deudaPendiente: 0 });
    assert.deepEqual(r, [{ destino: 'vendedor', valor: 300000 }]);
});

test('sin deuda configurada el porcentaje aplica siempre', () => {
    const r = calcularReparto({ total: 1000, porcentaje: 35 });
    assert.equal(de(r, 'proveedor'), 350);
});

test('propina en partes iguales entre los meseros del QR', () => {
    const r = calcularReparto({ total: 3000, propina: 900, deudaPendiente: 6000, meseros: ['a', 'b', 'c'] });
    assert.equal(de(r, 'a'), 300);
    assert.equal(de(r, 'b'), 300);
    assert.equal(de(r, 'c'), 300);
});

test('la propina que no se divide exacto no se pierde', () => {
    const r = calcularReparto({ total: 1000, propina: 100, meseros: ['a', 'b', 'c'] });
    assert.deepEqual([de(r, 'a'), de(r, 'b'), de(r, 'c')], [34, 33, 33]);
    assert.equal(suma(r), 1100);
});

test('sin meseros la propina va al vendedor', () => {
    const r = calcularReparto({ total: 1000, propina: 200, porcentaje: 35 });
    assert.equal(de(r, 'vendedor'), 850);
});

test('la suma de los destinos siempre es total + propina', () => {
    for (const [total, propina, deuda] of [[3333, 7, 100], [1, 0, null], [999999, 12345, 0], [10, 10, 2]]) {
        const r = calcularReparto({ total, propina, deudaPendiente: deuda, meseros: ['x', 'y'] });
        assert.equal(suma(r), total + propina);
        assert.ok(r.every((d) => Number.isInteger(d.valor) && d.valor > 0));
    }
});

test('acepta montos como texto (así vienen de Open Payments)', () => {
    assert.equal(de(calcularReparto({ total: '300000', deudaPendiente: '4000000' }), 'proveedor'), 105000);
});

test('rechaza montos y porcentajes inválidos', () => {
    assert.throws(() => calcularReparto({ total: -5 }));
    assert.throws(() => calcularReparto({ total: 10.5 }));
    assert.throws(() => calcularReparto({ total: 1000, porcentaje: 150 }));
});
