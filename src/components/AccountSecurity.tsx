import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import './AccountSecurity.css'

type Profile = { id: string; nik: string; full_name: string; role: 'AM' | 'LEADER'; outlet_id: string | null }
type Outlet = { id: string; outlet_name: string }
type Props = { profile: Profile; outlets: Outlet[]; onClose: () => void; onPasswordChanged: () => void }

export default function AccountSecurity({ profile, onClose, onPasswordChanged }: Props) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    setError('')
    if (next.length < 6 || next.length > 12) { setError('Password baru harus 6–12 karakter.'); return }
    if (next !== confirm) { setError('Konfirmasi password baru tidak sesuai.'); return }
    if (current === next) { setError('Password baru harus berbeda dari password lama.'); return }
    setBusy(true)
    try {
      // Verify the old password using the existing NIK login endpoint.
      // No password is logged, saved, or shown to AM.
      const { data, error: loginError } = await supabase.functions.invoke('login-nik', {
        body: { nik: profile.nik, password: current },
      })
      if (loginError || !data?.access_token || !data?.refresh_token) throw new Error('Password saat ini tidak benar.')
      const { data: activeUser } = await supabase.auth.getUser()
      if (!activeUser.user || activeUser.user.id !== profile.id) throw new Error('Identitas akun tidak sesuai.')
      // Re-authenticate the current user using their verified password.
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.access_token, refresh_token: data.refresh_token,
      })
      if (sessionError) throw sessionError
      const { error: updateError } = await supabase.auth.updateUser({ password: next })
      if (updateError) throw new Error('Gagal mengganti password: ' + updateError.message)
      setCurrent(''); setNext(''); setConfirm('')
      onPasswordChanged()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Gagal mengganti password.') }
    finally { setBusy(false) }
  }

  return <div className="account-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="account-dialog" role="dialog" aria-modal="true" aria-label="Keamanan Akun">
      <header className="account-heading"><div><h2>Keamanan Akun</h2><p>{profile.full_name} · {profile.role === 'AM' ? 'Area Manager' : 'Leader Outlet'}</p></div><button className="secondary-button" onClick={onClose}>Tutup</button></header>
      <form onSubmit={event => void save(event)} className="account-password-form">
        <p>Setelah password berhasil diganti, akun akan logout. Login kembali memakai NIK dan password baru.</p>
        <label>Password saat ini<input type="password" autoComplete="current-password" value={current} onChange={event => setCurrent(event.target.value)} required /></label>
        <label>Password baru (6–12 karakter)<input type="password" autoComplete="new-password" value={next} onChange={event => setNext(event.target.value)} required minLength={6} maxLength={12} /></label>
        <label>Konfirmasi password baru<input type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} required /></label>
        {error && <p className="account-error" role="alert">{error}</p>}
        <button className="primary-button" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan Password Baru'}</button>
      </form>
    </section>
  </div>
}
