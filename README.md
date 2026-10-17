# La Cajita

Pagos con QR para vendedores de barrio, con o sin cuenta, construidos sobre **Open Payments** (Interledger).
Open Payments Hackathon · Medellín · 16–17 de octubre de 2026.

> 🚧 En construcción durante el hackathon.

## Configuración
1. `cp .env.example .env` y completar con los datos de la Test Wallet.
2. Guardar `private.key` en la ruta indicada. **Nunca se sube al repo.**

## Abrir la app desde un celular (túnel público)
La wallet de Open Payments redirige al cliente a nuestro backend después del consentimiento, y el QR se escanea
con un celular: por eso el backend necesita una URL pública con HTTPS. Usamos [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (`cloudflared`).

**URL de la demo: `https://cajita.serenqo.app`** (túnel fijo `la-cajita`, corre en la máquina que tiene sus credenciales):
```bash
cloudflared tunnel run --url http://localhost:3000 la-cajita
```
Con este túnel, `PUBLIC_URL=https://cajita.serenqo.app` no cambia y los QR siguen sirviendo.

**Sin las credenciales del túnel fijo (cualquier otra máquina), túnel rápido:**

1. Instalar `cloudflared` ([descargas](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)).
2. Con el backend corriendo (`npm start`, puerto 3000 por defecto), en otra terminal:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
3. `cloudflared` imprime una URL como `https://<palabras>.trycloudflare.com`. Ábrela en el celular.
4. Pon esa URL en `PUBLIC_URL` del `.env` y reinicia el backend: es a donde vuelve la wallet tras aprobar el pago.

> La URL de `trycloudflare.com` cambia cada vez que se reinicia el túnel: hay que actualizar `PUBLIC_URL` y volver a generar los QR.
> Si el puerto 3000 está ocupado, arranca el backend con otro `PORT` y apunta el túnel a ese puerto.

**Cómo se creó el túnel fijo (referencia, ya está hecho):**
```bash
cloudflared tunnel login
cloudflared tunnel create la-cajita
cloudflared tunnel route dns la-cajita cajita.serenqo.app
cloudflared tunnel run --url http://localhost:3000 la-cajita
```

## Uso de IA
Ver [AI_USAGE.md](AI_USAGE.md) y la carpeta [prompts/](prompts/).
