// Cuentas de la app producto: registro e inicio de sesión con el celular (código por SMS) y los datos de cada persona.
// La sesión es una cookie firmada con HMAC que lleva un token al azar; en la base solo queda el hash del token,
// así cerrar sesión la invalida de verdad y una base filtrada no sirve para entrar.
//
//   pedirCodigo(celular)            → manda el código de 6 dígitos por SMS
//   entrar({ celular, codigo })     → crea el usuario si no existe y abre sesión → { usuario, cookie }
//   usuarioDeCookie(valor)          → usuario de la sesión o null
//   salir(valor)                    → cierra la sesión
import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';
import * as op from '../op/index.js';
import * as sms from './sms.js';
import * as vinculos from './vinculos.js';
import { aWalletUrl, esWalletUrl } from './wallet.js';

export const COOKIE = 'cajita_sesion';
export const VIGENCIA_SESION_MS = 30 * 24 * 60 * 60 * 1000;
export const VIGENCIA_CODIGO_MS = 5 * 60 * 1000;
export const ESPERA_CODIGO_MS = 30 * 1000;
export const MAX_INTENTOS = 5;

db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
        id TEXT PRIMARY KEY,
        celular TEXT NOT NULL UNIQUE,
        nombre TEXT,
        tipo TEXT CHECK (tipo IN ('billetera', 'efectivo')),
        wallet TEXT,
        cedula TEXT,
        qr_id TEXT,
        creado TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS codigos_acceso (
        celular TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        vence TEXT NOT NULL,
        intentos INTEGER NOT NULL DEFAULT 0,
        enviado TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sesiones (
        token_hash TEXT PRIMARY KEY,
        usuario_id TEXT NOT NULL,
        vence TEXT NOT NULL,
        creado TEXT NOT NULL
    );
`);

// Error con el código HTTP que deben devolver las rutas.
export class ErrorCuenta extends Error {
    constructor(mensaje, status = 400) {
        super(mensaje);
        this.status = status;
    }
}

let secretoGenerado;

// SESION_SECRETO del .env; si falta, uno al azar por arranque (las sesiones se pierden al reiniciar).
function secreto() {
    if (process.env.SESION_SECRETO) return process.env.SESION_SECRETO;
    secretoGenerado ??= randomBytes(32).toString('hex');
    return secretoGenerado;
}

const hmac = (texto, clave = secreto()) => createHmac('sha256', clave).update(texto).digest('hex');

function iguales(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && timingSafeEqual(x, y);
}

// --- Puras (con pruebas) ---

export function generarCodigo() {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

// El código se guarda como HMAC ligado al celular: el mismo código para otro número no sirve.
export function hashCodigo(celular, codigo, clave = secreto()) {
    return hmac(`codigo:${celular}:${String(codigo ?? '').replace(/\D/g, '')}`, clave);
}

export function codigoCorrecto(celular, codigo, hash, clave = secreto()) {
    return iguales(hashCodigo(celular, codigo, clave), hash);
}

export function firmar(valor, clave = secreto()) {
    return `${valor}.${hmac(`sesion:${valor}`, clave)}`;
}

// Devuelve el valor si la firma es válida; si no, null.
export function verificarFirma(firmado, clave = secreto()) {
    const texto = String(firmado ?? '');
    const punto = texto.lastIndexOf('.');
    if (punto <= 0) return null;
    const valor = texto.slice(0, punto);
    return iguales(firmar(valor, clave), texto) ? valor : null;
}

// "3024109037" → "•••• 9037"
export const ocultarCelular = (celular) => `•••• ${String(celular).slice(-4)}`;

// --- Usuarios ---

function filaAUsuario(fila) {
    if (!fila) return null;
    return {
        id: fila.id,
        celular: fila.celular,
        nombre: fila.nombre ?? null,
        tipo: fila.tipo ?? null,
        wallet: fila.wallet ?? null,
        cedula: fila.cedula ?? null,
        creado: fila.creado
    };
}

export function obtenerUsuario(id) {
    return filaAUsuario(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id));
}

// QR estático para cobrarle a este usuario (null si todavía no lo pidió).
export function qrDelUsuario(id) {
    return db.prepare('SELECT qr_id FROM usuarios WHERE id = ?').get(id)?.qr_id ?? null;
}

export function guardarQrDelUsuario(id, qrId) {
    db.prepare('UPDATE usuarios SET qr_id = ? WHERE id = ?').run(qrId, id);
}

function celularValido(celular) {
    const numero = sms.normalizarCelular(celular);
    if (!numero) throw new ErrorCuenta('Escribe un celular válido. Ejemplo: 300 123 4567');
    return numero;
}

// --- Código por SMS ---

export function pedirCodigo(celular) {
    const numero = celularValido(celular);
    const previo = db.prepare('SELECT enviado FROM codigos_acceso WHERE celular = ?').get(numero);
    const espera = previo ? ESPERA_CODIGO_MS - (Date.now() - new Date(previo.enviado).getTime()) : 0;
    if (espera > 0) {
        throw new ErrorCuenta(`Ya te enviamos un código. Pide otro en ${Math.ceil(espera / 1000)} segundos`, 429);
    }
    const codigo = generarCodigo();
    const ahora = new Date();
    db.prepare(`
        INSERT INTO codigos_acceso (celular, hash, vence, intentos, enviado) VALUES (?, ?, ?, 0, ?)
        ON CONFLICT(celular) DO UPDATE SET hash = excluded.hash, vence = excluded.vence, intentos = 0, enviado = excluded.enviado
    `).run(numero, hashCodigo(numero, codigo), new Date(ahora.getTime() + VIGENCIA_CODIGO_MS).toISOString(), ahora.toISOString());
    sms.enviar(numero, `La Cajita: tu código es ${codigo}. Vence en 5 minutos.`);
    return { ok: true, enviadoA: ocultarCelular(numero) };
}

function abrirSesion(usuarioId) {
    const token = randomBytes(32).toString('base64url');
    const ahora = new Date();
    db.prepare('INSERT INTO sesiones (token_hash, usuario_id, vence, creado) VALUES (?, ?, ?, ?)')
        .run(hmac(`token:${token}`), usuarioId, new Date(ahora.getTime() + VIGENCIA_SESION_MS).toISOString(), ahora.toISOString());
    // Limpieza de paso: sesiones y códigos vencidos.
    db.prepare('DELETE FROM sesiones WHERE vence < ?').run(ahora.toISOString());
    db.prepare('DELETE FROM codigos_acceso WHERE vence < ?').run(new Date(ahora.getTime() - VIGENCIA_CODIGO_MS).toISOString());
    return firmar(token);
}

export function entrar({ celular, codigo }) {
    const numero = celularValido(celular);
    const fila = db.prepare('SELECT * FROM codigos_acceso WHERE celular = ?').get(numero);
    const invalido = 'El código no es válido. Pide uno nuevo';
    if (!fila || fila.intentos >= MAX_INTENTOS) throw new ErrorCuenta(invalido);
    if (new Date(fila.vence) < new Date()) throw new ErrorCuenta('El código venció. Pide uno nuevo');
    if (!codigoCorrecto(numero, codigo, fila.hash)) {
        db.prepare('UPDATE codigos_acceso SET intentos = intentos + 1 WHERE celular = ?').run(numero);
        const quedan = MAX_INTENTOS - fila.intentos - 1;
        throw new ErrorCuenta(quedan > 0 ? `Código incorrecto. Te quedan ${quedan} intentos` : invalido);
    }
    // Un código sirve una sola vez; se deja la fila (sin hash útil) para respetar la espera de 30 s.
    db.prepare('UPDATE codigos_acceso SET intentos = ? WHERE celular = ?').run(MAX_INTENTOS, numero);

    let usuario = filaAUsuario(db.prepare('SELECT * FROM usuarios WHERE celular = ?').get(numero));
    if (!usuario) {
        const id = randomUUID();
        db.prepare('INSERT INTO usuarios (id, celular, creado) VALUES (?, ?, ?)').run(id, numero, new Date().toISOString());
        usuario = obtenerUsuario(id);
    }
    return { usuario, cookie: abrirSesion(usuario.id) };
}

export function usuarioDeCookie(valor) {
    const token = verificarFirma(valor);
    if (!token) return null;
    const sesion = db.prepare('SELECT usuario_id, vence FROM sesiones WHERE token_hash = ?').get(hmac(`token:${token}`));
    if (!sesion || new Date(sesion.vence) < new Date()) return null;
    return obtenerUsuario(sesion.usuario_id);
}

export function salir(valor) {
    const token = verificarFirma(valor);
    if (token) db.prepare('DELETE FROM sesiones WHERE token_hash = ?').run(hmac(`token:${token}`));
}

// --- Datos de la cuenta ---

export function cambiarNombre(id, nombre) {
    const limpio = String(nombre ?? '').trim().replace(/\s+/g, ' ');
    if (!limpio) throw new ErrorCuenta('Escribe tu nombre');
    if (limpio.length > 60) throw new ErrorCuenta('El nombre es muy largo (máximo 60 letras)');
    db.prepare('UPDATE usuarios SET nombre = ? WHERE id = ?').run(limpio, id);
    // Su QR fijo ya impreso o compartido sigue igual, pero quien lo escanee ve el nombre nuevo.
    const qrId = qrDelUsuario(id);
    if (qrId) {
        db.prepare('UPDATE qrs SET vendedor = ? WHERE id = ?').run(limpio, qrId);
        db.prepare('UPDATE personas_sin_cuenta SET nombre = ? WHERE qr_id = ?').run(limpio, qrId);
    }
    return obtenerUsuario(id);
}

// Con billetera: el dinero le llega directo a su wallet. Se valida que exista en Open Payments.
export async function usarBilletera(id, wallet) {
    const url = aWalletUrl(wallet);
    if (!esWalletUrl(url)) throw new ErrorCuenta('Escribe la dirección de tu billetera. Ejemplo: $ilp.interledger-test.dev/ana');
    let datos;
    try {
        datos = await op.obtenerWallet(url);
    } catch {
        throw new ErrorCuenta(`No encontramos la billetera ${url}`);
    }
    const actual = obtenerUsuario(id);
    // Cambiar de billetera o de tipo invalida el QR anterior: el próximo /yo/qr crea uno nuevo.
    db.prepare("UPDATE usuarios SET tipo = 'billetera', wallet = ?, nombre = COALESCE(nombre, ?), qr_id = NULL WHERE id = ?")
        .run(datos.id ?? url, actual.nombre ? null : (datos.publicName || null), id);
    return {
        usuario: obtenerUsuario(id),
        billetera: { assetCode: datos.assetCode, assetScale: datos.assetScale, publicName: datos.publicName ?? null }
    };
}

// Sin cuenta: el dinero queda en la Custodia a nombre de su cédula, y su celular (ya verificado con el código)
// queda vinculado a esa cédula. Si la cédula ya tiene otro celular, no se deja: el PIN de retiro iría a este.
export function usarEfectivo(id, cedula) {
    const doc = String(cedula ?? '').replace(/\D/g, '');
    if (doc.length < 5 || doc.length > 12) throw new ErrorCuenta('Escribe tu número de cédula, solo números');
    const usuario = obtenerUsuario(id);
    const otroCelular = vinculos.celularDeCedula(doc);
    if (otroCelular && otroCelular !== usuario.celular) {
        throw new ErrorCuenta(`Esa cédula ya está registrada con otro celular (termina en ${otroCelular.slice(-4)})`);
    }
    try {
        vinculos.vincular({ cedula: doc, celular: usuario.celular });
    } catch (error) {
        throw new ErrorCuenta(error.message);
    }
    db.prepare("UPDATE usuarios SET tipo = 'efectivo', cedula = ?, qr_id = CASE WHEN tipo = 'efectivo' AND cedula = ? THEN qr_id END WHERE id = ?")
        .run(doc, doc, id);
    return { usuario: obtenerUsuario(id) };
}
