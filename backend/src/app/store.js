import { db } from './db.js';

db.exec(`
    CREATE TABLE IF NOT EXISTS qrs (
        id TEXT PRIMARY KEY,
        vendedor TEXT NOT NULL,
        wallet_url TEXT NOT NULL,
        tipo TEXT NOT NULL DEFAULT 'estatico',
        monto TEXT,
        meseros TEXT NOT NULL DEFAULT '[]',
        vigente_hasta TEXT,
        propina INTEGER NOT NULL DEFAULT 0,
        creado TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pagos (
        id TEXT PRIMARY KEY,
        estado TEXT NOT NULL,
        pagador TEXT NOT NULL,
        plan TEXT NOT NULL,
        permiso TEXT,
        error TEXT,
        creado TEXT NOT NULL,
        actualizado TEXT NOT NULL
    );
`);

const ahora = () => new Date().toISOString();

function filaAQr(fila) {
    if (!fila) return null;
    return {
        id: fila.id,
        vendedor: fila.vendedor,
        walletUrl: fila.wallet_url,
        tipo: fila.tipo,
        monto: fila.monto,
        meseros: JSON.parse(fila.meseros),
        vigenteHasta: fila.vigente_hasta,
        propina: fila.propina === 1
    };
}

function filaAPago(fila) {
    if (!fila) return null;
    return {
        id: fila.id,
        estado: fila.estado,
        pagador: fila.pagador,
        plan: JSON.parse(fila.plan),
        permiso: fila.permiso ? JSON.parse(fila.permiso) : null,
        error: fila.error,
        creado: fila.creado,
        actualizado: fila.actualizado
    };
}

export function guardarQr({ id, vendedor, walletUrl, tipo = 'estatico', monto = null, meseros = [], vigenteHasta = null, propina = false }) {
    db.prepare(`
        INSERT INTO qrs (id, vendedor, wallet_url, tipo, monto, meseros, vigente_hasta, propina, creado)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            vendedor = excluded.vendedor, wallet_url = excluded.wallet_url, tipo = excluded.tipo, monto = excluded.monto,
            meseros = excluded.meseros, vigente_hasta = excluded.vigente_hasta, propina = excluded.propina
    `).run(id, vendedor, walletUrl, tipo, monto, JSON.stringify(meseros), vigenteHasta, propina ? 1 : 0, ahora());
    return obtenerQr(id);
}

export function obtenerQr(id) {
    return filaAQr(db.prepare('SELECT * FROM qrs WHERE id = ?').get(id));
}

export function crearPago({ id, estado, pagador, plan }) {
    const momento = ahora();
    db.prepare('INSERT INTO pagos (id, estado, pagador, plan, creado, actualizado) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, estado, pagador, JSON.stringify(plan), momento, momento);
    return obtenerPago(id);
}

export function actualizarPago(id, cambios) {
    const actual = obtenerPago(id);
    if (!actual) throw new Error(`Pago no encontrado: ${id}`);
    const nuevo = { ...actual, ...cambios };
    db.prepare('UPDATE pagos SET estado = ?, plan = ?, permiso = ?, error = ?, actualizado = ? WHERE id = ?')
        .run(nuevo.estado, JSON.stringify(nuevo.plan), nuevo.permiso ? JSON.stringify(nuevo.permiso) : null, nuevo.error ?? null, ahora(), id);
    return obtenerPago(id);
}

export function obtenerPago(id) {
    return filaAPago(db.prepare('SELECT * FROM pagos WHERE id = ?').get(id));
}
