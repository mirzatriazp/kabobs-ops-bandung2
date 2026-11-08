import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { supabase } from '../lib/supabase'
import './LiveChat.css'

type Props = { role: 'AM' | 'LEADER' }
type Message = {
  id: string
  sender_id: string
  sender_name: string
  sender_role: string
  sender_outlet: string
  body: string
  created_at: string
}
const MAX_LEN = 1000
const when = (iso: string) => new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(iso))

export default function LiveChat({ role }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [myId, setMyId] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const firstLoad = useRef(true)

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    const { data, error: loadErr } = await supabase
      .from('ops_chat_messages')
      .select('id,sender_id,sender_name,sender_role,sender_outlet,body,created_at')
      .order('created_at', { ascending: false })
      .limit(100)
    if (loadErr) {
      setError('Gagal memuat chat: ' + loadErr.message)
    } else {
      setMessages(((data || []) as Message[]).reverse())
      setError('')
      if (firstLoad.current) firstLoad.current = false
    }
    if (showLoading) setLoading(false)
  }, [])

  useEffect(() => {
    let active = true
    void supabase.auth.getUser().then(({ data }) => {
      if (active) setMyId(data.user?.id || '')
    })
    void load(true)
    // Channel men-trigger reload agar RLS dan snapshot identitas tetap konsisten.
    const channel = supabase.channel('ops-live-chat-area-bdg2')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'ops_chat_messages',
      }, () => { void load() })
      .subscribe()
    const poll = window.setInterval(() => { void load() }, 15000)
    return () => {
      active = false
      window.clearInterval(poll)
      void supabase.removeChannel(channel)
    }
  }, [load])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages.length])

  const send = async (event?: FormEvent) => {
    event?.preventDefault()
    const body = draft.trim()
    if (!body || sending) return
    if (body.length > MAX_LEN) {
      setError(`Pesan maksimal ${MAX_LEN} karakter`)
      return
    }
    setSending(true)
    setError('')
    setNotice('')
    const { error: sendErr } = await supabase.from('ops_chat_messages').insert({ body })
    if (sendErr) setError('Gagal mengirim: ' + sendErr.message)
    else {
      setDraft('')
      await load()
    }
    setSending(false)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <section className="ops-chat-panel">
      <header className="ops-chat-header">
        <div>
          <h3>Live Chat — Area Bandung 2</h3>
          <p>Ruang komunikasi bersama Area Manager dan Leader 8 outlet.</p>
        </div>
        <button className="ops-chat-refresh" type="button" onClick={() => { setNotice(''); void load(true) }} disabled={loading}>
          ↻ Refresh
        </button>
      </header>
      <div className="ops-chat-subhead">
        <span>Chat Bersama</span>
        <span>{role === 'AM' ? 'Area Manager' : 'Leader Outlet'} · 100 pesan terbaru</span>
      </div>
      {error && <p className="ops-chat-alert" role="alert">{error}</p>}
      {notice && <p className="ops-chat-notice">{notice}</p>}
      <div className="ops-chat-messages" role="log" aria-live="polite" aria-label="Pesan Live Chat">
        {loading && messages.length === 0 ? <div className="ops-chat-empty">Memuat percakapan...</div> : null}
        {!loading && messages.length === 0 ? <div className="ops-chat-empty">Belum ada pesan. Mulai percakapan pertama.</div> : null}
        {messages.map(m => {
          const mine = m.sender_id === myId
          return (
            <div key={m.id} className={`ops-chat-line ${mine ? 'mine' : ''}`}>
              <div className="ops-chat-bubble">
                <div className="ops-chat-meta">
                  <strong>{m.sender_name}</strong>
                  <span className="ops-chat-outlet">{m.sender_outlet}</span>
                </div>
                <p>{m.body}</p>
                <time dateTime={m.created_at}>{when(m.created_at)} WIB</time>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
      <form className="ops-chat-compose" onSubmit={e => { void send(e) }}>
        <label htmlFor="ops-chat-input">Tulis pesan</label>
        <div className="ops-chat-compose-row">
          <textarea
            id="ops-chat-input" value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2} maxLength={MAX_LEN}
            placeholder="Tulis pesan untuk tim Area Bandung 2..."
            disabled={sending}
          />
          <button type="submit" disabled={sending || !draft.trim()}>{sending ? 'Mengirim...' : 'Kirim'}</button>
        </div>
        <div className="ops-chat-compose-hint">
          <span>Enter = kirim · Shift+Enter = baris baru</span>
          <span>{draft.length}/{MAX_LEN}</span>
        </div>
      </form>
    </section>
  )
}
