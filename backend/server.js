const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3009;

// Middleware : on augmente la limite à 10mb pour gérer les photos (avatars en base64)
app.use(cors());
app.use(express.json({ limit: '10mb' })); 

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Initialise et crée les tables au démarrage
const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL
      );
      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        matricule VARCHAR(50) UNIQUE NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        name VARCHAR(200) NOT NULL,
        role VARCHAR(100) NOT NULL,
        departement VARCHAR(100) NOT NULL,
        compliance INTEGER NOT NULL,
        status VARCHAR(50) NOT NULL,
        certifications JSONB NOT NULL DEFAULT '[]',
        avatar TEXT
      );
    `);
    
    // Inject default initial admin
    const adminCheck = await pool.query('SELECT * FROM accounts WHERE email = $1', ['admin@madagreen.com']);
    if (adminCheck.rows.length === 0) {
      await pool.query(`INSERT INTO accounts (email, password, role) VALUES ('admin@madagreen.com', 'admin', 'Admin')`);
      await pool.query(`INSERT INTO accounts (email, password, role) VALUES ('visiteur@madagreen.com', 'visit', 'Visiteur')`);
    }
    console.log("Database tables initialized successfully !");
  } catch (err) {
    console.error("Error initializing database tables:", err);
  }
};
initDB();

// --- API ROUTES ---

// 1. Authentification
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT email, role FROM accounts WHERE email = $1 AND password = $2', [email, password]);
    if (result.rows.length > 0) {
      res.json({ success: true, account: result.rows[0] });
    } else {
      res.status(401).json({ success: false, message: 'Identifiants invalides' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Gestion des Comptes
app.get('/api/accounts', async (req, res) => {
  try {
    const result = await pool.query('SELECT email, role FROM accounts');
    res.json({ success: true, accounts: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/accounts', async (req, res) => {
  const { email, password, role } = req.body;
  try {
    await pool.query('INSERT INTO accounts (email, password, role) VALUES ($1, $2, $3)', [email, password, role]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Cet email existe peut-être déjà' });
  }
});

app.delete('/api/accounts/:email', async (req, res) => {
  try {
    await pool.query('DELETE FROM accounts WHERE email = $1', [req.params.email]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Gestion des Employés
app.get('/api/employees', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM employees ORDER BY id DESC');
    // Renommage camelCase pour correspondre exactement à l'attente du Frontend actuel
    const formatted = result.rows.map(r => ({
      ...r,
      firstName: r.first_name,
      lastName: r.last_name
    }));
    res.json({ success: true, employees: formatted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/employees', async (req, res) => {
  const emp = req.body;
  try {
    const check = await pool.query('SELECT id FROM employees WHERE matricule = $1', [emp.matricule]);
    if (check.rows.length > 0) {
      // Update
      await pool.query(`
        UPDATE employees 
        SET first_name=$1, last_name=$2, name=$3, role=$4, departement=$5, compliance=$6, status=$7, certifications=$8, avatar=$9
        WHERE matricule=$10
      `, [emp.firstName, emp.lastName, emp.name, emp.role, emp.departement, emp.compliance, emp.status, JSON.stringify(emp.certifications), emp.avatar, emp.matricule]);
    } else {
      // Insert
      await pool.query(`
        INSERT INTO employees (matricule, first_name, last_name, name, role, departement, compliance, status, certifications, avatar)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [emp.matricule, emp.firstName, emp.lastName, emp.name, emp.role, emp.departement, emp.compliance, emp.status, JSON.stringify(emp.certifications), emp.avatar]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/employees/:matricule', async (req, res) => {
  try {
    await pool.query('DELETE FROM employees WHERE matricule = $1', [req.params.matricule]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Backend HSE Passport API running on port ${port} `);
});
