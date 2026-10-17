// Lector de QR para la pantalla Pagar.
// Usa BarcodeDetector cuando el navegador lo trae con soporte para QR (Chrome en Android o macOS).
// Si no (Firefox, Safari, Chrome en Windows o Linux), decodifica cuadro por cuadro con jsQR.
const JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
let cargaJsQr = null;

function cargarJsQr() {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    cargaJsQr ??= new Promise((resolver, rechazar) => {
        const script = document.createElement('script');
        script.src = JSQR_URL;
        script.onload = () => (window.jsQR ? resolver(window.jsQR) : rechazar(new Error('jsQR no cargó')));
        script.onerror = () => { cargaJsQr = null; rechazar(new Error('jsQR no cargó')); };
        document.head.append(script);
    });
    return cargaJsQr;
}

async function detectorNativo() {
    if (!('BarcodeDetector' in window)) return null;
    try {
        const formatos = await window.BarcodeDetector.getSupportedFormats?.();
        if (formatos && !formatos.includes('qr_code')) return null;
        return new window.BarcodeDetector({ formats: ['qr_code'] });
    } catch {
        return null;
    }
}

// Devuelve una función que recibe un <video>, <img> o ImageBitmap y responde el texto del QR (o null).
export async function crearLector() {
    const nativo = await detectorNativo();
    if (nativo) {
        return async (fuente) => {
            const [codigo] = await nativo.detect(fuente);
            return codigo?.rawValue ?? null;
        };
    }
    const jsQR = await cargarJsQr();
    const lienzo = document.createElement('canvas');
    const contexto = lienzo.getContext('2d', { willReadFrequently: true });
    return async (fuente) => {
        const ancho = fuente.videoWidth ?? fuente.naturalWidth ?? fuente.width;
        const alto = fuente.videoHeight ?? fuente.naturalHeight ?? fuente.height;
        if (!ancho || !alto) return null;
        // Basta con 800 px de lado: más grande solo hace lento cada cuadro.
        const escala = Math.min(1, 800 / Math.max(ancho, alto));
        lienzo.width = Math.round(ancho * escala);
        lienzo.height = Math.round(alto * escala);
        contexto.drawImage(fuente, 0, 0, lienzo.width, lienzo.height);
        const { data } = contexto.getImageData(0, 0, lienzo.width, lienzo.height);
        return jsQR(data, lienzo.width, lienzo.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
    };
}

// Lee el QR de una foto elegida por la persona (sirve sin cámara en vivo).
export async function leerImagen(archivo) {
    const lector = await crearLector();
    const url = URL.createObjectURL(archivo);
    try {
        const imagen = new Image();
        imagen.src = url;
        await imagen.decode();
        return await lector(imagen);
    } finally {
        URL.revokeObjectURL(url);
    }
}
