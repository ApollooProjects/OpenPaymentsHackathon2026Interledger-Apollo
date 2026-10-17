// Registra en SMS Gateway for Android el webhook de SMS entrantes: <PUBLIC_URL>/sms/gateway (evento sms:received).
// Uso: node scripts/registrar-webhook-sms.js         (registra si no existe)
//      node scripts/registrar-webhook-sms.js --listar
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.loadEnvFile(path.join(raiz, '.env'));

const { SMSGATE_USUARIO, SMSGATE_CLAVE, SMSGATE_URL, PUBLIC_URL } = process.env;
if (!SMSGATE_USUARIO || !SMSGATE_CLAVE) throw new Error('Faltan SMSGATE_USUARIO o SMSGATE_CLAVE en el .env');
if (!PUBLIC_URL?.startsWith('https://')) throw new Error('PUBLIC_URL debe ser https:// (el gateway exige HTTPS)');

const base = (SMSGATE_URL || 'https://api.sms-gate.app/3rdparty/v1').replace(/\/$/, '');
const auth = `Basic ${Buffer.from(`${SMSGATE_USUARIO}:${SMSGATE_CLAVE}`).toString('base64')}`;
const destino = `${PUBLIC_URL.replace(/\/$/, '')}/sms/gateway`;

async function api(metodo, ruta, cuerpo) {
    const respuesta = await fetch(`${base}${ruta}`, {
        method: metodo,
        headers: { Authorization: auth, ...(cuerpo && { 'Content-Type': 'application/json' }) },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined
    });
    const texto = await respuesta.text();
    if (!respuesta.ok) throw new Error(`${metodo} ${ruta} → ${respuesta.status}: ${texto}`);
    return texto ? JSON.parse(texto) : null;
}

const actuales = await api('GET', '/webhooks');
console.log('Webhooks registrados:', actuales.map((w) => `${w.event} → ${w.url}`));
if (process.argv.includes('--listar')) process.exit(0);

if (actuales.some((w) => w.event === 'sms:received' && w.url === destino)) {
    console.log('Ya estaba registrado:', destino);
} else {
    const nuevo = await api('POST', '/webhooks', { url: destino, event: 'sms:received' });
    console.log('Registrado:', nuevo.event, '→', nuevo.url);
}
