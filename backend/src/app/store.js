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
    CREATE TABLE IF NOT EXISTS retiros (
        id TEXT PRIMARY KEY,
        cedula TEXT NOT NULL,
        celular TEXT,
        monto TEXT NOT NULL,
        cobro_id TEXT NOT NULL,
        pin_hash TEXT NOT NULL,
        pin_sal TEXT NOT NULL,
        vence TEXT NOT NULL,
        estado TEXT NOT NULL,
        pago_op_id TEXT,
        error TEXT,
        creado TEXT NOT NULL,
        actualizado TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS permisos (
        clave TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        manage_url TEXT,
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

function filaARetiro(fila) {
    if (!fila) return null;
    return {
        id: fila.id,
        cedula: fila.cedula,
        celular: fila.celular,
        monto: JSON.parse(fila.monto),
        cobroId: fila.cobro_id,
        pinHash: fila.pin_hash,
        pinSal: fila.pin_sal,
        vence: fila.vence,
        estado: fila.estado,
        pagoOpId: fila.pago_op_id,
        error: fila.error
    };
}

export function crearRetiro({ id, cedula, celular, monto, cobroId, pinHash, pinSal, vence, estado }) {
    const momento = ahora();
    db.prepare(`
        INSERT INTO retiros (id, cedula, celular, monto, cobro_id, pin_hash, pin_sal, vence, estado, creado, actualizado)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, cedula, celular ?? null, JSON.stringify(monto), cobroId, pinHash, pinSal, vence, estado, momento, momento);
    return obtenerRetiro(id);
}

export function obtenerRetiro(id) {
    return filaARetiro(db.prepare('SELECT * FROM retiros WHERE id = ?').get(id));
}

export function retirosDe(cedula) {
    return db.prepare('SELECT * FROM retiros WHERE cedula = ? ORDER BY creado').all(cedula).map(filaARetiro);
}

// Cambia de estado solo si sigue en el estado esperado: evita entregar dos veces el mismo retiro.
export function cambiarEstadoRetiro(id, de, a, { error = null, pagoOpId } = {}) {
    const { changes } = db.prepare(`
        UPDATE retiros SET estado = ?, error = ?, pago_op_id = COALESCE(?, pago_op_id), actualizado = ?
        WHERE id = ? AND estado = ?
    `).run(a, error, pagoOpId ?? null, ahora(), id, de);
    return changes === 1;
}

export function guardarPermiso(clave, { token, manageUrl }) {
    db.prepare(`
        INSERT INTO permisos (clave, token, manage_url, actualizado) VALUES (?, ?, ?, ?)
        ON CONFLICT(clave) DO UPDATE SET token = excluded.token, manage_url = excluded.manage_url, actualizado = excluded.actualizado
    `).run(clave, token, manageUrl ?? null, ahora());
}

export function obtenerPermiso(clave) {
    const fila = db.prepare('SELECT * FROM permisos WHERE clave = ?').get(clave);
    return fila ? { token: fila.token, manageUrl: fila.manage_url } : null;
}
