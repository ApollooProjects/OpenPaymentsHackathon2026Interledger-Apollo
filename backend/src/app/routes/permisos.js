import { Router } from 'express';
import * as pagosRapidos from '../pagosRapidos.js';
import { mensajeParaUsuario } from '../errores.js';

export const rutasPermisos = Router();

// Activar pagos rápidos: devuelve la URL de la pantalla de consentimiento con el tope semanal.
rutasPermisos.post('/permisos', async (req, res) => {
    try {
        const { clienteId, pagador, tope } = req.body ?? {};
        res.json(await pagosRapidos.activar({ clienteId, pagador, tope }));
    } catch (error) {
        console.error('POST /permisos:', error);
        res.status(400).json({ error: mensajeParaUsuario(error, 'pago') });
    }
});

rutasPermisos.get('/op/finish-permiso', async (req, res) => {
    const { cliente, interact_ref: interactRef, hash, result: resultado } = req.query;
    if (!cliente) return res.status(400).send('Falta el parámetro cliente');
    let estado;
    try {
        estado = await pagosRapidos.terminarActivacion({ clienteId: cliente, interactRef, hash, resultado });
    } catch (error) {
        console.error(error);
        estado = 'fallido';
    }
    res.redirect(`/demoenvivo/#cliente?pagosRapidos=${encodeURIComponent(estado)}`);
});

rutasPermisos.get('/permisos/:clienteId', (req, res) => {
    res.json(pagosRapidos.estado(req.params.clienteId));
});

rutasPermisos.delete('/permisos/:clienteId', async (req, res) => {
    const resultado = await pagosRapidos.cancelar(req.params.clienteId);
    res.status(resultado.ok ? 200 : 404).json(resultado);
});
