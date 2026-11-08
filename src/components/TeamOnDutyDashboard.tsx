import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import './TeamOnDutyDashboard.css'

type Outlet = { id: string; outlet_code: string; outlet_name: string }
type Props = { role: 'AM' | 'LEADER'; outletId: string; outlets: Outlet[] }
type Period = { id: string; outlet_id: string }
type Entry = { id: string; outlet_id: string; period_id: string; crew_nik: string; crew_name: string; work_codes: Record<string, string> | null; display_order: number }
type DutyRow = { id: string; outlet: string; name: string; nik: string; code: string; category: 'Opening' | 'Middle' | 'Closing' }
const OPENING = new Set(['O8', 'O9'])
const MIDDLE = new Set(['M10', 'M11', 'M12', 'M13'])
const CLOSING = new Set(['C14', 'C15'])
function jakartaToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const value = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  const year = Number(value('year'))
  const month = Number(value('month'))
  const day = Number(value('day'))
  return { year, month: day > 25 ? (month === 12 ? 1 : month + 1) : month,
    periodYear: day > 25 && month === 12 ? year + 1 : year,
    date: `${value('year')}-${value('month')}-${value('day')}` }
}
function category(code: string): DutyRow['category'] | null {
  if (OPENING.has(code)) return 'Opening'
  if (MIDDLE.has(code)) return 'Middle'
  if (CLOSING.has(code)) return 'Closing'
  return null
}
export default function TeamOnDutyDashboard({ role, outletId, outlets }: Props) {
  const [rows, setRows] = useState<DutyRow[]>([])
  const [approvedCount, setApprovedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshIndex, setRefreshIndex] = useState(0)
  const [slideIndex, setSlideIndex] = useState(0)
  const touchX = useRef<number | null>(null)
  useEffect(() => { setSlideIndex(0) }, [role, outletId])
  const today = jakartaToday()
  const dateLabel = new Date(`${today.date}T12:00:00+07:00`).toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const outletNameById = useMemo(() => new Map(outlets.map(outlet => [outlet.id, outlet.outlet_name])), [outlets])
  const refresh = useCallback(() => setRefreshIndex(n => n + 1), [])
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      setRows([])
      setApprovedCount(0)
      try {
        if (role === 'LEADER' && !outletId) throw new Error('Outlet akun Leader belum terhubung.')
        let query = supabase.from('ops_schedule_periods')
          .select('id,outlet_id')
          .eq('period_year', today.periodYear)
          .eq('period_month', today.month)
          .eq('status', 'approved')
        if (role === 'LEADER' || outletId) query = query.eq('outlet_id', outletId)
        const { data: periods, error: periodsError } = await query
        if (periodsError) throw periodsError
        const approved = (periods ?? []) as Period[]
        if (cancelled) return
        setApprovedCount(approved.length)
        if (!approved.length) { setRows([]); return }
        const { data: entries, error: entriesError } = await supabase.from('ops_schedule_entries')
          .select('id,outlet_id,period_id,crew_nik,crew_name,work_codes,display_order')
          .in('period_id', approved.map(p => p.id))
          .order('display_order', { ascending: true })
        if (entriesError) throw entriesError
        const approvedIds = new Set(approved.map(p => p.id))
        const next = ((entries ?? []) as Entry[])
          .filter(entry => approvedIds.has(entry.period_id))
          .map(entry => {
            const code = entry.work_codes?.[today.date] ?? ''
            const shiftCategory = category(code)
            if (!shiftCategory) return null
            return { id: entry.id, outlet: outletNameById.get(entry.outlet_id) ?? 'Outlet',
              name: entry.crew_name, nik: entry.crew_nik, code, category: shiftCategory }
          })
          .filter((entry): entry is DutyRow => entry !== null)
          .sort((a, b) => a.outlet.localeCompare(b.outlet, 'id') ||
            (['Opening', 'Middle', 'Closing'].indexOf(a.category) - ['Opening', 'Middle', 'Closing'].indexOf(b.category)) ||
            a.name.localeCompare(b.name, 'id'))
        if (!cancelled) setRows(next)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Gagal memuat Team In Charge.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [role, outletId, today.date, today.periodYear, today.month, outletNameById, refreshIndex])
  const count = (shift: DutyRow['category']) => rows.filter(row => row.category === shift).length
  // A single outlet per slide for AM when viewing all outlets.
  const multipleOutlets = role === 'AM' && !outletId
  const outletSlides = useMemo(() => multipleOutlets
    ? Array.from(new Set(rows.map(row => row.outlet)))
    : [null], [rows, multipleOutlets])
  const activeSlide = Math.min(slideIndex, Math.max(0, outletSlides.length - 1))
  const goSlide = (delta: number) => setSlideIndex(current => {
    const next = Math.min(current, outletSlides.length - 1) + delta
    return (next + outletSlides.length) % outletSlides.length
  })
  const shiftCodes = ['O8', 'O9', 'M10', 'M11', 'M12', 'M13', 'C14', 'C15']
  const selectedSlide = outletSlides[activeSlide] ?? null
  const visibleRows = selectedSlide === null ? rows : rows.filter(row => row.outlet === selectedSlide)
  return <section className="tod-card" aria-label="Team In Charge Hari Ini">
    <div className="tod-header">
      <div><h3>Team In Charge Hari Ini</h3><p>{dateLabel} · Berdasarkan Schedule Approved AM</p></div>
      <button type="button" onClick={refresh} disabled={loading}>↻ Refresh</button>
    </div>
    {loading ? <p className="tod-muted">Memuat jadwal resmi...</p>
      : error ? <div role="alert" className="tod-error">Gagal memuat data: {error}</div>
      : approvedCount === 0 ? <div className="tod-empty">Belum ada Schedule yang disetujui AM untuk periode hari ini{role === 'AM' && !outletId ? ' di 8 outlet' : ''}.</div>
      : rows.length === 0 ? <div className="tod-empty">Tidak ada crew terjadwal bekerja hari ini. OFF, GHK, dan cuti tidak ditampilkan.</div>
      : <>
        <div className="tod-summary">
          <span><strong>{rows.length}</strong> Crew bertugas</span>
          <span>Opening <strong>{count('Opening')}</strong></span>
          <span>Middle <strong>{count('Middle')}</strong></span>
          <span>Closing <strong>{count('Closing')}</strong></span>
        </div>
        <div className="tod-shift-list">
          {multipleOutlets && outletSlides.length > 1 && <div className="tod-slide-nav" aria-label="Navigasi outlet">
            <button type="button" aria-label="Outlet sebelumnya" onClick={() => goSlide(-1)}>‹</button>
            <span>{activeSlide + 1} / {outletSlides.length} outlet</span>
            <button type="button" aria-label="Outlet berikutnya" onClick={() => goSlide(1)}>›</button>
          </div>}
          <div
            className="tod-outlet-group"
            onTouchStart={event => { touchX.current = event.touches[0]?.clientX ?? null }}
            onTouchEnd={event => {
              if (!multipleOutlets || outletSlides.length <= 1 || touchX.current === null) return
              const endX = event.changedTouches[0]?.clientX ?? touchX.current
              const distance = endX - touchX.current
              touchX.current = null
              if (Math.abs(distance) >= 45) goSlide(distance < 0 ? 1 : -1)
            }}
          >
            {multipleOutlets && <h4 className="tod-outlet-heading">{selectedSlide}</h4>}
            {shiftCodes.map(code => {
              const members = visibleRows.filter(row => row.code === code)
              if (!members.length) return null
              const shiftType = category(code)
              return <div className="tod-shift-row" key={code}>
                <span className={`tod-code tod-${shiftType?.toLowerCase() ?? 'opening'}`}>{code}</span>
                <span className="tod-names">{members.map((member, index) =>
                  <span key={member.id}><strong>{member.name}</strong>{index < members.length - 1 ? ', ' : ''}</span>
                )}</span>
              </div>
            })}
          </div>
        </div>
      </>}
  </section>
}
