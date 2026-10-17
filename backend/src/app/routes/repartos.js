import { Router } from 'express';
import * as repartos from '../repartos.js';

export const rutasRepartos = Router();

rutasRepartos.post('/repartos', async (req, res) => {
    try {
        res.json(await repartos.crearReparto(req.body ?? {}));
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

rutasRepartos.get('/repartos/:id', async (req, res) => {
    const resumen = await repartos.resumenReparto(req.params.id);
    if (!resumen) return res.status(404).json({ error: 'Reparto no encontrado' });
    res.json(resumen);
});

// Botón "Retirar" de la pestaña Vendedor (sin cuenta): el PIN llega por SMS.
rutasRepartos.post('/repartos/:id/retirar', async (req, res) => {
    const resultado = await repartos.retirar(req.params.id);
    res.status(resultado.ok ? 200 : 400).json(resultado);
});
