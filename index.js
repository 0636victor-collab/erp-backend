const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de la conexión a Supabase usando las variables de entorno
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 6543,
    ssl: {
        rejectUnauthorized: false
    }
});

// Middleware para permitir recibir datos en formato JSON y conectar con frontend
app.use(express.json());
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// 1. Ruta de prueba principal para verificar que el servidor vive
app.get('/', (req, res) => {
    res.send('🚀 API del ERP Escolar - I.E.P. La Misión de Jesús funcionando al 100%');
});

// 2. Ruta para buscar alumno por DNI (Consulta real a Supabase)
app.get('/alumnos/:dni', async (req, res) => {
    try {
        const { dni } = req.params;
        const result = await pool.query('SELECT * FROM alumnos WHERE dni = $1', [dni]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Alumno no encontrado en la base de datos." });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error("Error al consultar alumno:", err);
        res.status(500).json({ error: "Error interno del servidor." });
    }
});

// 3. Ruta para registrar un nuevo alumno con todos sus detalles (Ficha de Matrícula)
app.post('/alumnos', async (req, res) => {
    try {
        const { 
            dni, nombres, apellido_paterno, apellido_materno, genero, 
            fecha_nacimiento, fecha_ingreso, grado, seccion, direccion, 
            alergias, tipo_sangre, vinculo_responsable, dni_responsable, 
            nombres_responsable, celular_responsable, email_responsable, foto_url 
        } = req.body;

        const query = `
            INSERT INTO alumnos (
                dni, nombres, apellido_paterno, apellido_materno, genero, 
                fecha_nacimiento, fecha_ingreso, grado, seccion, direccion, 
                alergias, tipo_sangre, vinculo_responsable, dni_responsable, 
                nombres_responsable, celular_responsable, email_responsable, foto_url
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) 
            RETURNING *;
        `;

        const values = [
            dni, nombres, apellido_paterno, apellido_materno, genero, 
            fecha_nacimiento || null, fecha_ingreso, grado, seccion, direccion, 
            alergias, tipo_sangre, vinculo_responsable, dni_responsable, 
            nombres_responsable, celular_responsable, email_responsable, foto_url
        ];

        const nuevoAlumno = await pool.query(query, values);
        res.json({ success: true, mensaje: "Alumno registrado con éxito", alumno: nuevoAlumno.rows[0] });
    } catch (err) {
        console.error("Error al registrar alumno:", err);
        res.status(500).json({ error: "Error al registrar el alumno en la base de datos." });
    }
});

// 4. Ruta para registrar pagos de pensiones en la base de datos
app.post('/pagos', async (req, res) => {
    try {
        const { codigo_operacion, dni_alumno, nombre_alumno, concepto, total_pagado, metodo_pago, usuario_cajero } = req.body;
        
        const query = `
            INSERT INTO transacciones_caja (codigo_operacion, dni_alumno, nombre_alumno, concepto, total_pagado, metodo_pago, usuario_cajero)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
        `;
        const values = [codigo_operacion, dni_alumno, nombre_alumno, concepto, total_pagado, metodo_pago, usuario_cajero];
        
        const newTransaccion = await pool.query(query, values);
        res.json({ success: true, mensaje: "Pago registrado exitosamente", transaccion: newTransaccion.rows[0] });
    } catch (err) {
        console.error("Error al registrar pago:", err);
        res.status(500).json({ error: "Error al registrar el pago en la base de datos." });
    }
});

// 5. Ruta para consultar los pagos realizados por DNI de alumno
app.get('/pagos/:dni', async (req, res) => {
    try {
        const { dni } = req.params;
        const result = await pool.query('SELECT * FROM transacciones_caja WHERE dni_alumno = $1', [dni]);
        res.json(result.rows);
    } catch (err) {
        console.error("Error al consultar pagos:", err);
        res.status(500).json({ error: "Error al obtener los pagos." });
    }
});

// 6. Ruta para buscar datos de un responsable por su DNI (Autocompletado)
app.get('/responsables/:dni', async (req, res) => {
    try {
        const { dni } = req.params;
        const result = await pool.query(
            'SELECT dni_responsable, nombres_responsable, celular_responsable, email_responsable, vinculo_responsable FROM alumnos WHERE dni_responsable = $1 LIMIT 1', 
            [dni]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Responsable no encontrado previamente." });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error("Error al buscar responsable:", err);
        res.status(500).json({ error: "Error en el servidor." });
    }
});

// Encender el servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo a toda máquina en el puerto ${PORT}`);
});
