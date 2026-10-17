import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import { db } from './db.js';
import { guardarQr } from './store.js';
import { rutasPagos } from './routes/pagos.js';
import { rutasRetiros } from './routes/retiros.js';
import { rutasRepartos } from './routes/repartos.js';
import { rutasPermisos } from './routes/permisos.js';
import { rutasRemesas } from './routes/remesas.js';
import { rutasCobros } from './routes/cobros.js';
import { rutasQr } from './qr.js';
import { rutasSms } from './sms.js';
import { onPagoCompletado } from './motor.js';
import { avisarLlegada, registrar, rutasSinCuenta } from './sinCuenta.js';
import './conexiones.js';
import { rutasSmsReal } from './smsReal.js';
import { mensajeParaUsuario } from './errores.js';
import { aWalletUrl } from './wallet.js';
import { rutasAuth } from './routes/auth.js';
import { rutasYo } from './routes/yo.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

dotenv.config({ path: path.join(raiz, '.env'), quiet: true });

const app = express();

// El cuerpo crudo se guarda para verificar la firma HMAC de los webhooks del gateway de SMS.
app.use(express.json({ verify: (req, res, buf) => { req.cuerpoCrudo = buf; } }));
// no-cache: el navegador (y Cloudflare) revalidan con el ETag en cada carga, así nadie se queda con JS viejo
// después de un despliegue; si el archivo no cambió, la respuesta es un 304 sin cuerpo.
const sinCache = { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') };
app.use(express.static(path.join(raiz, 'frontend'), sinCache));
// App producto: la del usuario (/app) y la del corresponsal (/corresponsal). Si la carpeta no existe, da 404.
app.use('/app', express.static(path.join(raiz, 'app'), sinCache));
app.use('/corresponsal', express.static(path.join(raiz, 'corresponsal'), sinCache));
app.use(rutasQr);

app.get('/salud', (req, res) => {
    const { ok } = db.prepare('SELECT 1 AS ok').get();
    res.json({ ok: ok === 1 });
});

app.use(rutasPagos);
app.use(rutasRetiros);
app.use(rutasRepartos);
app.use(rutasPermisos);
app.use(rutasRemesas);
app.use(rutasCobros);
app.use(rutasSms);
app.use(rutasSmsReal);
app.use(rutasSinCuenta);
app.use(rutasAuth);
app.use(rutasYo);

// Aviso de llegada (H9): SMS a quien no tiene cuenta cuando su cobro en la Custodia se confirma.
onPagoCompletado(avisarLlegada);

app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({ error: mensajeParaUsuario(error) });
});

if (process.env.DEMO_VENDEDOR_WALLET) {
    guardarQr({
        id: 'demo',
        vendedor: process.env.DEMO_VENDEDOR_NOMBRE || 'Doña Rita',
        walletUrl: aWalletUrl(process.env.DEMO_VENDEDOR_WALLET)
    });
}

// QR estático de demo sin cuenta (id "demo-sin-cuenta"): el dinero queda en la Custodia a nombre de esa cédula.
if (process.env.CUSTODIA_WALLET && process.env.DEMO_SINCUENTA_CEDULA && process.env.DEMO_SINCUENTA_CELULAR) {
    try {
        registrar({
            qrId: 'demo-sin-cuenta',
            nombre: process.env.DEMO_SINCUENTA_NOMBRE || 'Don Pedro',
            cedula: process.env.DEMO_SINCUENTA_CEDULA,
            celular: process.env.DEMO_SINCUENTA_CELULAR
        });
    } catch (error) {
        console.warn(`[demo-sin-cuenta] no se registró: ${error.message}`);
    }
}

const puerto = Number(process.env.PORT) || 3000;

app.listen(puerto, () => {
    console.log(`La Cajita en http://localhost:${puerto}`);
});
