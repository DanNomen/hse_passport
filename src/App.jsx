import { useState, useEffect } from 'react'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import avatarPlaceholder from './assets/avatar.png'
import logo from './assets/logo.png'
import mgpBg from './assets/mgp_background.jpg'
import './index.css'
import './App.css'

// Constants
const CERTIFICATION_LIST = ["TH - Port Harnais", "HT - BT", "ATEX niv1",
  "Secourisme", "Lutte contre l'incendie", "Sauvetage en Hauteur", "Verification echaffaudage", "Montage / Demontage Echaffaudage"
]

const INITIAL_EMPLOYEES = []

const INITIAL_ACCOUNTS = [
  { email: 'admin@madagreen.com', password: 'admin', role: 'Admin' },
  { email: 'visiteur@madagreen.com', password: 'visit', role: 'Visiteur' }
]

const PROJET_ACCOUNTS = [
  { email: 'projet@madagreen.com', password: 'admin', role: 'Admin' }
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
  const isProd = true // <-- PASSÉ EN PRODUCTION
  const API_URL = 'http://46.105.75.234:3009/api'.trim()
  const DB_PREFIX = '_prod' // Stable prefix for mobile production

  // --- States ---
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('hse_theme');
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  })

  const [accounts, setAccounts] = useState(() => {
    const saved = localStorage.getItem(`hse_accounts_v1${DB_PREFIX}`)
    return saved ? JSON.parse(saved) : INITIAL_ACCOUNTS
  })

  const [employees, setEmployees] = useState(() => {
    const saved = localStorage.getItem(`hse_employees_v2${DB_PREFIX}`)
    return saved ? JSON.parse(saved) : INITIAL_EMPLOYEES
  })
  const [isSyncing, setIsSyncing] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  const [employeeView, setEmployeeView] = useState('list')
  const [showHeader, setShowHeader] = useState(true)
  const [lastScrollY, setLastScrollY] = useState(0)
  const [selectedEmployee, setSelectedEmployee] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterDept, setFilterDept] = useState('Tous')
  const [toasts, setToasts] = useState([])

  const [formData, setFormData] = useState({
    firstName: '', lastName: '', matricule: '', role: '', departement: '', certifications: [], avatar: null, aptitudeMedicale: true,
    epis: { gants: { checked: false, date: '' }, chaussures: { checked: false, date: '' }, casques: { checked: false, date: '' }, uniforme: { checked: false, date: '' }, gillet: { checked: false, date: '' } }
  })
  const [draftCert, setDraftCert] = useState({ name: '', dateObtention: '', validite: '', dateExpiration: '' })
  const [newAccountFormData, setNewAccountFormData] = useState({ email: '', password: '', role: 'Visiteur' })
  const [selectedHub, setSelectedHub] = useState(null)
  const [projetView, setProjetView] = useState('projet')

  // Modal State
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, item: null, type: '' })

  // Chargement initial des données depuis le serveur en mode Prod
  useEffect(() => {
    const fetchInitialData = async () => {
      if (isProd && isAuthenticated) {
        try {
          const { CapacitorHttp } = await import('@capacitor/core')

          // Récupérer les comptes
          const resAcc = await CapacitorHttp.get({
            url: `${API_URL}/accounts`,
            connectTimeout: 30000,
            readTimeout: 30000
          })
          if (resAcc.status === 200 && resAcc.data.success) {
            setAccounts(resAcc.data.accounts)
            localStorage.setItem(`hse_accounts_v1${DB_PREFIX}`, JSON.stringify(resAcc.data.accounts))
          }

          // Récupérer les employés
          const resEmp = await CapacitorHttp.get({
            url: `${API_URL}/employees`,
            connectTimeout: 30000,
            readTimeout: 30000
          })
          if (resEmp.status === 200 && resEmp.data.success) {
            setEmployees(resEmp.data.employees)
            localStorage.setItem(`hse_employees_v2${DB_PREFIX}`, JSON.stringify(resEmp.data.employees))
          }
        } catch (err) {
          console.error("Erreur chargement initial:", err)
        }
      }
    }
    fetchInitialData()
  }, [isProd, isAuthenticated])


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

  // Notification de l'état de la connexion Internet
  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    if (draftCert.dateObtention && draftCert.validite) {
      const date = new Date(draftCert.dateObtention)
      date.setFullYear(date.getFullYear() + Number(draftCert.validite))
      setDraftCert(prev => ({ ...prev, dateExpiration: date.toISOString().split('T')[0] }))
    }
  }, [draftCert.dateObtention, draftCert.validite])

  // Smart Header Logic
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY
      if (currentScrollY > lastScrollY && currentScrollY > 60) {
        setShowHeader(false) // On descend -> cache le menu
      } else {
        setShowHeader(true) // On monte -> affiche le menu
      }
      setLastScrollY(currentScrollY)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [lastScrollY])

  // --- Handlers ---
  useEffect(() => {
    localStorage.setItem('hse_employees', JSON.stringify(employees))
  }, [employees])

  useEffect(() => {
    const handleStatusChange = () => setIsOnline(navigator.onLine)
    window.addEventListener('online', handleStatusChange)
    window.addEventListener('offline', handleStatusChange)
    return () => {
      window.removeEventListener('online', handleStatusChange)
      window.removeEventListener('offline', handleStatusChange)
    }
  }, [])

  const syncData = async () => {
    if (!isOnline) {
      showToast("Pas de connexion internet", "error")
      return
    }

    setIsSyncing(true)
    try {
      const { CapacitorHttp } = await import('@capacitor/core')

      // 1. PUSH (Envoyer/Mettre à jour les locaux vers le serveur)
      for (const employee of employees) {
        try {
          const optionsPush = {
            url: `${API_URL}/employees`,
            headers: { 'Content-Type': 'application/json' },
            data: employee
          }
          await CapacitorHttp.post(optionsPush)
        } catch (pushErr) {
          console.error(`Erreur push ${employee.matricule}:`, pushErr)
        }
      }

      // 2. PULL (Récupérer l'état actuel du serveur pour mettre à jour le mobile)
      const optionsPull = {
        url: `${API_URL}/employees`,
        headers: { 'Content-Type': 'application/json' }
      }
      const resPull = await CapacitorHttp.get(optionsPull)
      if (resPull.status === 200 && resPull.data.success) {
        const serverEmployees = resPull.data.employees || []
        setEmployees(serverEmployees)
        localStorage.setItem(`hse_employees_v2${DB_PREFIX}`, JSON.stringify(serverEmployees))
      }

      showToast("Synchronisation et mise à jour terminées !")
    } catch (err) {
      console.error(err)
      showToast("Erreur de synchronisation : vous n'êtes pas connecté à internet", "danger")
    } finally {
      setIsSyncing(false)
    }
  }

  const showToast = (message, type = 'success') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000)
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    const emailInput = e.target.email.value.trim().toLowerCase()
    const passwordInput = e.target.password.value.trim()

    const finalizeAuth = async (account) => {
      setCurrentUser(account)
      setIsAuthenticated(true)
    }

    if (isProd) {
      if (isOnline) {
        try {
          const { CapacitorHttp } = await import('@capacitor/core')
          const res = await CapacitorHttp.post({
            url: `${API_URL}/login`,
            headers: { 'Content-Type': 'application/json' },
            data: { email: emailInput, password: passwordInput },
            connectTimeout: 5000,
            readTimeout: 5000
          })

          if (res.status === 200 && res.data.success) {
            finalizeAuth(res.data.account)
            return
          }
        } catch (err) {
          console.warn("Mode local activé")
        }
      }

      const scopeAccounts = selectedHub === 'projet' ? PROJET_ACCOUNTS : [...accounts, ...INITIAL_ACCOUNTS]
      const acc = scopeAccounts.find(a => a.email.toLowerCase() === emailInput && a.password === passwordInput)

      if (acc) {
        finalizeAuth(acc)
      } else {
        showToast("Identifiants incorrects", "danger")
      }
    } else {
      const scopeAccounts = selectedHub === 'projet' ? PROJET_ACCOUNTS : [...accounts, ...INITIAL_ACCOUNTS]
      const acc = scopeAccounts.find(a => a.email.toLowerCase() === emailInput && a.password === passwordInput)
      if (acc) {
        finalizeAuth(acc)
      } else {
        showToast("Erreur login démo", "danger")
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
        const { CapacitorHttp } = await import('@capacitor/core')
        const res = await CapacitorHttp.post({
          url: `${API_URL}/accounts`,
          headers: { 'Content-Type': 'application/json' },
          data: newAccountFormData
        })
        if (res.status !== 200 || !res.data.success) throw new Error()
      } catch (err) {
        console.error('API Error Create Account:', err);
        showToast(`Erreur API: ${err.message || "Impossible de joindre le serveur"}`, "danger");
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
          const { CapacitorHttp } = await import('@capacitor/core')
          await CapacitorHttp.delete({ url: `${API_URL}/accounts/${email}` })
        } catch (err) {
          console.error('API Error Delete Account:', err);
          showToast(`Erreur API de suppression: ${err.message || "Serveur injoignable"}`, "danger");
          setConfirmDialog({ isOpen: false, item: null, type: '' });
          return;
        }
      }
      setAccounts(prev => prev.filter(a => a.email !== email))
      showToast("Le compte a été retiré")

    } else if (confirmDialog.type === 'employee') {
      const id = confirmDialog.item.matricule;

      if (isProd && isOnline) {
        try {
          const { CapacitorHttp } = await import('@capacitor/core')
          await CapacitorHttp.delete({ url: `${API_URL}/employees/${id}` })
        } catch (e) {
          console.error("Delete online failed:", e);
        }
      }

      const updatedEmployees = employees.filter(e => e.matricule !== id)
      setEmployees(updatedEmployees)
      localStorage.setItem(`hse_employees_v2${DB_PREFIX}`, JSON.stringify(updatedEmployees))
      showToast("Employé retiré", 'success')
    }
    setConfirmDialog({ isOpen: false, item: null, type: '' });
  }

  const handleFormChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value })

  const addCert = () => {
    if (!draftCert.name || !draftCert.dateObtention || !draftCert.validite) return
    setFormData(prev => ({ ...prev, certifications: [...prev.certifications, { ...draftCert }] }))
    setDraftCert({ name: '', dateObtention: '', validite: '', dateExpiration: '' })
  }

  const saveEmployee = (e) => {
    e.preventDefault()
    const compliance = calculateCompliance(formData.certifications)
    const newEmp = {
      ...formData,
      name: `${formData.firstName} ${formData.lastName}`,
      compliance,
      status: getStatusLabel(compliance),
      matricule: formData.matricule || `HSE-${Math.floor(Math.random() * 900) + 100}-PX`
    }

    const updatedEmployees = employeeView === 'edit'
      ? employees.map(emp => emp.matricule === selectedEmployee.matricule ? newEmp : emp)
      : [newEmp, ...employees]

    setEmployees(updatedEmployees)
    localStorage.setItem(`hse_employees_v2${DB_PREFIX}`, JSON.stringify(updatedEmployees))

    showToast(employeeView === 'edit' ? "Mise à jour locale réussie" : "Nouvel arrivant enregistré localement")
    setEmployeeView('list')
    setFormData({ firstName: '', lastName: '', matricule: '', role: '', departement: '', certifications: [], avatar: null, aptitudeMedicale: true, epis: { gants: { checked: false, date: '' }, chaussures: { checked: false, date: '' }, casques: { checked: false, date: '' }, uniforme: { checked: false, date: '' }, gillet: { checked: false, date: '' } } })
  }

  const startEdit = (emp) => {
    setSelectedEmployee(emp)
    setFormData({
      ...emp,
      aptitudeMedicale: emp.aptitudeMedicale ?? true,
      epis: {
        gants: emp.epis?.gants || { checked: false, date: '' },
        chaussures: emp.epis?.chaussures || { checked: false, date: '' },
        casques: emp.epis?.casques || { checked: false, date: '' },
        uniforme: emp.epis?.uniforme || { checked: false, date: '' },
        gillet: emp.epis?.gillet || { checked: false, date: '' }
      }
    })
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

      const fileName = `Badge_${selectedEmployee.matricule}.pdf`;

      if (Capacitor.isNativePlatform()) {
        const pdfData = pdf.output('datauristring');
        const base64Data = pdfData.split(',')[1];

        const savedFile = await Filesystem.writeFile({
          path: fileName,
          data: base64Data,
          directory: Directory.Documents,
        });

        await Share.share({
          title: 'HSE Badge',
          text: `Badge de ${selectedEmployee.name}`,
          url: savedFile.uri,
          dialogTitle: 'Ouvrir ou Envoyer le Badge PDF',
        });
        showToast("Badge généré avec succès !");
      } else {
        pdf.save(fileName);
        showToast("Badge téléchargé !");
      }
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
    <div className={`app-wrapper ${theme}`}>
      <nav className={!showHeader ? 'nav-hidden' : ''}>
        <div className="logo">
          <span>MADAGREEN POWER</span>
        </div>

        <div className="nav-actions">
          {isProd && <span className="mobile-hide" style={{ color: 'var(--accent)', fontSize: '0.75rem', fontWeight: 'bold' }}>🟢 PROD DB</span>}
          <button className="btn-icon" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>

          {isAuthenticated && (
            <>
              {selectedHub === 'hse' ? (
                <>
                  <button
                    className="btn-icon"
                    onClick={syncData}
                    disabled={isSyncing}
                    style={{ color: isOnline ? 'var(--accent)' : 'var(--text-dim)' }}
                    title="Synchroniser avec le serveur"
                  >
                    <span className={isSyncing ? 'animate-spin' : ''} style={{ display: 'inline-block' }}>☁️</span>
                  </button>
                  <span className="user-badge">
                    <span style={{ color: 'var(--accent)', fontWeight: 'bold' }}>{currentUser?.email}</span>&nbsp;({currentUser?.role})
                  </span>
                  <button className={`btn-secondary nav-btn ${employeeView !== 'list' ? 'mobile-hide' : ''}`} onClick={() => setEmployeeView('list')}>Employés</button>
                  {currentUser?.role === 'Admin' && (
                    <button className={`btn-secondary nav-btn ${employeeView !== 'list' ? 'mobile-hide' : ''}`} onClick={() => setEmployeeView('settings')}>Paramètres</button>
                  )}
                  <button className={`btn-secondary nav-btn logout-btn ${employeeView !== 'list' ? 'mobile-hide' : ''}`} onClick={() => { setIsAuthenticated(false); setCurrentUser(null); setSelectedHub(null); }}>Déconnexion</button>
                </>
              ) : (
                <>
                  <button className={`btn-secondary nav-btn`} style={{ color: projetView === 'projet' ? '#3b82f6' : '' }} onClick={() => setProjetView('projet')}>Projet</button>
                  <button className={`btn-secondary nav-btn`} style={{ color: projetView === 'materiels' ? '#3b82f6' : '' }} onClick={() => setProjetView('materiels')}>Matériels</button>
                  {currentUser?.role === 'Admin' && (
                    <button className={`btn-secondary nav-btn`} style={{ color: projetView === 'parametres' ? '#3b82f6' : '' }} onClick={() => setProjetView('parametres')}>Paramètres</button>
                  )}
                  <span className="user-badge mobile-hide">
                    <span style={{ color: '#3b82f6', fontWeight: 'bold' }}>{currentUser?.email}</span>
                  </span>
                  <button className="btn-secondary nav-btn logout-btn" onClick={() => { setIsAuthenticated(false); setCurrentUser(null); setSelectedHub(null); }}>Déconnexion</button>
                </>
              )}
            </>
          )}
        </div>
      </nav>

      <main className="container" style={!isAuthenticated ? { padding: 0 } : {}}>
        {!isAuthenticated ? (
          <div className="login-wrapper" style={{
            minHeight: '100vh',
            backgroundImage: `url(${mgpBg})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            zIndex: 1000,
            display: 'flex',
            flexWrap: 'wrap',
            overflowY: 'auto'
          }}>
            {/* Left branding panel */}
            <div className="login-branding" style={{
              flex: '1 1 300px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              padding: '2rem',
              background: 'linear-gradient(to top, rgba(3,8,18,0.85) 0%, transparent 60%)',
              minHeight: '40vh'
            }}>
              <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: '900', lineHeight: 1.1, marginBottom: '0.5rem', color: '#fff' }}>
                HSE Passport
              </h1>
              <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.9rem', maxWidth: '380px', lineHeight: 1.5 }}>
                Plateforme de gestion des habilitations et certifications sécurité pour Madagreen Power.
              </p>

              <div style={{ display: 'flex', gap: '1.5rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
                {[['🛡️', 'HSE'], ['📋', 'Dossiers'], ['🎫', 'Passeports']].map(([icon, label]) => (
                  <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem' }}>
                    <span style={{ fontSize: '1.4rem' }}>{icon}</span>
                    <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase', letterSpacing: '1px' }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right login panel */}
            <div className="login-panel animate-slide-up" style={{
              flex: '1 1 400px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '2rem',
              background: 'rgba(5, 10, 22, 0.85)',
              backdropFilter: 'blur(24px)',
              borderLeft: '1px solid rgba(255,255,255,0.1)'
            }}>
              <div className="glass-panel" style={{ padding: '2.5rem', maxWidth: '420px', width: '100%', margin: '0 auto' }}>
                {!selectedHub ? (
                  <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <p style={{ color: 'var(--primary)', fontSize: '0.7rem', fontWeight: '700', letterSpacing: '3px', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Portail Sécurisé</p>
                    <h2 style={{ fontSize: '1.6rem', fontWeight: '800', marginBottom: '0.5rem' }}>Hub d'Applications</h2>
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '1.5rem', lineHeight: '1.5' }}>Veuillez sélectionner l'environnement auquel vous souhaitez accéder.</p>

                    <button
                      onClick={() => setSelectedHub('hse')}
                      style={{ background: 'var(--card-bg-light)', border: '2px solid transparent', borderRadius: '12px', padding: '1.5rem', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '1rem', transition: 'all 0.3s ease' }}
                    >
                      <div style={{ fontSize: '2rem' }}>🛡️</div>
                      <div>
                        <div style={{ fontSize: '1.1rem', fontWeight: '800', color: 'white', marginBottom: '0.2rem' }}>HSE Passport</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Habilitations & Sécurité</div>
                      </div>
                    </button>

                    <button
                      onClick={() => setSelectedHub('projet')}
                      style={{ background: 'var(--card-bg-medium)', border: '2px solid transparent', borderRadius: '12px', padding: '1.5rem', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '1rem', transition: 'all 0.3s ease' }}
                    >
                      <div style={{ fontSize: '2rem' }}>🏗️</div>
                      <div>
                        <div style={{ fontSize: '1.1rem', fontWeight: '800', color: 'white', marginBottom: '0.2rem' }}>Gestion de Projet</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Suivi Chantier & Logistique</div>
                      </div>
                    </button>
                  </div>
                ) : (
                  <div className="animate-slide-up">
                    <button onClick={() => setSelectedHub(null)} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 0, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                      <span>←</span> Retour au Hub
                    </button>

                    <div style={{ display: 'inline-block', background: selectedHub === 'hse' ? 'var(--accent-glow)' : 'rgba(59, 130, 246, 0.2)', color: selectedHub === 'hse' ? 'var(--accent)' : '#3b82f6', padding: '0.4rem 0.8rem', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.7rem', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '1rem' }}>
                      {selectedHub === 'hse' ? '🛡️ Module HSE' : '🏗️ Module Projet'}
                    </div>

                    <h2 style={{ fontSize: '1.8rem', fontWeight: '800', marginBottom: '0.5rem' }}>Connexion</h2>
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '2rem' }}>Identifiez-vous pour accéder au système.</p>

                    <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-dim)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '0.4rem' }}>Adresse Email</label>
                        <input
                          type="email" name="email"
                          placeholder="admin@madagreen.com"
                          required
                          style={{
                            width: '100%', background: 'rgba(255,255,255,0.03)', border: 'none',
                            borderBottom: '2px solid rgba(255,255,255,0.1)',
                            color: 'white', fontSize: '1rem', padding: '0.8rem 0',
                            outline: 'none', boxSizing: 'border-box'
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-dim)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '0.4rem' }}>Mot de passe</label>
                        <input
                          type="password" name="password"
                          placeholder="••••••••"
                          required
                          style={{
                            width: '100%', background: 'rgba(255,255,255,0.03)', border: 'none',
                            borderBottom: '2px solid rgba(255,255,255,0.1)',
                            color: 'white', fontSize: '1rem', padding: '0.8rem 0',
                            outline: 'none', boxSizing: 'border-box'
                          }}
                        />
                      </div>
                      <button type="submit" className="btn-primary" style={{ marginTop: '1rem', width: '100%', background: selectedHub === 'hse' ? 'var(--primary)' : '#3b82f6', justifyContent: 'center', borderColor: 'transparent' }}>
                        Se connecter →
                      </button>
                    </form>
                  </div>
                )}

                <p style={{ marginTop: '2.5rem', fontSize: '0.7rem', color: 'var(--text-dim)', textAlign: 'center' }}>
                  © {new Date().getFullYear()} Madagreen Power — Tous droits réservés
                </p>
              </div>
            </div>
          </div>
        ) : selectedHub === 'projet' ? (
          <div className="animate-fade-in">
            {projetView === 'projet' && (<div></div>)}
            {projetView === 'materiels' && (<div></div>)}
            {projetView === 'parametres' && (<div></div>)}
          </div>
        ) : (
          <div className="animate-fade-in">
            {/* Critical Alerts Section */}
            {employees.some(e => e.certifications.some(c => {
              const diff = new Date(c.dateExpiration) - new Date();
              return diff > 0 && diff < (30 * 24 * 60 * 60 * 1000);
            })) && (
                <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem', borderLeft: '4px solid var(--warning)', background: 'rgba(245, 158, 11, 0.05)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span style={{ fontSize: '1.5rem' }}>⚠️</span>
                    <div>
                      <h3 style={{ fontSize: '0.9rem', color: 'var(--warning)', margin: 0 }}>Alertes Expirations Proches ( &lt; 30 jours )</h3>
                      <p style={{ fontSize: '0.8rem', margin: '0.2rem 0 0' }}>Certains passeports nécessitent une mise à jour immédiate.</p>
                    </div>
                  </div>
                </div>
              )}

            {employeeView === 'list' ? (
              <>
                <div className="responsive-grid" style={{ marginBottom: '2rem' }}>
                  <StatCard label="Effectif Total" value={employees.length} color="primary" />
                  <StatCard label="Taux de Conformité" value={`${Math.round(employees.reduce((acc, e) => acc + e.compliance, 0) / (employees.length || 1))}%`} color="accent" />
                  <StatCard label="Alertes Critiques" value={employees.filter(e => e.compliance < 60).length} color="danger" />
                </div>

                {/* Advanced Department Analytics */}
                <div className="glass-panel" style={{ padding: '2rem', marginBottom: '3rem' }}>
                  <h3 style={{ fontSize: '1.1rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>📊 Analyse par Département</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '2rem' }}>
                    {[...new Set(employees.map(e => e.departement))].map(dept => {
                      const deptEmps = employees.filter(e => e.departement === dept);
                      const avgComp = Math.round(deptEmps.reduce((acc, e) => acc + e.compliance, 0) / deptEmps.length);
                      return (
                        <div key={dept}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.8rem', fontWeight: 'bold' }}>
                            <span>{dept}</span>
                            <span>{avgComp}%</span>
                          </div>
                          <div style={{ height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${avgComp}%`, background: avgComp >= 90 ? 'var(--accent)' : (avgComp >= 60 ? 'var(--warning)' : 'var(--danger)'), transition: 'width 1s ease' }}></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="glass-panel" style={{ padding: '2rem' }}>
                  <div className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem', flexWrap: 'wrap', gap: '1.5rem' }}>
                    <h2>Liste des personnels</h2>
                    <div className="controls-group" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                      <button className="btn-secondary" onClick={exportCSV}>📥 CSV</button>
                      <select className="glass-input" style={{ width: '160px' }} value={filterDept} onChange={e => setFilterDept(e.target.value)}>
                        <option value="Tous">Tous Depts</option>
                        {[...new Set(employees.map(e => e.departement))].map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                      <input type="text" className="glass-input" placeholder="Rechercher..." style={{ width: '220px' }} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                      {currentUser?.role === 'Admin' && (
                        <button className="btn-primary" onClick={() => { setFormData({ firstName: '', lastName: '', matricule: '', role: '', departement: '', certifications: [], avatar: null, aptitudeMedicale: true, epis: { gants: { checked: false, date: '' }, chaussures: { checked: false, date: '' }, casques: { checked: false, date: '' }, uniforme: { checked: false, date: '' }, gillet: { checked: false, date: '' } } }); setEmployeeView('add') }}>+ Nouveau</button>
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
                  <form onSubmit={handleAccountCreate} className="form-grid" style={{ gap: '1.5rem' }}>
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
                  <h2>{employeeView === 'add' ? "Creation employé" : "Mise à jour Dossier"}</h2>
                </div>

                <form onSubmit={saveEmployee} className="form-grid">
                  <div className="avatar-upload-area">
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

                  <div style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', gap: '1.5rem', background: 'var(--card-bg-light)', padding: '1.5rem', borderRadius: '12px', borderLeft: formData.aptitudeMedicale ? '4px solid var(--accent)' : '4px solid var(--danger)' }}>
                    <input
                      type="checkbox"
                      id="aptitudeMedicale"
                      checked={formData.aptitudeMedicale}
                      onChange={e => setFormData({ ...formData, aptitudeMedicale: e.target.checked })}
                      style={{ width: '28px', height: '28px', cursor: 'pointer' }}
                    />
                    <div>
                      <label htmlFor="aptitudeMedicale" style={{ fontWeight: 'bold', fontSize: '1.1rem', cursor: 'pointer' }}>Aptitude Médicale</label>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>
                        {formData.aptitudeMedicale ? '🟢 Le collaborateur a été déclaré APTE' : '🔴 Le collaborateur a été déclaré INAPTE'}
                      </div>
                    </div>
                  </div>

                  <div style={{ gridColumn: 'span 2', marginTop: '2rem' }}>
                    <h3 style={{ marginBottom: '1.5rem', fontSize: '1.1rem', color: 'var(--primary)' }}>EPI (Équipement de Protection Individuelle)</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
                      {[
                        { key: 'gants', label: 'Gants' },
                        { key: 'chaussures', label: 'Chaussures de sécurité' },
                        { key: 'casques', label: 'Casques' },
                        { key: 'uniforme', label: 'Uniforme manche longue' },
                        { key: 'gillet', label: 'Gillet Cotton' }
                      ].map(({ key, label }) => (
                        <div key={key} style={{ background: 'var(--card-bg-light)', padding: '1rem', borderRadius: '12px', borderLeft: formData.epis[key].checked ? '4px solid var(--accent)' : '4px solid var(--border)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: formData.epis[key].checked ? '0.75rem' : '0' }}>
                            <input
                              type="checkbox"
                              checked={formData.epis[key].checked}
                              onChange={e => setFormData(pr => ({ ...pr, epis: { ...pr.epis, [key]: { ...pr.epis[key], checked: e.target.checked } } }))}
                              style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                            />
                            <span style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{label}</span>
                          </div>
                          {formData.epis[key].checked && (
                            <div className="animate-fade-in">
                              <label className="input-label" style={{ fontSize: '0.75rem' }}>Date de dotation</label>
                              <input
                                type="date"
                                className="glass-input"
                                value={formData.epis[key].date}
                                onChange={e => setFormData(pr => ({ ...pr, epis: { ...pr.epis, [key]: { ...pr.epis[key], date: e.target.value } } }))}
                                style={{ padding: '0.5rem', fontSize: '0.85rem' }}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

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

                    <div className="badge-stats-grid">
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
                      <button type="button" className="btn-secondary" onClick={addCert} style={{ height: '46px', width: '100%' }}>Ajouter</button>
                    </div>
                  </div>

                  <div className="form-actions">
                    <button type="submit" className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>{employeeView === 'edit' ? "Mettre à jour" : "Enregistrer le dossier"}</button>
                    <button type="button" className="btn-secondary" style={{ flex: 1 }} onClick={() => setEmployeeView('list')}>Annuler</button>
                  </div>
                </form>
              </div>
            ) : employeeView === 'badge' ? (
              <section className="animate-fade-in" style={{ width: '100%', maxWidth: '800px', margin: '0 auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                <div className="glass-panel profile-main" style={{ position: 'relative', padding: '1.5rem', width: '100%' }}>
                  <button className="btn-icon" style={{ position: 'absolute', top: '1rem', right: '1rem', zIndex: 10 }} onClick={() => setEmployeeView('list')}>✕</button>
                  <div className="profile-header" style={{ display: 'flex', gap: '2rem', alignItems: 'center', marginBottom: '3rem', padding: '1rem' }}>
                    <div className="profile-image-wrapper" style={{ flexShrink: 0, width: '120px', height: '140px', borderRadius: '16px', overflow: 'hidden', border: '3px solid var(--primary-glow)', boxShadow: '0 10px 20px rgba(0,0,0,0.2)' }}>
                      <img src={selectedEmployee.avatar || avatarPlaceholder} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="Avatar" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <h1 style={{ marginBottom: '0.25rem', fontSize: '1.8rem' }}>{selectedEmployee.firstName}<br />{selectedEmployee.lastName?.toUpperCase()}</h1>
                      <p style={{ fontSize: '1.1rem', color: 'var(--primary)', fontWeight: '600', marginBottom: '0.5rem' }}>{selectedEmployee.role}</p>
                      <div className="id-badge" style={{ display: 'inline-block', background: 'var(--primary-glow)', padding: '4px 12px', borderRadius: '8px', fontSize: '0.8rem', fontFamily: 'monospace', fontWeight: 'bold', color: 'var(--primary)' }}>{selectedEmployee.matricule}</div>
                    </div>
                  </div>

                  <div className="badge-stats-grid">
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

                  <div style={{ background: 'var(--card-bg-medium)', padding: '1.5rem', borderRadius: '12px', textAlign: 'center', border: selectedEmployee.aptitudeMedicale ?? true ? '2px solid var(--accent-glow)' : '2px solid var(--danger-glow)' }}>
                    <div style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '2px', color: 'var(--text-dim)', marginBottom: '0.5rem' }}>Aptitude Médicale Officielle</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: '900', color: selectedEmployee.aptitudeMedicale ?? true ? 'var(--accent)' : 'var(--danger)' }}>
                      {selectedEmployee.aptitudeMedicale ?? true ? '✅ APTE' : '❌ INAPTE'}
                    </div>
                  </div>

                  <h3 style={{ marginBottom: '1.5rem', fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '2px' }}>Registre des Formations</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {selectedEmployee.certifications.length > 0 ? selectedEmployee.certifications.map((c, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--card-bg-medium)', padding: '1rem', borderRadius: '12px', borderLeft: `4px solid ${isExpired(c.dateExpiration) ? 'var(--danger)' : ((new Date(c.dateExpiration) - new Date()) < (30 * 24 * 60 * 60 * 1000) ? 'var(--warning)' : 'var(--accent)')}` }}>
                        <div>
                          <div style={{ fontWeight: '700' }}>{c.name}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Délivré le {c.dateObtention}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                            {(new Date(c.dateExpiration) - new Date()) < (30 * 24 * 60 * 60 * 1000) && !isExpired(c.dateExpiration) ? <span style={{ color: 'var(--warning)', fontWeight: '800' }}>BIENTÔT EXPIRED! </span> : null}
                            {isExpired(c.dateExpiration) ? <span style={{ color: 'var(--danger)', fontWeight: '800' }}>EXPIRED! </span> : 'Expiration'}
                          </div>
                          <div style={{ fontWeight: '700', color: isExpired(c.dateExpiration) ? 'var(--danger)' : 'var(--text-main)' }}>{c.dateExpiration}</div>
                        </div>
                      </div>
                    )) : <p>Aucun certificat enregistré.</p>}
                  </div>

                  <div className="form-actions" style={{ marginTop: '2.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center', width: '100%' }}>
                    <button className="btn-primary" style={{ width: '100%', maxWidth: '300px', justifyContent: 'center', padding: '1.2rem' }} onClick={printBadge}>
                      ⎙ Imprimer le Badge PDF
                    </button>
                    {currentUser?.role === 'Admin' && (
                      <button className="btn-secondary" style={{ width: '100%', maxWidth: '300px', justifyContent: 'center', padding: '1.2rem' }} onClick={() => startEdit(selectedEmployee)}>
                        ✎ Modifier le dossier
                      </button>
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

                  <div className="glass-panel" style={{ padding: '2rem' }}>
                    <h3 style={{ fontSize: '1rem', marginBottom: '1.5rem' }}>EPI Fournis</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {[
                        { key: 'gants', label: 'Gants' },
                        { key: 'chaussures', label: 'Chaussures Sécu' },
                        { key: 'casques', label: 'Casque' },
                        { key: 'uniforme', label: 'Uniforme Manche L.' },
                        { key: 'gillet', label: 'Gillet Cotton' }
                      ].map(({ key, label }) => {
                        const epiData = selectedEmployee.epis?.[key] || { checked: false, date: '' };
                        return (
                          <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                            <span style={{ color: epiData.checked ? 'var(--text-main)' : 'var(--text-dim)', fontWeight: epiData.checked ? 'bold' : 'normal' }}>{label}</span>
                            {epiData.checked ? (
                              <span style={{ fontSize: '0.8rem', color: 'var(--accent)', background: 'var(--accent-glow)', padding: '2px 8px', borderRadius: '4px' }}>{epiData.date ? epiData.date : 'Doté'}</span>
                            ) : (
                              <span style={{ fontSize: '0.8rem', color: 'var(--danger)', opacity: 0.5 }}>NON</span>
                            )}
                          </div>
                        )
                      })}
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
                              <div style={{ background: selectedEmployee.aptitudeMedicale !== false ? '#dcfce7' : '#fee2e2', color: selectedEmployee.aptitudeMedicale !== false ? '#166534' : '#991b1b', padding: '6px', borderRadius: '4px', fontWeight: 'bold', fontSize: '12px', textTransform: 'uppercase', marginTop: '5px' }}>
                                Aptitude : {selectedEmployee.aptitudeMedicale !== false ? '✅ APTE' : '❌ INAPTE'}
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

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: selectedEmployee.aptitudeMedicale !== false ? '#10b981' : '#f43f5e', color: 'white', padding: '5px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold', marginBottom: '15px' }}>
                            <span>Aptitude Médicale</span>
                            <span>{selectedEmployee.aptitudeMedicale !== false ? 'APTE' : 'INAPTE'}</span>
                          </div>

                          <div style={{ fontSize: '10px', fontWeight: '900', color: '#1e293b', borderBottom: '2px solid #1e293b', paddingBottom: '5px', marginBottom: '10px' }}>LISTE DES CERTIFICATIONS</div>
                          <div style={{ flex: 1 }}>
                            {selectedEmployee.certifications.length > 0 ? (
                              selectedEmployee.certifications.map((c, i) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', padding: '7px 0', fontSize: '10px' }}>
                                  <div style={{ fontWeight: 'bold', color: '#334155', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                    {c.name}
                                    {(new Date(c.dateExpiration) - new Date()) < (30 * 24 * 60 * 60 * 1000) && <span style={{ color: '#d97706', fontSize: '8px' }}>⚠️</span>}
                                  </div>
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
