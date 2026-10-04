const express = require('express');
const cors = require('cors');
const { Pool, types } = require('pg');
require('dotenv').config();

// 🛡️ BLINDAJE GLOBAL DE ZONA HORARIA (PERÚ)
process.env.TZ = 'America/Lima'; 
types.setTypeParser(1082, (val) => val);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' })); 

const pool = new Pool({
    user: process.env.DB_USER, 
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST, 
    port: process.env.DB_PORT,
    database: process.env.DB_DATABASE, 
    ssl: { rejectUnauthorized: false }
});

pool.on('connect', client => { client.query("SET timezone = 'America/Lima';"); });

pool.connect((err, client, release) => {
    if (err) console.error('❌ Error conectando a Supabase:', err.message);
    else { console.log('✅ Base de datos Supabase (America/Lima) conectada.'); release(); }
});

// ==========================================
// 1. MATRÍCULAS (MODIFICADO PARA MULTI-AÑO)
// ==========================================
app.get('/alumnos', async (req, res) => {
    const anio = req.query.anio || '2026'; // Por defecto 2026 si no le mandan nada
    try { 
        const r = await pool.query('SELECT * FROM alumnos WHERE anio_academico = $1 ORDER BY grado ASC, seccion ASC, apellidos ASC', [anio]); 
        res.json({ success: true, data: r.rows }); 
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/alumnos', async (req, res) => {
    const b = req.body;
    const anio = b.anio_academico || '2026'; // Capturamos el año en el que se le matricula
    try {
        const r = await pool.query(
            `INSERT INTO alumnos (dni, apellidos, nombres, grado, seccion, estado, utiles_completos, direccion, obs, papa_nombre, papa_celular, mama_nombre, mama_celular, apoderado_dni, pension_base, anio_academico) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *;`, 
            [b.dni, b.apellidos, b.nombres, b.grado, b.seccion, b.estado || 'ACTIVO', b.utiles_completos, b.direccion || '', b.obs || '', b.papa_nombre, b.papa_celular, b.mama_nombre, b.mama_celular, b.apoderado_dni, b.pension_base, anio]
        );
        res.json({ success: true, data: r.rows[0] });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/alumnos/:id', async (req, res) => {
    const { id } = req.params; const b = req.body;
    const anio = b.anio_academico || '2026';
    try {
        const r = await pool.query(`UPDATE alumnos SET dni=$1, apellidos=$2, nombres=$3, grado=$4, seccion=$5, estado=$6, utiles_completos=$7, direccion=$8, obs=$9, papa_nombre=$10, papa_celular=$11, mama_nombre=$12, mama_celular=$13, apoderado_dni=$14, pension_base=$15, anio_academico=$16 WHERE id=$17 RETURNING *;`, [b.dni, b.apellidos, b.nombres, b.grado, b.seccion, b.estado, b.utiles_completos, b.direccion, b.obs, b.papa_nombre, b.papa_celular, b.mama_nombre, b.mama_celular, b.apoderado_dni, b.pension_base, anio, id]);
        if (b.pension_base) await pool.query(`UPDATE pensiones SET monto=$1 WHERE alumno_id=$2 AND estado='PENDIENTE' AND concepto NOT ILIKE '%MATRÍCULA%'`, [b.pension_base, id]);
        res.json({ success: true, data: r.rows[0] });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ==========================================
// 2. CAJA (PENSIONES MODIFICADO PARA MULTI-AÑO)
// ==========================================
app.get('/caja/estado-cuenta', async (req, res) => {
    const anio = req.query.anio || '2026';
    try {
        // Ahora solo trae a los alumnos y pensiones del año seleccionado en la app
        const r = await pool.query(`SELECT a.id, a.dni, a.nombres, a.apellidos, a.grado, a.seccion, COALESCE(a.papa_celular, a.mama_celular, '') as celular_contacto, COALESCE(json_agg(p.* ORDER BY p.fecha_vencimiento ASC) FILTER (WHERE p.id IS NOT NULL), '[]') as recibos FROM alumnos a LEFT JOIN pensiones p ON a.id=p.alumno_id WHERE a.anio_academico = $1 GROUP BY a.id ORDER BY a.grado, a.seccion, a.apellidos;`, [anio]);
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/pensiones/:id/pagar', async (req, res) => {
    const { id } = req.params; const { metodo_pago, nro_operacion, fecha_pago, monto_final } = req.body;
    try { const r = await pool.query(`UPDATE pensiones SET estado='PAGADO', monto=$1, metodo_pago=$2, nro_operacion=$3, fecha_pago=$4 WHERE id=$5 RETURNING *;`, [monto_final, metodo_pago, nro_operacion, fecha_pago, id]); res.json({ success: true, data: r.rows[0] }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ==========================================
// 3. VENTAS E INVENTARIO
// ==========================================
app.get('/productos', async (req, res) => {
    try { const r = await pool.query('SELECT * FROM productos ORDER BY categoria ASC, nombre ASC'); res.json({ success: true, data: r.rows }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/productos', async (req, res) => {
    const b = req.body; 
    try { const r = await pool.query(`INSERT INTO productos (categoria, nombre, precio, stock, tipo) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [b.categoria.toUpperCase(), b.nombre, b.precio, b.stock, b.tipo]); res.json({ success: true, data: r.rows[0] }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/productos/:id', async (req, res) => {
    const { id } = req.params; const b = req.body; 
    try { const r = await pool.query(`UPDATE productos SET categoria=$1, nombre=$2, precio=$3, stock=$4, tipo=$5 WHERE id=$6 RETURNING *`, [b.categoria.toUpperCase(), b.nombre, b.precio, b.stock, b.tipo, id]); res.json({ success: true, data: r.rows[0] }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/ventas', async (req, res) => {
    const b = req.body; const c = await pool.connect();
    try {
        await c.query('BEGIN');
        for (let i of b.carrito) { 
            const p = await c.query('SELECT stock, nombre, tipo FROM productos WHERE id=$1 FOR UPDATE', [i.id]); 
            if (p.rows[0].tipo==='FISICO' && p.rows[0].stock < i.cantidad) throw new Error(`Stock insuficiente: ${p.rows[0].nombre}.`); 
        }
        const rV = await c.query(`INSERT INTO ventas (alumno_id, comprador_dni, comprador_nombre, comprador_celular, total, metodo_pago, nro_operacion) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, fecha_venta`, [b.alumno_id || null, b.comprador_dni||'', b.comprador_nombre||'', b.comprador_celular||'', b.total, b.metodo_pago, b.nro_operacion]);
        for (let i of b.carrito) {
            await c.query(`INSERT INTO ventas_detalle (venta_id, producto_id, nombre_producto, cantidad, precio_unitario, precio_original, motivo_descuento, subtotal) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [rV.rows[0].id, i.id, i.nombre, i.cantidad, i.precio, i.precio_original, i.motivo_descuento||'', i.cantidad*i.precio]);
            if (i.tipo==='FISICO') await c.query('UPDATE productos SET stock = stock - $1 WHERE id=$2', [i.cantidad, i.id]);
        }
        await c.query('COMMIT'); res.json({ success: true, venta_id: rV.rows[0].id, fecha_venta: rV.rows[0].fecha_venta });
    } catch (e) { await c.query('ROLLBACK'); res.status(400).json({ success: false, error: e.message }); } finally { c.release(); }
});

app.get('/ventas/resumen', async (req, res) => {
    try { const r = await pool.query(`SELECT v.*, a.nombres as a_nom, a.apellidos as a_ape, a.grado, a.seccion, COALESCE(a.papa_celular, a.mama_celular, '') as a_cel, (SELECT json_agg(vd.*) FROM ventas_detalle vd WHERE vd.venta_id=v.id) as detalles FROM ventas v LEFT JOIN alumnos a ON v.alumno_id=a.id ORDER BY v.fecha_venta DESC;`); res.json({ success: true, data: r.rows }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/ventas/cambio', async (req, res) => {
    const { producto_devuelto_id, producto_entregado_id, cantidad } = req.body; const c = await pool.connect();
    try {
        await c.query('BEGIN');
        const pN = await c.query('SELECT stock, nombre, tipo FROM productos WHERE id=$1 FOR UPDATE', [producto_entregado_id]);
        if (pN.rows[0].tipo==='FISICO' && pN.rows[0].stock < cantidad) throw new Error(`Stock insuficiente: ${pN.rows[0].nombre}`);
        await c.query('UPDATE productos SET stock = stock + $1 WHERE id=$2 AND tipo=\'FISICO\'', [cantidad, producto_devuelto_id]);
        await c.query('UPDATE productos SET stock = stock - $1 WHERE id=$2 AND tipo=\'FISICO\'', [cantidad, producto_entregado_id]);
        await c.query('COMMIT'); res.json({ success: true });
    } catch (e) { await c.query('ROLLBACK'); res.status(400).json({ success: false, error: e.message }); } finally { c.release(); }
});

// ==========================================
// 4. RRHH Y GASTOS 
// ==========================================
app.get('/personal', async (req, res) => { 
    try { const r = await pool.query("SELECT * FROM personal ORDER BY estado ASC, apellidos ASC"); res.json({ success: true, data: r.rows }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } 
});

app.post('/personal', async (req, res) => { 
    const b = req.body; 
    try { const r = await pool.query(`INSERT INTO personal (dni, nombres, apellidos, cargo, sueldo_base, tipo_seguro, estado) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`, [b.dni, b.nombres.toUpperCase(), b.apellidos.toUpperCase(), b.cargo.toUpperCase(), b.sueldo_base, b.tipo_seguro, b.estado]); res.json({ success: true, data: r.rows[0] }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } 
});

app.put('/personal/:id', async (req, res) => { 
    const { id } = req.params; const b = req.body; 
    try { const r = await pool.query(`UPDATE personal SET dni=$1, nombres=$2, apellidos=$3, cargo=$4, sueldo_base=$5, tipo_seguro=$6, estado=$7 WHERE id=$8 RETURNING *`, [b.dni, b.nombres.toUpperCase(), b.apellidos.toUpperCase(), b.cargo.toUpperCase(), b.sueldo_base, b.tipo_seguro, b.estado, id]); res.json({ success: true, data: r.rows[0] }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } 
});

app.get('/gastos', async (req, res) => { 
    try { const r = await pool.query("SELECT * FROM gastos ORDER BY fecha_gasto DESC"); res.json({ success: true, data: r.rows }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } 
});

app.post('/gastos', async (req, res) => { 
    const b = req.body; 
    try { const r = await pool.query(`INSERT INTO gastos (categoria, descripcion, monto, nro_comprobante, registrado_por) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [b.categoria, b.descripcion, b.monto, b.nro_comprobante, b.registrado_por || 'Admin']); res.json({ success: true, data: r.rows[0] }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } 
});

app.post('/planillas/adelanto', async (req, res) => {
    const { id_detalle, monto_adelanto, registrado_por } = req.body; const c = await pool.connect();
    try {
        await c.query('BEGIN');
        const det = await c.query('SELECT pd.*, p.nombres, p.apellidos FROM planilla_detalles pd JOIN personal p ON pd.personal_id = p.id WHERE pd.id = $1', [id_detalle]);
        if(det.rows.length === 0) throw new Error('No se encontró el detalle de la planilla.');
        const row = det.rows[0];
        if (parseFloat(monto_adelanto) > parseFloat(row.sueldo_neto)) throw new Error('El monto supera el sueldo neto disponible.');
        const nuevosDescuentos = parseFloat(row.descuentos_extra) + parseFloat(monto_adelanto);
        const motivoPrevio = row.motivo_ajuste ? row.motivo_ajuste + ' | ' : '';
        const nuevoMotivo = `${motivoPrevio}Adelanto Caja: S/ ${parseFloat(monto_adelanto).toFixed(2)}`;
        const nuevoNeto = parseFloat(row.sueldo_bruto) - parseFloat(row.descuento_ley) + parseFloat(row.bonos) - nuevosDescuentos;
        await c.query(`UPDATE planilla_detalles SET descuentos_extra=$1, motivo_ajuste=$2, sueldo_neto=$3 WHERE id=$4`, [nuevosDescuentos, nuevoMotivo, nuevoNeto, id_detalle]);
        await c.query(`INSERT INTO egresos (concepto, monto, fecha, comprobante, registrado_por) VALUES ($1, $2, CURRENT_DATE, $3, $4)`, [`Adelanto de Sueldo: ${row.apellidos} ${row.nombres}`, monto_adelanto, 'VOUCHER ADELANTO', registrado_por || 'Tesorería']);
        await c.query('COMMIT'); res.json({ success: true, data: { nombres: row.nombres, apellidos: row.apellidos, monto: monto_adelanto } });
    } catch (e) { await c.query('ROLLBACK'); res.status(400).json({ success: false, error: e.message }); } finally { c.release(); }
});

app.post('/planillas/generar', async (req, res) => {
    const { periodo } = req.body; const c = await pool.connect();
    try {
        await c.query('BEGIN');
        let plan = await c.query('SELECT * FROM planillas WHERE periodo=$1', [periodo]); 
        let planillaId;
        if (plan.rows.length > 0) { planillaId = plan.rows[0].id; } 
        else { const ins = await c.query('INSERT INTO planillas (periodo) VALUES ($1) RETURNING id', [periodo]); planillaId = ins.rows[0].id; }
        const activos = await c.query("SELECT * FROM personal WHERE estado='ACTIVO'");
        for (let p of activos.rows) {
            const existe = await c.query('SELECT id FROM planilla_detalles WHERE planilla_id=$1 AND personal_id=$2', [planillaId, p.id]);
            if (existe.rows.length === 0) {
                let descLey = 0; if (p.tipo_seguro === 'ONP') descLey = parseFloat(p.sueldo_base) * 0.13; else if (p.tipo_seguro === 'AFP') descLey = parseFloat(p.sueldo_base) * 0.11;
                let neto = parseFloat(p.sueldo_base) - descLey;
                await c.query(`INSERT INTO planilla_detalles (planilla_id, personal_id, sueldo_bruto, descuento_ley, sueldo_neto) VALUES ($1, $2, $3, $4, $5)`, [planillaId, p.id, p.sueldo_base, descLey, neto]);
            }
        }
        await c.query('COMMIT'); res.json({ success: true });
    } catch (e) { await c.query('ROLLBACK'); res.status(500).json({ success: false, error: e.message }); } finally { c.release(); }
});

app.get('/planillas/:periodo', async (req, res) => { 
    try { const r = await pool.query(`SELECT pd.*, p.dni, p.nombres, p.apellidos, p.cargo, p.tipo_seguro, pl.estado as planilla_estado FROM planilla_detalles pd JOIN personal p ON pd.personal_id = p.id JOIN planillas pl ON pd.planilla_id = pl.id WHERE pl.periodo=$1 ORDER BY p.apellidos ASC`, [req.params.periodo]); res.json({ success: true, data: r.rows }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } 
});

app.put('/planillas/ajustar/:id_detalle', async (req, res) => { 
    const { id_detalle } = req.params; const { bonos, descuentos_extra, motivo_ajuste } = req.body; 
    try { const det = await pool.query('SELECT sueldo_bruto, descuento_ley FROM planilla_detalles WHERE id=$1', [id_detalle]); const neto = parseFloat(det.rows[0].sueldo_bruto) - parseFloat(det.rows[0].descuento_ley) + parseFloat(bonos) - parseFloat(descuentos_extra); await pool.query(`UPDATE planilla_detalles SET bonos=$1, descuentos_extra=$2, motivo_ajuste=$3, sueldo_neto=$4 WHERE id=$5`, [bonos, descuentos_extra, motivo_ajuste, neto, id_detalle]); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } 
});

app.post('/planillas/pagar-todo', async (req, res) => { 
    const { periodo } = req.body; const c = await pool.connect(); 
    try { await c.query('BEGIN'); const plan = await c.query(`UPDATE planillas SET estado='PAGADO' WHERE periodo=$1 RETURNING id`, [periodo]); if (plan.rows.length === 0) throw new Error('Planilla no encontrada'); const pId = plan.rows[0].id; const sum = await c.query(`SELECT SUM(sueldo_neto) as total FROM planilla_detalles WHERE planilla_id=$1`, [pId]); await c.query(`UPDATE planillas SET total_pagado=$1 WHERE id=$2`, [sum.rows[0].total, pId]); await c.query(`UPDATE planilla_detalles SET estado_pago='PAGADO', fecha_pago=NOW() WHERE planilla_id=$1`, [pId]); await c.query('COMMIT'); res.json({ success: true }); } catch (e) { await c.query('ROLLBACK'); res.status(500).json({ success: false, error: e.message }); } finally { c.release(); } 
});

app.put('/planillas/pagar-uno/:id_detalle', async (req, res) => { 
    const { id_detalle } = req.params; 
    try { await pool.query(`UPDATE planilla_detalles SET estado_pago='PAGADO', fecha_pago=NOW() WHERE id=$1`, [id_detalle]); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } 
});

// ==========================================
// 5. SEGURIDAD, LOGIN Y USUARIOS
// ==========================================
app.post('/login', async (req, res) => {
    const { usuario, password } = req.body;
    try {
        const r = await pool.query('SELECT id, nombre_completo, usuario, rol, estado FROM usuarios WHERE usuario = $1 AND password = $2', [usuario, password]);
        if (r.rows.length > 0) {
            if (r.rows[0].estado !== 'ACTIVO') return res.status(401).json({ success: false, error: 'Usuario inhabilitado por administración.' });
            res.json({ success: true, data: r.rows[0] });
        } else res.status(401).json({ success: false, error: 'Usuario o contraseña incorrectos.' });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/usuarios', async (req, res) => {
    try { const r = await pool.query("SELECT id, nombre_completo, usuario, rol, estado FROM usuarios ORDER BY id ASC"); res.json({ success: true, data: r.rows }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/usuarios', async (req, res) => {
    const b = req.body;
    try { const r = await pool.query(`INSERT INTO usuarios (nombre_completo, usuario, password, rol, estado) VALUES ($1, $2, $3, $4, $5) RETURNING id, nombre_completo, usuario, rol, estado`, [b.nombre_completo.toUpperCase(), b.usuario, b.password, b.rol, b.estado]); res.json({ success: true, data: r.rows[0] }); } catch (e) { res.status(500).json({ success: false, error: 'El nombre de usuario ya existe o hay un error.' }); }
});

app.put('/usuarios/:id', async (req, res) => {
    const { id } = req.params; const b = req.body;
    try { 
        let query = 'UPDATE usuarios SET nombre_completo=$1, usuario=$2, rol=$3, estado=$4 WHERE id=$5 RETURNING id, nombre_completo, usuario, rol, estado';
        let params = [b.nombre_completo.toUpperCase(), b.usuario, b.rol, b.estado, id];
        if (b.password && b.password.trim() !== '') {
            query = 'UPDATE usuarios SET nombre_completo=$1, usuario=$2, password=$3, rol=$4, estado=$5 WHERE id=$6 RETURNING id, nombre_completo, usuario, rol, estado';
            params = [b.nombre_completo.toUpperCase(), b.usuario, b.password, b.rol, b.estado, id];
        }
        const r = await pool.query(query, params); res.json({ success: true, data: r.rows[0] }); 
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ==========================================
// 6. CAJA DIARIA Y CIERRES (DASHBOARD)
// ==========================================
app.get('/caja-diaria/resumen', async (req, res) => {
    const { desde, hasta } = req.query;
    try {
        const [pensiones, ventas, egresos, detPensiones, detVentas, detEgresos] = await Promise.all([
            pool.query(`SELECT COALESCE(SUM(monto), 0) as total FROM pensiones WHERE estado='PAGADO' AND fecha_pago >= $1 AND fecha_pago <= $2`, [desde, hasta]),
            pool.query(`SELECT COALESCE(SUM(total), 0) as total FROM ventas WHERE (fecha_venta - INTERVAL '5 hours')::date >= $1 AND (fecha_venta - INTERVAL '5 hours')::date <= $2`, [desde, hasta]),
            pool.query(`SELECT COALESCE(SUM(monto), 0) as total FROM egresos WHERE fecha >= $1 AND fecha <= $2`, [desde, hasta]),
            pool.query(`SELECT p.id, p.monto, p.concepto, p.fecha_pago, a.nombres, a.apellidos FROM pensiones p JOIN alumnos a ON p.alumno_id = a.id WHERE p.estado='PAGADO' AND p.fecha_pago >= $1 AND p.fecha_pago <= $2 ORDER BY p.fecha_pago DESC`, [desde, hasta]),
            pool.query(`SELECT id, total, fecha_venta, comprador_nombre FROM ventas WHERE (fecha_venta - INTERVAL '5 hours')::date >= $1 AND (fecha_venta - INTERVAL '5 hours')::date <= $2 ORDER BY fecha_venta DESC`, [desde, hasta]),
            pool.query(`SELECT id, monto, concepto, fecha, registrado_por FROM egresos WHERE fecha >= $1 AND fecha <= $2 ORDER BY fecha DESC`, [desde, hasta])
        ]);
        
        const totalIngresos = parseFloat(pensiones.rows[0].total) + parseFloat(ventas.rows[0].total);
        const totalEgresos = parseFloat(egresos.rows[0].total);
        const saldo = totalIngresos - totalEgresos;

        res.json({ success: true, data: { ingresos_pensiones: parseFloat(pensiones.rows[0].total), ingresos_tienda: parseFloat(ventas.rows[0].total), total_ingresos: totalIngresos, total_egresos: totalEgresos, saldo_efectivo: saldo, lista_pensiones: detPensiones.rows, lista_ventas: detVentas.rows, lista_egresos: detEgresos.rows } });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/egresos', async (req, res) => {
    const b = req.body; try { const r = await pool.query(`INSERT INTO egresos (concepto, monto, fecha, comprobante, registrado_por) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [b.concepto, b.monto, b.fecha, b.comprobante, b.registrado_por]); res.json({ success: true, data: r.rows[0] }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/egresos', async (req, res) => {
    const { desde, hasta } = req.query; try { const r = await pool.query(`SELECT * FROM egresos WHERE fecha >= $1 AND fecha <= $2 ORDER BY fecha DESC, id DESC`, [desde, hasta]); res.json({ success: true, data: r.rows }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/cierres-caja', async (req, res) => {
    const b = req.body; try { const r = await pool.query(`INSERT INTO cierres_caja (fecha_inicio, fecha_fin, total_ingresos, total_egresos, saldo_efectivo, entregado_a, firma_digital) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`, [b.fecha_inicio, b.fecha_fin, b.total_ingresos, b.total_egresos, b.saldo_efectivo, b.entregado_a, b.firma_digital]); res.json({ success: true, data: r.rows[0] }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/cierres-caja', async (req, res) => {
    try { const r = await pool.query(`SELECT * FROM cierres_caja ORDER BY fecha_cierre DESC`); res.json({ success: true, data: r.rows }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.listen(PORT, () => { console.log(`🚀 Servidor ERP encendido en el puerto ${PORT}...`); });
