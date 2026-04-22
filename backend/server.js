const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3009;

// --- LOGGING ---
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// --- SÉCURITÉ RÉSEAU ---
app.use(helmet()); // Protège les en-têtes HTTP
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Limiter les tentatives de connexion (Brute Force Protection)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Max 10 tentatives par IP
  message: { success: false, message: "Trop de tentatives de connexion. Réessayez dans 15 minutes." }
});

app.use('/api/login', loginLimiter);

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
        avatar TEXT,
        aptitude_medicale BOOLEAN DEFAULT true,
        epis JSONB NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS caisses (
        id SERIAL PRIMARY KEY,
        numero_caisse VARCHAR(100) UNIQUE NOT NULL,
        affecter_a VARCHAR(200),
        materiels JSONB NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS projets (
        id SERIAL PRIMARY KEY,
        nom_chantier VARCHAR(200) NOT NULL,
        lieu VARCHAR(200) NOT NULL,
        date_debut VARCHAR(100),
        outillage_caisse VARCHAR(100),
        responsable_chantier VARCHAR(200),
        epc JSONB NOT NULL DEFAULT '{}',
        intervenants JSONB NOT NULL DEFAULT '[]',
        date_creation VARCHAR(100)
      );
    `);
    
    // Auto-migration (add column if missing)
    try {
      await pool.query('ALTER TABLE employees ADD COLUMN aptitude_medicale BOOLEAN DEFAULT true');
    } catch(e) {}
    try {
      await pool.query('ALTER TABLE employees ADD COLUMN epis JSONB DEFAULT \'{}\'');
    } catch(e) {}
    
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

app.delete('/api/accounts', async (req, res) => {
  const { email } = req.query;
  try {
    await pool.query('DELETE FROM accounts WHERE email = $1', [email]);
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
      lastName: r.last_name,
      aptitudeMedicale: r.aptitude_medicale,
      epis: r.epis || {}
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
        SET first_name=$1, last_name=$2, name=$3, role=$4, departement=$5, compliance=$6, status=$7, certifications=$8, avatar=$9, aptitude_medicale=$11, epis=$12
        WHERE matricule=$10
      `, [emp.firstName, emp.lastName, emp.name, emp.role, emp.departement, emp.compliance, emp.status, JSON.stringify(emp.certifications), emp.avatar, emp.matricule, emp.aptitudeMedicale ?? true, JSON.stringify(emp.epis || {})]);
    } else {
      // Insert
      await pool.query(`
        INSERT INTO employees (matricule, first_name, last_name, name, role, departement, compliance, status, certifications, avatar, aptitude_medicale, epis)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [emp.matricule, emp.firstName, emp.lastName, emp.name, emp.role, emp.departement, emp.compliance, emp.status, JSON.stringify(emp.certifications), emp.avatar, emp.aptitudeMedicale ?? true, JSON.stringify(emp.epis || {})]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/employees', async (req, res) => {
  const { matricule } = req.query;
  try {
    await pool.query('DELETE FROM employees WHERE matricule = $1', [matricule]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Gestion des Caisses
app.get('/api/caisses', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM caisses ORDER BY id DESC');
    const formatted = result.rows.map(r => ({
      numeroCaisse: r.numero_caisse,
      affecterA: r.affecter_a,
      materiels: r.materiels || []
    }));
    res.json({ success: true, caisses: formatted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/caisses', async (req, res) => {
  const caisse = req.body;
  try {
    const check = await pool.query('SELECT id FROM caisses WHERE numero_caisse = $1', [caisse.numeroCaisse]);
    if (check.rows.length > 0) {
      await pool.query(`
        UPDATE caisses 
        SET affecter_a=$1, materiels=$2
        WHERE numero_caisse=$3
      `, [caisse.affecterA, JSON.stringify(caisse.materiels || []), caisse.numeroCaisse]);
    } else {
      await pool.query(`
        INSERT INTO caisses (numero_caisse, affecter_a, materiels)
        VALUES ($1, $2, $3)
      `, [caisse.numeroCaisse, caisse.affecterA, JSON.stringify(caisse.materiels || [])]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/caisses', async (req, res) => {
  const { numeroCaisse } = req.query;
  try {
    await pool.query('DELETE FROM caisses WHERE numero_caisse = $1', [numeroCaisse]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Gestion des Projets
app.get('/api/projets', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM projets ORDER BY id DESC');
    const formatted = result.rows.map(r => ({
      ...r,
      nomChantier: r.nom_chantier,
      dateDebut: r.date_debut,
      outillageCaisse: r.outillage_caisse,
      responsableChantier: r.responsable_chantier,
      dateCreation: r.date_creation
    }));
    res.json({ success: true, projets: formatted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projets', async (req, res) => {
  const p = req.body;
  try {
    // On utilise le nom du chantier comme identifiant pour l'upsert simplifié ici (ou on pourrait utiliser un id)
    // Pour plus de robustesse, on check si un projet avec le même nom et lieu existe
    const check = await pool.query('SELECT id FROM projets WHERE nom_chantier = $1 AND lieu = $2', [p.nomChantier, p.lieu]);
    if (check.rows.length > 0) {
      await pool.query(`
        UPDATE projets 
        SET date_debut=$1, outillage_caisse=$2, responsable_chantier=$3, epc=$4, intervenants=$5, date_creation=$6
        WHERE nom_chantier=$7 AND lieu=$8
      `, [p.dateDebut, p.outillageCaisse, p.responsableChantier, JSON.stringify(p.epc || {}), JSON.stringify(p.intervenants || []), p.dateCreation, p.nomChantier, p.lieu]);
    } else {
      await pool.query(`
        INSERT INTO projets (nom_chantier, lieu, date_debut, outillage_caisse, responsable_chantier, epc, intervenants, date_creation)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [p.nomChantier, p.lieu, p.dateDebut, p.outillageCaisse, p.responsableChantier, JSON.stringify(p.epc || {}), JSON.stringify(p.intervenants || []), p.dateCreation]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projets', async (req, res) => {
  const { nomChantier } = req.query;
  try {
    await pool.query('DELETE FROM projets WHERE nom_chantier = $1', [nomChantier]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.listen(port, () => {
  console.log(`Backend HSE Passport API running on port ${port} `);
});
