import React, { useEffect, useRef, useState } from 'react'
import { store, useStore } from '../core/store'
import { extname } from '../core/util'
import HomeScreen from './HomeScreen'
import Viewport from './Viewport'
import LeftPanel from './LeftPanel'
import Outliner from './Outliner'
import Inspector from './Inspector'
import Timeline from './Timeline'
import ExportDialog from './ExportDialog'
import SettingsDialog from './SettingsDialog'
import PreviewPanel from './PreviewPanel'
import { getPrefs, loadPrefs, usePrefs } from '../core/settings'
import Logo from './Logo'
import { AskHost, MenuHost, ask } from './widgets'
import {
  editDelete, editExtrude, editMerge, editSelectAll, goHome, importAudio, importModels, leaveCurrent, save, setEditMode, startFromBlend, toggleEdit,
} from './actions'
import { openAddMenu } from './addMenu'
import { viewportApi } from './vpApi'

const MODEL = ['glb', 'gltf', 'obj', 'fbx', 'stl']
const AUDIO = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg']
const IMAGE = ['png', 'jpg', 'jpeg', 'webp']

export default function App() {
  useStore()
  const [exporting, setExporting] = useState(false)
  const [tlH, setTlH] = useState(280)
  const [dropping, setDropping] = useState(false)
  const screen = store.ui.screen
  const prefs = usePrefs()
  useEffect(() => { loadPrefs() }, [])

  /* ------------------------------------------------ keys */
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target
      if (t instanceof Element && t.closest('input, textarea, select, [contenteditable]')) return
      if (store.ui.screen !== 'editor' || viewportApi.modal || document.querySelector('.modal-backdrop')) return
      const k = e.key.toLowerCase()
      const ctrl = e.ctrlKey || e.metaKey
      const code = e.code
      const done = () => { e.preventDefault(); e.stopPropagation() }

      if (ctrl) {
        if (k === 'z' && !e.shiftKey) { store.doUndo(); return done() }
        if (k === 'y' || (k === 'z' && e.shiftKey)) { store.doRedo(); return done() }
        if (k === 's') { save(e.shiftKey).then((ok) => ok && store.toast('저장했어요')); return done() }
        if (k === 'e') { setExporting(true); return done() }
        if (k === 'b') { store.split(); return done() }
        if (k === 'd') { store.duplicateSelection(); return done() }
        return
      }
      if (k === 'tab') { toggleEdit(); return done() }
      if (store.ui.edit) {
        // mesh edit mode has its own small keymap; everything else falls through
        if (code === 'Digit1') { setEditMode('vert'); return done() }
        if (code === 'Digit3' || code === 'Digit2') { setEditMode('face'); return done() }
        if (k === 'e') { const n = editExtrude(); if (n) setTimeout(() => viewportApi.startModal?.('translate', n)); return done() }
        if (k === 'm') { editMerge(); return done() }
        if (k === 'x' || k === 'delete' || k === 'backspace') { editDelete(); return done() }
        if (k === 'a') { editSelectAll(!e.altKey); return done() }
        if (k === 'escape') { editSelectAll(false); return done() }
        if (k === 'h' || k === 'i' || (e.shiftKey && k === 'd')) return done()
      }
      if (code.startsWith('Numpad')) {
        const n = code.slice(6)
        if (n === '0') store.setUi({ camView: !store.ui.camView })
        else if (n === '1') viewportApi.view?.(e.ctrlKey ? 'back' : 'front')
        else if (n === '3') viewportApi.view?.(e.ctrlKey ? 'left' : 'right')
        else if (n === '7') viewportApi.view?.(e.ctrlKey ? 'bottom' : 'top')
        else if (n === 'Decimal') viewportApi.frameSelected?.()
        else return
        return done()
      }
      if (e.shiftKey && k === 'a') {
        const m = viewportApi.mouse
        openAddMenu(m?.inside ? m.x : innerWidth / 2, m?.inside ? m.y : innerHeight / 3)
        return done()
      }
      if (e.shiftKey && k === 'd') { store.duplicateSelection(); if (viewportApi.mouse?.inside) setTimeout(() => viewportApi.startModal?.('translate')); return done() }
      switch (k) {
        case ' ': store.setPlaying(!store.playing); return done()
        case 'delete': case 'x': case 'backspace': store.deleteSelection(); return done()
        case 'g': case 'r': case 's': {
          const mode = k === 'g' ? 'translate' : k === 'r' ? 'rotate' : 'scale'
          if (viewportApi.mouse?.inside && store.ui.selection.length && !store.ui.camView) viewportApi.startModal?.(mode)
          else store.setUi({ gizmo: mode })
          return done()
        }
        case 'i': store.keySelection(); return done()
        case 'f': viewportApi.frameSelected?.(); return done()
        case 'h':
          if (e.altKey) store.mutate((p) => { for (const o of p.objects) o.visible = true })
          else if (store.ui.selection.length) {
            const ids = store.ui.selection
            store.mutate((p) => { for (const o of p.objects) if (ids.includes(o.id)) o.visible = !o.visible })
          }
          return done()
        case 'a':
          if (e.altKey) store.select([]); else store.select(store.project.objects.map((o) => o.id))
          return done()
        case 'escape': store.select([]); store.setUi({ selKeys: [], selClip: null }); return done()
        case 'home': store.setTime(0); return done()
        case 'end': store.setTime(store.project.settings.duration); return done()
        case 'arrowleft': store.setTime(store.time - (e.shiftKey ? 1 : 1 / store.project.settings.fps)); return done()
        case 'arrowright': store.setTime(store.time + (e.shiftKey ? 1 : 1 / store.project.settings.fps)); return done()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  /* ------------------------------------------------ close + autosave */
  useEffect(() => {
    const off = window.odit.app.onCloseRequest(async () => {
      if (await leaveCurrent()) window.odit.app.close()
    })
    // saved projects keep themselves saved; a new one waits for its first Ctrl S
    let lastSave = Date.now()
    const iv = setInterval(() => {
      const p = getPrefs()
      if (!p.autosave || Date.now() - lastSave < p.autosaveMin * 60_000) return
      lastSave = Date.now()
      if (store.ui.screen === 'editor' && store.dirty && store.path && !store.playing && !store.ui.edit) save().catch(() => {})
    }, 15_000)
    return () => { off(); clearInterval(iv) }
  }, [])

  /* ------------------------------------------------ file drop */
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDropping(false)
    const paths = Array.from(e.dataTransfer.files).map((f) => window.odit.fs.pathOf(f)).filter(Boolean)
    if (!paths.length) return
    const proj = paths.find((p) => extname(p) === 'odit3d')
    if (proj) { const { openProject } = await import('./actions'); return openProject(proj) }
    const blend = paths.find((p) => extname(p) === 'blend')
    if (blend) return startFromBlend(blend)
    if (store.ui.screen !== 'editor') return
    const models = paths.filter((p) => MODEL.includes(extname(p)))
    const audio = paths.filter((p) => AUDIO.includes(extname(p)))
    const images = paths.filter((p) => IMAGE.includes(extname(p)))
    if (models.length) await importModels(models)
    if (audio.length) await importAudio(audio)
    if (images.length) {
      const o = store.selected
      if (o?.mat) store.patch(o.id, (x) => { x.mat!.map = images[0] })
      else store.toast('이미지는 모양을 선택한 뒤 끌어 놓으면 입혀져요')
    }
  }
  const dragIn = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true) }
  }

  /* ------------------------------------------------ timeline resize */
  const resize = (e: React.PointerEvent) => {
    e.preventDefault()
    const y0 = e.clientY, h0 = tlH
    document.body.classList.add('resizing-v')
    const move = (ev: PointerEvent) => setTlH(Math.max(150, Math.min(innerHeight - 320, h0 - (ev.clientY - y0))))
    const up = () => {
      document.body.classList.remove('resizing-v')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const toast = store.ui.toast

  return (
    <div className="root" onDragOver={dragIn} onDragLeave={(e) => { if (!e.relatedTarget) setDropping(false) }} onDrop={onDrop}>
      {screen === 'home' ? <HomeScreen /> : (
        <div className="app">
          <div className="titlebar">
            <button className="brand brand-btn" title="홈" onClick={goHome}><Logo size={18} /></button>
            <input className="title-name" value={store.project.name}
              onChange={(e) => store.mutate((p) => { p.name = e.target.value }, 'name')}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
            {store.dirty && <span className="title-dirty" title="저장 안 됨" />}
            <button className="btn ghost icon sm" title="되돌리기 (Ctrl Z)" disabled={!store.canUndo} onClick={() => store.doUndo()}><i className="fa-solid fa-rotate-left" /></button>
            <button className="btn ghost icon sm" title="다시 실행 (Ctrl Y)" disabled={!store.canRedo} onClick={() => store.doRedo()}><i className="fa-solid fa-rotate-right" /></button>
            <div className="spacer" />
            <button className={'btn sm' + (store.ui.preview ? ' on' : ' ghost')} title="프리뷰 패널" onClick={() => store.setUi({ preview: !store.ui.preview })}>
              <i className="fa-solid fa-display" />프리뷰
            </button>
            <button className="btn ghost icon sm" title="설정" onClick={() => store.setUi({ settings: true })}><i className="fa-solid fa-gear" /></button>
            <button className="btn ghost sm" title="저장 (Ctrl S)" onClick={() => save().then((ok) => ok && store.toast('저장했어요'))}>
              <i className="fa-solid fa-floppy-disk" />저장
            </button>
            <button className="btn primary sm" title="내보내기 (Ctrl E)" onClick={() => setExporting(true)}>
              <i className="fa-solid fa-arrow-up-from-bracket" />내보내기
            </button>
          </div>
          <div className="main">
            <LeftPanel />
            <div className={'center' + (prefs.previewDock === 'bottom' ? ' bottom' : '')}>
              <Viewport />
              {store.ui.preview && <>
                <div className="pv-split" onPointerDown={(e) => {
                  e.preventDefault()
                  const bottom = prefs.previewDock === 'bottom'
                  const x0 = e.clientX, y0 = e.clientY
                  const { w, h } = store.previewSize
                  document.body.classList.add(bottom ? 'resizing-v' : 'resizing-h')
                  const move = (ev: PointerEvent) => {
                    if (bottom) store.previewSize = { w, h: Math.max(160, Math.min(innerHeight - 380, h - (ev.clientY - y0))) }
                    else store.previewSize = { h, w: Math.max(240, Math.min(innerWidth - 1000, w - (ev.clientX - x0))) }
                    store.emit()
                  }
                  const up = () => {
                    document.body.classList.remove('resizing-v', 'resizing-h')
                    window.removeEventListener('pointermove', move)
                    window.removeEventListener('pointerup', up)
                  }
                  window.addEventListener('pointermove', move)
                  window.addEventListener('pointerup', up)
                }} />
                <PreviewPanel />
              </>}
            </div>
            <div className="right-col">
              <div className="panel outliner-panel">
                <div className="panel-head"><span className="panel-title">장면</span><div className="spacer" />
                  <span className="count">{store.project.objects.length}</span></div>
                <Outliner />
              </div>
              <Inspector />
            </div>
          </div>
          <div className="tl-resize" onPointerDown={resize}><span /></div>
          <Timeline height={tlH} />
        </div>
      )}
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {store.ui.settings && <SettingsDialog onClose={() => store.setUi({ settings: false })} />}
      {store.ui.blend && <BlendDialog />}
      {dropping && (
        <div className="drop-overlay"><div><i className="fa-solid fa-file-import" /><b>여기에 놓기</b><span>3D 모델 · 오디오 · 이미지 · 프로젝트</span></div></div>
      )}
      <AskHost />
      <MenuHost />
      {toast && <div className="toast-wrap"><div className="toast" key={toast.id}>{toast.text}</div></div>}
    </div>
  )
}

export { ask }

function BlendDialog() {
  const b = store.ui.blend!
  const close = () => store.setUi({ blend: null })
  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.stopPropagation()}>
      <div className="modal small">
        <div className="modal-head"><h2>{b.phase === 'working' ? '블렌더 장면 가져오는 중' : b.phase === 'noblender' ? '블렌더를 찾지 못했어요' : '가져오지 못했어요'}</h2></div>
        <div className="modal-body">
          {b.phase === 'working' && <div className="blend-prog"><div className="progress"><div /></div><span>{b.file.split(/[\\/]/).pop()}</span></div>}
          {b.phase === 'noblender' && <p className="ask-body">이 PC에 설치된 블렌더가 필요해요. 설정에서 blender.exe 위치를 지정해 주세요.</p>}
          {b.phase === 'error' && <div className="err-body">{b.error}</div>}
        </div>
        {b.phase !== 'working' && (
          <div className="modal-foot">
            {b.phase === 'noblender' && <button className="btn" onClick={() => store.setUi({ blend: null, settings: true })}>설정 열기</button>}
            <div className="spacer" />
            <button className="btn primary" onClick={close}>닫기</button>
          </div>
        )}
      </div>
    </div>
  )
}
