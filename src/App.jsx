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
  { email: 'superadmin@madagreen.com', password: 'super', role: 'Super Admin' },
  { email: 'madagreen@hse.com', password: 'pass', role: 'Super Admin' },
  { email: 'admin@madagreen.com', password: 'admin', role: 'Admin' },
  { email: 'visiteur@madagreen.com', password: 'visit', role: 'Visiteur' }
]

const PROJET_ACCOUNTS = [
  { email: 'madagreen@hse.com', password: 'pass', role: 'Super Admin' },
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
          // 1. Remove all old versions
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('hse_') && !k.includes('v3') && !k.includes('isAuthenticated') && !k.includes('currentUser') && !k.includes('selectedHub')) {
              localStorage.removeItem(k);
            }
          }

          // 2. Aggressively strip heavy assets from any existing employee cache to free space
          try {
            const empKeys = [];
            for (let i = 0; i < localStorage.length; i++) {
              if (localStorage.key(i) && localStorage.key(i).includes('employees')) empKeys.push(localStorage.key(i));
            }
            empKeys.forEach(empKey => {
              const empDataStr = localStorage.getItem(empKey);
              if (empDataStr) {
                const data = JSON.parse(empDataStr);
                const lightData = data.map(emp => ({
                  ...emp,
                  avatar: null,
                  certifications: emp.certifications?.map(c => ({ ...c, attachment: null }))
                }));
                localStorage.setItem(empKey, JSON.stringify(lightData));
              }
            });
          } catch (err) { }

          try {
            // 3. Retry saving the current item (strip if it happens to be employees)
            if (key.includes('employees')) {
              const data = JSON.parse(value);
              const lightData = data.map(emp => ({
                ...emp,
                avatar: null,
                certifications: emp.certifications?.map(c => ({ ...c, attachment: null }))
              }));
              localStorage.setItem(key, JSON.stringify(lightData));
            } else {
              localStorage.setItem(key, value);
            }
          } catch (e2) {
            console.error("Storage critically full, failed to save:", key);
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
  const [draftCert, setDraftCert] = useState({ name: '', dateObtention: '', validite: '', dateExpiration: '', attachment: null })
  const [newAccountFormData, setNewAccountFormData] = useState({ email: '', password: '', role: 'Visiteur' })
  const [selectedHub, setSelectedHub] = useState(() => {
    const saved = localStorage.getItem('hse_selectedHub');
    return (saved === 'null' || saved === 'undefined') ? null : (saved || null);
  });
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
  const [pdfViewerUrl, setPdfViewerUrl] = useState(null)
  const [selectedBriefingIndex, setSelectedBriefingIndex] = useState(null)
  const [briefingFormData, setBriefingFormData] = useState({ id: '', date: '', topic: '', responsable: '', description: '', commentaires: '', intervenants: [] })
  const [showNotifications, setShowNotifications] = useState(false)
  const [notifications, setNotifications] = useState(() => {
    const saved = localStorage.getItem('gp_notifications_v1')
    return saved ? JSON.parse(saved) : []
  })

  // Persistence des notifications
  useEffect(() => {
    safeStorage.setItem('gp_notifications_v1', JSON.stringify(notifications))
  }, [notifications])

  const addNotification = (title, message, type = 'info') => {
    const newNotif = {
      id: Date.now(),
      title,
      message,
      type,
      date: new Date().toLocaleString('fr-FR'),
      read: false
    };
    setNotifications(prev => [newNotif, ...prev].slice(0, 50)); // Garder les 50 dernières
  };

  // Chargement initial des données depuis le serveur en mode Prod
  useEffect(() => {
    const fetchInitialData = async () => {
      if (isProd && isAuthenticated) {
        try {
          const [resAcc, resEmp, resProj, resCaisse] = await Promise.all([
            apiCall('GET', '/accounts'),
            apiCall('GET', '/employees'),
            apiCall('GET', '/projets'),
            apiCall('GET', '/caisses')
          ]);

          if (resAcc.status === 200 && resAcc.data.success) setAccounts(resAcc.data.accounts);

          const safeParse = (val, def) => {
            if (typeof val === 'string') {
              try { return JSON.parse(val); } catch (err) { return def; }
            }
            return val || def;
          };

          if (resEmp.status === 200 && resEmp.data.success) {
            setEmployees(resEmp.data.employees.map(e => ({
              ...e,
              certifications: safeParse(e.certifications, []),
              epis: safeParse(e.epis, {})
            })));
          }

          if (resProj.status === 200 && resProj.data.success) {
            setProjets(resProj.data.projets.map(p => ({
              ...p,
              briefings: safeParse(p.briefings, []),
              intervenants: safeParse(p.intervenants, []),
              epc: safeParse(p.epc, {})
            })));
          }

          if (resCaisse.status === 200 && resCaisse.data.success) setCaisses(resCaisse.data.caisses);

          showToast("Données synchronisées");
        } catch (err) {
          console.error("Erreur chargement initial:", err);
        }
      }
    }
    fetchInitialData()
  }, [isProd, isAuthenticated])

  useEffect(() => {
    safeStorage.setItem(`hse_employees_v3${DB_PREFIX}`, JSON.stringify(employees))
    safeStorage.setItem(`hse_accounts_v3${DB_PREFIX}`, JSON.stringify(accounts))
    safeStorage.setItem('gp_projets_v1', JSON.stringify(projets))
    safeStorage.setItem('gp_caisses_v1', JSON.stringify(caisses))
  }, [employees, accounts, projets, caisses, DB_PREFIX])

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
      method: method.toUpperCase(),
      headers: method.toUpperCase() === 'GET' || method.toUpperCase() === 'DELETE' ? {} : { 'Content-Type': 'application/json' },
      connectTimeout: 15000
    }

    if (data !== null && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'DELETE') {
      options.data = data;
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
          headers: method.toUpperCase() === 'GET' || method.toUpperCase() === 'DELETE' ? {} : { 'Content-Type': 'application/json' }
        }
        if (data !== null && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'DELETE') {
          fetchOptions.body = JSON.stringify(data);
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
      safeStorage.setItem('hse_isAuthenticated', 'true')
      safeStorage.setItem('hse_currentUser', JSON.stringify(account))
      safeStorage.setItem('hse_selectedHub', selectedHub)
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

    const scopeAccounts = selectedHub === 'projet' ? [...PROJET_ACCOUNTS, ...accounts] : [...accounts, ...INITIAL_ACCOUNTS]
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
        const res = await apiCall('DELETE', `/accounts?email=${encodeURIComponent(email)}`)

        if (res.status === 200) {
          setAccounts(prev => prev.filter(a => a.email !== email))
          showToast("Compte retiré du serveur")
        } else {
          showToast(`Échec (Code: ${res.status}): ` + (res.data?.error || "Erreur serveur"), "danger")
        }

      } else if (dialogType === 'employee') {
        const id = dialogItem.matricule;
        const res = await apiCall('DELETE', `/employees?matricule=${encodeURIComponent(id)}`)

        if (res.status === 200) {
          const updatedEmployees = employees.filter(e => e.matricule !== id)
          setEmployees(updatedEmployees)
          safeStorage.setItem(`hse_employees_v3${DB_PREFIX}`, JSON.stringify(updatedEmployees))
          showToast("Employé retiré du serveur")
        } else {
          showToast(`Échec (Code: ${res.status}): ` + (res.data?.error || "Erreur serveur"), "danger")
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
    setDraftCert({ name: '', dateObtention: '', validite: '', dateExpiration: '', attachment: null })
  }

  const handleCertFileChange = (e) => {
    const file = e.target.files[0]
    if (file) {
      if (file.type !== 'application/pdf') {
        showToast("Seuls les fichiers PDF sont acceptés", "danger")
        return
      }
      const reader = new FileReader()
      reader.onloadend = () => setDraftCert(prev => ({ ...prev, attachment: reader.result }))
      reader.readAsDataURL(file)
    }
  }

  const viewAttachment = (attachment) => {
    if (!attachment) return;
    setPdfViewerUrl(attachment);
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

  const handleSignatureChange = (e) => {
    const file = e.target.files[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => setFormData(prev => ({ ...prev, signature: reader.result }))
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

      const imgW = 54;
      const imgH = 86;
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
    <div className="glass-card" style={{ padding: '1.5rem', textAlign: 'center', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '160px' }}>
      <div style={{ position: 'absolute', top: '-15px', right: '-15px', fontSize: '4rem', opacity: 0.03, transform: 'rotate(15deg)' }}>📊</div>
      <div style={{ fontSize: '2.5rem', fontWeight: '900', color: `var(--${color})`, marginBottom: '0.25rem', fontFamily: 'var(--font-heading)', lineHeight: 1.1 }}>{value}</div>
      <div className="input-label" style={{ marginBottom: 0, fontSize: '0.65rem', letterSpacing: '1px', opacity: 0.8 }}>{label}</div>
    </div>
  )

  const EmployeeRaw = ({ emp }) => (
    <div
      className="glass-card employee-row animate-slide-up"
      onClick={() => { setSelectedEmployee(emp); setEmployeeView('badge') }}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1rem 1.5rem',
        background: 'var(--bg-card)',
        cursor: 'pointer',
        marginBottom: '0.75rem',
        borderLeft: `4px solid ${emp.compliance >= 90 ? 'var(--accent)' : emp.compliance >= 60 ? 'var(--warning)' : 'var(--danger)'}`,
        transition: 'var(--transition)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
        <div style={{ width: '50px', height: '50px', borderRadius: '12px', background: 'linear-gradient(135deg, var(--primary), var(--accent))', padding: '2px', position: 'relative', boxShadow: 'var(--shadow-sm)' }}>
          <img src={emp.avatar || avatarPlaceholder} style={{ width: '100%', height: '100%', borderRadius: '10px', objectFit: 'cover', border: '2px solid var(--bg-main)' }} alt="Avatar" />
          <div style={{ position: 'absolute', bottom: '-2px', right: '-2px', width: '10px', height: '10px', borderRadius: '50%', background: emp.compliance >= 90 ? 'var(--accent)' : 'var(--danger)', border: '2px solid var(--bg-main)' }}></div>
        </div>
        <div>
          <div style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '0.1rem', letterSpacing: '-0.02em' }}>{emp.lastName?.toUpperCase()} {emp.firstName}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: '600' }}>{emp.role}</span>
            <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: 'var(--text-muted)' }}></span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-heading)' }}>{emp.matricule}</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '2.5rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <div style={{ fontWeight: '900', fontSize: '1.25rem', color: emp.compliance >= 90 ? 'var(--accent)' : emp.compliance >= 60 ? 'var(--warning)' : 'var(--danger)', lineHeight: 1 }}>{emp.compliance}%</div>
          <div style={{ fontSize: '0.6rem', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '1px', fontWeight: '800', marginTop: '0.2rem' }}>Conformité</div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {(currentUser?.role === 'Admin' || currentUser?.role === 'Super Admin') && (
            <>
              <button className="btn-icon" style={{ width: '32px', height: '32px', fontSize: '0.9rem' }} onClick={(e) => { e.stopPropagation(); startEdit(emp); }} title="Modifier">✎</button>
              <button className="btn-icon" style={{ width: '32px', height: '32px', fontSize: '0.9rem', color: 'var(--danger)' }} onClick={(e) => { e.stopPropagation(); handleDelete(emp); }} title="Supprimer">🗑</button>
            </>
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
          <span className="text-gradient" style={{ fontSize: '1.4rem' }}>MADAGREEN POWER</span>
        </div>

        <div className="nav-actions">
          {isProd && (
            <div className="badge badge-success mobile-hide" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span className="pulse" style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)' }}></span>
              PROD LIVE
            </div>
          )}

          <button className="btn-icon" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title="Changer de thème">
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>

          {isAuthenticated && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              {selectedHub === 'hse' ? (
                <>
                  <button
                    className="btn-icon"
                    onClick={() => syncData()}
                    disabled={isSyncing}
                    style={{ color: isOnline ? 'var(--accent)' : 'var(--text-muted)' }}
                    title="Synchroniser les données"
                  >
                    <span className={isSyncing ? 'animate-spin' : ''}>☁️</span>
                  </button>

                  <div className="user-badge mobile-hide" style={{ background: 'var(--bg-card)', padding: '0.4rem 1rem', borderRadius: 'var(--radius-full)', border: '1px solid var(--border-glass)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)' }}></div>
                    <span style={{ fontSize: '0.8rem', fontWeight: '600' }}>{currentUser?.role}</span>
                  </div>

                  <div className="mobile-hide" style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }} onClick={() => setEmployeeView('list')}>Employés</button>
                    {(currentUser?.role === 'Admin' || currentUser?.role === 'Super Admin') && (
                      <button className="btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }} onClick={() => setEmployeeView('settings')}>⚙️ Paramètres</button>
                    )}
                  </div>
                  <div className="mobile-show">
                    {(currentUser?.role === 'Admin' || currentUser?.role === 'Super Admin') && (
                      <button className="btn-icon" onClick={() => setEmployeeView('settings')}>⚙️</button>
                    )}
                  </div>
                </>
              ) : selectedHub === 'projet' ? (
                <>
                  <button
                    className="btn-icon"
                    onClick={() => syncData()}
                    disabled={isSyncing}
                    style={{ color: isOnline ? 'var(--info)' : 'var(--text-muted)' }}
                    title="Actualiser"
                  >
                    <span className={isSyncing ? 'animate-spin' : ''}>☁️</span>
                  </button>

                  <div className="mobile-hide" style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', borderColor: projetView === 'projet' ? 'var(--info)' : '' }} onClick={() => setProjetView('projet')}>Projets</button>
                    {currentUser?.role === 'Super Admin' && (
                      <button className="btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', borderColor: projetView === 'materiels' ? 'var(--info)' : '' }} onClick={() => setProjetView('materiels')}>Matériels</button>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    {(currentUser?.role === 'Admin' || currentUser?.role === 'Super Admin') && (
                      <div style={{ position: 'relative' }}>
                        <button className="btn-icon" onClick={() => setShowNotifications(!showNotifications)} style={{ position: 'relative', border: showNotifications ? '1px solid var(--info)' : '' }}>
                          🔔
                          {notifications.filter(n => !n.read).length > 0 && (
                            <span style={{ position: 'absolute', top: '-5px', right: '-5px', background: 'var(--danger)', color: 'white', borderRadius: '50%', width: '14px', height: '14px', fontSize: '0.55rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '900' }}>
                              {notifications.filter(n => !n.read).length}
                            </span>
                          )}
                        </button>

                        {showNotifications && (
                          <div className="glass-panel animate-fade-in" style={{ position: 'absolute', top: '100%', right: 0, width: '320px', zIndex: 1000, marginTop: '10px', padding: '1.5rem', maxHeight: '400px', overflowY: 'auto', border: '1px solid var(--border-glass)', boxShadow: 'var(--shadow-lg)', textAlign: 'left' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                              <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)' }}>Flux d'activités</h3>
                              <button style={{ background: 'none', border: 'none', color: 'var(--info)', fontSize: '0.75rem', cursor: 'pointer', fontWeight: '700' }} onClick={() => setNotifications(prev => prev.map(n => ({ ...n, read: true })))}>Tout lire</button>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                              {notifications.length === 0 ? (
                                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', padding: '2rem 0' }}>Aucune notification récente</div>
                              ) : (
                                notifications.map(n => (
                                  <div key={n.id} style={{ padding: '0.85rem', borderRadius: '10px', background: n.read ? 'rgba(255,255,255,0.02)' : 'rgba(var(--info-rgb), 0.08)', borderLeft: `3px solid ${n.type === 'success' ? 'var(--accent)' : 'var(--info)'}`, transition: 'all 0.2s' }}>
                                    <div style={{ fontSize: '0.8rem', fontWeight: '800', marginBottom: '0.2rem', color: 'var(--text-primary)' }}>{n.title}</div>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>{n.message}</div>
                                    <div style={{ fontSize: '0.55rem', color: 'var(--text-muted)', marginTop: '0.4rem', fontWeight: '700', textTransform: 'uppercase' }}>{n.date}</div>
                                  </div>
                                ))
                              )}
                            </div>
                            {notifications.length > 0 && (
                              <button className="btn-secondary" style={{ width: '100%', marginTop: '1.25rem', padding: '0.5rem', fontSize: '0.7rem' }} onClick={() => setNotifications([])}>Vider l'historique</button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {(currentUser?.role === 'Admin' || currentUser?.role === 'Super Admin') && (
                      <button className="btn-icon" onClick={() => setProjetView('parametres')}>⚙️</button>
                    )}
                  </div>
                </>
              ) : null}

              <button className="btn-primary" style={{ background: 'var(--danger)', boxShadow: 'none', padding: '0.5rem 1rem', fontSize: '0.85rem' }} onClick={() => {
                setIsAuthenticated(false);
                setCurrentUser(null);
                setSelectedHub(null);
                localStorage.removeItem('hse_isAuthenticated');
                localStorage.removeItem('hse_currentUser');
                localStorage.removeItem('hse_selectedHub');
              }}>Quitter</button>
            </div>
          )}
        </div>
      </nav>

      <main className="container" style={!isAuthenticated ? { padding: 0, maxWidth: 'none' } : {}}>
        {(!isAuthenticated || !selectedHub) ? (
          <div className={`login-screen ${theme}`} style={{
            display: 'flex',
            width: '100vw',
            height: '100vh',
            background: 'var(--bg-main)',
            overflow: 'hidden',
            position: 'fixed',
            top: 0,
            left: 0,
            zIndex: 1000,
            transition: 'background 0.5s ease'
          }}>
            {/* Left Side: Visual Branding */}
            <div style={{
              flex: '1.4',
              position: 'relative',
              backgroundImage: `url(${mgpBg})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              padding: '5rem'
            }} className="mobile-hide">
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, var(--bg-main) 0%, transparent 70%)', opacity: 0.8 }}></div>
              <div style={{ position: 'relative', zIndex: 1, color: 'white' }}>
                <h1 style={{ fontSize: '4.5rem', fontWeight: '900', marginBottom: '1.5rem', lineHeight: 1, letterSpacing: '-0.04em' }}>HSE Safety <br />Tools</h1>
                <p style={{ fontSize: '1.25rem', maxWidth: '520px', opacity: 0.85, marginBottom: '4rem', lineHeight: 1.6 }}>
                  Plateforme intelligente de gestion des habilitations et de la conformité sécurité pour Madagreen Power.
                </p>

                <div style={{ display: 'flex', gap: '4rem' }}>
                  <div style={{ textAlign: 'center' }}><div style={{ fontSize: '1.8rem', marginBottom: '0.75rem' }}>🛡️</div><div style={{ fontSize: '0.7rem', fontWeight: '900', textTransform: 'uppercase', letterSpacing: '1px' }}>Sécurité</div></div>
                  <div style={{ textAlign: 'center' }}><div style={{ fontSize: '1.8rem', marginBottom: '0.75rem' }}>📋</div><div style={{ fontSize: '0.7rem', fontWeight: '900', textTransform: 'uppercase', letterSpacing: '1px' }}>Dossiers</div></div>
                  <div style={{ textAlign: 'center' }}><div style={{ fontSize: '1.8rem', marginBottom: '0.75rem' }}>🎫</div><div style={{ fontSize: '0.7rem', fontWeight: '900', textTransform: 'uppercase', letterSpacing: '1px' }}>Passeports</div></div>
                </div>
              </div>
            </div>

            {/* Right Side: Authentication/Hub */}
            <div style={{
              flex: '1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-main)',
              position: 'relative',
              padding: '3rem',
              borderLeft: '1px solid var(--border-glass)'
            }}>

              <div className="glass-panel animate-fade-in" style={{
                maxWidth: '480px',
                width: '100%',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-glass-bright)',
                padding: '4rem',
                borderRadius: '35px',
                boxShadow: 'var(--shadow-glass)'
              }}>
                {!selectedHub ? (
                  <div className="animate-fade-in">
                    <div style={{ marginBottom: '3rem' }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: '900', color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '1.25rem' }}>Portail Sécurisé</div>
                      <h2 style={{ fontSize: '2.2rem', fontWeight: '900', margin: 0, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Hub d'Applications</h2>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginTop: '1rem', lineHeight: 1.5 }}>Veuillez sélectionner l'environnement de travail pour continuer.</p>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                      <button
                        className="glass-card hub-btn"
                        style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', cursor: 'pointer', padding: '1.75rem', textAlign: 'left', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-glass)' }}
                        onClick={() => { setSelectedHub('hse'); localStorage.setItem('hse_selectedHub', 'hse'); }}
                      >
                        <div style={{ width: '55px', height: '55px', borderRadius: '16px', background: 'var(--primary-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.75rem' }}>🛡️</div>
                        <div>
                          <div style={{ fontWeight: '800', fontSize: '1.2rem', color: 'var(--text-primary)' }}>HSE Passport</div>
                          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>Habilitations & Sécurité</div>
                        </div>
                      </button>

                      <button
                        className="glass-card hub-btn"
                        style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', cursor: 'pointer', padding: '1.75rem', textAlign: 'left', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-glass)' }}
                        onClick={() => { setSelectedHub('projet'); localStorage.setItem('hse_selectedHub', 'projet'); }}
                      >
                        <div style={{ width: '55px', height: '55px', borderRadius: '16px', background: 'var(--accent-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.75rem' }}>🏗️</div>
                        <div>
                          <div style={{ fontWeight: '800', fontSize: '1.2rem', color: 'var(--text-primary)' }}>Gestion de Projet</div>
                          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>Suivi Chantier & Logistique</div>
                        </div>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="animate-fade-in">
                    <div style={{ marginBottom: '3rem' }}>
                      <button
                        onClick={() => setSelectedHub(null)}
                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontWeight: '700', cursor: 'pointer', fontSize: '0.85rem', marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.5rem', transition: 'color 0.2s' }}
                      >
                        ← Retour au Hub
                      </button>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.25rem', borderRadius: '12px', background: 'var(--accent-glow)', color: 'var(--accent)', fontSize: '0.75rem', fontWeight: '900', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2rem' }}>
                        <span>🛡️</span> Module {selectedHub === 'hse' ? 'HSE' : 'Projet'}
                      </div>
                      <h2 style={{ fontSize: '2.8rem', fontWeight: '900', margin: 0, color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>Connexion</h2>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginTop: '1rem' }}>Identifiez-vous pour accéder à vos outils.</p>
                    </div>

                    <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
                      <div>
                        <label className="input-label" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Adresse Email</label>
                        <input type="email" name="email" className="glass-input" placeholder="admin@madagreen.com" required style={{ background: 'var(--bg-input)' }} />
                      </div>
                      <div>
                        <label className="input-label" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Mot de Passe</label>
                        <input type="password" name="password" className="glass-input" placeholder="••••••••" required style={{ background: 'var(--bg-input)' }} />
                      </div>
                      <button type="submit" className="btn-primary" style={{ marginTop: '1.5rem', width: '100%', height: '60px', fontSize: '1.1rem', borderRadius: '18px', fontWeight: '800' }}>
                        Se connecter →
                      </button>
                    </form>
                  </div>
                )}

                <div style={{ marginTop: '4rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', opacity: 0.7, fontWeight: '600' }}>
                  © {new Date().getFullYear()} Madagreen Power — Portail de Gestion Intégrée
                </div>
              </div>
            </div>
          </div>
        ) : selectedHub === 'projet' ? (
          <div className="animate-fade-in">
            {projetView === 'projet' && (
              <div className="animate-fade-in">
                <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem' }}>
                    <div>
                      <h2 style={{ margin: 0, fontSize: '1.5rem' }}>Tableau de Bord Projets</h2>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>Vue d'ensemble et gestion opérationnelle</p>
                    </div>
                    {(currentUser?.role === 'Admin' || currentUser?.role === 'Super Admin') && (
                      <button className="btn-primary" onClick={() => { setProjetView('addProjet'); setProjetWizardStep(1); }}>+ Nouveau Projet</button>
                    )}
                  </div>
                </div>

                {projets.length === 0 ? (
                  <div className="glass-panel" style={{ padding: '4rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🏗️</div>
                    <p style={{ color: 'var(--text-muted)' }}>Aucun projet actif. Cliquez sur "Lancer un Projet" pour démarrer.</p>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
                    {projets.map((p, i) => (
                      <div key={i} className="glass-card" style={{ padding: '2rem', borderLeft: '4px solid var(--info)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                            <div style={{ width: '60px', height: '60px', borderRadius: '15px', background: 'var(--info-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem' }}>🏗️</div>
                            <div>
                              <h3 style={{ margin: 0, fontSize: '1.25rem' }}>{p.nomChantier}</h3>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.4rem' }}>
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>📍 {p.lieu}</span>
                                <span className="badge badge-info" style={{ fontSize: '0.7rem' }}>Resp: {p.responsableChantier}</span>
                              </div>
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '1px', fontWeight: '700' }}>Statut Chantier</div>
                            <div style={{ color: 'var(--info)', fontWeight: '800', fontSize: '1rem', marginTop: '0.2rem' }}>EN COURS</div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border-glass)' }}>
                          <div style={{ display: 'flex', gap: '2rem' }}>
                            <div>
                              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Début</div>
                              <div style={{ fontWeight: '700', fontSize: '0.9rem' }}>{p.dateDebut}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Intervenants</div>
                              <div style={{ fontWeight: '700', fontSize: '0.9rem' }}>{p.intervenants?.length || 0} Pers.</div>
                            </div>
                            <div>
                              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Matériel</div>
                              <div style={{ fontWeight: '700', fontSize: '0.9rem', color: p.outillageCaisse ? 'var(--info)' : 'var(--text-muted)' }}>{p.outillageCaisse || 'Aucun'}</div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button className="btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }} onClick={() => {
                              setProjetFormData({ ...p });
                              setProjetIntervenants(p.intervenants || [])
                              setProjetView('detailProjet')
                              setSelectedProjetIndex(i)
                            }}>Détails</button>
                            <button className="btn-icon" onClick={() => {
                              setProjetFormData({ ...p });
                              setProjetIntervenants(p.intervenants || [])
                              setSelectedProjetIndex(i)
                              setProjetWizardStep(1)
                              setProjetView('editProjet')
                            }}>✎</button>
                            <button className="btn-icon" style={{ color: 'var(--danger)' }} onClick={async () => {
                              if (!isOnline) { showToast("Connexion internet requise", "danger"); return; }
                              try {
                                showToast("Suppression...", "info")
                                const res = await apiCall('DELETE', `/projets?nomChantier=${encodeURIComponent(p.nomChantier)}`)
                                if (res.status === 200) {
                                  const updated = projets.filter((_, idx) => idx !== i)
                                  setProjets(updated); safeStorage.setItem('gp_projets_v1', JSON.stringify(updated));
                                  showToast('Projet supprimé');
                                } else { showToast("Erreur lors de la suppression", "danger"); }
                              } catch (e) { showToast(e.message, "danger"); }
                            }}>🗑</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {projetView === 'addProjet' && (
              <div className="glass-panel animate-fade-in" style={{ maxWidth: '800px', margin: '0 auto', padding: '3rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '1rem' }}>
                  <button className="btn-icon" onClick={() => {
                    if (projetWizardStep > 1) setProjetWizardStep(projetWizardStep - 1);
                    else { setProjetView('projet'); resetProjetForm(); setProjetIntervenants([]); }
                  }}>←</button>
                  <h2 style={{ margin: 0 }}>Nouveau Projet</h2>
                </div>

                {/* Modern Step Indicator */}
                <div style={{ display: 'flex', gap: '1rem', marginBottom: '3rem' }}>
                  {[1, 2, 3].map(step => (
                    <div key={step} style={{ flex: 1 }}>
                      <div style={{ height: '4px', borderRadius: '2px', background: projetWizardStep >= step ? 'var(--info)' : 'var(--bg-card)', transition: 'all 0.3s' }}></div>
                      <div style={{ fontSize: '0.65rem', color: projetWizardStep === step ? 'var(--info)' : 'var(--text-muted)', fontWeight: '800', marginTop: '0.5rem', textTransform: 'uppercase' }}>
                        Étape {step}
                      </div>
                    </div>
                  ))}
                </div>

                {projetWizardStep === 1 && (
                  <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    <div className="glass-card" style={{ padding: '2rem', display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem' }}>
                      <h3 style={{ fontSize: '1rem', color: 'var(--info)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Détails du Chantier</h3>
                      <div><label className="input-label">Nom du Projet / Chantier</label><input type="text" className="glass-input" placeholder="Ex: Centrale Solaire Majunga" value={projetFormData.nomChantier} onChange={e => setProjetFormData({ ...projetFormData, nomChantier: e.target.value })} /></div>
                      <div><label className="input-label">Localisation</label><input type="text" className="glass-input" placeholder="Ex: Majunga, Madagascar" value={projetFormData.lieu} onChange={e => setProjetFormData({ ...projetFormData, lieu: e.target.value })} /></div>
                      <div><label className="input-label">Date de Lancement</label><input type="date" className="glass-input" value={projetFormData.dateDebut} onChange={e => setProjetFormData({ ...projetFormData, dateDebut: e.target.value })} /></div>
                    </div>
                    <button className="btn-primary" style={{ height: '50px', justifyContent: 'center' }} disabled={!projetFormData.nomChantier || !projetFormData.lieu || !projetFormData.dateDebut} onClick={() => setProjetWizardStep(2)}>Suivant : Équipe & Responsable →</button>
                  </div>
                )}

                {projetWizardStep === 2 && (
                  <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    <div className="glass-card" style={{ padding: '2rem' }}>
                      <h3 style={{ fontSize: '1rem', color: 'var(--info)', textTransform: 'uppercase', marginBottom: '1.5rem' }}>Direction du Chantier</h3>
                      <div>
                        <label className="input-label">Responsable Principal</label>
                        <select className="glass-input" value={projetFormData.responsableChantier} onChange={e => setProjetFormData({ ...projetFormData, responsableChantier: e.target.value })}>
                          <option value="">Sélectionner parmi le personnel...</option>
                          {employees.map(emp => (<option key={emp.matricule} value={emp.name}>{emp.name}</option>))}
                        </select>
                      </div>
                    </div>

                    <div className="glass-card" style={{ padding: '2rem' }}>
                      <h3 style={{ fontSize: '1rem', color: 'var(--info)', textTransform: 'uppercase', marginBottom: '1.5rem' }}>Équipe d'Intervention ({projetIntervenants.length})</h3>
                      {projetIntervenants.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.5rem' }}>
                          {projetIntervenants.map((intv, i) => (
                            <span key={i} className="badge badge-info" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem' }}>
                              {intv.name}
                              <span style={{ cursor: 'pointer', fontWeight: 'bold' }} onClick={() => setProjetIntervenants(prev => prev.filter((_, idx) => idx !== i))}>×</span>
                            </span>
                          ))}
                        </div>
                      )}
                      <div style={{ position: 'relative' }}>
                        <label className="input-label">Rechercher des membres</label>
                        <input type="text" className="glass-input" placeholder="Nom ou matricule..." value={intervenantSearch} onChange={e => setIntervenantSearch(e.target.value)} />
                        {intervenantSearch.trim().length > 0 && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: 'var(--bg-main)', border: '1px solid var(--border-glass)', borderRadius: '12px', marginTop: '5px', maxHeight: '200px', overflowY: 'auto', boxShadow: 'var(--shadow-lg)' }}>
                            {employees.filter(emp => !projetIntervenants.some(intv => intv.matricule === emp.matricule)).filter(emp => emp.name.toLowerCase().includes(intervenantSearch.toLowerCase()) || emp.matricule.toLowerCase().includes(intervenantSearch.toLowerCase())).map(emp => (
                              <div key={emp.matricule} onClick={() => { setProjetIntervenants(prev => [...prev, { matricule: emp.matricule, name: emp.name, role: emp.role }]); setIntervenantSearch('') }} style={{ padding: '0.8rem 1.25rem', cursor: 'pointer', borderBottom: '1px solid var(--border-glass)' }}>
                                <div style={{ fontWeight: '700', fontSize: '0.9rem' }}>{emp.name}</div>
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{emp.role}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <button className="btn-primary" style={{ height: '50px', justifyContent: 'center' }} disabled={!projetFormData.responsableChantier} onClick={() => setProjetWizardStep(3)}>Suivant : Logistique & Matériel →</button>
                  </div>
                )}

                {projetWizardStep === 3 && (
                  <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    <div className="glass-card" style={{ padding: '2rem' }}>
                      <h3 style={{ fontSize: '1rem', color: 'var(--info)', textTransform: 'uppercase', marginBottom: '1.5rem' }}>Dotation Matérielle</h3>
                      <div>
                        <label className="input-label">Affectation Caisse Outillage</label>
                        <select className="glass-input" value={projetFormData.outillageCaisse} onChange={e => setProjetFormData({ ...projetFormData, outillageCaisse: e.target.value })}>
                          <option value="">Aucune caisse assignée...</option>
                          {caisses.map(c => (<option key={c.numeroCaisse} value={c.numeroCaisse}>{c.numeroCaisse} — {c.affecterA}</option>))}
                        </select>
                      </div>
                    </div>

                    <div className="glass-card" style={{ padding: '2rem' }}>
                      <h3 style={{ fontSize: '1rem', color: 'var(--info)', textTransform: 'uppercase', marginBottom: '1.5rem' }}>Sécurité Collective (EPC)</h3>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                        {Object.keys(INITIAL_EPC).map(key => (
                          <div key={key} onClick={() => setProjetFormData({ ...projetFormData, epc: { ...projetFormData.epc, [key]: !projetFormData.epc[key] } })} style={{ background: projetFormData.epc[key] ? 'var(--info-glow)' : 'var(--bg-main)', padding: '1rem', borderRadius: '12px', cursor: 'pointer', border: `1px solid ${projetFormData.epc[key] ? 'var(--info)' : 'var(--border-glass)'}`, display: 'flex', alignItems: 'center', gap: '0.75rem', transition: 'all 0.3s' }}>
                            <div style={{ width: '18px', height: '18px', borderRadius: '4px', border: '2px solid var(--info)', background: projetFormData.epc[key] ? 'var(--info)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '0.7rem' }}>{projetFormData.epc[key] && '✓'}</div>
                            <span style={{ fontSize: '0.85rem', fontWeight: '700' }}>{key.charAt(0).toUpperCase() + key.slice(1)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <button className="btn-primary" style={{ height: '60px', justifyContent: 'center', fontSize: '1.1rem' }} onClick={async () => {
                      const manager = employees.find(e => e.name === projetFormData.responsableChantier);
                      let finalIntervenants = [...projetIntervenants];
                      if (manager && !finalIntervenants.some(i => i.matricule === manager.matricule)) finalIntervenants.push({ matricule: manager.matricule, name: manager.name, role: manager.role });
                      if (!isOnline) { showToast("Connexion internet requise", "danger"); return; }
                      const existingProj = selectedProjetIndex !== null ? projets[selectedProjetIndex] : {};
                      const newProjet = {
                        ...projetFormData,
                        intervenants: finalIntervenants,
                        dateCreation: existingProj.dateCreation || new Date().toLocaleDateString('fr-FR'),
                        briefings: existingProj.briefings || []
                      }
                      try {
                        showToast("Création en cours...", "info")
                        const res = await apiCall('POST', '/projets', newProjet)
                        if (res.status === 200) {
                          const updated = [newProjet, ...projets]; setProjets(updated); safeStorage.setItem('gp_projets_v1', JSON.stringify(updated));
                          resetProjetForm(); setProjetView('projet'); showToast('Projet créé avec succès');
                          addNotification("Nouveau Projet", `Le projet "${newProjet.nomChantier}" a été créé par ${currentUser?.email}`, "success");
                        } else { showToast("Erreur serveur", "danger"); }
                      } catch (e) { showToast(e.message, "danger"); }
                    }}>Lancer le Projet & Enregistrer</button>
                  </div>
                )}
              </div>
            )}

            {projetView === 'materiels' && (
              <div className="animate-fade-in">
                <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem' }}>
                    <div>
                      <h2 style={{ margin: 0, fontSize: '1.5rem' }}>Inventaire des Caisses</h2>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>Gestion du matériel et de l'outillage mobile</p>
                    </div>
                    <button className="btn-primary" onClick={() => {
                      setCaisseFormData({ numeroCaisse: '', affecterA: '', materiels: [] });
                      setProjetView('addCaisse');
                    }}>+ Nouvelle Caisse</button>
                  </div>
                </div>

                {caisses.length === 0 ? (
                  <div className="glass-panel" style={{ padding: '4rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📦</div>
                    <p style={{ color: 'var(--text-muted)' }}>Aucun matériel inventorié.</p>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1.5rem' }}>
                    {caisses.map((c, i) => (
                      <div key={i} className="glass-card" style={{ padding: '2rem', position: 'relative' }}>
                        <div style={{ position: 'absolute', top: '1.5rem', right: '1.5rem' }}>
                          <button className="btn-icon" style={{ color: 'var(--danger)' }} onClick={async () => {
                            if (!isOnline) { showToast("Connexion internet requise", "danger"); return; }
                            try {
                              showToast("Suppression...", "info")
                              const res = await apiCall('DELETE', `/caisses?numeroCaisse=${encodeURIComponent(c.numeroCaisse)}`)
                              if (res.status === 200) {
                                const updated = caisses.filter((_, idx) => idx !== i);
                                setCaisses(updated); safeStorage.setItem('gp_caisses_v1', JSON.stringify(updated));
                                showToast('Caisse supprimée');
                              } else { showToast("Échec de la suppression", "danger"); }
                            } catch (e) { showToast(e.message, "danger"); }
                          }}>🗑</button>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '2rem' }}>
                          <div style={{ width: '50px', height: '50px', background: 'var(--info-glow)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem' }}>📦</div>
                          <div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>Numéro Inventaire</div>
                            <div style={{ fontWeight: '900', fontSize: '1.2rem', color: 'var(--info)' }}>{c.numeroCaisse}</div>
                          </div>
                        </div>

                        <div className="glass-card" style={{ background: 'var(--bg-main)', padding: '1rem', marginBottom: '1.5rem' }}>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Responsable Affecté</div>
                          <div style={{ fontWeight: '700', fontSize: '1rem' }}>👤 {c.affecterA || 'Non assigné'}</div>
                        </div>

                        <div style={{ marginBottom: '2rem' }}>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Contenu ({c.materiels?.length || 0} articles)</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                            {c.materiels?.slice(0, 4).map((m, idx) => (
                              <span key={idx} style={{ fontSize: '0.75rem', background: 'var(--bg-card)', padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--border-glass)' }}>{m}</span>
                            ))}
                            {c.materiels?.length > 4 && <span style={{ fontSize: '0.75rem', color: 'var(--info)', fontWeight: 'bold', alignSelf: 'center' }}>+{c.materiels.length - 4}</span>}
                          </div>
                        </div>

                        <button className="btn-secondary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => {
                          setCaisseFormData(c); setSelectedProjetIndex(i); setProjetView('detailCaisse');
                        }}>Visualiser le Contenu</button>
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
              <div className="glass-panel animate-slide-up" style={{ width: '100%', minHeight: '85vh', padding: '3rem', boxSizing: 'border-box' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                    <button className="btn-icon" onClick={() => setProjetView('projet')}>←</button>
                    <h2 style={{ margin: 0, fontSize: '1.8rem' }}>Détails du Projet</h2>
                  </div>
                  <div style={{ fontSize: '2.3rem', fontWeight: 'bold', color: 'var(--primary)' }}>
                    {projetFormData.nomChantier}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: '4rem' }}>

                  {/* LEFT COLUMN: Infos, Caisse, EPC */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

                    <div className="glass-card" style={{ padding: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                      <div style={{ gridColumn: 'span 2' }}>
                        <label className="input-label">Responsable Chantier</label>
                        <div style={{ fontWeight: '700', fontSize: '1.3rem', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span>👤</span> {projetFormData.responsableChantier || "Non désigné"}
                        </div>
                      </div>
                      <div>
                        <label className="input-label">Lieu</label>
                        <div style={{ fontWeight: '600', fontSize: '1.1rem' }}>📍 {projetFormData.lieu}</div>
                      </div>
                      <div>
                        <label className="input-label">Date de début</label>
                        <div style={{ fontWeight: '600', fontSize: '1.1rem' }}>📅 {projetFormData.dateDebut}</div>
                      </div>
                    </div>

                    <div>
                      <label className="input-label" style={{ fontSize: '1.1rem' }}>Caisse d'outillage</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', background: 'var(--card-bg-light)', padding: '1.5rem', borderRadius: '12px', marginTop: '0.5rem', border: '1px solid var(--border-glass)' }}>
                        <div style={{ fontSize: '2.5rem' }}>📦</div>
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
                              <div style={{ fontWeight: '800', fontSize: '1.3rem', color: 'var(--primary)' }}>{projetFormData.outillageCaisse}</div>
                              <div style={{ fontSize: '0.95rem', color: 'var(--text-dim)', marginTop: '0.25rem' }}>
                                Affecté à: {caisses.find(c => c.numeroCaisse === projetFormData.outillageCaisse)?.affecterA || "Personnel non identifié"}
                              </div>
                              <div style={{ fontSize: '0.85rem', color: 'var(--accent)', marginTop: '0.5rem', fontWeight: 'bold' }}>Voir le contenu complet →</div>
                            </div>
                          ) : (
                            <div style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: '1.1rem' }}>Aucune caisse assignée à ce projet</div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="input-label" style={{ fontSize: '1.1rem' }}>Protections Collectives (EPC)</label>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1rem', marginTop: '0.75rem' }}>
                        {[
                          { key: 'extincteurs', label: '🧯 Extincteurs' },
                          { key: 'balisage', label: '🚧 Balisage' },
                          { key: 'echafaudage', label: '🏗️ Échafaudage' },
                          { key: 'gardecorps', label: '🛡️ Garde-corps' },
                          { key: 'lignedevie', label: '⚓ Lignes de vie' },
                          { key: 'eclairage', label: '💡 Éclairage' },
                          { key: 'kitantipollution', label: '🧼 Anti-poll.' }
                        ].filter(({ key }) => projetFormData.epc?.[key]).map(({ key, label }) => {
                          const isSet = projetFormData.epc?.[key];
                          return (
                            <div key={key} style={{ padding: '0.8rem 1rem', borderRadius: '10px', background: 'var(--accent-glow)', border: '1px solid var(--accent)', opacity: 1, display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem', transition: 'all 0.3s' }}>
                              <span style={{ fontSize: '1.2rem' }}>✅</span>
                              <span style={{ fontWeight: 'bold', color: '#fff' }}>{label}</span>
                            </div>
                          );
                        })}
                      </div>
                      {(!projetFormData.epc || !Object.values(projetFormData.epc).some(v => v)) && (
                        <p style={{ color: 'var(--text-dim)', fontSize: '0.95rem', padding: '1rem', background: 'var(--card-bg-light)', borderRadius: '10px', textAlign: 'center', marginTop: '0.75rem' }}>Aucun équipement de protection collective n'a été coché pour ce projet.</p>
                      )}
                    </div>

                  </div>

                  {/* RIGHT COLUMN: Intervenants, Briefings */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>

                    <div className="glass-card" style={{ padding: '1.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <label className="input-label" style={{ margin: 0, fontSize: '1.1rem' }}>Safety Briefings ({projetFormData.briefings?.length || 0})</label>
                        <button className="btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', background: 'var(--info)' }} onClick={() => {
                          const newBriefing = {
                            id: Date.now().toString(),
                            date: new Date().toISOString().split('T')[0],
                            topic: 'Briefing Sécurité Quotidien',
                            responsable: projetFormData.responsableChantier,
                            intervenants: [...projetIntervenants]
                          };
                          setBriefingFormData(newBriefing);
                          setSelectedBriefingIndex(null);
                          setProjetView('editBriefing');
                        }}>+ Nouveau Briefing</button>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '350px', overflowY: 'auto', paddingRight: '10px' }}>
                        {projetFormData.briefings?.map((b, idx) => (
                          <div key={b.id || idx} style={{ padding: '1.25rem', background: 'var(--bg-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid var(--border-glass)', borderRadius: '12px', transition: 'transform 0.2s', ':hover': { transform: 'translateY(-2px)' } }}>
                            <div>
                              <div style={{ fontWeight: '800', fontSize: '1.05rem', color: '#fff', marginBottom: '0.4rem' }}>{b.topic}</div>
                              <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', display: 'flex', gap: '1rem' }}>
                                <span>📅 {b.date}</span>
                                <span>👤 {b.responsable}</span>
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <button className="btn-icon" style={{ width: '36px', height: '36px', fontSize: '0.9rem', background: 'rgba(255,255,255,0.05)' }} onClick={() => {
                                setBriefingFormData({ ...b });
                                setSelectedBriefingIndex(idx);
                                setProjetView('editBriefing');
                              }}>✎</button>
                              <button className="btn-icon" style={{ width: '36px', height: '36px', fontSize: '0.9rem', background: 'rgba(255,0,0,0.1)', color: 'var(--danger)' }} onClick={() => {
                                const updatedBriefings = projetFormData.briefings.filter((_, i) => i !== idx);
                                const updatedProj = {
                                  ...projetFormData,
                                  intervenants: projetIntervenants,
                                  dateCreation: projets[selectedProjetIndex]?.dateCreation || new Date().toLocaleDateString('fr-FR'),
                                  briefings: updatedBriefings
                                };
                                const newList = [...projets];
                                newList[selectedProjetIndex] = updatedProj;
                                setProjets(newList);
                                apiCall('POST', '/projets', updatedProj);
                                setProjetFormData(updatedProj);
                                showToast("Briefing supprimé");
                              }}>🗑</button>
                            </div>
                          </div>
                        ))}
                        {(!projetFormData.briefings || projetFormData.briefings.length === 0) && (
                          <div style={{ color: 'var(--text-dim)', fontSize: '0.95rem', textAlign: 'center', padding: '3rem 1rem', background: 'var(--card-bg-light)', borderRadius: '12px', border: '1px dashed var(--border-glass)' }}>
                            <div style={{ fontSize: '2rem', marginBottom: '1rem', opacity: 0.5 }}>📝</div>
                            Aucun briefing sécurité n'a encore été enregistré pour ce projet.
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="input-label" style={{ fontSize: '1.1rem' }}>Équipe d'Intervenants ({projetIntervenants.filter(intv => intv.name !== projetFormData.responsableChantier).length})</label>
                      {projetIntervenants.filter(intv => intv.name !== projetFormData.responsableChantier).length === 0 ? (
                        <p style={{ color: 'var(--text-dim)', fontSize: '0.95rem', padding: '1rem', background: 'var(--card-bg-light)', borderRadius: '10px', textAlign: 'center' }}>Aucun intervenant assigné.</p>
                      ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem', maxHeight: '350px', overflowY: 'auto', paddingRight: '10px' }}>
                          {projetIntervenants.filter(intv => intv.name !== projetFormData.responsableChantier).map((intv, i) => (
                            <div key={i} style={{ padding: '1rem', background: 'var(--card-bg-light)', border: '1px solid var(--border-glass)', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                              <span style={{ fontWeight: '700', fontSize: '1rem' }}>{intv.name}</span>
                              <span style={{ color: 'var(--accent)', fontSize: '0.85rem', fontWeight: '500' }}>{intv.role}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                  </div>
                </div>
              </div>
            )}

            {projetView === 'editBriefing' && selectedProjetIndex !== null && (
              <div className="animate-fade-in" style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gridTemplateColumns: '400px 1fr', gap: '2rem' }}>
                {/* Form Side */}
                <div className="glass-panel" style={{ padding: '2rem', height: 'fit-content', position: 'sticky', top: '100px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
                    <button className="btn-icon" onClick={() => setProjetView('detailProjet')}>←</button>
                    <h2 style={{ fontSize: '1.2rem' }}>Éditer le Briefing</h2>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    <div>
                      <label className="input-label">Sujet du Briefing</label>
                      <input type="text" className="glass-input" value={briefingFormData.topic} onChange={e => setBriefingFormData({ ...briefingFormData, topic: e.target.value })} />
                    </div>
                    <div>
                      <label className="input-label">Date</label>
                      <input type="date" className="glass-input" value={briefingFormData.date} onChange={e => setBriefingFormData({ ...briefingFormData, date: e.target.value })} />
                    </div>
                    <div>
                      <label className="input-label">Responsable Site (PM)</label>
                      <select className="glass-input" value={briefingFormData.responsable} onChange={e => setBriefingFormData({ ...briefingFormData, responsable: e.target.value })}>
                        {employees.map(emp => (<option key={emp.matricule} value={emp.name}>{emp.name}</option>))}
                      </select>
                    </div>
                    <div>
                      <label className="input-label">Description des points évoqués</label>
                      <textarea className="glass-input" style={{ minHeight: '100px', resize: 'vertical' }} value={briefingFormData.description} onChange={e => setBriefingFormData({ ...briefingFormData, description: e.target.value })} placeholder="Détaillez les consignes partagées..." />
                    </div>
                    <div>
                      <label className="input-label">Commentaires et points de vigilance</label>
                      <textarea className="glass-input" style={{ minHeight: '100px', resize: 'vertical' }} value={briefingFormData.commentaires} onChange={e => setBriefingFormData({ ...briefingFormData, commentaires: e.target.value })} placeholder="Notes additionnelles ou risques spécifiques..." />
                    </div>

                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1rem' }}>
                      <label className="input-label">Intervenants Présents ({briefingFormData.intervenants.length})</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '300px', overflowY: 'auto', marginBottom: '1rem' }}>
                        {briefingFormData.intervenants.map((intv, i) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-main)', padding: '0.5rem 0.8rem', borderRadius: '8px', fontSize: '0.85rem' }}>
                            <span>{intv.name}</span>
                            <button style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }} onClick={() => setBriefingFormData({ ...briefingFormData, intervenants: briefingFormData.intervenants.filter((_, idx) => idx !== i) })}>✕</button>
                          </div>
                        ))}
                      </div>
                      <div style={{ position: 'relative' }}>
                        <input type="text" className="glass-input" placeholder="Ajouter un intervenant..." value={intervenantSearch} onChange={e => setIntervenantSearch(e.target.value)} />
                        {intervenantSearch.trim().length > 0 && (
                          <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, zIndex: 10, background: '#1e293b', border: '1px solid var(--border-glass)', borderRadius: '12px', marginBottom: '5px', maxHeight: '200px', overflowY: 'auto', boxShadow: '0 -10px 25px rgba(0,0,0,0.3)' }}>
                            {employees.filter(emp => !briefingFormData.intervenants.some(intv => intv.matricule === emp.matricule)).filter(emp => emp.name.toLowerCase().includes(intervenantSearch.toLowerCase())).map(emp => (
                              <div key={emp.matricule} onClick={() => { setBriefingFormData({ ...briefingFormData, intervenants: [...briefingFormData.intervenants, { matricule: emp.matricule, name: emp.name, role: emp.role }] }); setIntervenantSearch('') }} style={{ padding: '0.8rem 1rem', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                <div style={{ fontWeight: '600', fontSize: '0.85rem' }}>{emp.name}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <button className="btn-primary" style={{ width: '100%', marginTop: '1rem' }} onClick={async () => {
                      if (!isOnline) { showToast("Connexion internet requise", "danger"); return; }
                      let updatedBriefings = [...(projetFormData.briefings || [])];
                      if (selectedBriefingIndex !== null) {
                        updatedBriefings[selectedBriefingIndex] = briefingFormData;
                      } else {
                        updatedBriefings.unshift(briefingFormData);
                      }

                      const updatedProj = {
                        ...projetFormData,
                        intervenants: projetIntervenants,
                        dateCreation: projets[selectedProjetIndex]?.dateCreation || new Date().toLocaleDateString('fr-FR'),
                        briefings: updatedBriefings
                      };
                      try {
                        showToast("Enregistrement...", "info");
                        const res = await apiCall('POST', '/projets', updatedProj);
                        if (res.status === 200) {
                          const newList = [...projets];
                          newList[selectedProjetIndex] = updatedProj;
                          setProjets(newList);
                          safeStorage.setItem('gp_projets_v1', JSON.stringify(newList));
                          setProjetFormData(updatedProj);
                          showToast("Briefing enregistré !");
                          addNotification("Safety Briefing", `Un nouveau briefing a été enregistré pour le chantier "${projetFormData.nomChantier}"`, "info");
                          setProjetView('detailProjet');
                        }
                      } catch (e) { showToast(e.message, "danger"); }
                    }}>💾 Enregistrer le Briefing</button>
                  </div>
                </div>

                {/* Preview Side */}
                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', top: '-50px', right: 0 }}>
                    <button className="btn-primary" onClick={async () => {
                      try {
                        showToast("Génération du document A4...", "info");
                        const page1 = document.getElementById('sb-page-1');
                        const page2 = document.getElementById('sb-page-2');

                        const canvas1 = await html2canvas(page1, { scale: 2, useCORS: true, logging: false });
                        const canvas2 = await html2canvas(page2, { scale: 2, useCORS: true, logging: false });

                        const pdf = new jsPDF('p', 'mm', 'a4');
                        const pdfWidth = pdf.internal.pageSize.getWidth();
                        const pdfHeight = pdf.internal.pageSize.getHeight();

                        const img1 = canvas1.toDataURL('image/png');
                        const img2 = canvas2.toDataURL('image/png');

                        pdf.addImage(img1, 'PNG', 0, 0, pdfWidth, pdfHeight);
                        pdf.addPage();
                        pdf.addImage(img2, 'PNG', 0, 0, pdfWidth, pdfHeight);

                        pdf.save(`Safety_Briefing_${projetFormData.nomChantier}_${briefingFormData.date}.pdf`);
                        showToast(`Document PDF (2 pages) généré !`);
                      } catch (err) { showToast("Erreur PDF: " + err.message, "danger"); }
                    }}>🖨️ Imprimer / PDF A4</button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
                    {/* PAGE 1 */}
                    <div id="sb-page-1" style={{
                      background: 'white',
                      color: 'black',
                      padding: '15mm',
                      height: '297mm',
                      width: '210mm',
                      margin: '0 auto',
                      fontFamily: '"Segoe UI", Arial, sans-serif',
                      boxSizing: 'border-box',
                      display: 'flex',
                      flexDirection: 'column'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', borderBottom: '2px solid #002060', paddingBottom: '10px' }}>
                        <img src={logo} alt="Logo" style={{ height: '50px' }} />
                        <h1 style={{ margin: 0, color: '#002060', fontSize: '24px', fontWeight: '800' }}>Safety Briefing Chantier</h1>
                      </div>

                      {/* Main Info Table */}
                      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '30px' }}>
                        <thead>
                          <tr style={{ background: '#002060', color: 'white' }}>
                            <th style={{ border: '1px solid #002060', padding: '10px', fontSize: '11px' }}>PM Responsable Site</th>
                            <th style={{ border: '1px solid #002060', padding: '10px', fontSize: '11px' }}>Date</th>
                            <th style={{ border: '1px solid #002060', padding: '10px', fontSize: '11px' }}>Briefing</th>
                            <th style={{ border: '1px solid #002060', padding: '10px', fontSize: '11px' }}>Chantier</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td style={{ border: '1px solid #333', padding: '12px', textAlign: 'center', fontWeight: 'bold', fontSize: '12px' }}>{briefingFormData.responsable}</td>
                            <td style={{ border: '1px solid #333', padding: '12px', textAlign: 'center', fontSize: '12px' }}>{new Date(briefingFormData.date).toLocaleDateString('fr-FR')}</td>
                            <td style={{ border: '1px solid #333', padding: '12px', textAlign: 'center', fontSize: '12px' }}>{briefingFormData.topic}</td>
                            <td style={{ border: '1px solid #333', padding: '12px', textAlign: 'center', fontWeight: 'bold', fontSize: '12px' }}>{projetFormData.nomChantier}</td>
                          </tr>
                        </tbody>
                      </table>

                      {/* Participants Table */}
                      <div style={{ marginBottom: '10px', fontWeight: '900', fontSize: '13px', color: '#002060', textTransform: 'uppercase' }}>LISTE DES PARTICIPANTS</div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', flex: 1 }}>
                        <thead>
                          <tr style={{ background: '#002060', color: 'white' }}>
                            <th style={{ border: '1px solid #002060', padding: '10px', fontSize: '11px' }}>Fonction</th>
                            <th style={{ border: '1px solid #002060', padding: '10px', fontSize: '11px' }}>Nom</th>
                            <th style={{ border: '1px solid #002060', padding: '10px', fontSize: '11px' }}>Signature</th>
                          </tr>
                        </thead>
                        <tbody>
                          {briefingFormData.intervenants.slice(0, 18).map((intv, idx) => (
                            <tr key={idx}>
                              <td style={{ border: '1px solid #333', padding: '8px', fontSize: '11px' }}>{intv.role}</td>
                              <td style={{ border: '1px solid #333', padding: '8px', fontSize: '11px', fontWeight: 'bold' }}>{intv.name}</td>
                              <td style={{ border: '1px solid #333', padding: '4px', height: '40px', textAlign: 'center' }}>
                                {(() => { const emp = employees.find(e => e.name === intv.name); return emp?.signature ? <img src={emp.signature} alt="sig" style={{ maxHeight: '36px', maxWidth: '120px', objectFit: 'contain' }} /> : null; })()}
                              </td>
                            </tr>
                          ))}
                          {[...Array(Math.max(0, 18 - briefingFormData.intervenants.length))].map((_, i) => (
                            <tr key={`empty-${i}`}>
                              <td style={{ border: '1px solid #333', padding: '15px' }}></td>
                              <td style={{ border: '1px solid #333', padding: '15px' }}></td>
                              <td style={{ border: '1px solid #333', padding: '15px' }}></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div style={{ marginTop: '10px', fontSize: '9px', color: '#999', textAlign: 'center' }}>Page 1 / 2</div>
                    </div>

                    {/* PAGE 2 */}
                    <div id="sb-page-2" style={{
                      background: 'white',
                      color: 'black',
                      padding: '15mm',
                      height: '297mm',
                      width: '210mm',
                      margin: '0 auto',
                      fontFamily: '"Segoe UI", Arial, sans-serif',
                      boxSizing: 'border-box'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', borderBottom: '2px solid #002060', paddingBottom: '10px' }}>
                        <img src={logo} alt="Logo" style={{ height: '50px' }} />
                        <h1 style={{ margin: 0, color: '#002060', fontSize: '24px', fontWeight: '800' }}>Safety Briefing Chantier</h1>
                      </div>

                      {/* Description Section */}
                      <div style={{ marginBottom: '25px' }}>
                        <div style={{ background: '#002060', color: 'white', padding: '10px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', border: '1px solid #002060', textTransform: 'uppercase' }}>
                          Description des points et consignes évoquées
                        </div>
                        <div style={{ border: '1px solid #333', borderTop: 'none', padding: '20px', minHeight: '150px', fontSize: '12px', lineHeight: '1.6', color: '#333', whiteSpace: 'pre-wrap' }}>
                          {briefingFormData.description || "Aucun commentaire spécifique."}
                        </div>
                      </div>

                      {/* Comments Section */}
                      <div style={{ marginBottom: '25px' }}>
                        <div style={{ background: '#002060', color: 'white', padding: '10px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', border: '1px solid #002060', textTransform: 'uppercase' }}>
                          Commentaires et points de vigilance
                        </div>
                        <div style={{ border: '1px solid #333', borderTop: 'none', padding: '20px', minHeight: '120px', fontSize: '12px', lineHeight: '1.6', color: '#333', whiteSpace: 'pre-wrap' }}>
                          {briefingFormData.commentaires || "Aucun commentaire spécifique."}
                        </div>
                      </div>
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
              <div className="glass-panel animate-slide-up" style={{ maxWidth: '700px', margin: '0 auto', padding: '3rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '3rem' }}>
                  <button className="btn-icon" onClick={() => setProjetView('projet')}>←</button>
                  <h2>Gestion des Accès (Projet)</h2>
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
                        <option value="Super Admin">Super Administrateur (Accès Total)</option>
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
                  {[...PROJET_ACCOUNTS, ...accounts].map((acc, idx) => (
                    <div key={idx} className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem' }}>
                      <div>
                        <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{acc.email}</div>
                        <div style={{ fontSize: '0.85rem', color: acc.role === 'Admin' ? '#3b82f6' : 'var(--text-dim)' }}>Accès {acc.role}</div>
                      </div>
                      {acc.email !== currentUser.email && !PROJET_ACCOUNTS.some(pa => pa.email === acc.email) && (
                        <button className="btn-icon" onClick={() => handleAccountDelete(acc.email)} style={{ color: 'var(--danger)' }}>🗑</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : selectedHub === 'hse' ? (
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
                  <StatCard label="Effectif Total" value={employees.length} color="primary" />
                  <StatCard label="Taux de Conformité" value={`${Math.round(employees.reduce((acc, e) => acc + e.compliance, 0) / (employees.length || 1))}%`} color="accent" />
                  <StatCard label="Alertes Critiques" value={employees.filter(e => e.compliance < 60).length} color="danger" />
                </div>

                {/* Advanced Certification Analytics */}
                <div className="glass-panel" style={{ padding: '2rem', marginBottom: '3rem', position: 'relative', border: '1px solid var(--border-glass)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ padding: '8px', background: 'rgba(99, 102, 241, 0.1)', borderRadius: '10px' }}>📊</span>
                      Distribution des Habilitations
                    </h3>
                    <div className="badge badge-info" style={{ fontSize: '0.6rem', letterSpacing: '1px' }}>Temps Réel</div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem' }}>
                    {CERTIFICATION_LIST.map(cert => {
                      const count = employees.filter(e => e.certifications?.some(c => c.name === cert && !isExpired(c.dateExpiration) && c.attachment)).length;
                      const percentage = employees.length > 0 ? Math.round((count / employees.length) * 100) : 0;
                      return (
                        <div key={cert} className="glass-card" style={{ background: 'rgba(255,255,255,0.02)', padding: '1.25rem', border: '1px solid rgba(255,255,255,0.03)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', alignItems: 'flex-start' }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-secondary)', maxWidth: '140px', lineHeight: 1.2 }}>{cert}</span>
                            <span style={{ fontSize: '1.1rem', fontWeight: '900', color: count > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>{count}</span>
                          </div>
                          <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px', overflow: 'hidden', position: 'relative' }}>
                            <div
                              style={{
                                height: '100%',
                                width: `${percentage}%`,
                                background: percentage > 80 ? 'var(--accent)' : percentage > 40 ? 'var(--primary)' : 'var(--text-muted)',
                                borderRadius: '10px',
                                transition: 'width 1.5s ease-in-out'
                              }}
                            ></div>
                          </div>
                          <div style={{ textAlign: 'right', marginTop: '0.5rem', fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: '800' }}>{percentage}% COUVERTURE</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="glass-panel" style={{ padding: '2rem', border: '1px solid var(--border-glass)' }}>
                  <div className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1.5rem' }}>
                    <div>
                      <h2 style={{ fontSize: '1.5rem', fontWeight: '900' }}>Répertoire du Personnel</h2>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Gestion des dossiers et conformité individuelle</p>
                    </div>
                    <div className="controls-group" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                      <button className="btn-secondary" onClick={exportCSV}>📥 CSV</button>
                      <select className="glass-input" style={{ width: '160px' }} value={filterDept} onChange={e => setFilterDept(e.target.value)}>
                        <option value="Tous">Tous Depts</option>
                        {[...new Set(employees.map(e => e.departement))].map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                      <input type="text" className="glass-input" placeholder="Rechercher..." style={{ width: '220px' }} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                      {(currentUser?.role === 'Admin' || currentUser?.role === 'Super Admin') && (
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
              <div className="glass-panel animate-fade-in" style={{ maxWidth: '800px', margin: '0 auto', padding: '3rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '3rem' }}>
                  <button className="btn-icon" onClick={() => setEmployeeView('list')}>←</button>
                  <h2 style={{ margin: 0 }}>Contrôle des Accès</h2>
                </div>

                <div className="glass-card" style={{ padding: '2.5rem', marginBottom: '3rem', borderLeft: '4px solid var(--primary)' }}>
                  <h3 style={{ marginBottom: '1.5rem', fontSize: '1.2rem' }}>Nouvel Utilisateur</h3>
                  <form onSubmit={handleAccountCreate} className="form-grid" style={{ gap: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                    <div style={{ gridColumn: 'span 2' }}>
                      <label className="input-label">Email de connexion</label>
                      <input type="email" className="glass-input" value={newAccountFormData.email} onChange={e => setNewAccountFormData({ ...newAccountFormData, email: e.target.value })} required placeholder="nom@madagreen-power.com" />
                    </div>
                    <div>
                      <label className="input-label">Mot de passe</label>
                      <input type="password" className="glass-input" value={newAccountFormData.password} onChange={e => setNewAccountFormData({ ...newAccountFormData, password: e.target.value })} required placeholder="••••••••" />
                    </div>
                    <div>
                      <label className="input-label">Niveau d'accès</label>
                      <select className="glass-input" value={newAccountFormData.role} onChange={e => setNewAccountFormData({ ...newAccountFormData, role: e.target.value })}>
                        <option value="Super Admin">Super Administrateur</option>
                        <option value="Admin">Administrateur</option>
                        <option value="Visiteur">Visiteur (Lecture)</option>
                      </select>
                    </div>
                    <div style={{ gridColumn: 'span 2', marginTop: '1rem' }}>
                      <button type="submit" className="btn-primary" style={{ width: '100%', height: '50px' }}>Enregistrer l'accès</button>
                    </div>
                  </form>
                </div>

                <h3 style={{ marginBottom: '1.5rem', fontSize: '1.2rem' }}>Comptes Actifs</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {accounts.map((acc, idx) => (
                    <div key={idx} className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 2rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                        <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--bg-main)', display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>👤</div>
                        <div>
                          <div style={{ fontWeight: '800', color: 'var(--text-primary)' }}>{acc.email}</div>
                          <div className={`badge ${acc.role === 'Super Admin' ? 'badge-danger' : (acc.role === 'Admin' ? 'badge-info' : 'badge-success')}`} style={{ marginTop: '0.25rem', display: 'inline-block' }}>{acc.role}</div>
                        </div>
                      </div>
                      {acc.email !== currentUser.email && (
                        <button className="btn-icon" onClick={() => handleAccountDelete(acc.email)} style={{ color: 'var(--danger)' }} title="Supprimer l'accès">🗑</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (employeeView === 'add' || employeeView === 'edit') ? (
              <div className="glass-panel animate-fade-in" style={{ maxWidth: '1000px', margin: '0 auto', padding: '3rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '3rem' }}>
                  <button className="btn-icon" onClick={() => setEmployeeView('list')}>←</button>
                  <h2 style={{ margin: 0 }}>{employeeView === 'add' ? "Nouveau Dossier Personnel" : "Mise à jour du Dossier"}</h2>
                </div>

                <form onSubmit={saveEmployee}>
                  <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gap: '3rem' }}>
                    {/* Sidebar: Photo & Status */}
                    <div>
                      <div
                        className="glass-card"
                        style={{ padding: '1rem', textAlign: 'center', cursor: 'pointer', border: '2px dashed var(--border-glass)' }}
                        onClick={() => document.getElementById('file-up').click()}
                      >
                        <div style={{ width: '100%', aspectRatio: '1/1', borderRadius: '12px', overflow: 'hidden', background: 'var(--bg-main)', marginBottom: '1rem' }}>
                          <img src={formData.avatar || avatarPlaceholder} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="Avatar" />
                        </div>
                        <div className="btn-secondary" style={{ width: '100%', padding: '0.5rem', fontSize: '0.8rem' }}>Changer la photo</div>
                        <input type="file" id="file-up" hidden onChange={handleFileChange} />
                      </div>

                      <div className="glass-card" style={{ marginTop: '1.5rem', padding: '1.5rem', borderLeft: `4px solid ${formData.aptitudeMedicale ? 'var(--accent)' : 'var(--danger)'}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                          <input
                            type="checkbox"
                            id="apt-med"
                            checked={formData.aptitudeMedicale}
                            onChange={e => setFormData({ ...formData, aptitudeMedicale: e.target.checked })}
                            style={{ width: '20px', height: '20px' }}
                          />
                          <label htmlFor="apt-med" style={{ fontWeight: '800', fontSize: '0.9rem' }}>Aptitude Médicale</label>
                        </div>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {formData.aptitudeMedicale ? 'Certificat médical valide fourni.' : 'Aptitude non confirmée.'}
                        </p>
                      </div>

                      {/* Signature Upload */}
                      <div className="glass-card" style={{ marginTop: '1.5rem', padding: '1.5rem', borderLeft: '4px solid var(--info)' }}>
                        <h4 style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--info)', textTransform: 'uppercase', letterSpacing: '1px' }}>✍️ Signature</h4>
                        {formData.signature ? (
                          <div style={{ marginBottom: '1rem', background: '#fff', borderRadius: '8px', padding: '0.5rem', border: '1px solid var(--border-glass)' }}>
                            <img src={formData.signature} alt="Signature" style={{ width: '100%', maxHeight: '80px', objectFit: 'contain' }} />
                          </div>
                        ) : (
                          <div style={{ height: '60px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px dashed var(--border-glass)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Aucune signature déposée</span>
                          </div>
                        )}
                        <label htmlFor="sig-up" className="btn-secondary" style={{ width: '100%', display: 'block', textAlign: 'center', cursor: 'pointer', padding: '0.5rem', fontSize: '0.8rem' }}>
                          {formData.signature ? '🔄 Remplacer la signature' : '📤 Déposer une signature'}
                        </label>
                        <input type="file" id="sig-up" hidden accept="image/*" onChange={handleSignatureChange} />
                        {formData.signature && (
                          <button type="button" style={{ marginTop: '0.5rem', width: '100%', background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.75rem' }} onClick={() => setFormData(prev => ({ ...prev, signature: null }))}>Supprimer la signature</button>
                        )}
                      </div>
                    </div>

                    {/* Main Content: Info & Certs */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                      <div className="glass-card" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                        <div style={{ gridColumn: 'span 2' }}><h3 style={{ fontSize: '1rem', color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '1px' }}>Informations Générales</h3></div>
                        <div><label className="input-label">Nom</label><input type="text" name="lastName" className="glass-input" value={formData.lastName} onChange={handleFormChange} required /></div>
                        <div><label className="input-label">Prénom</label><input type="text" name="firstName" className="glass-input" value={formData.firstName} onChange={handleFormChange} required /></div>
                        <div><label className="input-label">Département</label><input type="text" name="departement" className="glass-input" value={formData.departement} onChange={handleFormChange} required /></div>
                        <div><label className="input-label">Fonction</label><input type="text" name="role" className="glass-input" value={formData.role} onChange={handleFormChange} required /></div>
                        <div><label className="input-label">Matricule</label><input type="text" name="matricule" className="glass-input" value={formData.matricule} onChange={handleFormChange} placeholder="AUTO-GENÉRÉ" disabled={employeeView === 'edit'} /></div>
                      </div>

                      <div className="glass-card">
                        <h3 style={{ fontSize: '1rem', color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '1.5rem' }}>Équipements (EPI)</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                          {['gants', 'chaussures', 'casques', 'uniforme', 'gillet'].map(key => (
                            <div key={key} style={{ padding: '1rem', background: 'var(--bg-main)', borderRadius: '12px', border: formData.epis[key].checked ? '1px solid var(--accent-glow)' : '1px solid transparent' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                <input
                                  type="checkbox"
                                  checked={formData.epis[key].checked}
                                  onChange={e => setFormData(pr => ({ ...pr, epis: { ...pr.epis, [key]: { ...pr.epis[key], checked: e.target.checked } } }))}
                                />
                                <span style={{ fontSize: '0.8rem', fontWeight: '700' }}>{key.charAt(0).toUpperCase() + key.slice(1)}</span>
                              </div>
                              {formData.epis[key].checked && (
                                <input
                                  type="date"
                                  className="glass-input"
                                  style={{ padding: '0.3rem', fontSize: '0.75rem' }}
                                  value={formData.epis[key].date}
                                  onChange={e => setFormData(pr => ({ ...pr, epis: { ...pr.epis, [key]: { ...pr.epis[key], date: e.target.value } } }))}
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="glass-card">
                        <h3 style={{ fontSize: '1rem', color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '1.5rem' }}>Certifications HSE</h3>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.5rem' }}>
                          {formData.certifications.map((c, i) => (
                            <div key={i} className="badge badge-info" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem' }}>
                              <span>{c.name} ({c.dateExpiration})</span>
                              <button type="button" onClick={() => setFormData(f => ({ ...f, certifications: f.certifications.filter((_, idx) => idx !== i) }))} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontWeight: 'bold' }}>×</button>
                            </div>
                          ))}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '1rem', alignItems: 'end', background: 'var(--bg-main)', padding: '1.5rem', borderRadius: '12px' }}>
                          <div><label className="input-label">Type</label><select className="glass-input" value={draftCert.name} onChange={e => setDraftCert(d => ({ ...d, name: e.target.value }))}><option value="">Sélectionner...</option>{CERTIFICATION_LIST.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                          <div><label className="input-label">Date</label><input type="date" className="glass-input" value={draftCert.dateObtention} onChange={e => setDraftCert(d => ({ ...d, dateObtention: e.target.value }))} /></div>
                          <div><label className="input-label">Validité</label><input type="number" className="glass-input" value={draftCert.validite} onChange={e => setDraftCert(d => ({ ...d, validite: e.target.value }))} placeholder="Ans" /></div>
                          <button type="button" className="btn-primary" onClick={addCert} style={{ height: '46px' }}>Ajouter</button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: '3rem', display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                    <button type="button" className="btn-secondary" onClick={() => setEmployeeView('list')}>Annuler</button>
                    <button type="submit" className="btn-primary" style={{ minWidth: '200px' }}>{employeeView === 'edit' ? "Mettre à jour le dossier" : "Créer le profil"}</button>
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
                        <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                          {c.attachment && (
                            <button className="btn-icon" onClick={() => viewAttachment(c.attachment)} style={{ background: 'var(--primary-glow)', color: 'var(--primary)', padding: '8px', borderRadius: '10px' }} title="Voir la pièce jointe">📎</button>
                          )}
                          <div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                              {(new Date(c.dateExpiration) - new Date()) < (30 * 24 * 60 * 60 * 1000) && !isExpired(c.dateExpiration) ? <span style={{ color: 'var(--warning)', fontWeight: '800' }}>BIENTÔT EXPIRED! </span> : null}
                              {isExpired(c.dateExpiration) ? <span style={{ color: 'var(--danger)', fontWeight: '800' }}>EXPIRED! </span> : 'Expiration'}
                            </div>
                            <div style={{ fontWeight: '700', color: isExpired(c.dateExpiration) ? 'var(--danger)' : 'var(--text-main)' }}>{c.dateExpiration}</div>
                          </div>
                        </div>
                      </div>
                    )) : <p>Aucun certificat enregistré.</p>}
                  </div>

                  <div className="form-actions" style={{ marginTop: '2.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center', width: '100%' }}>
                    <button className="btn-primary" style={{ width: '100%', maxWidth: '300px', justifyContent: 'center', padding: '1.2rem' }} onClick={printBadge}>
                      ⎙ Imprimer le Badge PDF
                    </button>
                    {(currentUser?.role === 'Admin' || currentUser?.role === 'Super Admin') && (
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

                      {/* Recto CR80: 54x86mm */}
                      <div id="badge-recto" style={{ width: '54mm', height: '86mm', borderRadius: '4mm', border: '0.5px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#ffffff', position: 'relative', boxSizing: 'border-box', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}>

                        {/* Professional Header */}
                        <div style={{ background: '#1e40af', height: '18mm', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: 'white', position: 'relative', zIndex: 10 }}>
                          <img src={logo} alt="" style={{ height: '7mm', marginBottom: '1mm', filter: 'brightness(0) invert(1)' }} />
                          <div style={{ fontSize: '7pt', fontWeight: '800', letterSpacing: '0.5px', textTransform: 'uppercase' }}>Passeport Sécurité</div>
                        </div>

                        {/* Photo Section */}
                        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '4mm', position: 'relative', zIndex: 10 }}>
                          <div style={{ width: '25mm', height: '30mm', borderRadius: '2mm', overflow: 'hidden', border: '2px solid #1e40af', background: '#f8fafc' }}>
                            <img src={selectedEmployee.avatar || avatarPlaceholder} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          </div>
                        </div>

                        {/* Info Section */}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3mm', gap: '2mm', zIndex: 10 }}>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '10pt', fontWeight: '900', color: '#0f172a', lineHeight: '1.1' }}>{selectedEmployee.firstName}</div>
                            <div style={{ fontSize: '12pt', fontWeight: '900', color: '#0f172a', textTransform: 'uppercase', lineHeight: '1.1' }}>{selectedEmployee.lastName}</div>
                          </div>

                          <div style={{ background: '#f1f5f9', width: '100%', padding: '1.5mm', borderRadius: '1mm', textAlign: 'center' }}>
                            <div style={{ fontSize: '6pt', color: '#64748b', fontWeight: '700', textTransform: 'uppercase', marginBottom: '0.5mm' }}>Fonction</div>
                            <div style={{ fontSize: '8pt', color: '#1e40af', fontWeight: '800' }}>{selectedEmployee.role}</div>
                          </div>

                          <div style={{ background: '#f1f5f9', width: '100%', padding: '1.5rem', borderRadius: '1mm', textAlign: 'center' }}>
                            <div style={{ fontSize: '6pt', color: '#64748b', fontWeight: '700', textTransform: 'uppercase', marginBottom: '0.5rem' }}>MATRICULE</div>
                            <div style={{ fontSize: '10pt', fontWeight: '900', color: '#0f172a' }}>{selectedEmployee.matricule}</div>
                          </div>
                        </div>

                        {/* Footer Bar */}
                        <div style={{ background: selectedEmployee.compliance >= 90 ? '#10b981' : (selectedEmployee.compliance >= 60 ? '#f59e0b' : '#ef4444'), height: '1.5mm', width: '100%' }}></div>
                      </div>

                      {/* Verso CR80: 54x86mm */}
                      <div id="badge-verso" style={{ width: '54mm', height: '86mm', borderRadius: '4mm', border: '0.5px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#ffffff', position: 'relative', boxSizing: 'border-box', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}>

                        {/* Watermark Logo */}
                        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%) rotate(-45deg)', opacity: 0.05, width: '40mm', zIndex: 0, pointerEvents: 'none' }}>
                          <img src={logo} alt="" style={{ width: '100%' }} />
                        </div>

                        <div style={{ background: '#334155', color: 'white', padding: '2mm', textAlign: 'center', fontSize: '7pt', fontWeight: '800', textTransform: 'uppercase', position: 'relative', zIndex: 1 }}>
                          Habilitations
                        </div>

                        <div style={{ flex: 1, padding: '3mm', display: 'flex', flexDirection: 'column', gap: '1.5mm', position: 'relative', zIndex: 1 }}>
                          {/* Medical Aptitude Section Moved to Verso */}
                          <div style={{ background: selectedEmployee.aptitudeMedicale !== false ? '#dcfce7' : '#fee2e2', padding: '2mm', borderRadius: '1.5mm', border: '1px solid ' + (selectedEmployee.aptitudeMedicale !== false ? '#86efac' : '#fca5a5'), textAlign: 'center', marginBottom: '1mm' }}>
                            <div style={{ fontSize: '5.5pt', color: selectedEmployee.aptitudeMedicale !== false ? '#166534' : '#991b1b', fontWeight: '800', textTransform: 'uppercase', marginBottom: '0.5mm' }}>Aptitude Médicale</div>
                            <div style={{ fontSize: '9pt', fontWeight: '900', color: selectedEmployee.aptitudeMedicale !== false ? '#15803d' : '#b91c1c' }}>{selectedEmployee.aptitudeMedicale !== false ? 'CONFORME' : 'NON CONFORME'}</div>
                          </div>

                          <div style={{ fontSize: '6pt', fontWeight: '900', color: '#64748b', borderBottom: '1px solid #e2e8f0', paddingBottom: '1mm', marginBottom: '1mm' }}>HABILITATION / EXPIRATION</div>

                          <div style={{ flex: 1, overflow: 'hidden' }}>
                            {selectedEmployee.certifications.length > 0 ? (
                              selectedEmployee.certifications.slice(0, 6).map((c, i) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.2mm 0', borderBottom: '0.5px solid #f1f5f9' }}>
                                  <div style={{ fontSize: '6.5pt', fontWeight: '700', color: '#1e293b', width: '65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                                  <div style={{ fontSize: '6.5pt', fontWeight: '800', color: isExpired(c.dateExpiration) ? '#ef4444' : '#1e293b' }}>{c.dateExpiration.replace(/-/g, '/')}</div>
                                </div>
                              ))
                            ) : (
                              <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '7pt', marginTop: '5mm', fontStyle: 'italic' }}>Aucune habilitation</div>
                            )}
                          </div>

                          <div style={{ background: 'rgba(248, 250, 252, 0.8)', padding: '2mm', borderRadius: '2mm', border: '1px dashed #cbd5e1', textAlign: 'center' }}>
                            <div style={{ fontSize: '5.5pt', color: '#64748b', fontWeight: '800', marginBottom: '1mm' }}>URGENCE / HSE CONTACT</div>
                            <div style={{ fontSize: '7pt', fontWeight: '900', color: '#0f172a' }}>034 34 001 97 — 038 48 911 41</div>
                          </div>
                        </div>

                        {/* MADAGREEN Branding */}
                        <div style={{ background: 'rgba(241, 245, 249, 0.9)', padding: '2mm', textAlign: 'center', borderTop: '1px solid #e2e8f0', position: 'relative', zIndex: 1 }}>
                          <div style={{ fontSize: '6pt', fontWeight: '900', color: '#475569' }}>MADAGREEN POWER</div>
                          <div style={{ fontSize: '4pt', color: '#94a3b8' }}>www.madagreen-power.com</div>
                        </div>
                      </div>

                    </div>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
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

      {/* In-App PDF Viewer Modal */}
      {pdfViewerUrl && (
        <div className="modal-overlay animate-fade-in" style={{ zIndex: 3000 }}>
          <div className="glass-panel animate-slide-up" style={{ width: '95%', height: '90%', maxWidth: '1000px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem', position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 0.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>📄 Visualisation du Certificat</h3>
              <button className="btn-icon" onClick={() => setPdfViewerUrl(null)} style={{ fontSize: '1.5rem' }}>✕</button>
            </div>
            <div style={{ flex: 1, background: '#fff', borderRadius: '12px', overflow: 'hidden' }}>
              <iframe
                src={pdfViewerUrl}
                style={{ width: '100%', height: '100%', border: 'none' }}
                title="PDF Viewer"
              ></iframe>
            </div>
            <button className="btn-primary" onClick={() => setPdfViewerUrl(null)} style={{ justifyContent: 'center' }}>Fermer</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
