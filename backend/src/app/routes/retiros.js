import { Router } from 'express';
import * as retiros from '../retiros.js';

export const rutasRetiros = Router();

rutasRetiros.post('/retiros', async (req, res) => {
    const { cedula, celular } = req.body ?? {};
    if (!cedula && !celular) return res.status(400).json({ ok: false, error: 'Falta la cédula o el celular' });
    const resultado = await retiros.solicitar({ cedula, celular });
    res.status(resultado.ok ? 200 : 404).json(resultado);
});

rutasRetiros.post('/retiros/validar', async (req, res) => {
    const { pin, cedula } = req.body ?? {};
    if (!pin || !cedula) return res.status(400).json({ ok: false, error: 'Falta el PIN o la cédula' });
    const resultado = await retiros.validar({ pin, cedula });
    if (resultado.ok) return res.json(resultado);
    res.status(resultado.estado === 'procesando' ? 202 : 400).json(resultado);
});
