// Vínculo celular → cédula de quien no tiene cuenta. Un celular es de una sola persona: por SMS solo llega el número,
// y de este vínculo sale a qué cédula consultar SALDO o pedir RETIRAR, y a qué celular mandar el PIN.
// Una cédula puede tener varios celulares; los SMS que salen por cédula van al vinculado más reciente.
import { db } from './db.js';
import { normalizarCelular } from './sms.js';

db.exec(`
    CREATE TABLE IF NOT EXISTS vinculos_celular (
        celular TEXT PRIMARY KEY,
        cedula TEXT NOT NULL,
        actualizado TEXT NOT NULL
    );
`);

const soloDigitos = (texto) => String(texto ?? '').replace(/\D/g, '');

// Vincula el celular a la cédula. Si el celular ya es de otra cédula, falla (salvo forzar: corrección manual).
export function vincular({ cedula, celular, forzar = false }) {
    const numero = normalizarCelular(celular);
    const doc = soloDigitos(cedula);
    if (!numero) throw new Error('Celular inválido');
    if (!doc) throw new Error('Cédula inválida');
    const actual = cedulaDeCelular(numero);
    if (actual && actual !== doc && !forzar) {
        throw new Error(`El celular ${numero} ya está registrado con otra cédula (termina en ${actual.slice(-4)})`);
    }
    db.prepare(`
        INSERT INTO vinculos_celular (celular, cedula, actualizado) VALUES (?, ?, ?)
        ON CONFLICT(celular) DO UPDATE SET cedula = excluded.cedula, actualizado = excluded.actualizado
    `).run(numero, doc, new Date().toISOString());
    return { celular: numero, cedula: doc };
}

export function cedulaDeCelular(celular) {
    const numero = normalizarCelular(celular);
    if (!numero) return null;
    return db.prepare('SELECT cedula FROM vinculos_celular WHERE celular = ?').get(numero)?.cedula ?? null;
}

export function celularDeCedula(cedula) {
    return db.prepare('SELECT celular FROM vinculos_celular WHERE cedula = ? ORDER BY actualizado DESC LIMIT 1')
        .get(soloDigitos(cedula))?.celular ?? null;
}

export function listar() {
    return db.prepare('SELECT celular, cedula, actualizado FROM vinculos_celular ORDER BY cedula, actualizado').all();
}
