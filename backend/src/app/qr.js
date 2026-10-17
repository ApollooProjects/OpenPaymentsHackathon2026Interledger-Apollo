import { Router } from 'express';
import QRCode from 'qrcode';

// URL a la que lleva el QR impreso: abre directo la pestaña Cliente con ese QR.
export function urlDelQr(qrId, base) {
    const raiz = (process.env.PUBLIC_URL || base).replace(/\/$/, '');
    return `${raiz}/#cliente?qr=${encodeURIComponent(qrId)}`;
}

export function imagenQr(texto) {
    return QRCode.toString(texto, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
}

// GET /qr/:qrId/imagen → SVG del QR que apunta a la pestaña Cliente.
// Los datos del QR (GET /qr/:qrId) los sirve C1.3.
export const rutasQr = Router();

rutasQr.get('/qr/:qrId/imagen', async (req, res) => {
    const base = `${req.protocol}://${req.get('host')}`;
    const svg = await imagenQr(urlDelQr(req.params.qrId, base));
    res.type('image/svg+xml').send(svg);
});
