import React, { useEffect, useState } from 'react'
import type { ProjectCard } from '../../electron/preload'
import { ago, shortTime } from '../core/util'
import { openProject, startFromBlend, startNew } from './actions'
import { ask } from './widgets'
import { store } from '../core/store'
import Logo from './Logo'

export default function HomeScreen() {
  const [list, setList] = useState<ProjectCard[] | null>(null)
  const [q, setQ] = useState('')
  const reload = () => window.odit.projects.list().then(setList)
  useEffect(() => { reload() }, [])

  const shown = (list ?? []).filter((c) => c.name.toLowerCase().includes(q.toLowerCase()))

  const remove = async (e: React.MouseEvent, c: ProjectCard) => {
    e.stopPropagation()
    const r = await ask(`'${c.name}'을(를) 휴지통으로 옮길까요?`, { ok: '옮기기', danger: true })
    if (r !== 'ok') return
    await window.odit.app.trash(c.path)
    store.toast('휴지통으로 옮겼어요')
    reload()
  }

  return (
    <div className="app home-app">
      <div className="titlebar">
        <div className="brand"><Logo size={18} /><b>ODIT 3D</b></div>
        <div className="spacer" />
        <button className="btn ghost icon sm" title="설정" onClick={() => store.setUi({ settings: true })}><i className="fa-solid fa-gear" /></button>
      </div>
      <div className="home">
        <div className="home-actions">
          <button className="act act-main" onClick={startNew}>
            <span className="act-icon"><i className="fa-solid fa-plus" /></span><b>새 프로젝트</b>
          </button>
          <button className="act" onClick={() => startFromBlend()}>
            <span className="act-icon blend"><i className="fa-solid fa-cube" /></span><b>블렌더 파일에서 시작</b>
          </button>
          <button className="act" onClick={() => openProject()}>
            <span className="act-icon"><i className="fa-solid fa-folder-open" /></span><b>파일 열기</b>
          </button>
        </div>

        <div className="home-bar">
          <h2>프로젝트</h2>
          {list && <span className="home-count">{list.length}</span>}
          <div className="spacer" />
          <div className="search" style={{ width: 220 }}>
            <i className="fa-solid fa-magnifying-glass" />
            <input className="input" placeholder="검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        {list && shown.length === 0 && (
          <div className="home-empty">
            <i className="fa-solid fa-cube" />
            <b>{q ? '찾는 프로젝트가 없어요' : '아직 프로젝트가 없어요'}</b>
          </div>
        )}
        <div className="home-grid">
          {shown.map((c) => (
            <button key={c.path} className="home-card" onClick={() => openProject(c.path)}>
              <div className="home-thumb">
                {c.thumb && <img src={c.thumb} alt="" />}
                <span className="home-len">{shortTime(c.duration)}</span>
              </div>
              <div className="home-meta"><b>{c.name}</b><small>{ago(c.mtime)}</small></div>
              <span className="home-x" title="휴지통으로" onClick={(e) => remove(e, c)}><i className="fa-solid fa-xmark" /></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
