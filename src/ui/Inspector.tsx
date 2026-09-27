import React from 'react'
import { store, useStore, useTime } from '../core/store'
import { keyAt, valueAt } from '../core/anim'
import { FX_MAP, PRIM_MAP, PRIM_PARAMS } from '../core/defaults'
import type { Clip, Material, SceneObject, Settings, ShotTransition, TitleAnim } from '../core/types'
import { basename } from '../core/util'
import { ColorSwatch, NumField, Row, Section, Seg, Select, Slider, Switch } from './widgets'
import { addShot } from './actions'
import { iconOf } from './Outliner'

const AX = ['#ff5266', '#8fd13a', '#5aa9ff']

function KeyBtn({ o, keys }: { o: SceneObject; keys: string[] }) {
  const t = store.time
  const at = keys.every((k) => keyAt(o.anim[k], t))
  const any = keys.some((k) => (o.anim[k]?.length ?? 0) > 0)
  return (
    <button className={'kf-btn' + (at ? ' at' : any ? ' on' : '')} title={at ? '키프레임 지우기' : '키프레임 넣기'}
      onClick={() => store.toggleKey(o.id, keys)}>
      <i className={'fa-solid fa-diamond'} />
    </button>
  )
}

function VecRow({ o, field, label, step, speed }: { o: SceneObject; field: 'pos' | 'rot' | 'scale'; label: string; step: number; speed?: number }) {
  const t = store.time
  const keys = ['x', 'y', 'z'].map((a) => `${field}.${a}`)
  return (
    <div className="vec-row">
      <div className="vec-head"><span>{label}</span><KeyBtn o={o} keys={keys} /></div>
      <div className="vec3">
        {keys.map((k, i) => (
          <NumField key={k} label={'XYZ'[i]} color={AX[i]} step={step} speed={speed}
            value={valueAt(o, k, t)} onChange={(v) => store.setProp(o.id, k, v)} />
        ))}
      </div>
    </div>
  )
}

function PropNum({ o, k, label, min, max, step = 0.01, slider = true }: {
  o: SceneObject; k: string; label: string; min: number; max: number; step?: number; slider?: boolean
}) {
  const v = valueAt(o, k, store.time)
  return (
    <div className="pnum">
      <div className="pnum-head">
        <span>{label}</span>
        <div className="pnum-val"><NumField value={v} step={step} min={min} max={max} onChange={(x) => store.setProp(o.id, k, x)} /></div>
        <KeyBtn o={o} keys={[k]} />
      </div>
      {slider && <Slider value={v} min={min} max={Math.max(min + step, Math.min(max, 10))} step={step} onChange={(x) => store.setProp(o.id, k, x)} />}
    </div>
  )
}

function mat(o: SceneObject, fn: (m: Material) => void, c?: string) {
  store.patch(o.id, (x) => { if (x.mat) fn(x.mat) }, c)
}

/* ------------------------------------------------------------------ edit mode */

/** the middle of the selected vertices, editable — typing a value moves them all */
function EditPanel({ o }: { o: SceneObject }) {
  const ed = store.ui.edit!
  const m = o.edit!
  const sel = ed.sel
  const c = [0, 0, 0]
  for (const i of sel) for (let k = 0; k < 3; k++) c[k] += m.pos[i * 3 + k] / sel.length
  const move = (k: number, v: number) => {
    const d = v - c[k]
    store.editMesh((mm) => { for (const i of sel) mm.pos[i * 3 + k] = +(mm.pos[i * 3 + k] + d).toFixed(5) }, 'median' + k)
  }
  return (
    <Section title="편집 모드">
      <div className="edit-stats">
        <span><b>{sel.length}</b> / {m.pos.length / 3} 정점</span>
        <span>{m.idx.length / 3} 삼각형</span>
      </div>
      {sel.length > 0 && (
        <div className="vec-row">
          <div className="vec-head"><span>선택 중심</span></div>
          <div className="vec3">
            {[0, 1, 2].map((k) => (
              <NumField key={k} label={'XYZ'[k]} color={AX[k]} value={c[k]} onChange={(v) => move(k, v)} />
            ))}
          </div>
        </div>
      )}
      <p className="edit-keys">
        <span className="kbd">1</span> 정점 <span className="kbd">3</span> 면 <span className="kbd">G R S</span> 변형
        <span className="kbd">E</span> 돌출 <span className="kbd">M</span> 병합 <span className="kbd">X</span> 삭제
        <span className="kbd">A</span> 모두 <span className="kbd">Tab</span> 끝내기
      </p>
    </Section>
  )
}

/* ------------------------------------------------------------------ object */

function ObjectProps({ o }: { o: SceneObject }) {
  const cams = store.project.objects.filter((x) => x.id !== o.id)
  return <>
    <div className="insp-title">
      <i className={'fa-solid ' + iconOf(o)} />
      <input className="insp-name" value={o.name} onChange={(e) => store.rename(o.id, e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
    </div>

    {store.ui.edit?.id === o.id && o.edit && <EditPanel o={o} />}

    <Section title="변형">
      <VecRow o={o} field="pos" label="위치" step={0.01} />
      <VecRow o={o} field="rot" label="회전" step={1} speed={0.5} />
      <VecRow o={o} field="scale" label="크기" step={0.01} />
      <div className="row gap-top">
        <span className="dim-label">그림자</span><div className="spacer" />
        <Switch on={o.shadow} onChange={(v) => store.patch(o.id, (x) => { x.shadow = v })} />
      </div>
    </Section>

    {o.prim && (
      <Section title={PRIM_MAP[o.prim.kind].name}>
        {o.prim.kind === 'text' && (
          <textarea className="input text-input" value={o.prim.text ?? ''} rows={2}
            onChange={(e) => store.patch(o.id, (x) => { x.prim!.text = e.target.value }, o.id + ':text')}
            onKeyDown={(e) => e.stopPropagation()} />
        )}
        {Object.entries(o.prim.p).map(([k, v]) => {
          const d = PRIM_PARAMS[k] ?? { label: k, min: 0, max: 100, step: 0.01 }
          return (
            <Row key={k} label={d.label}>
              <NumField value={v} step={d.step} min={d.min} max={d.max}
                onChange={(x) => store.patch(o.id, (y) => { y.prim!.p[k] = x }, o.id + ':' + k)} />
            </Row>
          )
        })}
      </Section>
    )}

    {o.mat && (
      <Section title="재질">
        <Row label="색"><ColorSwatch value={o.mat.color} onChange={(c) => mat(o, (m) => { m.color = c }, o.id + ':color')} /></Row>
        <PropNum o={o} k="mat.metalness" label="금속성" min={0} max={1} />
        <PropNum o={o} k="mat.roughness" label="거칠기" min={0} max={1} />
        <PropNum o={o} k="mat.opacity" label="불투명도" min={0} max={1} />
        <div className="pnum">
          <div className="pnum-head"><span>유리 투과</span>
            <div className="pnum-val"><NumField value={o.mat.transmission} min={0} max={1} onChange={(v) => mat(o, (m) => { m.transmission = v }, o.id + ':tr')} /></div>
          </div>
          <Slider value={o.mat.transmission} min={0} max={1} onChange={(v) => mat(o, (m) => { m.transmission = v }, o.id + ':tr')} />
        </div>
        <Row label="발광색"><ColorSwatch value={o.mat.emissive} onChange={(c) => mat(o, (m) => {
          m.emissive = c
          if (m.emissiveIntensity === 0 && c !== '#000000') m.emissiveIntensity = 1
        }, o.id + ':em')} /></Row>
        <PropNum o={o} k="mat.emissiveIntensity" label="발광 세기" min={0} max={20} />
        <Row label="이미지">
          {o.mat.map ? (
            <div className="row">
              <span className="file-chip" title={o.mat.map}>{basename(o.mat.map)}</span>
              <button className="btn ghost icon sm" title="빼기" onClick={() => mat(o, (m) => { m.map = null })}><i className="fa-solid fa-xmark" /></button>
            </div>
          ) : (
            <button className="btn sm" onClick={async () => {
              const [p] = await window.odit.dialog.open('image')
              if (p) mat(o, (m) => { m.map = p })
            }}><i className="fa-solid fa-image" />입히기</button>
          )}
        </Row>
        <div className="row gap-top">
          <span className="dim-label">각진 면</span><div className="spacer" />
          <Switch on={o.mat.flat} onChange={(v) => mat(o, (m) => { m.flat = v })} />
        </div>
        <div className="row gap-top">
          <span className="dim-label">와이어프레임</span><div className="spacer" />
          <Switch on={o.mat.wireframe} onChange={(v) => mat(o, (m) => { m.wireframe = v })} />
        </div>
      </Section>
    )}

    {o.light && (
      <Section title="조명">
        <Row label="종류">
          <Seg value={o.light.kind} onChange={(k) => store.patch(o.id, (x) => { x.light!.kind = k })} options={[
            { v: 'sun', label: '태양' }, { v: 'point', label: '전구' }, { v: 'spot', label: '스포트' },
          ]} />
        </Row>
        <Row label="색"><ColorSwatch value={o.light.color} onChange={(c) => store.patch(o.id, (x) => { x.light!.color = c }, o.id + ':lc')} /></Row>
        <PropNum o={o} k="light.intensity" label="세기" min={0} max={o.light.kind === 'sun' ? 10 : 200} step={0.1} />
        {o.light.kind === 'spot' && <>
          <Row label="각도"><NumField value={o.light.angle} step={1} min={1} max={89} suffix="°" onChange={(v) => store.patch(o.id, (x) => { x.light!.angle = v }, o.id + ':ang')} /></Row>
          <Row label="가장자리"><NumField value={o.light.softness} min={0} max={1} onChange={(v) => store.patch(o.id, (x) => { x.light!.softness = v }, o.id + ':soft')} /></Row>
        </>}
        <div className="row gap-top">
          <span className="dim-label">그림자 만들기</span><div className="spacer" />
          <Switch on={o.light.shadow} onChange={(v) => store.patch(o.id, (x) => { x.light!.shadow = v })} />
        </div>
      </Section>
    )}

    {o.camera && (
      <Section title="카메라">
        <PropNum o={o} k="camera.fov" label="화각" min={5} max={120} step={0.5} slider={false} />
        <Row label="바라보기">
          <Select value={o.camera.target ?? ''} onChange={(v) => store.patch(o.id, (x) => { x.camera!.target = v || null })}
            options={[{ v: '', label: '직접 회전' }, ...cams.filter((c) => c.kind !== 'camera').map((c) => ({ v: c.id, label: c.name }))]} />
        </Row>
        <button className="btn wide gap-top" onClick={() => addShot(o.id)}>
          <i className="fa-solid fa-film" />재생 헤드에 이 카메라로 샷 넣기
        </button>
      </Section>
    )}

    {o.model && (
      <Section title="모델">
        <p className="file-line" title={o.model.path}>{basename(o.model.path)}</p>
      </Section>
    )}
  </>
}

/* ------------------------------------------------------------------ clips */

const TRANS: { v: ShotTransition; label: string }[] = [
  { v: 'cut', label: '컷' }, { v: 'dip', label: '암전' }, { v: 'blend', label: '카메라 이동' },
]
const TANIM: { v: TitleAnim; label: string }[] = [
  { v: 'none', label: '없음' }, { v: 'fade', label: '페이드' }, { v: 'rise', label: '떠오르기' }, { v: 'pop', label: '팝' },
  { v: 'type', label: '타자기' }, { v: 'blur', label: '흐림' }, { v: 'slide', label: '밀려오기' },
]

function ClipProps({ c }: { c: Clip }) {
  const set = (fn: (c: any) => void, key?: string) => store.patchClip(c.id, fn, key ? c.id + key : undefined)
  const cams = store.project.objects.filter((o) => o.kind === 'camera')
  const head = { shot: ['fa-film', '카메라 샷'], title: ['fa-font', '자막'], fx: ['fa-wand-magic-sparkles', '효과'], audio: ['fa-music', '오디오'] }[c.kind]
  return <>
    <div className="insp-title"><i className={'fa-solid ' + head[0]} /><b>{c.kind === 'fx' ? FX_MAP[c.fx].name : c.kind === 'audio' ? c.name : head[1]}</b></div>
    <Section title="시간">
      <Row label="시작"><NumField value={c.start} step={1 / store.project.settings.fps} min={0} suffix="s" onChange={(v) => set((x) => { x.start = v }, 's')} /></Row>
      <Row label="길이"><NumField value={c.dur} step={1 / store.project.settings.fps} min={0.05} suffix="s" onChange={(v) => set((x) => { x.dur = v }, 'd')} /></Row>
    </Section>

    {c.kind === 'shot' && (
      <Section title="샷">
        <Row label="카메라">
          <Select value={c.cameraId} onChange={(v) => set((x) => { x.cameraId = v })} options={cams.map((o) => ({ v: o.id, label: o.name }))} />
        </Row>
        <Row label="들어오는 방식"><Select value={c.trans} onChange={(v) => set((x) => { x.trans = v })} options={TRANS} /></Row>
        {c.trans !== 'cut' && (
          <Row label="전환 길이"><NumField value={c.transDur} step={0.05} min={0.05} max={5} suffix="s" onChange={(v) => set((x) => { x.transDur = v }, 'td')} /></Row>
        )}
      </Section>
    )}

    {c.kind === 'title' && (
      <Section title="글자">
        <textarea className="input text-input" rows={3} value={c.text}
          onChange={(e) => set((x) => { x.text = e.target.value }, 'txt')} onKeyDown={(e) => e.stopPropagation()} />
        <Row label="크기"><NumField value={c.size} step={1} min={8} max={400} onChange={(v) => set((x) => { x.size = v }, 'sz')} /></Row>
        <Row label="굵기"><Select value={c.weight} onChange={(v) => set((x) => { x.weight = v })}
          options={[400, 500, 600, 700, 800, 900].map((w) => ({ v: w, label: String(w) }))} /></Row>
        <Row label="색"><ColorSwatch value={c.color} onChange={(v) => set((x) => { x.color = v }, 'col')} /></Row>
        <Row label="위치">
          <div className="vec2">
            <NumField label="X" value={c.x * 100} step={0.5} min={0} max={100} suffix="%" onChange={(v) => set((x) => { x.x = v / 100 }, 'x')} />
            <NumField label="Y" value={c.y * 100} step={0.5} min={0} max={100} suffix="%" onChange={(v) => set((x) => { x.y = v / 100 }, 'y')} />
          </div>
        </Row>
        <Row label="등장"><Select value={c.anim} onChange={(v) => set((x) => { x.anim = v })} options={TANIM} /></Row>
        <div className="row gap-top">
          <span className="dim-label">배경</span><div className="spacer" />
          {c.box && <ColorSwatch value={c.boxColor} onChange={(v) => set((x) => { x.boxColor = v }, 'bc')} />}
          <Switch on={c.box} onChange={(v) => set((x) => { x.box = v })} />
        </div>
      </Section>
    )}

    {c.kind === 'fx' && (
      <Section title="효과">
        <div className="pnum">
          <div className="pnum-head"><span>세기</span>
            <div className="pnum-val"><NumField value={c.amount} min={0} max={2} onChange={(v) => set((x) => { x.amount = v }, 'a')} /></div>
          </div>
          <Slider value={c.amount} min={0} max={2} onChange={(v) => set((x) => { x.amount = v }, 'a')} />
        </div>
      </Section>
    )}

    {c.kind === 'audio' && (
      <Section title="소리">
        <div className="pnum">
          <div className="pnum-head"><span>볼륨</span>
            <div className="pnum-val"><NumField value={c.volume * 100} step={1} min={0} max={200} suffix="%" onChange={(v) => set((x) => { x.volume = v / 100 }, 'v')} /></div>
          </div>
          <Slider value={c.volume} min={0} max={2} onChange={(v) => set((x) => { x.volume = v }, 'v')} />
        </div>
        <Row label="페이드 인"><NumField value={c.fadeIn} step={0.05} min={0} max={c.dur} suffix="s" onChange={(v) => set((x) => { x.fadeIn = v }, 'fi')} /></Row>
        <Row label="페이드 아웃"><NumField value={c.fadeOut} step={0.05} min={0} max={c.dur} suffix="s" onChange={(v) => set((x) => { x.fadeOut = v }, 'fo')} /></Row>
      </Section>
    )}
    <button className="btn wide danger gap-top" onClick={() => store.deleteClip(c.id)}><i className="fa-solid fa-trash" />클립 삭제</button>
  </>
}

/* ------------------------------------------------------------------ scene */

const SIZES = [
  { label: '가로 1080p', w: 1920, h: 1080 },
  { label: '세로 쇼츠', w: 1080, h: 1920 },
  { label: '정사각형', w: 1080, h: 1080 },
  { label: '세로 4:5', w: 1080, h: 1350 },
  { label: '가로 4K', w: 3840, h: 2160 },
  { label: '가로 720p', w: 1280, h: 720 },
]

function SceneProps() {
  const s = store.project.settings
  const set = (fn: (s: Settings) => void, key?: string) => store.mutate((p) => fn(p.settings), key)
  const size = SIZES.findIndex((x) => x.w === s.width && x.h === s.height)
  return <>
    <Section title="출력">
      <Row label="화면"><Select value={size} onChange={(i) => set((x) => { if (i >= 0) { x.width = SIZES[i].w; x.height = SIZES[i].h } })}
        options={[...(size < 0 ? [{ v: -1, label: `${s.width}×${s.height}` }] : []), ...SIZES.map((x, i) => ({ v: i, label: `${x.label} · ${x.w}×${x.h}` }))]} /></Row>
      <Row label="프레임"><Seg value={String(s.fps) as '24' | '30' | '60'} onChange={(v) => set((x) => { x.fps = +v })}
        options={[{ v: '24', label: '24' }, { v: '30', label: '30' }, { v: '60', label: '60' }]} /></Row>
      <Row label="길이"><NumField value={s.duration} step={0.1} min={0.5} max={600} suffix="s" onChange={(v) => set((x) => { x.duration = v }, 'dur')} /></Row>
    </Section>
    <Section title="환경">
      <Row label="배경색"><ColorSwatch value={s.background} onChange={(v) => set((x) => { x.background = v }, 'bg')} /></Row>
      <div className="row gap-top">
        <span className="dim-label">스튜디오 반사광</span><div className="spacer" />
        <Switch on={s.env === 'studio'} onChange={(v) => set((x) => { x.env = v ? 'studio' : 'none' })} />
      </div>
      {s.env === 'studio' && (
        <div className="pnum"><div className="pnum-head"><span>반사광 세기</span>
          <div className="pnum-val"><NumField value={s.envIntensity} min={0} max={3} onChange={(v) => set((x) => { x.envIntensity = v }, 'env')} /></div></div>
          <Slider value={s.envIntensity} min={0} max={3} onChange={(v) => set((x) => { x.envIntensity = v }, 'env')} /></div>
      )}
      <div className="pnum"><div className="pnum-head"><span>노출</span>
        <div className="pnum-val"><NumField value={s.exposure} min={0.1} max={4} onChange={(v) => set((x) => { x.exposure = v }, 'exp')} /></div></div>
        <Slider value={s.exposure} min={0.1} max={4} onChange={(v) => set((x) => { x.exposure = v }, 'exp')} /></div>
      <div className="pnum"><div className="pnum-head"><span>빛 번짐</span>
        <div className="pnum-val"><NumField value={s.bloom} min={0} max={3} onChange={(v) => set((x) => { x.bloom = v }, 'bl')} /></div></div>
        <Slider value={s.bloom} min={0} max={3} onChange={(v) => set((x) => { x.bloom = v }, 'bl')} /></div>
      <div className="pnum"><div className="pnum-head"><span>안개</span>
        <div className="pnum-val"><NumField value={s.fog} min={0} max={1} onChange={(v) => set((x) => { x.fog = v }, 'fog')} /></div></div>
        <Slider value={s.fog} min={0} max={1} onChange={(v) => set((x) => { x.fog = v }, 'fog')} /></div>
      <div className="row gap-top">
        <span className="dim-label">그림자</span><div className="spacer" />
        <Switch on={s.shadows} onChange={(v) => set((x) => { x.shadows = v })} />
      </div>
      <div className="row gap-top">
        <span className="dim-label">바닥 격자</span><div className="spacer" />
        <Switch on={s.floorGrid} onChange={(v) => set((x) => { x.floorGrid = v })} />
      </div>
    </Section>
  </>
}

export default function Inspector() {
  useStore()
  useTime()
  const { ui } = store
  const clip = store.clip(ui.selClip)
  const o = store.selected
  const tab = clip || !o ? (clip ? 'clip' : 'scene') : ui.rightTab
  return (
    <div className="panel inspector">
      <div className="tabs">
        <button className={'tab' + (tab !== 'scene' ? ' active' : '')} disabled={!o && !clip}
          onClick={() => store.setUi({ rightTab: 'object' })}>{clip ? '클립' : '오브젝트'}</button>
        <button className={'tab' + (tab === 'scene' ? ' active' : '')}
          onClick={() => { store.selectClip(null); store.setUi({ rightTab: 'scene' }) }}>장면</button>
      </div>
      <div className="panel-body">
        {tab === 'clip' && clip && <ClipProps c={clip} />}
        {tab === 'object' && o && <ObjectProps o={o} />}
        {tab === 'scene' && <SceneProps />}
      </div>
    </div>
  )
}
