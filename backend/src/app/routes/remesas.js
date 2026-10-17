import { Router } from 'express';
import * as remesas from '../remesas.js';
import { mensajeParaUsuario } from '../errores.js';

export const rutasRemesas = Router();

rutasRemesas.post('/remesas/cotizar', async (req, res) => {
    try {
        res.json(await remesas.cotizar(req.body ?? {}));
    } catch (error) {
        if (!error.status) console.error('POST /remesas/cotizar:', error);
        res.status(error.status ?? 400).json({ error: mensajeParaUsuario(error, 'remesa') });
    }
});

rutasRemesas.post('/remesas', async (req, res) => {
    try {
        res.json(await remesas.enviar(req.body ?? {}));
    } catch (error) {
        if (!error.status) console.error('POST /remesas:', error);
        res.status(error.status ?? 400).json({ error: mensajeParaUsuario(error, 'pago') });
    }
});
