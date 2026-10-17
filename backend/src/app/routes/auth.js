// App producto: entrar con el celular y un código por SMS. La sesión va en la cookie cajita_sesion.
import { Router } from 'express';
import * as cuentas from '../cuentas.js';

export const rutasAuth = Router();

// Sin cookie-parser: solo se necesita una cookie.
export function leerCookie(req, nombre = cuentas.COOKIE) {
    for (const parte of String(req.headers.cookie ?? '').split(';')) {
        const [clave, ...resto] = parte.trim().split('=');
        if (clave === nombre) {
            try {
                return decodeURIComponent(resto.join('='));
            } catch {
                return null;
            }
        }
    }
    return null;
}

// Secure solo si la petición llegó por https (el túnel lo dice en X-Forwarded-Proto); en localhost va sin Secure.
function opcionesCookie(req) {
    const https = req.secure || String(req.get('x-forwarded-proto') ?? '').split(',')[0].trim() === 'https';
    return { httpOnly: true, sameSite: 'lax', path: '/', secure: https };
}

// Middleware para las rutas que piden sesión: deja el usuario en req.usuario o responde 401.
export function conSesion(req, res, next) {
    const usuario = cuentas.usuarioDeCookie(leerCookie(req));
    if (!usuario) return res.status(401).json({ error: 'Tu sesión terminó. Entra otra vez con tu celular' });
    req.usuario = usuario;
    next();
}

export function responderError(res, error) {
    if (error instanceof cuentas.ErrorCuenta) return res.status(error.status).json({ error: error.message });
    throw error;
}

// POST /auth/codigo { celular } → { ok, enviadoA: "•••• 9037" }
rutasAuth.post('/auth/codigo', (req, res) => {
    try {
        res.json(cuentas.pedirCodigo(req.body?.celular));
    } catch (error) {
        responderError(res, error);
    }
});

// POST /auth/entrar { celular, codigo } → { usuario } y la cookie de sesión
rutasAuth.post('/auth/entrar', (req, res) => {
    try {
        const { usuario, cookie } = cuentas.entrar(req.body ?? {});
        res.cookie(cuentas.COOKIE, cookie, { ...opcionesCookie(req), maxAge: cuentas.VIGENCIA_SESION_MS });
        res.json({ usuario });
    } catch (error) {
        responderError(res, error);
    }
});

// POST /auth/salir → { ok: true }
rutasAuth.post('/auth/salir', (req, res) => {
    cuentas.salir(leerCookie(req));
    res.clearCookie(cuentas.COOKIE, opcionesCookie(req));
    res.json({ ok: true });
});
