// SMS reales con SMS Gateway for Android (https://docs.sms-gate.app): un celular Android con SIM hace de línea de La Cajita.
//   Salida:  cada sms.enviar() también se manda por la API del gateway (además de la bandeja simulada).
//   Entrada: el gateway llama POST /sms/gateway (evento sms:received) → sms.procesarEntrante → la respuesta sale por SMS.
// Solo se habla con los números de SMSGATE_PERMITIDOS: el número falso de la demo o una promoción del operador
// nunca reciben un SMS real.
//
// Variables (.env): SMSGATE_USUARIO, SMSGATE_CLAVE (pestaña Home de la app, sección Cloud Server),
// SMSGATE_FIRMA (Settings → Webhooks → Signing Key), SMSGATE_PERMITIDOS (p. ej. 3001234567,3109876543),
// SMSGATE_URL (opcional, por defecto el servidor en la nube).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import * as sms from './sms.js';

const URL_NUBE = 'https://api.sms-gate.app/3rdparty/v1';
const VENTANA_FIRMA_S = 5 * 60;

function config() {
    const { SMSGATE_USUARIO, SMSGATE_CLAVE, SMSGATE_FIRMA, SMSGATE_PERMITIDOS, SMSGATE_URL } = process.env;
    return {
        usuario: SMSGATE_USUARIO,
        clave: SMSGATE_CLAVE,
        firma: SMSGATE_FIRMA,
        base: (SMSGATE_URL || URL_NUBE).replace(/\/$/, ''),
        permitidos: new Set(String(SMSGATE_PERMITIDOS ?? '').split(',').map(sms.normalizarCelular).filter(Boolean))
    };
}

export const activo = () => Boolean(config().usuario && config().clave);

export function permitido(celular) {
    return config().permitidos.has(sms.normalizarCelular(celular));
}

// "3001234567" → "+573001234567"
function aInternacional(numero) {
    return numero.length === 10 ? `+57${numero}` : `+${numero}`;
}

export async function enviarReal(numero, texto) {
    if (!activo() || !permitido(numero)) return false;
    const { usuario, clave, base } = config();
    const respuesta = await fetch(`${base}/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${Buffer.from(`${usuario}:${clave}`).toString('base64')}`
        },
        body: JSON.stringify({ textMessage: { text: texto }, phoneNumbers: [aInternacional(numero)] })
    });
    if (!respuesta.ok) throw new Error(`gateway respondió ${respuesta.status}: ${await respuesta.text()}`);
    return true;
}

// HMAC-SHA256(cuerpo crudo + X-Timestamp) con la Signing Key, comparado en tiempo constante.
export function firmaValida({ cuerpo, timestamp, firma }) {
    const { firma: clave } = config();
    if (!clave || !cuerpo || !timestamp || !firma) return false;
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > VENTANA_FIRMA_S) return false;
    const esperada = createHmac('sha256', clave).update(Buffer.concat([cuerpo, Buffer.from(String(timestamp))])).digest();
    const recibida = Buffer.from(String(firma), 'hex');
    return recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
}

sms.alEnviar(enviarReal);

export const rutasSmsReal = Router();

rutasSmsReal.post('/sms/gateway', async (req, res) => {
    if (!config().firma) return res.status(503).json({ error: 'Falta SMSGATE_FIRMA en el .env' });
    const valida = firmaValida({ cuerpo: req.cuerpoCrudo, timestamp: req.get('X-Timestamp'), firma: req.get('X-Signature') });
    if (!valida) return res.status(401).json({ error: 'Firma inválida' });

    const { event, payload } = req.body ?? {};
    // Se responde 2xx a todo lo firmado para que el gateway no reintente; solo se procesan SMS de números permitidos.
    if (event !== 'sms:received' || !payload?.message) return res.json({ ok: true, ignorado: event });
    if (!permitido(payload.sender)) {
        console.warn(`[SMS real] ignorado: ${payload.sender} no está en SMSGATE_PERMITIDOS`);
        return res.json({ ok: true, ignorado: 'no permitido' });
    }
    await sms.procesarEntrante(payload.sender, payload.message);
    res.json({ ok: true });
});
