import { useState, useEffect } from 'react'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import avatarPlaceholder from './assets/avatar.png'
import logo from './assets/logo.png'
import mgpBg from './assets/mgp_background.jpg'
import './index.css'
import './App.css'

// Constants
const CERTIFICATION_LIST = [
  "Aptitude médicale", "TH - Port Harnais", "HT - BT", "ATEX niv1",
  "Secourisme", "Lutte contre l'incendie", "Sauvetage en Hauteur"
]

const INITIAL_EMPLOYEES = [
  {
    matricule: 'HSE-992-PX', firstName: 'Alexander', lastName: 'Volt', name: 'Alexander Volt', role: 'Senior Safety Auditor', departement: 'Audit Interne', compliance: 100, status: 'Actif', certifications: [
      { name: "Aptitude médicale", dateObtention: "2025-01-10", validite: 1, dateExpiration: "2026-01-10" },
      { name: "Secourisme", dateObtention: "2024-05-20", validite: 2, dateExpiration: "2026-05-20" }
    ]
  },
  {
    matricule: 'HSE-114-TR', firstName: 'Maria', lastName: 'Gonzalez', name: 'Maria Gonzalez', role: 'Ingénieur QSE', departement: 'Qualité', compliance: 100, status: 'Actif', certifications: [
      { name: "TH - Port Harnais", dateObtention: "2024-11-05", validite: 3, dateExpiration: "2027-11-05" }
    ]
  }
]

const INITIAL_ACCOUNTS = [
  { email: 'admin@madagreen.com', password: 'admin', role: 'Admin' },
  { email: 'visiteur@madagreen.com', password: 'visit', role: 'Visiteur' }
]

// Utilities
const isExpired = (date) => date && new Date(date) < new Date()

const calculateCompliance = (certs) => {
  if (!certs || certs.length === 0) return 0
  const valid = certs.filter(c => !isExpired(c.dateExpiration)).length
  return Math.round((valid / certs.length) * 100)
}

const getStatusLabel = (comp) => {
  if (comp >= 90) return 'Actif'
  if (comp >= 60) return 'Attention'
  return 'Critique'
}

function App() {
  const isProd = import.meta.env.MODE === 'production'
  const API_URL = 'http://46.105.75.234:3009/api'
  const DB_PREFIX = import.meta.env.MODE === 'development' ? '_dev' : ''

  // --- States ---
  const [isAuthenticated, setIsAuthenticated] = useState(() => localStorage.getItem(`hse_auth${DB_PREFIX}`) === 'true')
  const [currentUser, setCurrentUser] = useState(() => {
    const saved = localStorage.getItem(`hse_user${DB_PREFIX}`)
    return saved ? JSON.parse(saved) : null
  })
  const [theme, setTheme] = useState(() => localStorage.getItem('hse_theme') || 'dark')

  const [accounts, setAccounts] = useState(() => {
    const saved = localStorage.getItem(`hse_accounts_v1${DB_PREFIX}`)
    return saved ? JSON.parse(saved) : INITIAL_ACCOUNTS
  })

  const [employees, setEmployees] = useState(() => {
    const saved = localStorage.getItem(`hse_employees_v2${DB_PREFIX}`)
    return saved ? JSON.parse(saved) : INITIAL_EMPLOYEES
  })

  const [employeeView, setEmployeeView] = useState('list')
  const [selectedEmployee, setSelectedEmployee] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterDept, setFilterDept] = useState('Tous')
  const [toasts, setToasts] = useState([])

  const [formData, setFormData] = useState({
    firstName: '', lastName: '', matricule: '', role: '', departement: '', certifications: [], avatar: null
  })
  const [draftCert, setDraftCert] = useState({ name: '', dateObtention: '', validite: '', dateExpiration: '' })
  const [newAccountFormData, setNewAccountFormData] = useState({ email: '', password: '', role: 'Visiteur' })

  // Modal State
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, item: null, type: '' })

  // --- Effects ---
  useEffect(() => {
    if (isProd && isAuthenticated) {
      fetch(`${API_URL}/accounts`)
        .then(res => res.json())
        .then(data => data.success && setAccounts(data.accounts))
        .catch(err => console.error("API error:", err))

      fetch(`${API_URL}/employees`)
        .then(res => res.json())
        .then(data => data.success && setEmployees(data.employees))
        .catch(err => console.error("API error:", err))
    }
  }, [isProd, isAuthenticated])

  useEffect(() => {
    localStorage.setItem(`hse_auth${DB_PREFIX}`, isAuthenticated)
  }, [isAuthenticated, DB_PREFIX])

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem(`hse_user${DB_PREFIX}`, JSON.stringify(currentUser))
    } else {
      localStorage.removeItem(`hse_user${DB_PREFIX}`)
    }
  }, [currentUser, DB_PREFIX])

  useEffect(() => {
    if (!isProd) {
      localStorage.setItem(`hse_employees_v2${DB_PREFIX}`, JSON.stringify(employees))
      localStorage.setItem(`hse_accounts_v1${DB_PREFIX}`, JSON.stringify(accounts))
    }
  }, [employees, accounts, isProd, DB_PREFIX])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('hse_theme', theme)
  }, [theme])

  useEffect(() => {
    if (draftCert.dateObtention && draftCert.validite) {
      const date = new Date(draftCert.dateObtention)
      date.setFullYear(date.getFullYear() + Number(draftCert.validite))
      setDraftCert(prev => ({ ...prev, dateExpiration: date.toISOString().split('T')[0] }))
    }
  }, [draftCert.dateObtention, draftCert.validite])

  // --- Handlers ---
  const showToast = (message, type = 'success') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000)
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    const email = e.target.email.value
    const password = e.target.password.value

    if (isProd) {
      try {
        const res = await fetch(`${API_URL}/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        })
        const data = await res.json()
        if (data.success) {
          setCurrentUser(data.account)
          setIsAuthenticated(true)
          showToast(`Connexion API réussie (${data.account.role})`)
        } else {
          showToast(data.message || "Identifiants invalides", "danger")
        }
      } catch (err) {
        showToast("Erreur de connexion Serveur / Base de données", "danger")
      }
    } else {
      const account = accounts.find(a => a.email === email && a.password === password)
      if (account) {
        setCurrentUser(account)
        setIsAuthenticated(true)
        showToast(`Connexion locale (${account.role})`)
      } else {
        showToast("Email ou mot de passe incorrect", "danger")
      }
    }
  }

  const handleAccountCreate = async (e) => {
    e.preventDefault()
    if (accounts.some(a => a.email === newAccountFormData.email)) {
      showToast("Ce compte existe déjà", "danger")
      return;
    }

    if (isProd) {
      try {
        const res = await fetch(`${API_URL}/accounts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newAccountFormData)
        })
        const data = await res.json()
        if (!data.success) throw new Error()
      } catch (err) {
        showToast("Erreur API", "danger");
        return;
      }
    }

    setAccounts(prev => [...prev, newAccountFormData])
    showToast("Nouveau compte créé")
    setNewAccountFormData({ email: '', password: '', role: 'Visiteur' })
  }

  const handleAccountDelete = async (email) => {
    // Will be handled via modal, just a safety hook if called directly
    setConfirmDialog({ isOpen: true, item: { email }, type: 'account' });
  }

  const executeDelete = async () => {
    if (confirmDialog.type === 'account') {
      const email = confirmDialog.item.email;
      if (isProd) {
        try {
          await fetch(`${API_URL}/accounts/${email}`, { method: 'DELETE' })
        } catch (err) {
          showToast("Erreur API de suppression", "danger");
          setConfirmDialog({ isOpen: false, item: null, type: '' });
          return;
        }
      }
      setAccounts(prev => prev.filter(a => a.email !== email))
      showToast("Le compte a été retiré")

    } else if (confirmDialog.type === 'employee') {
      const id = confirmDialog.item.matricule;
      if (isProd) {
        try {
          await fetch(`${API_URL}/employees/${id}`, { method: 'DELETE' })
        } catch (err) {
          showToast("Erreur API PostgreSQL", "danger");
          setConfirmDialog({ isOpen: false, item: null, type: '' });
          return;
        }
      }
      setEmployees(prev => prev.filter(e => e.matricule !== id))
      showToast("Employé supprimé définitivement", 'danger')
    }
    setConfirmDialog({ isOpen: false, item: null, type: '' });
  }

  const handleFormChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value })

  const addCert = () => {
    if (!draftCert.name || !draftCert.dateObtention || !draftCert.validite) return
    setFormData(prev => ({ ...prev, certifications: [...prev.certifications, { ...draftCert }] }))
    setDraftCert({ name: '', dateObtention: '', validite: '', dateExpiration: '' })
  }

  const saveEmployee = async (e) => {
    e.preventDefault()
    const compliance = calculateCompliance(formData.certifications)
    const newEmp = {
      ...formData,
      name: `${formData.firstName} ${formData.lastName}`,
      compliance,
      status: getStatusLabel(compliance),
      matricule: formData.matricule || `HSE-${Math.floor(Math.random() * 900) + 100}-PX`
    }

    if (isProd) {
      try {
        await fetch(`${API_URL}/employees`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newEmp)
        })
      } catch (err) {
        showToast("Erreur d'enregistrement PostgreSQL", "danger");
        return;
      }
    }

    setEmployees(prev => {
      if (employeeView === 'edit') {
        return prev.map(emp => emp.matricule === selectedEmployee.matricule ? newEmp : emp)
      }
      return [newEmp, ...prev]
    })

    showToast(employeeView === 'edit' ? "Mise à jour réussie" : "Nouvel arrivant enregistré")
    setEmployeeView('list')
    setFormData({ firstName: '', lastName: '', matricule: '', role: '', departement: '', certifications: [], avatar: null })
  }

  const startEdit = (emp) => {
    setSelectedEmployee(emp)
    setFormData({ ...emp })
    setEmployeeView('edit')
  }

  const handleDelete = async (emp) => {
    setConfirmDialog({ isOpen: true, item: emp, type: 'employee' });
  }

  const exportCSV = () => {
    const headers = ["Matricule", "Nom", "Fonction", "Dept", "Conformité"]
    const rows = employees.map(e => [e.matricule, e.name, e.role, e.departement, `${e.compliance}%`])
    const content = "data:text/csv;charset=utf-8," + headers.join(",") + "\n" + rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n")
    const link = document.createElement("a")
    link.href = encodeURI(content)
    link.download = "export_hse.csv"
    link.click()
    showToast("Exportation terminée")
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => setFormData(prev => ({ ...prev, avatar: reader.result }))
      reader.readAsDataURL(file)
    }
  }

  const printBadge = async () => {
    try {
      showToast("Génération du badge...", "info");

      const recto = document.getElementById('badge-recto');
      const verso = document.getElementById('badge-verso');

      if (!recto || !verso) {
        throw new Error("Éléments du badge non trouvés dans le DOM");
      }

      const options = {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false
      };

      const canvasRecto = await html2canvas(recto, options);
      const canvasVerso = await html2canvas(verso, options);

      const pdf = new jsPDF('p', 'mm', 'a4');

      const imgW = 85;
      const imgH = 105;
      const xPos = (210 - imgW) / 2;

      pdf.addImage(canvasRecto.toDataURL('image/png'), 'PNG', xPos, 15, imgW, imgH);
      pdf.addImage(canvasVerso.toDataURL('image/png'), 'PNG', xPos, 15 + imgH + 10, imgW, imgH);

      pdf.save(`Badge_${selectedEmployee.matricule}.pdf`);
      showToast("Badge téléchargé !");
    } catch (err) {
      console.error("Erreur PDF:", err);
      showToast("Erreur: " + err.message, "danger");
    }
  }

  // --- Sub-components ---
  const StatCard = ({ label, value, color }) => (
    <div className="glass-card" style={{ padding: '1.5rem', textAlign: 'center' }}>
      <div style={{ fontSize: '2.5rem', fontWeight: '900', color: `var(--${color})` }}>{value}</div>
      <div className="input-label" style={{ marginBottom: 0 }}>{label}</div>
    </div>
  )

  const EmployeeRaw = ({ emp }) => (
    <div className="glass-card employee-row animate-slide-up" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.5rem', background: 'var(--card-bg-light)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
        <div style={{ width: '50px', height: '50px', borderRadius: '14px', background: 'var(--primary)', padding: '2px' }}>
          <img src={emp.avatar || avatarPlaceholder} style={{ width: '100%', height: '100%', borderRadius: '12px', objectFit: 'cover' }} />
        </div>
        <div>
          <h4 style={{ fontSize: '1.1rem', fontWeight: '700' }}>{emp.lastName?.toUpperCase()} {emp.firstName}</h4>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>{emp.role} • <span style={{ fontFamily: 'monospace', color: 'var(--primary)' }}>{emp.matricule}</span></span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
        <div style={{ textAlign: 'right', minWidth: '100px' }}>
          <div style={{ fontWeight: '800', fontSize: '1.1rem', color: emp.compliance >= 90 ? 'var(--accent)' : emp.compliance >= 60 ? 'var(--warning)' : 'var(--danger)' }}>{emp.compliance}%</div>
          <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--text-dim)', letterSpacing: '1px' }}>{emp.status}</div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {currentUser?.role === 'Admin' && (
            <button className="btn-icon" onClick={() => startEdit(emp)}>✎</button>
          )}
          <button className="btn-icon" onClick={() => { setSelectedEmployee(emp); setEmployeeView('badge') }} style={{ color: 'var(--primary)' }}>ID</button>
          {currentUser?.role === 'Admin' && (
            <button className="btn-icon" onClick={() => handleDelete(emp)} style={{ color: 'var(--danger)' }}>🗑</button>
          )}
        </div>
      </div>
    </div>
  )

  // --- Render ---
  return (
    <div className="animate-fade-in">
      <nav>
        <div className="logo">
          <span>MADAGREEN POWER</span>
        </div>

        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
          {isProd && (
            <span style={{ color: 'var(--accent)', fontSize: '0.8rem', padding: '4px 8px', borderRadius: '4px', background: 'var(--card-bg-hover)' }}>🟢 Prod DB</span>
          )}

          <button className="btn-icon" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title="Changer le thème">
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>

          {isAuthenticated && (
            <>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.9rem', marginRight: '1rem', display: 'flex', alignItems: 'center' }}>
                <span style={{ color: 'var(--accent)', fontWeight: 'bold' }}>{currentUser?.email}</span>&nbsp;({currentUser?.role})
              </span>
              <button className="btn-secondary" style={{ padding: '0.5rem 1rem' }} onClick={() => setEmployeeView('list')}>Employés</button>
              {currentUser?.role === 'Admin' && (
                <button className="btn-secondary" style={{ padding: '0.5rem 1rem' }} onClick={() => setEmployeeView('settings')}>Paramètres</button>
              )}
              <button className="btn-secondary" style={{ padding: '0.5rem 1rem', background: 'var(--danger-glow)', borderColor: 'transparent', color: 'var(--danger)' }} onClick={() => { setIsAuthenticated(false); setCurrentUser(null); }}>Déconnexion</button>
            </>
          )}
        </div>
      </nav>

      <main className="container" style={!isAuthenticated ? { padding: 0 } : {}}>
        {!isAuthenticated ? (
          <div style={{
            minHeight: '100vh',
            backgroundImage: `url(${mgpBg})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            zIndex: 0,
            display: 'flex'
          }}>
            {/* Left branding panel */}
            <div style={{
              flex: '1 1 55%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              padding: '4rem',
              background: 'linear-gradient(to top, rgba(3,8,18,0.75) 0%, transparent 60%)',
            }}>
              <h1 style={{ fontSize: '3rem', fontWeight: '900', lineHeight: 1.1, marginBottom: '1rem', color: '#fff', textShadow: '0 2px 16px rgba(0,0,0,0.8)' }}>
                HSE Passport
              </h1>
              <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '1rem', maxWidth: '380px', lineHeight: 1.7, textShadow: '0 1px 8px rgba(0,0,0,0.9)' }}>
                Plateforme de gestion des habilitations et certifications sécurité.
              </p>
              <div style={{ display: 'flex', gap: '2.5rem', marginTop: '2.5rem' }}>
                {[['🛡️', 'Conformité HSE'], ['📋', 'Dossiers Employés'], ['🎫', 'Passeports Sécurité']].map(([icon, label]) => (
                  <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ fontSize: '1.6rem', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.8))' }}>{icon}</span>
                    <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase', letterSpacing: '1px', textAlign: 'center', textShadow: '0 1px 6px rgba(0,0,0,0.9)' }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right login panel — no card */}
            <div className="animate-slide-up" style={{
              flex: '0 0 400px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '4rem 3.5rem',
              background: 'rgba(5, 10, 22, 0.82)',
              backdropFilter: 'blur(24px)',
              borderLeft: '1px solid rgba(255,255,255,0.07)'
            }}>
              <p style={{ color: 'var(--primary)', fontSize: '0.8rem', fontWeight: '700', letterSpacing: '3px', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Espace Sécurisé</p>
              <h2 style={{ fontSize: '2rem', fontWeight: '800', marginBottom: '0.5rem' }}>Connexion</h2>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.9rem', marginBottom: '3rem' }}>Identifiez-vous pour accéder au système.</p>

              <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '0.6rem' }}>Adresse Email</label>
                  <input
                    type="email" name="email"
                    placeholder="admin@madagreen.com"
                    required
                    style={{
                      width: '100%', background: 'transparent', border: 'none',
                      borderBottom: '2px solid rgba(255,255,255,0.2)',
                      color: 'white', fontSize: '1rem', padding: '0.6rem 0',
                      outline: 'none', boxSizing: 'border-box',
                      transition: 'border-color 0.3s'
                    }}
                    onFocus={e => e.target.style.borderBottomColor = 'var(--primary)'}
                    onBlur={e => e.target.style.borderBottomColor = 'rgba(255,255,255,0.2)'}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '0.6rem' }}>Mot de passe</label>
                  <input
                    type="password" name="password"
                    placeholder="••••••••"
                    required
                    style={{
                      width: '100%', background: 'transparent', border: 'none',
                      borderBottom: '2px solid rgba(255,255,255,0.2)',
                      color: 'white', fontSize: '1rem', padding: '0.6rem 0',
                      outline: 'none', boxSizing: 'border-box',
                      transition: 'border-color 0.3s'
                    }}
                    onFocus={e => e.target.style.borderBottomColor = 'var(--primary)'}
                    onBlur={e => e.target.style.borderBottomColor = 'rgba(255,255,255,0.2)'}
                  />
                </div>
                <button type="submit" style={{
                  marginTop: '1rem',
                  padding: '1rem',
                  background: 'var(--primary)',
                  border: 'none',
                  borderRadius: '8px',
                  color: 'white',
                  fontSize: '1rem',
                  fontWeight: '700',
                  letterSpacing: '1px',
                  cursor: 'pointer',
                  transition: 'opacity 0.2s, transform 0.2s',
                  boxShadow: '0 0 24px var(--primary-glow)'
                }}
                  onMouseEnter={e => { e.target.style.opacity = '0.85'; e.target.style.transform = 'translateY(-1px)'; }}
                  onMouseLeave={e => { e.target.style.opacity = '1'; e.target.style.transform = 'translateY(0)'; }}
                >
                  S'authentifier →
                </button>
              </form>

              <p style={{ marginTop: '3rem', fontSize: '0.75rem', color: 'rgba(255,255,255,0.25)', textAlign: 'center' }}>
                © {new Date().getFullYear()} Madagreen Power — Tous droits réservés
              </p>
            </div>
          </div>
        ) : (
          <div className="animate-fade-in">
            {employeeView === 'list' ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '2rem', marginBottom: '3rem' }}>
                  <StatCard label="Effectif Total" value={employees.length} color="primary" />
                  <StatCard label="Taux de Conformité" value={`${Math.round(employees.reduce((acc, e) => acc + e.compliance, 0) / (employees.length || 1))}%`} color="accent" />
                  <StatCard label="Alertes Critiques" value={employees.filter(e => e.compliance < 60).length} color="danger" />
                </div>

                <div className="glass-panel" style={{ padding: '2rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem', flexWrap: 'wrap', gap: '1.5rem' }}>
                    <h2>Liste des personnels</h2>
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                      <button className="btn-secondary" onClick={exportCSV}>📥 CSV</button>
                      <select className="glass-input" style={{ width: '160px' }} value={filterDept} onChange={e => setFilterDept(e.target.value)}>
                        <option value="Tous">Tous Depts</option>
                        {[...new Set(employees.map(e => e.departement))].map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                      <input type="text" className="glass-input" placeholder="Rechercher..." style={{ width: '220px' }} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                      {currentUser?.role === 'Admin' && (
                        <button className="btn-primary" onClick={() => { setFormData({ firstName: '', lastName: '', matricule: '', role: '', departement: '', certifications: [], avatar: null }); setEmployeeView('add') }}>+ Nouveau</button>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {employees
                      .filter(e => (filterDept === 'Tous' || e.departement === filterDept) && (e.name.toLowerCase().includes(searchTerm.toLowerCase()) || e.matricule.toLowerCase().includes(searchTerm.toLowerCase())))
                      .map(e => <EmployeeRaw key={e.matricule} emp={e} />)}
                  </div>
                </div>
              </>
            ) : employeeView === 'settings' ? (
              <div className="glass-panel animate-slide-up" style={{ maxWidth: '700px', margin: '0 auto', padding: '3rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '3rem' }}>
                  <button className="btn-icon" onClick={() => setEmployeeView('list')}>←</button>
                  <h2>Paramètres d'Accès</h2>
                </div>

                <div style={{ background: 'var(--card-bg-light)', padding: '2rem', borderRadius: '16px', marginBottom: '3rem' }}>
                  <h3 style={{ marginBottom: '1.5rem' }}>Créer un nouvel accès</h3>
                  <form onSubmit={handleAccountCreate} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                    <div style={{ gridColumn: 'span 2' }}>
                      <label className="input-label">Email de connexion</label>
                      <input type="email" className="glass-input" value={newAccountFormData.email} onChange={e => setNewAccountFormData({ ...newAccountFormData, email: e.target.value })} required placeholder="nom@entreprise.com" />
                    </div>
                    <div>
                      <label className="input-label">Mot de passe</label>
                      <input type="password" className="glass-input" value={newAccountFormData.password} onChange={e => setNewAccountFormData({ ...newAccountFormData, password: e.target.value })} required placeholder="••••••••" />
                    </div>
                    <div>
                      <label className="input-label">Niveau d'accès</label>
                      <select className="glass-input" value={newAccountFormData.role} onChange={e => setNewAccountFormData({ ...newAccountFormData, role: e.target.value })}>
                        <option value="Admin">Administrateur (Lecture & Écriture)</option>
                        <option value="Visiteur">Visiteur (Lecture seule)</option>
                      </select>
                    </div>
                    <div style={{ gridColumn: 'span 2', marginTop: '1rem' }}>
                      <button type="submit" className="btn-primary" style={{ width: '100%', justifyContent: 'center' }}>Ajouter l'utilisateur</button>
                    </div>
                  </form>
                </div>

                <h3>Comptes Existants</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
                  {accounts.map((acc, idx) => (
                    <div key={idx} className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem' }}>
                      <div>
                        <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{acc.email}</div>
                        <div style={{ fontSize: '0.85rem', color: acc.role === 'Admin' ? 'var(--accent)' : 'var(--text-dim)' }}>Accès {acc.role}</div>
                      </div>
                      {acc.email !== currentUser.email && (
                        <button className="btn-icon" onClick={() => setConfirmDialog({ isOpen: true, item: acc, type: 'account' })} style={{ color: 'var(--danger)' }}>🗑</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (employeeView === 'add' || employeeView === 'edit') ? (
              <div className="glass-panel animate-slide-up" style={{ maxWidth: '900px', margin: '0 auto', padding: '3rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '3rem' }}>
                  <button className="btn-icon" onClick={() => setEmployeeView('list')}>←</button>
                  <h2>{employeeView === 'add' ? "Recrutement" : "Mise à jour Dossier"}</h2>
                </div>

                <form onSubmit={saveEmployee} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                  <div style={{ gridRow: 'span 3', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', background: 'var(--card-bg-light)', padding: '2rem', borderRadius: '24px' }}>
                    <div className="avatar" style={{ width: '180px', height: '180px', cursor: 'pointer' }} onClick={() => document.getElementById('file-up').click()}>
                      <img src={formData.avatar || avatarPlaceholder} />
                      <div style={{ position: 'absolute', bottom: '15px', right: '15px', background: 'var(--primary)', padding: '8px', borderRadius: '50%', boxShadow: '0 5px 15px var(--primary-glow)' }}>📷</div>
                    </div>
                    <input type="file" id="file-up" hidden onChange={handleFileChange} />
                    <p style={{ fontSize: '0.8rem', textAlign: 'center' }}>Cliquez pour uploader<br />JPG, PNG (Max 2MB)</p>
                  </div>

                  <div>
                    <label className="input-label">Nom de famille</label>
                    <input type="text" name="lastName" className="glass-input" value={formData.lastName} onChange={handleFormChange} required placeholder="DUBOIS" />
                  </div>
                  <div>
                    <label className="input-label">Prénom</label>
                    <input type="text" name="firstName" className="glass-input" value={formData.firstName} onChange={handleFormChange} required placeholder="Jean" />
                  </div>
                  <div>
                    <label className="input-label">Département</label>
                    <input type="text" name="departement" className="glass-input" value={formData.departement} onChange={handleFormChange} required placeholder="Exploitation" />
                  </div>
                  <div>
                    <label className="input-label">Fonction</label>
                    <input type="text" name="role" className="glass-input" value={formData.role} onChange={handleFormChange} required placeholder="Conducteur d'engins" />
                  </div>
                  <div>
                    <label className="input-label">Matricule (Optionnel)</label>
                    <input type="text" name="matricule" className="glass-input" value={formData.matricule} onChange={handleFormChange} placeholder="AUTO-GEN" disabled={employeeView === 'edit'} />
                  </div>

                  <div style={{ gridColumn: 'span 2', marginTop: '2rem' }}>
                    <h3 style={{ marginBottom: '1.5rem', fontSize: '1.1rem', color: 'var(--primary)' }}>Habilitations HSE</h3>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.5rem' }}>
                      {formData.certifications.map((c, i) => (
                        <div key={i} className="glass-card" style={{ padding: '0.75rem 1rem', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '1rem', border: '1px solid var(--primary-glow)' }}>
                          <div>
                            <div style={{ fontWeight: '700', fontSize: '0.9rem' }}>{c.name}</div>
                            <div style={{ fontSize: '0.7rem', color: isExpired(c.dateExpiration) ? 'var(--danger)' : 'var(--accent)' }}>Exp: {c.dateExpiration}</div>
                          </div>
                          <button type="button" onClick={() => setFormData(f => ({ ...f, certifications: f.certifications.filter((_, idx) => idx !== i) }))} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}>✕</button>
                        </div>
                      ))}
                    </div>

                    <div style={{ background: 'var(--card-bg-medium)', padding: '1.5rem', borderRadius: '16px', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '1rem', alignItems: 'end' }}>
                      <div>
                        <label className="input-label">Type de formation</label>
                        <select className="glass-input" value={draftCert.name} onChange={e => setDraftCert(d => ({ ...d, name: e.target.value }))}>
                          <option value="">Sélectionner...</option>
                          {CERTIFICATION_LIST.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="input-label">Date</label>
                        <input type="date" className="glass-input" value={draftCert.dateObtention} onChange={e => setDraftCert(d => ({ ...d, dateObtention: e.target.value }))} />
                      </div>
                      <div>
                        <label className="input-label">Validité (ans)</label>
                        <input type="number" className="glass-input" value={draftCert.validite} onChange={e => setDraftCert(d => ({ ...d, validite: e.target.value }))} />
                      </div>
                      <button type="button" className="btn-secondary" onClick={addCert} style={{ height: '46px' }}>Ajouter</button>
                    </div>
                  </div>

                  <div style={{ gridColumn: 'span 2', display: 'flex', gap: '1rem', marginTop: '2rem' }}>
                    <button type="submit" className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>{employeeView === 'edit' ? "Mettre à jour" : "Enregistrer le dossier"}</button>
                    <button type="button" className="btn-secondary" style={{ flex: 1 }} onClick={() => setEmployeeView('list')}>Annuler</button>
                  </div>
                </form>
              </div>
            ) : employeeView === 'badge' ? (
              <section className="dashboard-grid animate-fade-in" style={{ maxWidth: '1100px', margin: '0 auto' }}>
                <div className="glass-panel profile-main" style={{ padding: '3rem' }}>
                  <button className="btn-icon" style={{ position: 'absolute', top: '2rem', right: '2rem' }} onClick={() => setEmployeeView('list')}>✕</button>
                  <div className="profile-header">
                    <div className="avatar" style={{ width: '150px', height: '150px' }}>
                      <img src={selectedEmployee.avatar || avatarPlaceholder} />
                    </div>
                    <div>
                      <h1 style={{ marginBottom: '0.25rem' }}>{selectedEmployee.name}</h1>
                      <p style={{ fontSize: '1.2rem', color: 'var(--primary)', fontWeight: '600' }}>{selectedEmployee.role}</p>
                      <div className="id-badge">{selectedEmployee.matricule}</div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem', marginBottom: '3rem' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '1.5rem', fontWeight: '800', color: selectedEmployee.compliance >= 90 ? 'var(--accent)' : 'var(--warning)' }}>{selectedEmployee.compliance}%</div>
                      <div className="input-label">Score HSE</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '1.5rem', fontWeight: '800' }}>{selectedEmployee.certifications.length}</div>
                      <div className="input-label">Certifications</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '1.5rem', fontWeight: '800', color: selectedEmployee.status === 'Actif' ? 'var(--accent)' : 'var(--danger)' }}>{selectedEmployee.status}</div>
                      <div className="input-label">État</div>
                    </div>
                  </div>

                  <h3 style={{ marginBottom: '1.5rem', fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '2px' }}>Registre des Aptitudes</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {selectedEmployee.certifications.length > 0 ? selectedEmployee.certifications.map((c, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--card-bg-medium)', padding: '1rem', borderRadius: '12px', borderLeft: `4px solid ${isExpired(c.dateExpiration) ? 'var(--danger)' : 'var(--accent)'}` }}>
                        <div>
                          <div style={{ fontWeight: '700' }}>{c.name}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Délivré le {c.dateObtention}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>Expiration</div>
                          <div style={{ fontWeight: '700', color: isExpired(c.dateExpiration) ? 'var(--danger)' : 'var(--text-main)' }}>{c.dateExpiration}</div>
                        </div>
                      </div>
                    )) : <p>Aucun certificat enregistré.</p>}
                  </div>

                  <div style={{ display: 'flex', gap: '1rem', marginTop: '3rem' }}>
                    <button className="btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={printBadge}>⎙ Imprimer le Badge PDF</button>
                    {currentUser?.role === 'Admin' && (
                      <button className="btn-secondary" style={{ flex: 1 }} onClick={() => startEdit(selectedEmployee)}>✎ Modifier le dossier</button>
                    )}
                  </div>
                </div>

                <div className="sidebar animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                  <div className="glass-panel" style={{ padding: '2rem' }}>
                    <h3 style={{ fontSize: '1rem', marginBottom: '1.5rem' }}>Aperçu Technique</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div>
                        <span className="input-label">Département</span>
                        <div style={{ color: 'var(--text-main)' }}>{selectedEmployee.departement}</div>
                      </div>
                      <div className="security-meter">
                        <div className="meter-fill" style={{ width: `${selectedEmployee.compliance}%`, background: selectedEmployee.compliance >= 90 ? 'var(--accent)' : 'var(--danger)' }}></div>
                      </div>
                    </div>
                  </div>

                  <div style={{ position: 'fixed', left: '-100vw', top: 0, opacity: 0, pointerEvents: 'none' }}>
                    <div id="pdf-badge-wrapper" style={{ padding: '40px', background: 'white', display: 'flex', flexDirection: 'column', gap: '40px' }}>

                      {/* Recto 85x105mm */}
                      <div id="badge-recto" style={{ width: '85mm', height: '105mm', borderRadius: '12px', border: '1px solid #ddd', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#f8fafc', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', position: 'relative', boxSizing: 'border-box' }}>

                        {/* Watermark Logo */}
                        <img src={logo} alt="" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%) rotate(-45deg)', width: '80%', opacity: '0.06', pointerEvents: 'none', zIndex: '0' }} />

                        {/* Header */}
                        <div style={{ background: '#1c4c8d', color: 'white', textAlign: 'center', padding: '15px 10px', position: 'relative', zIndex: '1' }}>
                          <div style={{ fontSize: '12px', fontWeight: '800', letterSpacing: '0.8px', lineHeight: '1.2' }}>PASSEPORT SÉCURITÉ<br />MADAGREEN POWER</div>
                        </div>

                        {/* Body */}
                        <div style={{ flex: 1, padding: '20px 15px', display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center', position: 'relative', zIndex: '1', textAlign: 'center' }}>
                          <div style={{ flexShrink: 0 }}>
                            <img src={selectedEmployee.avatar || avatarPlaceholder} alt="" style={{ width: '120px', height: '135px', objectFit: 'cover', borderRadius: '8px', border: '3px solid white', boxShadow: '0 4px 10px rgba(0,0,0,0.15)' }} />
                          </div>

                          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <span style={{ color: '#1c4c8d', fontWeight: '700', fontSize: '10px', textTransform: 'uppercase' }}>Nom Complet</span>
                              <span style={{ fontWeight: '800', fontSize: '18px', color: '#0f172a', lineHeight: '1.2' }}>{selectedEmployee.firstName}<br />{selectedEmployee.lastName?.toUpperCase()}</span>
                            </div>

                            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '10px', marginTop: '10px', display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
                              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'baseline', gap: '5px' }}>
                                <span style={{ color: '#1c4c8d', fontWeight: '700', fontSize: '10px', textTransform: 'uppercase' }}>Matricule:</span>
                                <span style={{ fontWeight: '800', fontSize: '14px', color: '#334155', fontFamily: 'monospace' }}>{selectedEmployee.matricule}</span>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                                <span style={{ color: '#1c4c8d', fontWeight: '700', fontSize: '10px', textTransform: 'uppercase' }}>Département & Fonction</span>
                                <span style={{ fontWeight: '600', fontSize: '12px', color: '#64748b' }}>{selectedEmployee.departement} • {selectedEmployee.role}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Status Bar (Bottom) */}
                        <div style={{ background: selectedEmployee.compliance >= 90 ? '#16a34a' : (selectedEmployee.compliance >= 60 ? '#d97706' : '#dc2626'), height: '15px', width: '100%', position: 'relative', zIndex: '1' }}></div>
                      </div>

                      {/* Verso 85x105mm */}
                      <div id="badge-verso" style={{ width: '85mm', height: '105mm', background: 'white', color: 'black', border: '1px solid #cbd5e1', borderRadius: '10px', overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                        {/* Filigrane Logo */}
                        <img src={logo} alt="" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%) rotate(30deg)', width: '80%', opacity: '0.08', pointerEvents: 'none', zIndex: '0' }} />

                        <div style={{ height: '15mm', background: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold', fontSize: '14px', position: 'relative', zIndex: '1' }}>
                          HABILITATIONS & APTITUDES
                        </div>
                        <div style={{ flex: 1, padding: '5mm', display: 'flex', flexDirection: 'column', position: 'relative', zIndex: '1' }}>
                          <div style={{ fontSize: '10px', fontWeight: '900', color: '#1e293b', borderBottom: '2px solid #1e293b', paddingBottom: '5px', marginBottom: '10px' }}>LISTE DES CERTIFICATIONS</div>
                          <div style={{ flex: 1 }}>
                            {selectedEmployee.certifications.length > 0 ? (
                              selectedEmployee.certifications.map((c, i) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', padding: '7px 0', fontSize: '10px' }}>
                                  <div style={{ fontWeight: 'bold', color: '#334155' }}>{c.name}</div>
                                  <div style={{ color: isExpired(c.dateExpiration) ? '#f43f5e' : '#10b981', fontWeight: '900' }}>{c.dateExpiration}</div>
                                </div>
                              ))
                            ) : (
                              <div style={{ padding: '40px', textAlign: 'center', fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>Aucune certification enregistrée</div>
                            )}
                          </div>
                          <div style={{ marginTop: 'auto', borderTop: '1px dashed #cbd5e1', paddingTop: '10px', textAlign: 'center' }}>
                            <div style={{ fontSize: '12px', fontWeight: '900', color: '#1e293b' }}>MADAGREEN POWER</div>
                            <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '5px' }}>☎ Urgence HSE: 034 34 001 97</div>
                          </div>
                        </div>
                      </div>

                    </div>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        )}
      </main>

      {/* Modern Confirmation Modal */}
      {confirmDialog.isOpen && (
        <div className="modal-overlay animate-fade-in">
          <div className="glass-panel animate-slide-up" style={{ padding: '2.5rem', maxWidth: '420px', width: '100%', textAlign: 'center', borderTop: '4px solid var(--danger)' }}>
            <div style={{ fontSize: '3.5rem', marginBottom: '1rem', textShadow: '0 0 20px var(--danger-glow)' }}>⚠️</div>
            <h2 style={{ marginBottom: '1rem' }}>Action Irréversible</h2>
            <p style={{ color: 'var(--text-main)', marginBottom: '2.5rem', fontSize: '1.05rem', lineHeight: '1.5' }}>
              Souhaitez-vous vraiment supprimer définitivement {confirmDialog.type === 'employee' ? `le dossier de ` : `l'accès du compte `}
              <strong style={{ color: 'var(--danger)' }}>{confirmDialog.type === 'employee' ? confirmDialog.item.name : confirmDialog.item.email}</strong> ?
            </p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button className="btn-secondary" style={{ flex: 1, padding: '0.8rem' }} onClick={() => setConfirmDialog({ isOpen: false, item: null, type: '' })}>
                Annuler
              </button>
              <button className="btn-primary" style={{ flex: 1, padding: '0.8rem', background: 'var(--danger-glow)', borderColor: 'transparent', color: 'var(--danger)', justifyContent: 'center' }} onClick={executeDelete}>
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className="toast" style={{ borderLeftColor: t.type === 'danger' ? 'var(--danger)' : 'var(--primary)' }}>
            <span>{t.type === 'success' ? '✅' : '🚨'}</span>
            <span style={{ fontWeight: '600' }}>{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default App
