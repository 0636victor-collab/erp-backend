// 1. Ruta para buscar alumno por DNI y calcular su estado
app.get('/alumnos/:dni', async (req, res) => {
    try {
        const { dni } = req.params;
        const result = await pool.query('SELECT * FROM alumnos WHERE dni = $1', [dni]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Alumno no encontrado en la base de datos." });
        }

        const alumno = result.rows.length > 0 ? result.rows[0] : null;
        
        // Aquí puedes conectar también la consulta de pagos reales si ya creaste la tabla de transacciones
        res.json({
            dni: alumno.dni,
            nombres: alumno.nombres,
            apellidos: alumno.apellidos,
            grado: alumno.grado,
            deudaTotal: "350.00" // O puedes calcularlo dinámicamente desde tu base de datos
        });
    } catch (err) {
        console.error(err);
        res.status(500.json({ error: "Error interno del servidor." }));
    }
});

// 2. Ruta para registrar un pago de pensión
app.post('/pagos', async (req, res) => {
    try {
        const { codigo_operacion, dni_alumno, nombre_alumno, total_pagado, metodo_pago, usuario_cajero } = req.body;
        
        const query = `
            INSERT INTO transacciones_caja (codigo_operacion, dni_alumno, nombre_alumno, total_pagado, metodo_pago, usuario_cajero)
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
        `;
        const values = [codigo_operacion, dni_alumno, nombre_alumno, total_pagado, metodo_pago, usuario_cajero];
        
        const newTransaccion = await pool.query(query, values);
        res.json({ success: true, mensaje: "Pago registrado exitosamente en la nube", transaccion: newTransaccion.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error al registrar el pago en la base de datos." });
    }
});


// ==========================================
// 4. RUTAS DEL MÓDULO DE ESTUDIANTES
// ==========================================

// Registrar un Alumno
app.post('/alumnos', async (req, res) => {
    try {
        const { dni, nombres, apellidos, contacto_emergencia } = req.body;
        
        const nuevoAlumno = await pool.query(
            'INSERT INTO alumnos (dni, nombres, apellidos, contacto_emergencia) VALUES ($1, $2, $3, $4) RETURNING *',
            [dni, nombres, apellidos, contacto_emergencia]
        );
        
        res.json({ 
            mensaje: '¡Alumno registrado con éxito, mi rey!', 
            alumno: nuevoAlumno.rows[0] 
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al registrar alumno en la BD' });
    }
});

// Obtener los grados existentes (Filtro dinámico)
app.get('/grados', async (req, res) => {
    try {
        const result = await pool.query('SELECT DISTINCT grado FROM alumnos WHERE grado IS NOT NULL ORDER BY grado');
        res.json(result.rows.map(r => r.grado));
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener grados' });
    }
});

// Listar, Filtrar, Buscar y Paginar Alumnos
app.get('/alumnos', async (req, res) => {
    try {
        const { busqueda = '', grado = '', limite = 10, pagina = 1 } = req.query;
        const offset = (pagina - 1) * limite;

        let query = 'SELECT * FROM alumnos WHERE 1=1';
        let values = [];
        let countQuery = 'SELECT COUNT(*) FROM alumnos WHERE 1=1';
        let countValues = [];
        let paramIndex = 1;

        if (busqueda) {
            query += ` AND (nombres ILIKE $${paramIndex} OR apellidos ILIKE $${paramIndex} OR dni ILIKE $${paramIndex})`;
            countQuery += ` AND (nombres ILIKE $${paramIndex} OR apellidos ILIKE $${paramIndex} OR dni ILIKE $${paramIndex})`;
            values.push(`%${busqueda}%`);
            countValues.push(`%${busqueda}%`);
            paramIndex++;
        }

        if (grado) {
            query += ` AND grado = $${paramIndex}`;
            countQuery += ` AND grado = $${paramIndex}`;
            values.push(grado);
            countValues.push(grado);
            paramIndex++;
        }

        query += ` ORDER BY id DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        values.push(limite, offset);

        const listado = await pool.query(query, values);
        const totalResult = await pool.query(countQuery, countValues);
        const total = parseInt(totalResult.rows[0].count);

        res.json({
            data: listado.rows,
            total: total,
            pagina: parseInt(pagina),
            limite: parseInt(limite)
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener los alumnos' });
    }
});

// ==========================================
// 5. RUTAS DEL MÓDULO DE CAJA Y PENSIONES
// ==========================================

// Buscar Alumno y sus Pensiones por DNI
app.get('/api/pensiones/:dni', async (req, res) => {
    try {
        const { dni } = req.params;
        
        // Búsqueda flexible para evitar errores de espacios o coincidencia exacta
        const alumnoRes = await pool.query('SELECT * FROM alumnos WHERE dni ILIKE $1', [dni.trim()]);
        
        if (alumnoRes.rows.length === 0) {
            return res.status(404).json({ error: "Estudiante no encontrado con ese DNI." });
        }

        const alumno = alumnoRes.rows[0];

        res.json({
            alumno: alumno,
            pensiones: [
                { id: 1, concepto: "Matrícula 2026", vencimiento: "15/01/2026", monto: 350.00, estado: "PAGADO" },
                { id: 2, concepto: "Pensión Marzo", vencimiento: "31/03/2026", monto: 350.00, estado: "PAGADO" },
                { id: 3, concepto: "Pensión Abril", vencimiento: "30/04/2026", monto: 350.00, estado: "VENCIDO" },
                { id: 4, concepto: "Pensión Mayo", vencimiento: "31/05/2026", monto: 350.00, estado: "PENDIENTE" }
            ]
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).send("Error en el servidor");
    }
});

// Registrar el Pago de una Pensión
app.post('/api/cobrar', async (req, res) => {
    try {
        const { dni_alumno, concepto, monto, metodo_pago, cajero } = req.body;

        const codigoOp = `TK-2026-${Math.floor(1000 + Math.random() * 9000)}`;

        const nuevaTransaccion = await pool.query(
            `INSERT INTO transacciones_caja (codigo_operacion, dni_alumno, nombre_alumno, total_pagado, metodo_pago, usuario_cajero) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [codigoOp, dni_alumno, "Estudiante Encontrado", monto, metodo_pago, cajero]
        );

        res.json({ 
            mensaje: "¡Pago registrado con éxito y boleta generada!", 
            transaccion: nuevaTransaccion.rows[0] 
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).send("Error al procesar el pago");
    }
});

// ==========================================
// 6. RUTA DE ESTADO (HEALTH CHECK)
// ==========================================
app.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW()');
        res.json({
            mensaje: '¡Bienvenido al Sistema Escolar API!',
            estado_bd: 'Conectada exitosamente',
            hora_servidor: result.rows[0].now
        });
    } catch (error) {
        res.status(500).json({ error: 'Error conectando a la base de datos' });
    }
});

// ==========================================
// 7. ENCENDER EL SERVIDOR
// ==========================================
const PUERTO = process.env.PORT || 3000;
app.listen(PUERTO, () => {
    console.log(`🚀 Servidor corriendo a toda máquina en el puerto ${PUERTO}`);
    console.log(`🔗 Puedes probarlo abriendo: http://localhost:${PUERTO}`);
});
