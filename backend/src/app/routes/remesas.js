import { Router } from 'express';
import * as remesas from '../remesas.js';

export const rutasRemesas = Router();

rutasRemesas.post('/remesas/cotizar', async (req, res) => {
    try {
        res.json(await remesas.cotizar(req.body ?? {}));
    } catch (error) {
        res.status(error.status ?? 400).json({ error: error.message });
    }
});

rutasRemesas.post('/remesas', async (req, res) => {
    try {
        res.json(await remesas.enviar(req.body ?? {}));
    } catch (error) {
        res.status(error.status ?? 400).json({ error: error.message });
    }
});
