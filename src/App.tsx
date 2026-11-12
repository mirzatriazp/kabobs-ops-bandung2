import { useEffect, useMemo, useState } from 'react'
import AccountSecurity from './components/AccountSecurity'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import SalesReport from './components/SalesReport'
import DashboardSales from './components/DashboardSales'
import Maintenance from './components/Maintenance'
import { CalendarActivity, GeneralInformation } from './components/CalendarActivity'
import './App.css'
import VisitAM from './components/VisitAM'
import './components/VisitAM.css'
import PIQPerformance from './components/PIQPerformance'
import ProfileOutlet from './components/ProfileOutlet'
import DataTeam from './components/DataTeam'
import Schedule from './components/Schedule'
import TeamOnDutyDashboard from './components/TeamOnDutyDashboard'
import InventoryDSO from './components/InventoryDSO'
import OutletRanking from './components/OutletRanking'
import TemplateBA from './components/TemplateBA'
import LiveChat from './components/LiveChat'
import OperationalOverview from './components/OperationalOverview'
import './DashboardFinal.css'
import './BrandingKabobs.css'
type Profile = {
  id: string
  nik: string
  full_name: string
  role: 'AM' | 'LEADER'
  outlet_id: string | null
  is_active: boolean
}
type Outlet = { id: string; outlet_code: string; outlet_name: string }

const MODULE_STORE = 'kabobs.ops.activePage.v1'
const SESSION_STORE = 'kabobs.ops.activity.v1'
const IDLE_MS = 2 * 60 * 60 * 1000 // Auto logout setelah 2 jam tanpa aktivitas
const sessionDay = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())
type SessionActivity = { userId: string; lastActivity: number; day: string }
function readActivity(): SessionActivity | null {
  try {
    const raw = localStorage.getItem(SESSION_STORE)
    if (!raw) return null
    const value = JSON.parse(raw) as SessionActivity
    return value && typeof value.userId === 'string' && typeof value.lastActivity === 'number' && typeof value.day === 'string' ? value : null
  } catch { return null }
}
function markActivity(userId: string) {
  localStorage.setItem(SESSION_STORE, JSON.stringify({userId, lastActivity: Date.now(), day: sessionDay()}))
}
function activityValid(userId: string) {
  const value = readActivity()
  return !!value && value.userId === userId && value.day === sessionDay() && Date.now() >= value.lastActivity && Date.now() - value.lastActivity < IDLE_MS
}

const modules = [
  ['Dashboard', 'Ringkasan dan informasi outlet'],
  ['Profile Outlet', 'Foto, alamat dan detail store'],
  ['Calendar Activity', 'Agenda dan deadline operasional'],
  ['General Information', 'Pengumuman dan informasi dari AM'],
  ['Sales Report', 'Input actual sales dan perhitungan MTD'],
  ['Inventory & DSO', 'Review DSO dan selisih bulanan'],
  ['Report Visit AM', 'Temuan dan corrective action'],
  ['Defect & Maintenance', 'Pengajuan service order'],
  ['Data Team', 'Crew dan atribut kerja'],
  ['Schedule', 'Perencanaan dan validasi jadwal'],
  ['PIQ Performance', 'Hasil audit internal'],
  ['Peringkat Outlet', 'Ranking area Bandung 2'],
  ['Template BA', 'Download dokumen'],
  ['Live Chat', 'Komunikasi antaroutlet'],
]

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Jakarta'
  }).format(new Date()))
  return h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam'
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [nik, setNik] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(true)
  const [loggingIn, setLoggingIn] = useState(false)
  const [error, setError] = useState('')
  const [activePage, setActivePage] = useState(() => {
    const stored = sessionStorage.getItem(MODULE_STORE)
    return stored && modules.some(([title]) => title === stored) ? stored : 'Dashboard'
  })
  const [accountOpen, setAccountOpen] = useState(false)
  const [sessionMessage, setSessionMessage] = useState('')
  const [selectedOutlet, setSelectedOutlet] = useState('')
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)

  // Restore only sessions with a valid activity record for today (WIB).
  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return
      const existing = data.session
      if (existing && !activityValid(existing.user.id)) {
        await supabase.auth.signOut()
        if (mounted) { setSession(null); setSessionMessage('Sesi sebelumnya berakhir. Silakan login kembali.') }
      } else if (mounted) setSession(existing)
    }).catch(() => { if (mounted) setError('Tidak dapat memeriksa sesi login.') }).finally(() => { if (mounted) setLoading(false) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (next && sessionStorage.getItem('kabobs.ops.loginPending') === '1') markActivity(next.user.id)
      setSession(next)
      if (!next) { setProfile(null); setOutlets([]) }
    })
    return () => { mounted = false; subscription.unsubscribe() }
  }, [])

  useEffect(() => { sessionStorage.setItem(MODULE_STORE, activePage) }, [activePage])

  // A token refresh is NOT counted as user activity. Only actual interactions reset the clock.
  useEffect(() => {
    if (!session) return
    const userId = session.user.id
    let lastWrite = 0
    let signingOut = false
    const expire = async () => {
      if (signingOut) return
      signingOut = true
      setSessionMessage('Sesi berakhir setelah 2 jam tidak aktif atau pergantian hari. Silakan login kembali.')
      localStorage.removeItem(SESSION_STORE)
      sessionStorage.removeItem(MODULE_STORE)
      setActivePage('Dashboard')
      setAccountOpen(false)
      await supabase.auth.signOut()
    }
    const check = () => { if (!activityValid(userId)) void expire() }
    const onActivity = () => {
      if (!activityValid(userId)) { void expire(); return }
      if (Date.now() - lastWrite > 15000) { markActivity(userId); lastWrite = Date.now() }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    const onStorage = (event: StorageEvent) => { if (event.key === SESSION_STORE) check() }
    check()
    const events: Array<keyof WindowEventMap> = ['pointerdown','keydown','scroll','touchstart']
    events.forEach(event => window.addEventListener(event, onActivity, { passive: true }))
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', check)
    window.addEventListener('storage', onStorage)
    const timer = window.setInterval(check, 30000)
    return () => {
      events.forEach(event => window.removeEventListener(event, onActivity))
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', check)
      window.removeEventListener('storage', onStorage)
      window.clearInterval(timer)
    }
  }, [session?.user.id])

  useEffect(() => {
    if (!session) return
    let active = true
    const load = async () => {
      setError('')
      const [p, o] = await Promise.all([
        supabase.from('profiles').select('id, nik, full_name, role, outlet_id, is_active').eq('id', session.user.id).single(),
        supabase.from('outlets').select('id, outlet_code, outlet_name').eq('is_active', true).order('outlet_name'),
      ])
      if (!active) return
      if (p.error || o.error || !p.data?.is_active) {
        setError('Akses akun belum dapat dimuat. Periksa RLS dan profil pengguna.')
        return
      }
      setProfile(p.data as Profile)
      setOutlets((o.data ?? []) as Outlet[])
      if (p.data.role === 'LEADER' && p.data.outlet_id) setSelectedOutlet(p.data.outlet_id)
    }
    load()
    return () => { active = false }
  }, [session])

  const currentOutlet = useMemo(() => outlets.find(o => o.id === selectedOutlet), [outlets, selectedOutlet])
  const name = profile?.role === 'AM'
    ? (currentOutlet?.outlet_name ?? 'Area Bandung 2')
    : (outlets.find(o => o.id === profile?.outlet_id)?.outlet_name ?? 'Outlet')

  async function login(event: FormEvent) {
    event.preventDefault()
    setError('')
    setLoggingIn(true)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('login-nik', {
        body: { nik: nik.trim(), password },
      })
      if (invokeError || !data?.access_token || !data?.refresh_token) {
        throw new Error(data?.error ?? 'NIK atau password salah, atau fungsi login belum aktif.')
      }
      sessionStorage.setItem('kabobs.ops.loginPending', '1')
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      })
      sessionStorage.removeItem('kabobs.ops.loginPending')
      if (sessionError) { localStorage.removeItem(SESSION_STORE); throw sessionError }
      const { data: verifiedSession } = await supabase.auth.getSession()
      if (!verifiedSession.session) throw new Error('Sesi login tidak berhasil dibuat.')
      markActivity(verifiedSession.session.user.id)
      setSessionMessage('')
      setPassword('')
    } catch (e) {
      sessionStorage.removeItem('kabobs.ops.loginPending')
      setError(e instanceof Error ? e.message : 'Login gagal')
    } finally { setLoggingIn(false) }
  }

  async function logout() {
    localStorage.removeItem(SESSION_STORE)
    sessionStorage.removeItem(MODULE_STORE)
    setAccountOpen(false)
    await supabase.auth.signOut()
    setActivePage('Dashboard')
    setSelectedOutlet('')
    setProfile(null)
  }

  if (loading) return <div className="loading">Memuat KABOBS Operational Hub...</div>
  if (!session) return <main className="login-screen">
    <div className="login-panel">
      <img className="kabobs-login-logo" src={`${import.meta.env.BASE_URL}kabobs-logo.png`} alt="Kabobs Premium Kebab" />
      <div className="eyebrow">KABOBS PREMIUM KEBAB</div>
      <h1>Operational Hub</h1>
      <p className="muted">Area Bandung 2 · Masuk menggunakan NIK dan password</p>
      <form onSubmit={login} className="login-form">
        <label>NIK<input value={nik} onChange={e => setNik(e.target.value)} inputMode="numeric" placeholder="Masukkan NIK" required /></label>
        <label>Password<input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Masukkan password" required /></label>
        {(error || sessionMessage) && <div className="error" role="alert">{error || sessionMessage}</div>}
        <button className="primary-button" disabled={loggingIn}>{loggingIn ? 'Memverifikasi...' : 'Masuk ke KABOBS Operational Hub'}</button>
      </form>
      <small>Akses khusus Area Manager dan Leader Outlet</small>
    </div>
  </main>

  if (!profile) return <div className="loading">{error || 'Memuat hak akses pengguna...'}</div>

  return <div className="app-shell horizontal-shell">
    <header className="site-header">
      <div className="site-topbar">
        <div className="side-brand"><img className="kabobs-header-logo" src={`${import.meta.env.BASE_URL}kabobs-logo.png`} alt="Logo Kabobs" /><span><strong>KABOBS Operational Hub</strong><small>AREA BANDUNG 2</small></span></div>
        <div className="top-actions"><span className="user-name">{profile.full_name} · {profile.role === 'AM' ? 'Area Manager' : name}</span><button className="secondary-button" onClick={() => setAccountOpen(true)}>Ganti Password</button><button className="secondary-button" onClick={logout}>Keluar</button></div>
      </div>
      <nav className="horizontal-nav" aria-label="Menu operasional">
        {modules.map(([title]) => <button key={title} className={activePage === title ? 'nav-active' : ''} onClick={() => setActivePage(title)}>{title}</button>)}
      </nav>
    </header>
    {accountOpen && <AccountSecurity profile={profile} outlets={outlets} onClose={() => setAccountOpen(false)} onPasswordChanged={() => { setAccountOpen(false); void logout() }} />}
    <div className="main-area">
      <main className="content">
        <div className="content-head"><div><div className="eyebrow">KABOBS · AREA BANDUNG 2</div><h1>{activePage}</h1><p className="muted">{profile.role === 'AM' ? 'Area Manager · 8 Outlet' : `Leader · ${name}`}</p></div>
          <div className="filters">
            {profile.role === 'AM' && <select aria-label="Outlet" value={selectedOutlet} onChange={e => setSelectedOutlet(e.target.value)}><option value="">Semua Outlet</option>{outlets.map(o => <option key={o.id} value={o.id}>{o.outlet_name}</option>)}</select>}
  <select
    aria-label="Bulan"
    value={month}
    onChange={e => setMonth(Number(e.target.value))}
  >
    {Array.from({ length: 12 }, (_, i) => (
      <option value={i + 1} key={i}>
        {new Intl.DateTimeFormat('id-ID', { month: 'long' }).format(new Date(2026, i, 1))}
      </option>
    ))}
  </select>
            <select aria-label="Tahun" value={year} onChange={e => setYear(Number(e.target.value))}>{Array.from({length: 8}, (_,i)=>2024+i).map(y => <option key={y}>{y}</option>)}</select>
          </div>
        </div>
        {activePage === 'Dashboard' ? <>
          <section className="hero"><div className="eyebrow light">LIVE OPERATIONS · AREA BANDUNG 2</div><h2>{greeting()}, {name}!</h2><p className="dashboard-hero-description" style={{ textAlign: 'center', marginInline: 'auto' }}>Pantau performa, aktivitas tim, agenda, dan tindak lanjut operasional dalam satu sistem.</p><span className="hero-note">Database: Terhubung · Role: {profile.role}</span></section>
          {/* Ringkasan Operasional diletakkan paling atas agar langsung terlihat. */}
          <OperationalOverview
            role={profile.role}
            outletId={profile.role === 'AM' ? selectedOutlet : (profile.outlet_id ?? '')}
            outlets={outlets}
            month={month}
            year={year}
          />
          <DashboardSales
            role={profile.role}
            outletId={profile.role === 'AM' ? selectedOutlet : (profile.outlet_id ?? '')}
            outlets={outlets}
            month={month}
            year={year}
            teamOnDuty={<TeamOnDutyDashboard
              role={profile.role}
              outletId={profile.role === 'AM' ? selectedOutlet : (profile.outlet_id ?? '')}
              outlets={outlets}
            />}
          />
          <div className="dashboard-grid dashboard-info-grid">
            <GeneralInformation role={profile.role} outletId={profile.role === 'AM' ? selectedOutlet : (profile.outlet_id ?? '')} outlets={outlets} month={month} year={year} compact />
            <CalendarActivity role={profile.role} outletId={profile.role === 'AM' ? selectedOutlet : (profile.outlet_id ?? '')} outlets={outlets} month={month} year={year} compact />
          </div>
          </>
: activePage === 'Profile Outlet'
  ? <ProfileOutlet
      role={profile.role}
      outletId={profile.role === 'AM' ? selectedOutlet : (profile.outlet_id ?? '')}
      outlets={outlets}
    />
        : activePage === 'Calendar Activity' ? <CalendarActivity role={profile.role} outletId={profile.role === 'AM' ? selectedOutlet : (profile.outlet_id ?? '')} outlets={outlets} month={month} year={year} /> : activePage === 'General Information' ? <GeneralInformation role={profile.role} outletId={profile.role === 'AM' ? selectedOutlet : (profile.outlet_id ?? '')} outlets={outlets} month={month} year={year} /> : activePage === 'Sales Report' ? <SalesReport role={profile.role} outletId={profile.role === 'AM' ? selectedOutlet : (profile.outlet_id ?? '')} outlets={outlets} month={month} year={year} /> : activePage === 'Defect & Maintenance' ? <Maintenance role={profile.role} outletId={profile.role === 'AM' ? selectedOutlet : (profile.outlet_id ?? '')} outlets={outlets} month={month} year={year} />
: activePage === 'Report Visit AM'
  ? <VisitAM
      role={profile.role}
      outletId={profile.role === 'AM' ? selectedOutlet : (profile.outlet_id ?? '')}
      outlets={outlets}
      month={month}
      year={year}
    />
    : activePage === 'PIQ Performance'
  ? <PIQPerformance
      role={profile.role}
      outletId={profile.role === 'AM' ? selectedOutlet : (profile.outlet_id ?? '')}
      outlets={outlets}
      month={month}
      year={year}
    />
    : activePage === 'Data Team'
  ? <DataTeam
      role={profile.role}
      outletId={profile.role === 'AM' ? selectedOutlet : (profile.outlet_id ?? '')}
      outlets={outlets}
    />
    : activePage === 'Schedule'
  ? <Schedule
      role={profile.role}
      outletId={profile.role === 'AM' ? selectedOutlet : (profile.outlet_id ?? '')}
      outlets={outlets}
      month={month}
      year={year}
    />
    : activePage === 'Inventory & DSO'
  ? <InventoryDSO
      role={profile.role}
      outletId={profile.role === 'AM' ? selectedOutlet : (profile.outlet_id ?? '')}
      outlets={outlets}
      month={month}
      year={year}
    />
    : activePage === 'Peringkat Outlet'
  ? <OutletRanking
      role={profile.role}
      outletId={profile.role === 'AM' ? selectedOutlet : (profile.outlet_id ?? '')}
      outlets={outlets}
      month={month}
      year={year}
    />
    : activePage === 'Template BA'
  ? <TemplateBA role={profile.role} />
  : activePage === 'Live Chat'
  ? <LiveChat role={profile.role} />
: <section className="panel">
    <div className="feature-icon">✦</div>
    <h2>{activePage}</h2>
    <p>{modules.find(m => m[0] === activePage)?.[1]}</p>
    <div className="notice">
      Modul ini belum diimplementasikan. Sales Report kini sudah tersedia.
    </div>
  </section>
}
      </main>
    </div>
  </div>
}
