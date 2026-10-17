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
import { rutasQr } from './qr.js';
import { rutasSms } from './sms.js';
import { onPagoCompletado } from './motor.js';
import { avisarLlegada, registrar, rutasSinCuenta } from './sinCuenta.js';
import './conexiones.js';
import { rutasSmsReal } from './smsReal.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

dotenv.config({ path: path.join(raiz, '.env'), quiet: true });

const app = express();

// El cuerpo crudo se guarda para verificar la firma HMAC de los webhooks del gateway de SMS.
app.use(express.json({ verify: (req, res, buf) => { req.cuerpoCrudo = buf; } }));
app.use(express.static(path.join(raiz, 'frontend')));
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
app.use(rutasSms);
app.use(rutasSmsReal);
app.use(rutasSinCuenta);

// Aviso de llegada (H9): SMS a quien no tiene cuenta cuando su cobro en la Custodia se confirma.
onPagoCompletado(avisarLlegada);

app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({ error: error.message });
});

if (process.env.DEMO_VENDEDOR_WALLET) {
    guardarQr({
        id: 'demo',
        vendedor: process.env.DEMO_VENDEDOR_NOMBRE || 'Doña Rita',
        walletUrl: process.env.DEMO_VENDEDOR_WALLET.replace(/^\$/, 'https://')
    });
}

// QR estático de demo sin cuenta (id "demo-sin-cuenta"): el dinero queda en la Custodia a nombre de esa cédula.
if (process.env.CUSTODIA_WALLET && process.env.DEMO_SINCUENTA_CEDULA && process.env.DEMO_SINCUENTA_CELULAR) {
    registrar({
        qrId: 'demo-sin-cuenta',
        nombre: process.env.DEMO_SINCUENTA_NOMBRE || 'Don Pedro',
        cedula: process.env.DEMO_SINCUENTA_CEDULA,
        celular: process.env.DEMO_SINCUENTA_CELULAR
    });
}

const puerto = Number(process.env.PORT) || 3000;

app.listen(puerto, () => {
    console.log(`La Cajita en http://localhost:${puerto}`);
});
