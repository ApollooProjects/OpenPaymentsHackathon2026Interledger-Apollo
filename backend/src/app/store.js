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
    CREATE TABLE IF NOT EXISTS repartos (
        id TEXT PRIMARY KEY,
        qr_id TEXT NOT NULL UNIQUE,
        vendedor TEXT NOT NULL,
        con_cuenta INTEGER NOT NULL,
        vendedor_wallet TEXT,
        cedula TEXT,
        celular TEXT,
        proveedor_wallet TEXT NOT NULL,
        porcentaje INTEGER NOT NULL,
        deuda TEXT,
        deuda_cobro_id TEXT,
        cajita_id TEXT,
        cajita_vence TEXT,
        creado TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pagos_rapidos (
        cliente_id TEXT PRIMARY KEY,
        wallet TEXT NOT NULL,
        tope TEXT NOT NULL,
        inicio TEXT NOT NULL,
        estado TEXT NOT NULL,
        datos TEXT NOT NULL,
        actualizado TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS permisos (
        clave TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        manage_url TEXT,
        actualizado TEXT NOT NULL
    );
`);

// QR personalizados (C3.5): a qué reparto pertenecen y su descripción. Se agregan sin borrar bases existentes.
for (const columna of ['reparto_id TEXT', 'descripcion TEXT']) {
    try {
        db.exec(`ALTER TABLE qrs ADD COLUMN ${columna}`);
    } catch (error) {
        if (!/duplicate column/i.test(error.message)) throw error;
    }
}

// Ahorro automático (C5.2): wallet y % de la parte del vendedor. Mismo patrón: no borra repartos existentes.
for (const columna of ['ahorro_wallet TEXT', 'ahorro_porcentaje INTEGER NOT NULL DEFAULT 0']) {
    try {
        db.exec(`ALTER TABLE repartos ADD COLUMN ${columna}`);
    } catch (error) {
        if (!/duplicate column/i.test(error.message)) throw error;
    }
}

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
        propina: fila.propina === 1,
        repartoId: fila.reparto_id ?? null,
        descripcion: fila.descripcion ?? null
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

export function guardarQr({
    id, vendedor, walletUrl, tipo = 'estatico', monto = null, meseros = [], vigenteHasta = null, propina = false,
    repartoId = null, descripcion = null
}) {
    db.prepare(`
        INSERT INTO qrs (id, vendedor, wallet_url, tipo, monto, meseros, vigente_hasta, propina, reparto_id, descripcion, creado)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            vendedor = excluded.vendedor, wallet_url = excluded.wallet_url, tipo = excluded.tipo, monto = excluded.monto,
            meseros = excluded.meseros, vigente_hasta = excluded.vigente_hasta, propina = excluded.propina,
            reparto_id = excluded.reparto_id, descripcion = excluded.descripcion
    `).run(id, vendedor, walletUrl, tipo, monto, JSON.stringify(meseros), vigenteHasta, propina ? 1 : 0,
        repartoId, descripcion, ahora());
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

function filaAReparto(fila) {
    if (!fila) return null;
    return {
        id: fila.id,
        qrId: fila.qr_id,
        vendedor: fila.vendedor,
        conCuenta: fila.con_cuenta === 1,
        vendedorWallet: fila.vendedor_wallet,
        cedula: fila.cedula,
        celular: fila.celular,
        proveedorWallet: fila.proveedor_wallet,
        porcentaje: fila.porcentaje,
        deuda: fila.deuda,
        deudaCobroId: fila.deuda_cobro_id,
        cajitaId: fila.cajita_id,
        cajitaVence: fila.cajita_vence,
        ahorroWallet: fila.ahorro_wallet ?? null,
        ahorroPorcentaje: fila.ahorro_porcentaje ?? 0
    };
}

export function crearReparto(r) {
    db.prepare(`
        INSERT INTO repartos (id, qr_id, vendedor, con_cuenta, vendedor_wallet, cedula, celular, proveedor_wallet,
            porcentaje, deuda, deuda_cobro_id, cajita_id, cajita_vence, ahorro_wallet, ahorro_porcentaje, creado)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(r.id, r.qrId, r.vendedor, r.conCuenta ? 1 : 0, r.vendedorWallet ?? null, r.cedula ?? null, r.celular ?? null,
        r.proveedorWallet, r.porcentaje, r.deuda ?? null, r.deudaCobroId ?? null, r.cajitaId ?? null, r.cajitaVence ?? null,
        r.ahorroWallet ?? null, r.ahorroPorcentaje ?? 0, ahora());
    return obtenerReparto(r.id);
}

export function obtenerReparto(id) {
    return filaAReparto(db.prepare('SELECT * FROM repartos WHERE id = ?').get(id));
}

// El QR estático del reparto, o un QR personalizado generado para ese reparto (C3.5).
export function repartoDelQr(qrId) {
    return filaAReparto(db.prepare(`
        SELECT r.* FROM repartos r
        WHERE r.qr_id = ? OR r.id = (SELECT reparto_id FROM qrs WHERE id = ?)
    `).get(qrId, qrId));
}

export function cambiarCajita(id, { cajitaId, cajitaVence }) {
    db.prepare('UPDATE repartos SET cajita_id = ?, cajita_vence = ? WHERE id = ?').run(cajitaId, cajitaVence, id);
    return obtenerReparto(id);
}

export function pagosDelQr(qrId) {
    return db.prepare("SELECT * FROM pagos WHERE json_extract(plan, '$.origen.qrId') = ? ORDER BY creado").all(qrId).map(filaAPago);
}

// Ventas de un reparto por su QR estático y por todos sus QR personalizados.
export function pagosDelReparto(repartoId) {
    return db.prepare(`
        SELECT p.* FROM pagos p
        WHERE json_extract(p.plan, '$.origen.qrId') IN (
            SELECT qr_id FROM repartos WHERE id = ?
            UNION SELECT id FROM qrs WHERE reparto_id = ?
        )
        ORDER BY p.creado
    `).all(repartoId, repartoId).map(filaAPago);
}

// Pagos con al menos un destino en esa wallet (perfil de demo: lo que ha recibido un mesero o un proveedor).
export function pagosHacia(walletUrl) {
    return db.prepare(`
        SELECT p.* FROM pagos p
        WHERE EXISTS (SELECT 1 FROM json_each(p.plan, '$.destinos') d WHERE json_extract(d.value, '$.walletUrl') = ?)
        ORDER BY p.creado DESC
    `).all(walletUrl).map(filaAPago);
}

export function repartosDelProveedor(walletUrl) {
    return db.prepare('SELECT * FROM repartos WHERE proveedor_wallet = ? ORDER BY creado DESC').all(walletUrl).map(filaAReparto);
}

// datos: lo que pide el grant según su estado (pendiente: nonces y continuación; activo: token, manageUrl, continuación).
export function guardarPagosRapidos({ clienteId, wallet, tope, inicio, estado, datos }) {
    db.prepare(`
        INSERT INTO pagos_rapidos (cliente_id, wallet, tope, inicio, estado, datos, actualizado) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cliente_id) DO UPDATE SET wallet = excluded.wallet, tope = excluded.tope, inicio = excluded.inicio,
            estado = excluded.estado, datos = excluded.datos, actualizado = excluded.actualizado
    `).run(clienteId, wallet, JSON.stringify(tope), inicio, estado, JSON.stringify(datos), ahora());
    return obtenerPagosRapidos(clienteId);
}

export function obtenerPagosRapidos(clienteId) {
    const fila = db.prepare('SELECT * FROM pagos_rapidos WHERE cliente_id = ?').get(clienteId);
    if (!fila) return null;
    return {
        clienteId: fila.cliente_id,
        wallet: fila.wallet,
        tope: JSON.parse(fila.tope),
        inicio: fila.inicio,
        estado: fila.estado,
        datos: JSON.parse(fila.datos)
    };
}

export function pagosRapidosDesde(clienteId, desde) {
    return db.prepare(`
        SELECT * FROM pagos
        WHERE json_extract(plan, '$.clienteId') = ? AND json_extract(plan, '$.metodo') = 'rapido'
            AND estado IN ('procesando', 'enviado', 'completado') AND creado >= ?
    `).all(clienteId, desde).map(filaAPago);
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
