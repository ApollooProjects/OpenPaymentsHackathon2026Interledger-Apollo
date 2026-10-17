// SMS simulados (H9, H12): bandeja por celular en SQLite + menú SALDO / RETIRAR / MENU / AYUDA.
// Quien no usa la app (vendedor de P2, destinatario de remesas) maneja todo desde aquí.
//
// Contrato para las demás:
//   sms.enviar(celular, texto)                    → manda un SMS a la bandeja de ese celular
//   sms.procesarEntrante(celular, texto)          → lo que escribe la persona; responde por SMS
//   sms.usarManejadores({ saldo, retirar })       → C2.3 / C2.4 inyectan la lógica real
//   Cada manejador recibe { celular } y devuelve el texto de respuesta (o nada si ya envió sus propios SMS).
import { Router } from 'express';
import { db } from './db.js';

db.exec(`
    CREATE TABLE IF NOT EXISTS sms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        celular TEXT NOT NULL,
        dir TEXT NOT NULL CHECK (dir IN ('entrante', 'saliente')),
        texto TEXT NOT NULL,
        hora TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sms_por_celular ON sms (celular, id);
`);

export const MENU = [
    'La Cajita. Responde con una opción:',
    '1. SALDO: cuánto tengo',
    '2. RETIRAR: sacar todo en efectivo',
    '3. AYUDA'
].join('\n');

const AYUDA = 'Con La Cajita recibes pagos y remesas sin cuenta de banco. '
    + 'Escribe SALDO para ver cuánto tienes o RETIRAR para recibir un PIN y sacar todo en cualquier corresponsal con tu cédula. '
    + 'Escribe MENU para ver las opciones.';

// Manejadores falsos hasta que C2.3 (retiros) y C2.4 (saldo en la Custodia) inyecten los reales.
const manejadores = {
    saldo: async () => 'Tu saldo es $ 0. (Saldo simulado: falta conectar la Custodia.)',
    retirar: async () => 'Recibimos tu solicitud de retiro. (Simulado: falta conectar los retiros.)'
};

export function usarManejadores(nuevos) {
    for (const [nombre, fn] of Object.entries(nuevos)) {
        if (!(nombre in manejadores)) throw new Error(`Manejador de SMS desconocido: ${nombre}`);
        if (typeof fn !== 'function') throw new Error(`El manejador ${nombre} debe ser una función`);
        manejadores[nombre] = fn;
    }
}

// "+57 300 123 4567" y "3001234567" → "3001234567" (mismo celular, misma bandeja)
export function normalizarCelular(texto) {
    let digitos = String(texto ?? '').replace(/\D/g, '');
    if (digitos.length === 12 && digitos.startsWith('57')) digitos = digitos.slice(2);
    return digitos.length >= 7 && digitos.length <= 15 ? digitos : null;
}

function guardar(celular, dir, texto) {
    db.prepare('INSERT INTO sms (celular, dir, texto, hora) VALUES (?, ?, ?, ?)')
        .run(celular, dir, texto, new Date().toISOString());
}

// Salidas extra de cada SMS saliente (p. ej. smsReal.js lo manda a un celular de verdad).
// No bloquean: si una falla, el SMS igual queda en la bandeja simulada.
const salidas = [];

export function alEnviar(fn) {
    salidas.push(fn);
}

export function enviar(celular, texto) {
    const numero = normalizarCelular(celular);
    if (!numero) throw new Error(`Celular inválido: ${celular}`);
    guardar(numero, 'saliente', String(texto));
    for (const fn of salidas) {
        Promise.resolve().then(() => fn(numero, String(texto)))
            .catch((error) => console.error(`SMS real a ${numero} falló:`, error.message));
    }
}

export function bandeja(celular) {
    const numero = normalizarCelular(celular);
    if (!numero) return [];
    return db.prepare('SELECT dir, texto, hora FROM sms WHERE celular = ? ORDER BY id').all(numero)
        .map(({ dir, texto, hora }) => ({ dir, texto, hora }));
}

// "  retírar " → "RETIRAR"; "1" → "SALDO"
export function interpretar(texto) {
    const palabra = String(texto ?? '').trim().toUpperCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .split(/\s+/)[0];
    const opciones = { 1: 'SALDO', 2: 'RETIRAR', 3: 'AYUDA', MENU: 'MENU', SALDO: 'SALDO', RETIRAR: 'RETIRAR', AYUDA: 'AYUDA' };
    return opciones[palabra] ?? 'MENU';
}

export async function procesarEntrante(celular, texto) {
    const numero = normalizarCelular(celular);
    if (!numero) throw new Error(`Celular inválido: ${celular}`);
    guardar(numero, 'entrante', String(texto ?? ''));

    const comando = interpretar(texto);
    let respuesta;
    try {
        if (comando === 'SALDO') respuesta = await manejadores.saldo({ celular: numero });
        else if (comando === 'RETIRAR') respuesta = await manejadores.retirar({ celular: numero });
        else if (comando === 'AYUDA') respuesta = AYUDA;
        else respuesta = MENU;
    } catch (error) {
        console.error(`SMS ${comando} de ${numero}:`, error);
        respuesta = 'No pudimos atender tu mensaje. Intenta de nuevo en un momento o escribe MENU.';
    }
    if (respuesta) enviar(numero, respuesta);
    return { comando };
}

export const rutasSms = Router();

rutasSms.get('/sms/:celular', (req, res) => {
    if (!normalizarCelular(req.params.celular)) return res.status(400).json({ error: 'Celular inválido' });
    res.json(bandeja(req.params.celular));
});

rutasSms.post('/sms/entrante', async (req, res) => {
    const { celular, texto } = req.body ?? {};
    if (!normalizarCelular(celular)) return res.status(400).json({ error: 'Celular inválido' });
    if (!String(texto ?? '').trim()) return res.status(400).json({ error: 'El mensaje está vacío' });
    await procesarEntrante(celular, texto);
    res.json({ ok: true });
});
