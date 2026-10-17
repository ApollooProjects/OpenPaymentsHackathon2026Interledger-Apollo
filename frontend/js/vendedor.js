// Pestaña Vendedor mínima (H3): muestra el QR estático para imprimir.
// Capa 1: el QR se elige con /#vendedor?qr=<id> (por defecto "demo"). En la capa 3 lo entrega POST /repartos.
import { alAbrirPestana, obtenerQr, urlImagenQr } from './api.js';

const seccion = document.getElementById('vendedor');
const nombre = seccion.querySelector('[data-nombre]');
const imagen = seccion.querySelector('img');
const enlace = seccion.querySelector('[data-enlace]');

alAbrirPestana('vendedor', async (params) => {
    const qrId = params.get('qr') || 'demo';
    const destino = `${location.origin}${location.search}#cliente?qr=${encodeURIComponent(qrId)}`;

    imagen.src = urlImagenQr(qrId);
    enlace.href = destino;
    enlace.textContent = destino;

    try {
        const qr = await obtenerQr(qrId);
        nombre.textContent = `QR de ${qr.vendedor}`;
    } catch {
        nombre.textContent = 'QR del puesto';
    }
});
