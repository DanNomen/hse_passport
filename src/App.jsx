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

const INITIAL_EPC = {
  extincteurs: false,
  balisage: false,
  echafaudage: false,
  gardecorps: false,
  lignedevie: false,
  eclairage: false,
  kitantipollution: false
}

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

const calculateProjectDuration = (startDate) => {
  if (!startDate) return '0 jour';
  const start = new Date(startDate);
  const now = new Date();
  
  // Set to midnight to compare full days
  start.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  
  const diffTime = now.getTime() - start.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
  
  if (diffDays <= 0) return 'Début bientôt';
  return `${diffDays} jour${diffDays > 1 ? 's' : ''}`;
};

function App() {
  const isProd = true // Activé pour la collaboration
  const API_URL = 'http://46.105.75.234:3009/api'.trim()
  const DB_PREFIX = '_prod'

  // --- Robust Storage Management ---
  const safeStorage = {
    setItem: (key, value) => {
      try {
        localStorage.setItem(key, value);
      } catch (e) {
        if (e.name === 'QuotaExceededError') {
          console.warn("Storage full, attempting cleanup...");
          // 1. Remove all old versions and non-critical data
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('hse_') && !k.includes('v3') && !k.includes('isAuthenticated') && !k.includes('currentUser')) {
              localStorage.removeItem(k);
            }
          }
          try {
            // Retry
            localStorage.setItem(key, value);
          } catch (e2) {
            // 2. If still full and it's the employee list, strip the heavy avatars for the cache
            if (key.includes('employees')) {
              try {
                console.warn("Storage still full, caching without avatars...");
                const data = JSON.parse(value);
                const lightData = data.map(emp => ({ ...emp, avatar: null }));
                localStorage.setItem(key, JSON.stringify(lightData));
              } catch (e3) {
                localStorage.removeItem(key);
              }
            }
          }
        }
      }
    },
    getItem: (key) => localStorage.getItem(key),
    removeItem: (key) => localStorage.removeItem(key)
  };

  // --- States ---
  const [isAuthenticated, setIsAuthenticated] = useState(() => safeStorage.getItem('hse_isAuthenticated') === 'true')

  // --- Nettoyage du Stockage local (One-time) ---
  useEffect(() => {
    try {
      const oldKeys = ['hse_employees', 'hse_employees_v2', 'hse_accounts_v1'];
      oldKeys.forEach(k => localStorage.removeItem(k));
    } catch (e) { }
  }, [])

  const [currentUser, setCurrentUser] = useState(() => JSON.parse(safeStorage.getItem('hse_currentUser') || 'null'))
  const [theme, setTheme] = useState(() => {
    const saved = safeStorage.getItem('hse_theme');
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  })

  const [accounts, setAccounts] = useState(() => {
    const saved = safeStorage.getItem(`hse_accounts_v3${DB_PREFIX}`)
    return saved ? JSON.parse(saved) : INITIAL_ACCOUNTS
  })

  const [employees, setEmployees] = useState(() => {
    const saved = safeStorage.getItem(`hse_employees_v3${DB_PREFIX}`)
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
  const [selectedHub, setSelectedHub] = useState(() => localStorage.getItem('hse_selectedHub') || null)
  const [projetView, setProjetView] = useState('projet')
  const [projets, setProjets] = useState(() => {
    const saved = localStorage.getItem('gp_projets_v1')
    return saved ? JSON.parse(saved) : []
  })
  const [projetFormData, setProjetFormData] = useState({
    nomChantier: '', lieu: '', dateDebut: '', outillageCaisse: '', responsableChantier: '',
    epc: { ...INITIAL_EPC }
  })
  const [projetWizardStep, setProjetWizardStep] = useState(1)
  const [projetIntervenants, setProjetIntervenants] = useState([])
  const [intervenantSearch, setIntervenantSearch] = useState('')
  const [selectedProjetIndex, setSelectedProjetIndex] = useState(null)
  const [caisses, setCaisses] = useState(() => {
    const saved = localStorage.getItem('gp_caisses_v1')
    return saved ? JSON.parse(saved) : []
  })
  const [caisseFormData, setCaisseFormData] = useState({ numeroCaisse: '', affecterA: '', materiels: [] })
  const [newMateriel, setNewMateriel] = useState('')
  const [previousView, setPreviousView] = useState(null)

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
            connectTimeout: 30000
          })
          if (resAcc.status === 200 && resAcc.data.success) {
            setAccounts(resAcc.data.accounts)
            safeStorage.setItem(`hse_accounts_v3${DB_PREFIX}`, JSON.stringify(resAcc.data.accounts))
          }

          // Récupérer les employés
          const resEmp = await CapacitorHttp.get({
            url: `${API_URL}/employees`,
            connectTimeout: 30000
          })
          if (resEmp.status === 200 && resEmp.data.success) {
            setEmployees(resEmp.data.employees)
            safeStorage.setItem(`hse_employees_v3${DB_PREFIX}`, JSON.stringify(resEmp.data.employees))
          }

          // Récupérer les projets
          const resProj = await CapacitorHttp.get({
            url: `${API_URL}/projets`,
            connectTimeout: 30000
          })
          if (resProj.status === 200 && resProj.data.success) {
            setProjets(resProj.data.projets)
            safeStorage.setItem('gp_projets_v1', JSON.stringify(resProj.data.projets))
          }

          // Récupérer les caisses
          const resCaisse = await CapacitorHttp.get({
            url: `${API_URL}/caisses`,
            connectTimeout: 30000
          })
          if (resCaisse.status === 200 && resCaisse.data.success) {
            setCaisses(resCaisse.data.caisses)
            safeStorage.setItem('gp_caisses_v1', JSON.stringify(resCaisse.data.caisses))
          }
        } catch (err) {
          console.error("Erreur chargement initial:", err)
          if (err.message?.includes('UNREACHABLE')) {
            showToast("Le serveur de production est temporairement injoignable.", "danger")
          }
        }
      }
    }
    fetchInitialData()
  }, [isProd, isAuthenticated, API_URL, DB_PREFIX])

  useEffect(() => {
    safeStorage.setItem(`hse_employees_v3${DB_PREFIX}`, JSON.stringify(employees))
    safeStorage.setItem(`hse_accounts_v3${DB_PREFIX}`, JSON.stringify(accounts))
  }, [employees, accounts, DB_PREFIX])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    safeStorage.setItem('hse_theme', theme)
  }, [theme])


  useEffect(() => {
    if (draftCert.dateObtention && draftCert.validite) {
      const date = new Date(draftCert.dateObtention)
      date.setFullYear(date.getFullYear() + Number(draftCert.validite))
      setDraftCert(prev => ({ ...prev, dateExpiration: date.toISOString().split('T')[0] }))
    }
  }, [draftCert.dateObtention, draftCert.validite])

  // Header is now permanent (scrolling logic removed for comfort)
  useEffect(() => {
    setShowHeader(true)
  }, [])

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
    const handleStatusChange = () => setIsOnline(navigator.onLine)
    window.addEventListener('online', handleStatusChange)
    window.addEventListener('offline', handleStatusChange)

    return () => {
      window.removeEventListener('online', handleStatusChange)
      window.removeEventListener('offline', handleStatusChange)
    }
  }, [isProd, isAuthenticated, isOnline, isSyncing])

  // --- API Service (Robustness & Fallback) ---
  const apiCall = async (method, endpoint, data = null) => {
    const url = `${API_URL}${endpoint}`
    const options = {
      url,
      headers: { 'Content-Type': 'application/json' },
      data: data,
      connectTimeout: 15000, // Timeout un peu plus long pour les mauvaises connexions
      method: method.toUpperCase()
    }

    try {
      const { CapacitorHttp } = await import('@capacitor/core')
      const response = await CapacitorHttp.request(options)
      return response
    } catch (capError) {
      console.warn("CapacitorHttp failed, switching to fetch fallback:", capError)
      try {
        const fetchOptions = {
          method: method.toUpperCase(),
          headers: { 'Content-Type': 'application/json' },
          body: data ? JSON.stringify(data) : null
        }
        const res = await fetch(url, fetchOptions)
        const resData = await res.json()
        return { status: res.status, data: resData }
      } catch (fetchError) {
        throw new Error("Impossible de joindre le serveur. Vérifiez votre connexion ou l'état du serveur.")
      }
    }
  }

  const syncData = async () => {
    if (!isOnline) {
      showToast("Pas de connexion internet", "danger")
      return
    }

    setIsSyncing(true)
    try {
      const [resEmp, resProj, resCaisse] = await Promise.all([
        apiCall('GET', '/employees'),
        apiCall('GET', '/projets'),
        apiCall('GET', '/caisses')
      ])

      if (resEmp.status === 200 && resEmp.data.success) {
        setEmployees(resEmp.data.employees)
        safeStorage.setItem(`hse_employees_v3${DB_PREFIX}`, JSON.stringify(resEmp.data.employees))
      }
      if (resProj.status === 200 && resProj.data.success) {
        setProjets(resProj.data.projets)
        safeStorage.setItem('gp_projets_v1', JSON.stringify(resProj.data.projets))
      }
      if (resCaisse.status === 200 && resCaisse.data.success) {
        setCaisses(resCaisse.data.caisses)
        safeStorage.setItem('gp_caisses_v1', JSON.stringify(resCaisse.data.caisses))
      }

      showToast("Données synchronisées avec le serveur")
    } catch (err) {
      console.error(err)
      showToast(err.message, "danger")
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
      localStorage.setItem('hse_isAuthenticated', 'true')
      localStorage.setItem('hse_currentUser', JSON.stringify(account))
      localStorage.setItem('hse_selectedHub', selectedHub)
    }

    if (isProd && isOnline) {
      try {
        const res = await apiCall('POST', '/login', { email: emailInput, password: passwordInput })
        if (res.status === 200 && res.data.success) {
          finalizeAuth(res.data.account)
          return
        }
      } catch (err) {
        console.warn("Mode local activé (erreur login)")
      }
    }

    const scopeAccounts = selectedHub === 'projet' ? PROJET_ACCOUNTS : [...accounts, ...INITIAL_ACCOUNTS]
    const acc = scopeAccounts.find(a => a.email.toLowerCase() === emailInput && a.password === passwordInput)

    if (acc) {
      finalizeAuth(acc)
    } else {
      showToast("Identifiants incorrects", "danger")
    }
  }

  const handleAccountCreate = async (e) => {
    e.preventDefault()

    if (!isOnline) {
      showToast("Connexion requise pour créer un compte", "danger")
      return
    }

    const accountData = { ...newAccountFormData }

    try {
      showToast("Création du compte en cours...", "info")
      const res = await apiCall('POST', '/accounts', accountData)

      if (res.status === 200) {
        setAccounts(prev => [...prev, accountData])
        showToast("Compte créé avec succès sur le serveur")
        setNewAccountFormData({ email: '', password: '', role: 'Visiteur' })
      } else {
        showToast("Erreur lors de la création sur le serveur", "danger")
      }
    } catch (err) {
      showToast(err.message, "danger")
    }
  }

  const handleAccountDelete = async (email) => {
    setConfirmDialog({ isOpen: true, item: { email }, type: 'account' });
  }

  const executeDelete = async () => {
    const dialogType = confirmDialog.type
    const dialogItem = confirmDialog.item

    if (!isOnline) {
      showToast("Connexion requise pour supprimer sur le serveur", "danger")
      return
    }

    try {
      showToast("Suppression en cours...", "info")

      if (dialogType === 'account') {
        const email = dialogItem.email;
        const res = await apiCall('DELETE', `/accounts/${email}`)

        if (res.status === 200) {
          setAccounts(prev => prev.filter(a => a.email !== email))
          showToast("Compte retiré du serveur")
        } else {
          showToast("Échec de la suppression sur le serveur", "danger")
        }

      } else if (dialogType === 'employee') {
        const id = dialogItem.matricule;
        const res = await apiCall('DELETE', `/employees/${id}`)

        if (res.status === 200) {
          const updatedEmployees = employees.filter(e => e.matricule !== id)
          setEmployees(updatedEmployees)
          localStorage.setItem(`hse_employees_v3${DB_PREFIX}`, JSON.stringify(updatedEmployees))
          showToast("Employé retiré du serveur")
        } else {
          showToast("Échec de la suppression sur le serveur", "danger")
        }
      }
    } catch (e) {
      showToast(e.message, "danger")
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

    if (!isOnline) {
      showToast("Vous devez être connecté pour enregistrer sur la Prod", "danger")
      return
    }

    const compliance = calculateCompliance(formData.certifications)
    const newEmp = {
      ...formData,
      name: `${formData.firstName} ${formData.lastName}`,
      compliance,
      status: getStatusLabel(compliance),
      matricule: formData.matricule || `HSE-${Date.now().toString().slice(-4)}-${Math.floor(Math.random() * 900) + 100}-PX`
    }

    try {
      showToast("Envoi au serveur de production...", "info")
      const res = await apiCall('POST', '/employees', newEmp)

      if (res.status === 200) {
        const updatedEmployees = employeeView === 'edit'
          ? employees.map(emp => emp.matricule === selectedEmployee.matricule ? newEmp : emp)
          : [newEmp, ...employees]

        setEmployees(updatedEmployees)
        safeStorage.setItem(`hse_employees_v3${DB_PREFIX}`, JSON.stringify(updatedEmployees))

        showToast("Données enregistrées directement sur le serveur !")
        setEmployeeView('list')
        setFormData({ firstName: '', lastName: '', matricule: '', role: '', certifications: [], avatar: null, aptitudeMedicale: true, epis: { gants: { checked: false, date: '' }, chaussures: { checked: false, date: '' }, casques: { checked: false, date: '' }, uniforme: { checked: false, date: '' }, gillet: { checked: false, date: '' } } })
      } else {
        showToast("Erreur serveur: " + (res.data?.message || "Indéterminée"), "danger")
      }
    } catch (err) {
      console.error("Save online failed:", err)
      showToast(err.message, "danger")
    }
  }

  const resetProjetForm = () => {
    setProjetFormData({
      nomChantier: '', lieu: '', dateDebut: '', outillageCaisse: '', responsableChantier: '',
      epc: { ...INITIAL_EPC }
    })
    setProjetIntervenants([])
    setProjetWizardStep(1)
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
          <img src={emp.avatar || avatarPlaceholder} style={{ width: '100%', height: '100%', borderRadius: '12px', objectFit: 'cover' }} alt="Avatar" />
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
          {isProd && <span className="mobile-hide" style={{ color: 'var(--accent)', fontSize: '0.75rem', fontWeight: 'bold', marginRight: '1rem' }}>🟢 PROD DB</span>}
          <button className="btn-icon" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>

          {isAuthenticated && (
            <>
              {selectedHub === 'hse' ? (
                <>
                  <button
                    className="btn-icon"
                    onClick={() => syncData()}
                    disabled={isSyncing}
                    style={{ color: isOnline ? 'var(--accent)' : 'var(--text-dim)', marginRight: '10px' }}
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
                  <button className={`btn-secondary nav-btn logout-btn ${employeeView !== 'list' ? 'mobile-hide' : ''}`} onClick={() => {
                    setIsAuthenticated(false);
                    setCurrentUser(null);
                    setSelectedHub(null);
                    localStorage.removeItem('hse_isAuthenticated');
                    localStorage.removeItem('hse_currentUser');
                    localStorage.removeItem('hse_selectedHub');
                  }}>Déconnexion</button>
                </>
              ) : (
                <>
                  <button
                    className="btn-icon"
                    onClick={() => syncData()}
                    disabled={isSyncing}
                    style={{ color: isOnline ? '#3b82f6' : 'var(--text-dim)', marginRight: '10px' }}
                    title="Actualiser les données"
                  >
                    <span className={isSyncing ? 'animate-spin' : ''} style={{ display: 'inline-block' }}>☁️</span>
                  </button>
                  <button className={`btn-secondary nav-btn`} style={{ color: projetView === 'projet' ? '#3b82f6' : '' }} onClick={() => setProjetView('projet')}>Projet</button>
                  <button className={`btn-secondary nav-btn`} style={{ color: projetView === 'materiels' ? '#3b82f6' : '' }} onClick={() => setProjetView('materiels')}>Matériels</button>
                  {currentUser?.role === 'Admin' && (
                    <button className={`btn-secondary nav-btn`} style={{ color: projetView === 'parametres' ? '#3b82f6' : '' }} onClick={() => setProjetView('parametres')}>Paramètres</button>
                  )}
                  <span className="user-badge mobile-hide">
                    <span style={{ color: '#3b82f6', fontWeight: 'bold' }}>{currentUser?.email}</span>
                  </span>
                  <button className="btn-secondary nav-btn logout-btn" onClick={() => {
                    setIsAuthenticated(false);
                    setCurrentUser(null);
                    setSelectedHub(null);
                    localStorage.removeItem('hse_isAuthenticated');
                    localStorage.removeItem('hse_currentUser');
                    localStorage.removeItem('hse_selectedHub');
                  }}>Déconnexion</button>
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
                HSE Safety Tools
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
                      onClick={() => { setSelectedHub('hse'); localStorage.setItem('hse_selectedHub', 'hse'); }}
                      style={{ background: 'var(--card-bg-light)', border: '2px solid transparent', borderRadius: '12px', padding: '1.5rem', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '1rem', transition: 'all 0.3s ease' }}
                    >
                      <div style={{ fontSize: '2rem' }}>🛡️</div>
                      <div>
                        <div style={{ fontSize: '1.1rem', fontWeight: '800', color: 'white', marginBottom: '0.2rem' }}>HSE Passport</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Habilitations & Sécurité</div>
                      </div>
                    </button>

                    <button
                      onClick={() => { setSelectedHub('projet'); localStorage.setItem('hse_selectedHub', 'projet'); }}
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
                    <button onClick={() => { setSelectedHub(null); localStorage.removeItem('hse_selectedHub'); }} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 0, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
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
            {projetView === 'projet' && (
              <div>
                <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                    <h2 style={{ fontSize: '1.3rem', margin: 0 }}>Liste des Projets</h2>
                    <button className="btn-primary" onClick={() => setProjetView('addProjet')}>+ Nouveau Projet</button>
                  </div>
                </div>
                {projets.length === 0 ? (
                  <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center' }}>
                    <p style={{ color: 'var(--text-dim)' }}>Aucun projet enregistré pour le moment.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {projets.map((p, i) => (
                      <div key={i} className="glass-panel" style={{ padding: '1.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                          <div>
                            <div style={{ fontWeight: '700', fontSize: '1.1rem' }}>{p.nomChantier}</div>
                            <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginTop: '0.25rem' }}>{p.lieu} — <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>Resp: {p.responsableChantier || 'N/A'}</span></div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span>Début: {p.dateDebut}</span>
                              <span style={{ background: 'var(--primary-glow)', color: 'var(--primary)', padding: '2px 8px', borderRadius: '4px', fontWeight: 'bold' }}>
                                {calculateProjectDuration(p.dateDebut)}
                              </span>
                              <span>— {p.intervenants?.length || 0} intervenant(s)</span>
                              {p.outillageCaisse && <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>• 📦 {p.outillageCaisse}</span>}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <button className="btn-secondary" style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }} onClick={() => {
                              setProjetFormData({
                                nomChantier: p.nomChantier,
                                lieu: p.lieu,
                                dateDebut: p.dateDebut,
                                outillageCaisse: p.outillageCaisse || '',
                                responsableChantier: p.responsableChantier || '',
                                epc: p.epc || { ...INITIAL_EPC }
                              })
                              setProjetIntervenants(p.intervenants || [])
                              setProjetView('detailProjet')
                              setSelectedProjetIndex(i)
                            }}>Détails</button>
                            <button className="btn-secondary" style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }} onClick={() => {
                              setProjetFormData({
                                nomChantier: p.nomChantier,
                                lieu: p.lieu,
                                dateDebut: p.dateDebut,
                                outillageCaisse: p.outillageCaisse || '',
                                responsableChantier: p.responsableChantier || '',
                                epc: p.epc || { ...INITIAL_EPC }
                              })
                              setProjetIntervenants(p.intervenants || [])
                              setSelectedProjetIndex(i)
                              setProjetWizardStep(1)
                              setProjetView('editProjet')
                            }}>Modifier</button>
                            <button className="btn-secondary" style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', color: 'var(--danger)' }} onClick={async () => {
                              if (!isOnline) {
                                showToast("Désolé, connexion internet requise pour supprimer", "danger")
                                return
                              }
                              try {
                                showToast("Suppression sur le serveur...", "info")
                                const res = await apiCall('DELETE', `/projets/${p.nomChantier}`)

                                if (res.status === 200) {
                                  const updated = projets.filter((_, idx) => idx !== i)
                                  setProjets(updated)
                                  safeStorage.setItem('gp_projets_v1', JSON.stringify(updated))
                                  showToast('Projet supprimé du serveur')
                                } else {
                                  showToast("Échec de la suppression sur le serveur", "danger")
                                }
                              } catch (e) {
                                showToast(e.message, "danger")
                              }
                            }}>Supprimer</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {projetView === 'addProjet' && (
              <div className="glass-panel animate-slide-up" style={{ maxWidth: '600px', margin: '0 auto', padding: '3rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '1.5rem' }}>
                  <button className="btn-icon" onClick={() => {
                    if (projetWizardStep > 1) {
                      setProjetWizardStep(projetWizardStep - 1)
                    } else {
                      setProjetView('projet');
                      resetProjetForm();
                      setProjetIntervenants([]);
                    }
                  }}>←</button>
                  <h2>Nouveau Projet</h2>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem' }}>
                  <div style={{ flex: 1, height: '4px', borderRadius: '2px', background: 'var(--primary)' }}></div>
                  <div style={{ flex: 1, height: '4px', borderRadius: '2px', background: projetWizardStep >= 2 ? 'var(--primary)' : 'rgba(255,255,255,0.1)' }}></div>
                  <div style={{ flex: 1, height: '4px', borderRadius: '2px', background: projetWizardStep >= 3 ? 'var(--primary)' : 'rgba(255,255,255,0.1)' }}></div>
                </div>

                {projetWizardStep === 1 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', margin: 0 }}>Étape 1/3 — Informations du projet</p>
                    <div>
                      <label className="input-label">Nom du Chantier</label>
                      <input type="text" className="glass-input" placeholder="Ex: Chantier Toamasina" value={projetFormData.nomChantier} onChange={e => setProjetFormData({ ...projetFormData, nomChantier: e.target.value })} />
                    </div>
                    <div>
                      <label className="input-label">Lieu</label>
                      <input type="text" className="glass-input" placeholder="Ex: Antananarivo" value={projetFormData.lieu} onChange={e => setProjetFormData({ ...projetFormData, lieu: e.target.value })} />
                    </div>
                    <div>
                      <label className="input-label">Date de début</label>
                      <input type="date" className="glass-input" value={projetFormData.dateDebut} onChange={e => setProjetFormData({ ...projetFormData, dateDebut: e.target.value })} />
                    </div>

                    <button
                      type="button"
                      className="btn-primary"
                      style={{ width: '100%', justifyContent: 'center', marginTop: '1rem' }}
                      disabled={!projetFormData.nomChantier || !projetFormData.lieu || !projetFormData.dateDebut}
                      onClick={() => setProjetWizardStep(2)}
                    >Suivant →</button>
                  </div>
                )}

                {projetWizardStep === 2 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', margin: 0 }}>Étape 2/3 — Responsable et Intervenants</p>

                    <div>
                      <label className="input-label">Responsable Chantier (HSE Passport)</label>
                      <select
                        className="glass-input"
                        value={projetFormData.responsableChantier}
                        onChange={e => setProjetFormData({ ...projetFormData, responsableChantier: e.target.value })}
                      >
                        <option value="">Sélectionner le responsable du chantier...</option>
                        {employees.map(emp => (
                          <option key={emp.matricule} value={emp.name}>{emp.name}</option>
                        ))}
                      </select>
                    </div>

                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem' }}>
                      <label className="input-label">Liste des Intervenants ({projetIntervenants.length})</label>
                      {projetIntervenants.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                          {projetIntervenants.map((intv, i) => (
                            <span key={i} style={{ background: 'var(--primary-glow)', color: 'var(--primary)', padding: '0.3rem 0.8rem', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              {intv.name}
                              <span style={{ cursor: 'pointer', opacity: 0.7 }} onClick={() => setProjetIntervenants(prev => prev.filter((_, idx) => idx !== i))}>✕</span>
                            </span>
                          ))}
                        </div>
                      )}

                      <div style={{ position: 'relative' }}>
                        <input type="text" className="glass-input" placeholder="Ajouter des intervenants..." value={intervenantSearch} onChange={e => setIntervenantSearch(e.target.value)} />
                        {intervenantSearch.trim().length > 0 && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: 'var(--bg-deep)', border: '1px solid var(--glass-border)', borderRadius: '12px', marginTop: '5px', maxHeight: '200px', overflowY: 'auto', boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}>
                            {employees
                              .filter(emp => !projetIntervenants.some(intv => intv.matricule === emp.matricule))
                              .filter(emp => emp.name.toLowerCase().includes(intervenantSearch.toLowerCase()) || emp.matricule.toLowerCase().includes(intervenantSearch.toLowerCase()))
                              .map(emp => (
                                <div
                                  key={emp.matricule}
                                  onClick={() => { setProjetIntervenants(prev => [...prev, { matricule: emp.matricule, name: emp.name, role: emp.role }]); setIntervenantSearch('') }}
                                  style={{ padding: '0.8rem 1rem', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                >
                                  <div style={{ fontWeight: '600', fontSize: '0.85rem' }}>{emp.name}</div>
                                  <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>{emp.role}</div>
                                </div>
                              ))
                            }
                          </div>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="btn-primary"
                      style={{ width: '100%', justifyContent: 'center', marginTop: '1rem' }}
                      disabled={!projetFormData.responsableChantier}
                      onClick={() => setProjetWizardStep(3)}
                    >Suivant (Matériels) →</button>
                  </div>
                )}

                {projetWizardStep === 3 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', margin: 0 }}>Étape 3/3 — Matériels et Equipements</p>

                    <div>
                      <label className="input-label">Outillage (Sélection Caisse)</label>
                      <select
                        className="glass-input"
                        value={projetFormData.outillageCaisse}
                        onChange={e => setProjetFormData({ ...projetFormData, outillageCaisse: e.target.value })}
                      >
                        <option value="">Aucune caisse assignée...</option>
                        {caisses.map(c => (
                          <option key={c.numeroCaisse} value={c.numeroCaisse}>
                            {c.numeroCaisse} — {c.affecterA}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem' }}>
                      <label className="input-label">Check-list EPC (Facultatif)</label>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                        {[
                          { key: 'extincteurs', label: 'Extincteurs' },
                          { key: 'balisage', label: 'Balisage' },
                          { key: 'echafaudage', label: 'Échafaudage' },
                          { key: 'gardecorps', label: 'Garde-corps' },
                          { key: 'lignedevie', label: 'Lignes de vie' },
                          { key: 'eclairage', label: 'Éclairage' },
                          { key: 'kitantipollution', label: 'Anti-pollution' }
                        ].map(({ key, label }) => (
                          <div
                            key={key}
                            onClick={() => setProjetFormData({ ...projetFormData, epc: { ...projetFormData.epc, [key]: !projetFormData.epc[key] } })}
                            style={{
                              background: 'var(--card-bg-light)',
                              padding: '0.75rem',
                              borderRadius: '10px',
                              cursor: 'pointer',
                              border: projetFormData.epc[key] ? '1px solid var(--accent)' : '1px solid transparent',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                              transition: 'all 0.3s'
                            }}
                          >
                            <input type="checkbox" checked={projetFormData.epc[key] || false} onChange={() => { }} style={{ width: '16px', height: '16px' }} />
                            <span style={{ fontSize: '0.8rem', fontWeight: '600' }}>{label}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="btn-primary"
                      style={{ width: '100%', justifyContent: 'center', marginTop: '1rem' }}
                      onClick={async () => {
                        const manager = employees.find(e => e.name === projetFormData.responsableChantier);
                        let finalIntervenants = [...projetIntervenants];
                        if (manager && !finalIntervenants.some(i => i.matricule === manager.matricule)) {
                          finalIntervenants.push({ matricule: manager.matricule, name: manager.name, role: manager.role });
                        }
                        if (!isOnline) {
                          showToast("Connexion internet requise pour créer un projet", "danger")
                          return
                        }

                        const newProjet = {
                          ...projetFormData,
                          intervenants: finalIntervenants,
                          dateCreation: new Date().toLocaleDateString('fr-FR')
                        }

                        try {
                          showToast("Création du projet sur le serveur...", "info")
                          const res = await apiCall('POST', '/projets', newProjet)

                          if (res.status === 200) {
                            const updated = [newProjet, ...projets]
                            setProjets(updated)
                            safeStorage.setItem('gp_projets_v1', JSON.stringify(updated))
                            resetProjetForm()
                            setProjetView('projet')
                            showToast('Projet enregistré avec succès sur le serveur')
                          } else {
                            showToast("Échec de l'enregistrement sur le serveur", "danger")
                          }
                        } catch (e) {
                          showToast(e.message, "danger")
                        }
                      }}
                    >Finaliser et Créer le Projet</button>
                  </div>
                )}
              </div>
            )}

            {projetView === 'materiels' && (
              <div className="animate-fade-in">
                <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                    <h2 style={{ fontSize: '1.3rem', margin: 0 }}>Gestion des Caisses (Matériels)</h2>
                    <button className="btn-primary" onClick={() => {
                      setCaisseFormData({ numeroCaisse: '', affecterA: '', materiels: [] });
                      setProjetView('addCaisse');
                    }}>+ Nouveau Caisse</button>
                  </div>
                </div>

                {caisses.length === 0 ? (
                  <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center' }}>
                    <p style={{ color: 'var(--text-dim)' }}>Aucune caisse enregistrée.</p>
                  </div>
                ) : (
                  <div className="responsive-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
                    {caisses.map((c, i) => (
                      <div key={i} className="glass-panel animate-slide-up" style={{ padding: '1.5rem', borderLeft: '4px solid var(--primary)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                          <div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px' }}>Numéro Caisse</div>
                            <div style={{ fontWeight: '800', fontSize: '1.2rem', color: 'var(--primary)' }}>{c.numeroCaisse}</div>
                          </div>
                          <button className="btn-icon" onClick={async () => {
                            if (!isOnline) {
                              showToast("Connexion internet requise pour supprimer", "danger")
                              return
                            }
                            try {
                              showToast("Suppression caisse...", "info")
                              const res = await apiCall('DELETE', `/caisses/${c.numeroCaisse}`)

                              if (res.status === 200) {
                                const updated = caisses.filter((_, idx) => idx !== i);
                                setCaisses(updated);
                                safeStorage.setItem('gp_caisses_v1', JSON.stringify(updated));
                                showToast('Caisse supprimée du serveur');
                              } else {
                                showToast("Échec serveur lors de la suppression", "danger")
                              }
                            } catch (e) {
                              showToast(e.message, "danger")
                            }
                          }} style={{ color: 'var(--danger)' }}>🗑</button>
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px' }}>Affecté à</div>
                          <div style={{ fontWeight: '600' }}>{c.affecterA || 'Non assigné'}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.5rem' }}>Matériels ({c.materiels?.length || 0})</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                            {c.materiels?.slice(0, 3).map((m, idx) => (
                              <span key={idx} style={{ fontSize: '0.75rem', background: 'var(--card-bg-light)', padding: '2px 8px', borderRadius: '4px' }}>{m}</span>
                            ))}
                            {c.materiels?.length > 3 && <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>+{c.materiels.length - 3} de plus</span>}
                          </div>
                        </div>
                        <button className="btn-secondary" style={{ width: '100%', marginTop: '1.5rem', fontSize: '0.8rem' }} onClick={() => {
                          setCaisseFormData(c);
                          setSelectedProjetIndex(i);
                          setProjetView('detailCaisse');
                        }}>Détails complets</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {projetView === 'addCaisse' && (
              <div className="glass-panel animate-slide-up" style={{ maxWidth: '600px', margin: '0 auto', padding: '3rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '2rem' }}>
                  <button className="btn-icon" onClick={() => setProjetView('materiels')}>←</button>
                  <h2>Nouveau Caisse</h2>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div>
                    <label className="input-label">Numéro du Caisse</label>
                    <input
                      type="text"
                      className="glass-input"
                      placeholder="Ex: CAI-001"
                      value={caisseFormData.numeroCaisse}
                      onChange={e => setCaisseFormData({ ...caisseFormData, numeroCaisse: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="input-label">Affecter à (HSE Passport)</label>
                    <select
                      className="glass-input"
                      value={caisseFormData.affecterA}
                      onChange={e => setCaisseFormData({ ...caisseFormData, affecterA: e.target.value })}
                    >
                      <option value="">Sélectionner un collaborateur...</option>
                      {employees.map(emp => (
                        <option key={emp.matricule} value={emp.name}>{emp.name}</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1.5rem' }}>
                    <label className="input-label">Liste des matériels</label>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                      <input
                        type="text"
                        className="glass-input"
                        placeholder="Ajouter un outil..."
                        value={newMateriel}
                        onChange={e => setNewMateriel(e.target.value)}
                        onKeyPress={e => e.key === 'Enter' && (e.preventDefault(), setNewMateriel(''), setCaisseFormData({ ...caisseFormData, materiels: [...caisseFormData.materiels, newMateriel] }))}
                      />
                      <button className="btn-primary" onClick={() => {
                        if (newMateriel.trim()) {
                          setCaisseFormData({ ...caisseFormData, materiels: [...caisseFormData.materiels, newMateriel.trim()] });
                          setNewMateriel('');
                        }
                      }}>Add</button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                      {caisseFormData.materiels.map((m, idx) => (
                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--card-bg-light)', padding: '0.6rem 1rem', borderRadius: '8px' }}>
                          <span>{m}</span>
                          <button style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }} onClick={() => setCaisseFormData({ ...caisseFormData, materiels: caisseFormData.materiels.filter((_, i) => i !== idx) })}>✕</button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    className="btn-primary"
                    style={{ width: '100%', justifyContent: 'center', marginTop: '1rem' }}
                    disabled={!caisseFormData.numeroCaisse}
                    onClick={async () => {
                      if (!isOnline) {
                        showToast("Connexion internet requise", "danger")
                        return
                      }

                      try {
                        showToast("Enregistrement caisse...", "info")
                        const res = await apiCall('POST', '/caisses', caisseFormData)

                        if (res.status === 200) {
                          const updated = [caisseFormData, ...caisses];
                          setCaisses(updated);
                          safeStorage.setItem('gp_caisses_v1', JSON.stringify(updated));
                          setProjetView('materiels');
                          showToast('Caisse enregistrée sur le serveur');
                        } else {
                          showToast("Erreur serveur lors de la création", "danger")
                        }
                      } catch (e) {
                        showToast(e.message, "danger")
                      }
                    }}
                  >Enregistrer la Caisse</button>
                </div>
              </div>
            )}

            {projetView === 'detailCaisse' && (
              <div className="glass-panel animate-slide-up" style={{ maxWidth: '600px', margin: '0 auto', padding: '3rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '2rem' }}>
                  <button className="btn-icon" onClick={() => {
                    if (previousView === 'detailProjet') {
                      setProjetView('detailProjet');
                      setPreviousView(null);
                    } else {
                      setProjetView('materiels');
                    }
                  }}>←</button>
                  <h2>Détails de la Caisse</h2>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                    <div>
                      <label className="input-label">Numéro Caisse</label>
                      <div style={{ fontWeight: '800', fontSize: '1.5rem', color: 'var(--primary)' }}>{caisseFormData.numeroCaisse}</div>
                    </div>
                    <div>
                      <label className="input-label">Affecté à</label>
                      <div style={{ fontWeight: '700', fontSize: '1.1rem' }}>{caisseFormData.affecterA || 'N/A'}</div>
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1.5rem' }}>
                    <label className="input-label">Contenu ({caisseFormData.materiels?.length || 0} articles)</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
                      {caisseFormData.materiels?.map((m, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'var(--card-bg-light)', padding: '0.8rem 1.2rem', borderRadius: '10px' }}>
                          <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>#{idx + 1}</span>
                          <span style={{ fontWeight: '500' }}>{m}</span>
                        </div>
                      ))}
                      {(!caisseFormData.materiels || caisseFormData.materiels.length === 0) && (
                        <p style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '1rem' }}>Cette caisse est vide.</p>
                      )}
                    </div>
                  </div>

                  <button className="btn-secondary" style={{ width: '100%', marginTop: '1rem' }} onClick={() => {
                    if (previousView === 'detailProjet') {
                      setProjetView('detailProjet');
                      setPreviousView(null);
                    } else {
                      setProjetView('materiels');
                    }
                  }}>Retour à la liste</button>
                </div>
              </div>
            )}

            {projetView === 'detailProjet' && selectedProjetIndex !== null && (
              <div className="glass-panel animate-slide-up" style={{ maxWidth: '600px', margin: '0 auto', padding: '3rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '2rem' }}>
                  <button className="btn-icon" onClick={() => setProjetView('projet')}>←</button>
                  <h2>Détails du Projet</h2>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div><label className="input-label">Nom du Chantier</label><p style={{ margin: '0.25rem 0 0', fontWeight: '600', fontSize: '1rem' }}>{projetFormData.nomChantier}</p></div>
                  <div><label className="input-label">Responsable Chantier</label><p style={{ margin: '0.25rem 0 0', fontWeight: '700', fontSize: '1.1rem', color: 'var(--primary)' }}>{projetFormData.responsableChantier || "Non désigné"}</p></div>
                  <div><label className="input-label">Lieu</label><p style={{ margin: '0.25rem 0 0', fontWeight: '600', fontSize: '1rem' }}>{projetFormData.lieu}</p></div>
                  <div><label className="input-label">Date de début</label><p style={{ margin: '0.25rem 0 0', fontWeight: '600', fontSize: '1rem' }}>{projetFormData.dateDebut}</p></div>
                  <div>
                    <label className="input-label">Caisse d'outillage</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'var(--card-bg-light)', padding: '1rem', borderRadius: '10px', marginTop: '0.5rem' }}>
                      <div style={{ fontSize: '1.5rem' }}>📦</div>
                      <div>
                        {projetFormData.outillageCaisse ? (
                          <div
                            style={{ cursor: 'pointer' }}
                            onClick={() => {
                              const caisse = caisses.find(c => c.numeroCaisse === projetFormData.outillageCaisse);
                              if (caisse) {
                                setPreviousView('detailProjet');
                                setCaisseFormData(caisse);
                                setProjetView('detailCaisse');
                              } else {
                                showToast("Caisse introuvable", "danger");
                              }
                            }}
                          >
                            <div style={{ fontWeight: '700', fontSize: '1rem', color: 'var(--primary)', textDecoration: 'underline' }}>Caisse: {projetFormData.outillageCaisse}</div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                              Affecté à: {caisses.find(c => c.numeroCaisse === projetFormData.outillageCaisse)?.affecterA || "Personnel non identifié"}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--accent)', marginTop: '0.2rem' }}>Voir le contenu →</div>
                          </div>
                        ) : (
                          <div style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>Aucune caisse assignée</div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="input-label">Intervenants ({projetIntervenants.length})</label>
                    {projetIntervenants.length === 0 ? (
                      <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginTop: '0.25rem' }}>Aucun intervenant assigné.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                        {projetIntervenants.map((intv, i) => (
                          <div key={i} style={{ padding: '0.6rem 1rem', background: 'var(--card-bg-light)', borderRadius: '8px' }}>
                            <span style={{ fontWeight: '600' }}>{intv.name}</span>
                            <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginLeft: '0.5rem' }}>— {intv.role}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1.5rem' }}>
                    <label className="input-label">Protections Collectives (EPC)</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginTop: '0.75rem' }}>
                      {[
                        { key: 'extincteurs', label: '🧯 Extincteurs' },
                        { key: 'balisage', label: '🚧 Balisage' },
                        { key: 'echafaudage', label: '🏗️ Échafaudage' },
                        { key: 'gardecorps', label: '🛡️ Garde-corps' },
                        { key: 'lignedevie', label: '⚓ Lignes de vie' },
                        { key: 'eclairage', label: '💡 Éclairage' },
                        { key: 'kitantipollution', label: '🧼 Anti-poll.' }
                      ].map(({ key, label }) => {
                        const isSet = projetFormData.epc?.[key];
                        return (
                          <div key={key} style={{ padding: '0.6rem', borderRadius: '8px', background: isSet ? 'var(--accent-glow)' : 'var(--card-bg-light)', border: isSet ? '1px solid var(--accent)' : '1px solid transparent', opacity: isSet ? 1 : 0.4, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                            <span>{isSet ? '✅' : '⚪'}</span>
                            <span style={{ fontWeight: isSet ? 'bold' : 'normal' }}>{label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {projetView === 'editProjet' && selectedProjetIndex !== null && (
              <div className="glass-panel animate-slide-up" style={{ maxWidth: '600px', margin: '0 auto', padding: '3rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '1.5rem' }}>
                  <button className="btn-icon" onClick={() => {
                    if (projetWizardStep > 1) {
                      setProjetWizardStep(projetWizardStep - 1)
                    } else {
                      setProjetView('projet');
                      setProjetWizardStep(1);
                    }
                  }}>{"<"}</button>
                  <h2>Modifier le Projet</h2>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem' }}>
                  <div style={{ flex: 1, height: '4px', borderRadius: '2px', background: 'var(--primary)' }}></div>
                  <div style={{ flex: 1, height: '4px', borderRadius: '2px', background: projetWizardStep >= 2 ? 'var(--primary)' : 'rgba(255,255,255,0.1)' }}></div>
                  <div style={{ flex: 1, height: '4px', borderRadius: '2px', background: projetWizardStep >= 3 ? 'var(--primary)' : 'rgba(255,255,255,0.1)' }}></div>
                </div>

                {projetWizardStep === 1 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', margin: 0 }}>Etape 1/3 - Informations du projet</p>
                    <div><label className="input-label">Nom du Chantier</label><input type="text" className="glass-input" value={projetFormData.nomChantier} onChange={e => setProjetFormData({ ...projetFormData, nomChantier: e.target.value })} /></div>
                    <div><label className="input-label">Lieu</label><input type="text" className="glass-input" value={projetFormData.lieu} onChange={e => setProjetFormData({ ...projetFormData, lieu: e.target.value })} /></div>
                    <div><label className="input-label">Date de début</label><input type="date" className="glass-input" value={projetFormData.dateDebut} onChange={e => setProjetFormData({ ...projetFormData, dateDebut: e.target.value })} /></div>
                    <button type="button" className="btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: '1rem' }} disabled={!projetFormData.nomChantier || !projetFormData.lieu || !projetFormData.dateDebut} onClick={() => setProjetWizardStep(2)}>Suivant →</button>
                  </div>
                )}

                {projetWizardStep === 2 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', margin: 0 }}>Etape 2/3 - Responsable et Intervenants</p>
                    <div>
                      <label className="input-label">Responsable Chantier (HSE Passport)</label>
                      <select className="glass-input" value={projetFormData.responsableChantier} onChange={e => setProjetFormData({ ...projetFormData, responsableChantier: e.target.value })}>
                        <option value="">Selectionner le responsable...</option>
                        {employees.map(emp => (<option key={emp.matricule} value={emp.name}>{emp.name}</option>))}
                      </select>
                    </div>
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem' }}>
                      <label className="input-label">Intervenants ({projetIntervenants.length})</label>
                      {projetIntervenants.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                          {projetIntervenants.map((intv, i) => (
                            <span key={i} style={{ background: 'var(--primary-glow)', color: 'var(--primary)', padding: '0.3rem 0.8rem', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              {intv.name}
                              <span style={{ cursor: 'pointer', opacity: 0.7 }} onClick={() => setProjetIntervenants(prev => prev.filter((_, idx) => idx !== i))}>x</span>
                            </span>
                          ))}
                        </div>
                      )}
                      <div style={{ position: 'relative' }}>
                        <input type="text" className="glass-input" placeholder="Ajouter des intervenants..." value={intervenantSearch} onChange={e => setIntervenantSearch(e.target.value)} />
                        {intervenantSearch.trim().length > 0 && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: 'var(--bg-deep)', border: '1px solid var(--glass-border)', borderRadius: '12px', marginTop: '5px', maxHeight: '200px', overflowY: 'auto', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}>
                            {employees.filter(emp => !projetIntervenants.some(intv => intv.matricule === emp.matricule)).filter(emp => emp.name.toLowerCase().includes(intervenantSearch.toLowerCase()) || emp.matricule.toLowerCase().includes(intervenantSearch.toLowerCase())).map(emp => (
                              <div key={emp.matricule} onClick={() => { setProjetIntervenants(prev => [...prev, { matricule: emp.matricule, name: emp.name, role: emp.role }]); setIntervenantSearch('') }} style={{ padding: '0.8rem 1rem', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                <div style={{ fontWeight: '600', fontSize: '0.85rem' }}>{emp.name}</div>
                                <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>{emp.role}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <button type="button" className="btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: '1rem' }} disabled={!projetFormData.responsableChantier} onClick={() => setProjetWizardStep(3)}>Suivant (Materiels) →</button>
                  </div>
                )}

                {projetWizardStep === 3 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', margin: 0 }}>Etape 3/3 - Materiels et EPC</p>
                    <div>
                      <label className="input-label">Outillage (Selection Caisse)</label>
                      <select className="glass-input" value={projetFormData.outillageCaisse} onChange={e => setProjetFormData({ ...projetFormData, outillageCaisse: e.target.value })}>
                        <option value="">Aucune caisse assignee...</option>
                        {caisses.map(c => (<option key={c.numeroCaisse} value={c.numeroCaisse}>{c.numeroCaisse} - {c.affecterA}</option>))}
                      </select>
                    </div>
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem' }}>
                      <label className="input-label">Check-list EPC</label>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                        {[{ key: 'extincteurs', label: 'Extincteurs' }, { key: 'balisage', label: 'Balisage' }, { key: 'echafaudage', label: 'Echafaudage' }, { key: 'gardecorps', label: 'Garde-corps' }, { key: 'lignedevie', label: 'Lignes de vie' }, { key: 'eclairage', label: 'Eclairage' }, { key: 'kitantipollution', label: 'Anti-pollution' }].map(({ key, label }) => (
                          <div key={key} onClick={() => setProjetFormData({ ...projetFormData, epc: { ...projetFormData.epc, [key]: !projetFormData.epc?.[key] } })} style={{ background: 'var(--card-bg-light)', padding: '0.75rem', borderRadius: '10px', cursor: 'pointer', border: projetFormData.epc?.[key] ? '1px solid var(--accent)' : '1px solid transparent', display: 'flex', alignItems: 'center', gap: '0.5rem', transition: 'all 0.3s' }}>
                            <input type="checkbox" checked={projetFormData.epc?.[key] || false} onChange={() => { }} style={{ width: '16px', height: '16px' }} />
                            <span style={{ fontSize: '0.8rem', fontWeight: '600' }}>{label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <button type="button" className="btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: '1rem' }} onClick={async () => {
                      const manager = employees.find(e => e.name === projetFormData.responsableChantier);
                      let finalIntervenants = [...projetIntervenants];
                      if (manager && !finalIntervenants.some(i => i.matricule === manager.matricule)) {
                        finalIntervenants.push({ matricule: manager.matricule, name: manager.name, role: manager.role });
                      }

                      if (!isOnline) {
                        showToast("Connexion internet requise pour mettre à jour", "danger")
                        return
                      }

                      const updatedProjet = { ...projetFormData, intervenants: finalIntervenants, dateCreation: projets[selectedProjetIndex].dateCreation }
                      const updatedList = [...projets]
                      updatedList[selectedProjetIndex] = updatedProjet

                      try {
                        showToast("Mise à jour sur le serveur...", "info")
                        const res = await apiCall('POST', '/projets', updatedProjet)

                        if (res.status === 200) {
                          setProjets(updatedList)
                          safeStorage.setItem('gp_projets_v1', JSON.stringify(updatedList))
                          setProjetView('projet')
                          setProjetWizardStep(1)
                          showToast('Projet mis à jour sur le serveur')
                        } else {
                          showToast("Échec de la mise à jour serveur", "danger")
                        }
                      } catch (e) {
                        showToast(e.message, "danger")
                      }
                    }}>Enregistrer les modifications</button>
                  </div>
                )}
              </div>
            )}
            {projetView === 'parametres' && (
              <div className="glass-panel" style={{ padding: '2rem' }}>
                <h2>Paramètres Projet</h2>
                <p>Configuration du module projet.</p>
              </div>
            )}
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
                      const avgComp = Math.round(deptEmps.reduce((acc, e) => acc + e.compliance, 0) / (deptEmps.length || 1));
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
                        <button className="btn-icon" onClick={() => handleAccountDelete(acc.email)} style={{ color: 'var(--danger)' }}>🗑</button>
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
                      <img src={formData.avatar || avatarPlaceholder} alt="Avatar" />
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
                        { key: 'gillet', label: 'Gilet Coton' }
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
                                <span style={{ color: '#1c4c8d', fontWeight: '700', fontSize: '10px', textTransform: 'uppercase' }}>FONCTION</span>
                                <span style={{ fontWeight: '600', fontSize: '12px', color: '#64748b' }}>{selectedEmployee.role}</span>
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
  );
}

export default App;
