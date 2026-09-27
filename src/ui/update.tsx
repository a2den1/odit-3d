import React, { useCallback, useEffect, useState } from 'react'
import { store } from '../core/store'
import { ask } from './widgets'

type UpdateStatus = Awaited<ReturnType<typeof window.odit.update.status>>

/** live update state, pushed from the main process */
export function useUpdate() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'disabled', currentVersion: '', prefs: { autoCheck: true, autoDownload: true } })
  useEffect(() => {
    let alive = true
    window.odit.update.status().then((s) => { if (alive) setStatus(s) }).catch(() => {})
    const off = window.odit.update.onStatus(setStatus)
    return () => { alive = false; off() }
  }, [])
  const check = useCallback(async () => {
    const s = await window.odit.update.check()
    setStatus(s)
    if (s.state === 'none') store.toast('이미 최신 버전이에요')
  }, [])
  const setPrefs = useCallback(async (p: { autoCheck?: boolean; autoDownload?: boolean }) => setStatus(await window.odit.update.setPrefs(p)), [])
  const install = useCallback(async () => {
    if (store.ui.screen === 'editor' && store.dirty) {
      const r = await ask('저장하지 않은 변경이 있어요', { body: '재시작하기 전에 저장할까요?', ok: '저장하고 재시작', cancel: '취소', extra: '저장 안 함' })
      if (r === 'cancel') return
      if (r === 'ok') { const { save } = await import('./actions'); if (!(await save())) return }
    }
    await window.odit.update.install()
  }, [])
  return { status, check, setPrefs, install }
}

export function UPDATE_LABEL(s: UpdateStatus): string {
  switch (s.state) {
    case 'disabled': return s.reason ?? '꺼져 있어요'
    case 'idle': case 'none': return `최신 버전 ${s.currentVersion}`
    case 'checking': return '확인하는 중…'
    case 'available': return `새 버전 ${s.version}`
    case 'downloading': return `${s.version ?? '새 버전'} 받는 중 ${Math.round(s.percent ?? 0)}%`
    case 'ready': return `${s.version} 설치 준비 완료`
    case 'error': return '확인하지 못했어요'
  }
}

/** Title bar pill — only there when there is something to say. */
export function UpdateBadge() {
  const { status: s, install } = useUpdate()
  if (s.state === 'ready') {
    return <button className="btn sm on" title="재시작하면 새 버전으로 바뀌어요" onClick={install}><i className="fa-solid fa-circle-arrow-up" />{s.version} 설치</button>
  }
  if (s.state === 'downloading') {
    return <button className="btn sm ghost" title="새 버전을 받는 중" onClick={() => store.setUi({ settings: true })}><i className="fa-solid fa-arrow-down" />{Math.round(s.percent ?? 0)}%</button>
  }
  if (s.state === 'available') {
    return <button className="btn sm on" onClick={() => window.odit.update.download()}><i className="fa-solid fa-arrow-up" />새 버전 {s.version}</button>
  }
  return null
}
