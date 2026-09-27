import React from 'react'
import { store, useStore, type LeftTab } from '../core/store'
import { FX_LIST, LIGHTS, MATERIAL_PRESETS, MOTIONS, PRIMS, TITLE_PRESETS } from '../core/defaults'
import type { AudioClip } from '../core/types'
import { shortTime } from '../core/util'
import {
  addCameraFromView, addEmpty, addFx, addLight, addPrim, addTitle, applyMaterial, applyMotion, importAudio, importModels,
} from './actions'

const TABS: { id: LeftTab; label: string; icon: string }[] = [
  { id: 'add', label: '추가', icon: 'fa-cube' },
  { id: 'material', label: '재질', icon: 'fa-palette' },
  { id: 'motion', label: '모션', icon: 'fa-person-running' },
  { id: 'text', label: '텍스트', icon: 'fa-font' },
  { id: 'fx', label: '효과', icon: 'fa-wand-magic-sparkles' },
  { id: 'audio', label: '오디오', icon: 'fa-music' },
]

/* The ball each material card shows is drawn with CSS: a radial highlight
   over the base colour reads as "shiny", a flat fill as "matte". */
function ball(m: (typeof MATERIAL_PRESETS)[number]['m']) {
  const c = m.color ?? '#ccc'
  const rough = m.roughness ?? 0.5
  const metal = m.metalness ?? 0
  const hi = `rgba(255,255,255,${(1 - rough) * 0.85 + metal * 0.1})`
  if (m.wireframe) return { background: `repeating-linear-gradient(45deg, ${c} 0 1.5px, transparent 1.5px 7px), repeating-linear-gradient(-45deg, ${c} 0 1.5px, transparent 1.5px 7px)` }
  const glow = (m.emissiveIntensity ?? 0) > 0
  return {
    background: `radial-gradient(circle at 34% 30%, ${hi} 0, transparent ${14 + rough * 34}%), ` +
      (metal > 0.5
        ? `linear-gradient(160deg, ${c} 0%, #111 55%, ${c} 100%)`
        : `radial-gradient(circle at 50% 42%, ${c} 40%, color-mix(in srgb, ${c} ${glow ? 80 : 45}%, #000) 100%)`),
    opacity: m.transmission ? 0.6 : 1,
  }
}

export default function LeftPanel() {
  useStore()
  const tab = store.ui.leftTab
  const sel = store.selected
  const audio = store.project.clips.filter((c): c is AudioClip => c.kind === 'audio')

  return (
    <div className="panel left-panel">
      <div className="lp-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={'lp-tab' + (tab === t.id ? ' on' : '')} onClick={() => store.setUi({ leftTab: t.id })}>
            <i className={'fa-solid ' + t.icon} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div className="panel-body">
        {tab === 'add' && <>
          <div className="lib-head">모양</div>
          <div className="lib-grid">
            {PRIMS.map((p) => (
              <button key={p.kind} className="lib-card" onClick={() => addPrim(p.kind)}>
                <i className={'fa-solid ' + p.icon} /><span>{p.name}</span>
              </button>
            ))}
          </div>
          <div className="lib-head">조명과 카메라</div>
          <div className="lib-grid">
            {LIGHTS.map((l) => (
              <button key={l.kind} className="lib-card" onClick={() => addLight(l.kind)}>
                <i className={'fa-solid ' + l.icon} /><span>{l.name}</span>
              </button>
            ))}
            <button className="lib-card" onClick={addCameraFromView}><i className="fa-solid fa-video" /><span>카메라</span></button>
            <button className="lib-card" onClick={addEmpty}><i className="fa-solid fa-crosshairs" /><span>빈 오브젝트</span></button>
          </div>
          <div className="lib-head">가져오기</div>
          <button className="import-row" onClick={() => importModels()}>
            <i className="fa-solid fa-file-import" />
            <b>3D 모델</b>
            <span>GLB · GLTF · FBX · OBJ · STL</span>
          </button>
        </>}

        {tab === 'material' && <>
          <div className="lib-grid mat-grid">
            {MATERIAL_PRESETS.map((m) => (
              <button key={m.id} className="lib-card mat" disabled={!sel?.mat} onClick={() => applyMaterial(m.id)}>
                <span className="mat-ball" style={ball(m.m)} />
                <span>{m.name}</span>
              </button>
            ))}
          </div>
          {!sel?.mat && <p className="lp-hint">모양을 선택하면 재질을 입힐 수 있어요</p>}
        </>}

        {tab === 'motion' && <>
          <div className="lib-grid">
            {MOTIONS.map((m) => (
              <button key={m.id} className="lib-card" disabled={!sel} onClick={() => applyMotion(m.id)}>
                <i className={'fa-solid ' + m.icon} /><span>{m.name}</span>
              </button>
            ))}
          </div>
          <p className="lp-hint">{sel ? '재생 헤드 위치부터 키프레임으로 들어가요' : '움직일 오브젝트를 선택해 주세요'}</p>
        </>}

        {tab === 'text' && <>
          <div className="lib-grid title-grid">
            {TITLE_PRESETS.map((p) => (
              <button key={p.id} className="lib-card title-card" onClick={() => addTitle(p.id)}>
                <span className="title-sample" style={{
                  color: p.c.color, fontWeight: p.c.weight,
                  background: p.c.box ? p.c.boxColor : undefined,
                }}>가나다</span>
                <span>{p.name}</span>
              </button>
            ))}
          </div>
          <div className="lib-head">3D 글자</div>
          <button className="import-row" onClick={() => addPrim('text')}>
            <i className="fa-solid fa-font" />
            <b>입체 글자 추가</b>
          </button>
        </>}

        {tab === 'fx' && (
          <div className="lib-grid">
            {FX_LIST.map((f) => (
              <button key={f.fx} className="lib-card" onClick={() => addFx(f.fx)}>
                <i className={'fa-solid ' + f.icon} /><span>{f.name}</span>
              </button>
            ))}
          </div>
        )}

        {tab === 'audio' && <>
          <button className="import-row" onClick={() => importAudio()}>
            <i className="fa-solid fa-file-audio" />
            <b>오디오 불러오기</b>
            <span>MP3 · WAV · M4A · FLAC · OGG</span>
          </button>
          {audio.length > 0 && <div className="lib-head">타임라인</div>}
          {audio.map((a) => (
            <button key={a.id} className={'audio-row' + (store.ui.selClip === a.id ? ' on' : '')}
              onClick={() => { store.selectClip(a.id); store.setTime(a.start) }}>
              <i className="fa-solid fa-music" />
              <b>{a.name}</b>
              <span>{shortTime(a.dur)}</span>
            </button>
          ))}
        </>}
      </div>
    </div>
  )
}
