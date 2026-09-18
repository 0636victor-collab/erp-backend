const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const pool = new Pool({
    user: process.env.DB_USER, 
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST, 
    port: process.env.DB_PORT,
    database: process.env.DB_DATABASE, 
    ssl: { rejectUnauthorized: false }
});

// Prueba de conexión "Blindada" para que no se apague la consola
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Error conectando a Supabase. Revisa tu archivo .env:', err.message);
    } else {
        console.log('✅ Base de datos Supabase conectada con éxito.');
        release();
    }
});

// ==========================================
// 1. MATRÍCULAS
// ==========================================
app.get('/alumnos', async (req, res) => {
    try { const r = await pool.query('SELECT * FROM alumnos ORDER BY grado ASC, seccion ASC, apellidos ASC'); res.json({ success: true, data: r.rows }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/alumnos/:id', async (req, res) => {
    const { id } = req.params; const b = req.body;
    try {
        const r = await pool.query(`UPDATE alumnos SET dni=$1, apellidos=$2, nombres=$3, grado=$4, seccion=$5, estado=$6, utiles_completos=$7, direccion=$8, obs=$9, papa_nombre=$10, papa_celular=$11, mama_nombre=$12, mama_celular=$13, apoderado_dni=$14, pension_base=$15 WHERE id=$16 RETURNING *;`, [b.dni, b.apellidos, b.nombres, b.grado, b.seccion, b.estado, b.utiles_completos, b.direccion, b.obs, b.papa_nombre, b.papa_celular, b.mama_nombre, b.mama_celular, b.apoderado_dni, b.pension_base, id]);
        if (b.pension_base) await pool.query(`UPDATE pensiones SET monto=$1 WHERE alumno_id=$2 AND estado='PENDIENTE' AND concepto NOT ILIKE '%MATRÍCULA%'`, [b.pension_base, id]);
        res.json({ success: true, data: r.rows[0] });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ==========================================
// 2. CAJA (PENSIONES)
// ==========================================
app.get('/caja/estado-cuenta', async (req, res) => {
    try {
        const r = await pool.query(`SELECT a.id, a.dni, a.nombres, a.apellidos, a.grado, a.seccion, COALESCE(a.papa_celular, a.mama_celular, '') as celular_contacto, COALESCE(json_agg(p.* ORDER BY p.fecha_vencimiento ASC) FILTER (WHERE p.id IS NOT NULL), '[]') as recibos FROM alumnos a LEFT JOIN pensiones p ON a.id=p.alumno_id GROUP BY a.id ORDER BY a.grado, a.seccion, a.apellidos;`);
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
    const b = req.body; try { const r = await pool.query(`INSERT INTO productos (categoria, nombre, precio, stock, tipo) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [b.categoria.toUpperCase(), b.nombre, b.precio, b.stock, b.tipo]); res.json({ success: true, data: r.rows[0] }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/productos/:id', async (req, res) => {
    const { id } = req.params; const b = req.body; try { const r = await pool.query(`UPDATE productos SET categoria=$1, nombre=$2, precio=$3, stock=$4, tipo=$5 WHERE id=$6 RETURNING *`, [b.categoria.toUpperCase(), b.nombre, b.precio, b.stock, b.tipo, id]); res.json({ success: true, data: r.rows[0] }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/ventas', async (req, res) => {
    const b = req.body; const c = await pool.connect();
    try {
        await c.query('BEGIN');
        for (let i of b.carrito) { const p = await c.query('SELECT stock, nombre, tipo FROM productos WHERE id=$1 FOR UPDATE', [i.id]); if (p.rows[0].tipo==='FISICO' && p.rows[0].stock<i.cantidad) throw new Error(`Stock insuficiente: ${p.rows[0].nombre}.`); }
        const rV = await c.query(`INSERT INTO ventas (alumno_id, comprador_dni, comprador_nombre, comprador_celular, total, metodo_pago, nro_operacion) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, fecha_venta`, [b.alumno_id || null, b.comprador_dni||'', b.comprador_nombre||'', b.comprador_celular||'', b.total, b.metodo_pago, b.nro_operacion]);
        for (let i of b.carrito) {
            await c.query(`INSERT INTO ventas_detalle (venta_id, producto_id, nombre_producto, cantidad, precio_unitario, precio_original, motivo_descuento, subtotal) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [rV.rows[0].id, i.id, i.nombre, i.cantidad, i.precio, i.precio_original, i.motivo_descuento||'', i.cantidad*i.precio]);
            if (i.tipo==='FISICO') await c.query('UPDATE productos SET stock=stock-$1 WHERE id=$2', [i.cantidad, i.id]);
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
        if (pN.rows[0].tipo==='FISICO' && pN.rows[0].stock<cantidad) throw new Error(`Stock insuficiente: ${pN.rows[0].nombre}`);
        await c.query('UPDATE productos SET stock=stock+$1 WHERE id=$2 AND tipo=\'FISICO\'', [cantidad, producto_devuelto_id]);
        await c.query('UPDATE productos SET stock=stock-$1 WHERE id=$2 AND tipo=\'FISICO\'', [cantidad, producto_entregado_id]);
        await c.query('COMMIT'); res.json({ success: true });
    } catch (e) { await c.query('ROLLBACK'); res.status(400).json({ success: false, error: e.message }); } finally { c.release(); }
});

// ==========================================
// 4. RRHH Y GASTOS (CON LEYES ONP/AFP)
// ==========================================
app.get('/personal', async (req, res) => { try { const r = await pool.query("SELECT * FROM personal ORDER BY estado ASC, apellidos ASC"); res.json({ success: true, data: r.rows }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } });

app.post('/personal', async (req, res) => { const b = req.body; try { const r = await pool.query(`INSERT INTO personal (dni, nombres, apellidos, cargo, sueldo_base, tipo_seguro) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [b.dni, b.nombres.toUpperCase(), b.apellidos.toUpperCase(), b.cargo.toUpperCase(), b.sueldo_base, b.tipo_seguro]); res.json({ success: true, data: r.rows[0] }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } });

app.put('/personal/:id', async (req, res) => { const { id } = req.params; const b = req.body; try { const r = await pool.query(`UPDATE personal SET dni=$1, nombres=$2, apellidos=$3, cargo=$4, sueldo_base=$5, tipo_seguro=$6, estado=$7 WHERE id=$8 RETURNING *`, [b.dni, b.nombres.toUpperCase(), b.apellidos.toUpperCase(), b.cargo.toUpperCase(), b.sueldo_base, b.tipo_seguro, b.estado, id]); res.json({ success: true, data: r.rows[0] }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } });

app.get('/gastos', async (req, res) => { try { const r = await pool.query("SELECT * FROM gastos ORDER BY fecha_gasto DESC"); res.json({ success: true, data: r.rows }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } });

app.post('/gastos', async (req, res) => { const b = req.body; try { const r = await pool.query(`INSERT INTO gastos (categoria, descripcion, monto, nro_comprobante) VALUES ($1, $2, $3, $4) RETURNING *`, [b.categoria, b.descripcion, b.monto, b.nro_comprobante]); res.json({ success: true, data: r.rows[0] }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } });

app.post('/planillas/generar', async (req, res) => {
    const { periodo } = req.body; const c = await pool.connect();
    try {
        await c.query('BEGIN');
        let plan = await c.query('SELECT * FROM planillas WHERE periodo=$1', [periodo]); let planillaId;
        if (plan.rows.length > 0) { planillaId = plan.rows[0].id; } else { const ins = await c.query('INSERT INTO planillas (periodo) VALUES ($1) RETURNING id', [periodo]); planillaId = ins.rows[0].id; }
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

app.get('/planillas/:periodo', async (req, res) => { try { const r = await pool.query(`SELECT pd.*, p.dni, p.nombres, p.apellidos, p.cargo, p.tipo_seguro, pl.estado as planilla_estado FROM planilla_detalles pd JOIN personal p ON pd.personal_id = p.id JOIN planillas pl ON pd.planilla_id = pl.id WHERE pl.periodo=$1 ORDER BY p.apellidos ASC`, [req.params.periodo]); res.json({ success: true, data: r.rows }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } });

app.put('/planillas/ajustar/:id_detalle', async (req, res) => { const { id_detalle } = req.params; const { bonos, descuentos_extra, motivo_ajuste } = req.body; try { const det = await pool.query('SELECT sueldo_bruto, descuento_ley FROM planilla_detalles WHERE id=$1', [id_detalle]); const neto = parseFloat(det.rows[0].sueldo_bruto) - parseFloat(det.rows[0].descuento_ley) + parseFloat(bonos) - parseFloat(descuentos_extra); await pool.query(`UPDATE planilla_detalles SET bonos=$1, descuentos_extra=$2, motivo_ajuste=$3, sueldo_neto=$4 WHERE id=$5`, [bonos, descuentos_extra, motivo_ajuste, neto, id_detalle]); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } });

app.post('/planillas/pagar-todo', async (req, res) => { const { periodo } = req.body; const c = await pool.connect(); try { await c.query('BEGIN'); const plan = await c.query(`UPDATE planillas SET estado='PAGADO' WHERE periodo=$1 RETURNING id`, [periodo]); if (plan.rows.length === 0) throw new Error('Planilla no encontrada'); const pId = plan.rows[0].id; const sum = await c.query(`SELECT SUM(sueldo_neto) as total FROM planilla_detalles WHERE planilla_id=$1`, [pId]); await c.query(`UPDATE planillas SET total_pagado=$1 WHERE id=$2`, [sum.rows[0].total, pId]); await c.query(`UPDATE planilla_detalles SET estado_pago='PAGADO', fecha_pago=NOW() WHERE planilla_id=$1`, [pId]); await c.query('COMMIT'); res.json({ success: true }); } catch (e) { await c.query('ROLLBACK'); res.status(500).json({ success: false, error: e.message }); } finally { c.release(); } });

app.put('/planillas/pagar-uno/:id_detalle', async (req, res) => { const { id_detalle } = req.params; try { await pool.query(`UPDATE planilla_detalles SET estado_pago='PAGADO', fecha_pago=NOW() WHERE id=$1`, [id_detalle]); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } });

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
        } else {
            res.status(401).json({ success: false, error: 'Usuario o contraseña incorrectos.' });
        }
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
        const r = await pool.query(query, params); 
        res.json({ success: true, data: r.rows[0] }); 
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor ERP encendido y esperando conexiones en el puerto ${PORT}...`);
});