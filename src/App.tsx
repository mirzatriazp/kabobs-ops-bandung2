import { useEffect, useMemo, useState } from 'react'
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
type Profile = {
  id: string
  nik: string
  full_name: string
  role: 'AM' | 'LEADER'
  outlet_id: string | null
  is_active: boolean
}
type Outlet = { id: string; outlet_code: string; outlet_name: string }

const modules = [
  ['Dashboard','Ringkasan dan informasi outlet'],
  ['Profile Outlet','Foto, alamat dan detail store'],
  ['Calendar Activity','Agenda dan deadline operasional'],
  ['General Information','Pengumuman dan informasi dari AM'],
  ['Sales Report','Input actual sales dan perhitungan MTD'],
  ['Defect & Maintenance','Pengajuan service order'],
  ['Report Visit AM','Temuan dan corrective action'],
  ['PIQ Performance','Hasil audit internal'],
  ['Data Team','Crew dan atribut kerja'],
  ['Schedule','Perencanaan dan validasi jadwal'],
  ['Inventory & DSO','Review DSO dan selisih bulanan'],
  ['Peringkat Outlet','Ranking area Bandung 2'],
  ['Template BA','Download dokumen'],
  ['Live Chat','Komunikasi antaroutlet'],
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
  const [activePage, setActivePage] = useState('Dashboard')
  const [selectedOutlet, setSelectedOutlet] = useState('')
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) { setSession(data.session); setLoading(false) }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (!next) { setProfile(null); setOutlets([]) }
    })
    return () => { mounted = false; subscription.unsubscribe() }
  }, [])

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
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      })
      if (sessionError) throw sessionError
      setPassword('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login gagal')
    } finally { setLoggingIn(false) }
  }

  async function logout() {
    await supabase.auth.signOut()
    setActivePage('Dashboard')
    setSelectedOutlet('')
    setProfile(null)
  }

  if (loading) return <div className="loading">Memuat KABOBS OPS...</div>
  if (!session) return <main className="login-screen">
    <div className="login-panel">
      <div className="brand-mark">K</div>
      <div className="eyebrow">KABOBS PREMIUM KEBAB</div>
      <h1>Operational Hub</h1>
      <p className="muted">Area Bandung 2 · Masuk menggunakan NIK dan password</p>
      <form onSubmit={login} className="login-form">
        <label>NIK<input value={nik} onChange={e => setNik(e.target.value)} inputMode="numeric" placeholder="Masukkan NIK" required /></label>
        <label>Password<input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Masukkan password" required /></label>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="primary-button" disabled={loggingIn}>{loggingIn ? 'Memverifikasi...' : 'Masuk ke Kabobs OPS'}</button>
      </form>
      <small>Akses khusus Area Manager dan Leader Outlet</small>
    </div>
  </main>

  if (!profile) return <div className="loading">{error || 'Memuat hak akses pengguna...'}</div>

  return <div className="app-shell horizontal-shell">
    <header className="site-header">
      <div className="site-topbar">
        <div className="side-brand"><span className="brand-mark small">K</span><span><strong>KABOBS OPS</strong><small>AREA BANDUNG 2</small></span></div>
        <div className="top-actions"><span className="user-name">{profile.full_name} · {profile.role === 'AM' ? 'Area Manager' : name}</span><button className="secondary-button" onClick={logout}>Keluar</button></div>
      </div>
      <nav className="horizontal-nav" aria-label="Menu operasional">
        {modules.map(([title]) => <button key={title} className={activePage === title ? 'nav-active' : ''} onClick={() => setActivePage(title)}>{title}</button>)}
      </nav>
    </header>
    <div className="main-area">
      <main className="content">
        <div className="content-head"><div><div className="eyebrow">KABOBS · AREA BANDUNG 2</div><h1>{activePage}</h1><p className="muted">{profile.role === 'AM' ? 'Area Manager · 8 Outlet' : `Leader · ${name}`}</p></div>
          <div className="filters">
            {profile.role === 'AM' && <select aria-label="Outlet" value={selectedOutlet} onChange={e => setSelectedOutlet(e.target.value)}><option value="">Semua Outlet</option>{outlets.map(o => <option key={o.id} value={o.id}>{o.outlet_name}</option>)}</select>}
            <select aria-label="Bulan" value={month} onChange={e => setMonth(Number(e.target.value))}>{Array.from({ length: 12 }, (_, i) => <option value={i + 1} key={i}>{new Intl.DateTimeFormat('id-ID',{month:'long'}).format(new Date(2026,i,1))}</option>)}</select>
            <select aria-label="Tahun" value={year} onChange={e => setYear(Number(e.target.value))}>{Array.from({length: 8}, (_,i)=>2024+i).map(y => <option key={y}>{y}</option>)}</select>
          </div>
        </div>
        {activePage === 'Dashboard' ? <>
          <section className="hero"><div className="eyebrow light">LIVE OPERATIONS · AREA BANDUNG 2</div><h2>{greeting()}, {name}!</h2><p>Pantau performa, aktivitas tim, agenda, dan tindak lanjut operasional dalam satu sistem.</p><span className="hero-note">Database: Terhubung · Role: {profile.role}</span></section>
          <DashboardSales role={profile.role} outletId={profile.role === 'AM' ? selectedOutlet : (profile.outlet_id ?? '')} outlets={outlets} month={month} year={year} />
          <div className="stats stats-secondary">
            {['Nilai PIQ','Tim In Charge Hari Ini'].map(title => <div className="stat-card" key={title}><div className="stat-title">{title}</div><div className="stat-empty">Belum ada data</div><div className="stat-foot">Menunggu integrasi modul terkait</div></div>)}
          </div>
          <div className="dashboard-grid">
            <GeneralInformation role={profile.role} outletId={profile.role === 'AM' ? selectedOutlet : (profile.outlet_id ?? '')} outlets={outlets} month={month} year={year} compact />
            <CalendarActivity role={profile.role} outletId={profile.role === 'AM' ? selectedOutlet : (profile.outlet_id ?? '')} outlets={outlets} month={month} year={year} compact />
          </div>
          <section className="panel"><h3>Master Outlet</h3><p className="muted">Data outlet dibaca dari Supabase sesuai akses.</p><div className="outlet-grid">{outlets.filter(o => profile.role === 'AM' && !selectedOutlet ? true : o.id === (profile.role === 'AM' ? selectedOutlet : profile.outlet_id)).map(o => <div className="outlet-item" key={o.id}><span className="outlet-icon">⌂</span>{o.outlet_name}</div>)}</div></section>
        </> : activePage === 'Calendar Activity' ? <CalendarActivity role={profile.role} outletId={profile.role === 'AM' ? selectedOutlet : (profile.outlet_id ?? '')} outlets={outlets} month={month} year={year} /> : activePage === 'General Information' ? <GeneralInformation role={profile.role} outletId={profile.role === 'AM' ? selectedOutlet : (profile.outlet_id ?? '')} outlets={outlets} month={month} year={year} /> : activePage === 'Sales Report' ? <SalesReport role={profile.role} outletId={profile.role === 'AM' ? selectedOutlet : (profile.outlet_id ?? '')} outlets={outlets} month={month} year={year} /> : activePage === 'Defect & Maintenance' ? <Maintenance role={profile.role} outletId={profile.role === 'AM' ? selectedOutlet : (profile.outlet_id ?? '')} outlets={outlets} month={month} year={year} />
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
