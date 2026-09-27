import React, { useEffect, useState } from 'react'
import { usePrefs, setPrefs, DEFAULT_PREFS } from '../core/settings'
import { EASINGS } from '../core/easing'
import { Select, Switch } from './widgets'
import { useUpdate, UPDATE_LABEL } from './update'
import { store } from '../core/store'

const KEYS: [string, string][] = [
  ['Shift A', '추가 메뉴'], ['G  R  S', '이동 · 회전 · 크기 (뒤에 X Y Z로 축 고정)'], ['Tab', '편집 모드'],
  ['1  3', '정점 · 면 선택 (편집 모드)'], ['E', '돌출'], ['M', '병합'], ['X  Delete', '삭제'], ['A  Alt A', '모두 선택 · 해제'],
  ['Shift D', '복제'], ['H  Alt H', '숨기기 · 모두 보이기'], ['I', '키프레임 넣기'], ['F', '선택한 것에 맞추기'],
  ['Numpad 0', '카메라 시점'], ['Numpad 1 3 7', '정면 · 옆 · 위'], ['Space', '재생'], ['← →', '한 프레임 이동'],
  ['Ctrl B', '자르기'], ['Ctrl Z  Ctrl Y', '되돌리기 · 다시 실행'], ['Ctrl S', '저장'], ['Ctrl E', '내보내기'],
]

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const p = usePrefs()
  const [found, setFound] = useState<string | null | undefined>(undefined)
  const [version, setVersion] = useState('')
  const up = useUpdate()
  const us = up.status
  useEffect(() => {
    window.odit.blender.find(p.blenderPath).then(setFound)
    window.odit.app.info().then((i) => setVersion(i.version))
  }, [p.blenderPath])

  return (
    <div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose() }}>
      <div className="modal settings">
        <div className="modal-head"><h2>설정</h2></div>
        <div className="modal-body">
          <div className="set-sec">
            <h3>조작</h3>
            <div className="set-row"><span>화면 돌리기</span>
              <Select value={p.orbitButton} onChange={(v) => setPrefs({ orbitButton: v })}
                options={[{ v: 'middle', label: '가운데 버튼 (블렌더식)' }, { v: 'right', label: '오른쪽 버튼' }]} />
            </div>
            <div className="set-row"><span>왼쪽 드래그로도 돌리기</span><Switch on={p.leftOrbit} onChange={(v) => setPrefs({ leftOrbit: v })} /></div>
            <div className="set-row"><span>휠 확대 방향 반대로</span><Switch on={p.invertZoom} onChange={(v) => setPrefs({ invertZoom: v })} /></div>
          </div>

          <div className="set-sec">
            <h3>화면</h3>
            <div className="set-row"><span>3D 화면 선명도</span>
              <Select value={p.quality} onChange={(v) => setPrefs({ quality: v })}
                options={[{ v: 'high', label: '높음' }, { v: 'normal', label: '보통' }, { v: 'low', label: '낮음 (빠름)' }]} />
            </div>
            <div className="set-row"><span>프리뷰 위치</span>
              <Select value={p.previewDock} onChange={(v) => setPrefs({ previewDock: v })}
                options={[{ v: 'right', label: '3D 화면 오른쪽' }, { v: 'bottom', label: '3D 화면 아래' }]} />
            </div>
          </div>

          <div className="set-sec">
            <h3>저장</h3>
            <div className="set-row"><span>자동 저장</span><Switch on={p.autosave} onChange={(v) => setPrefs({ autosave: v })} /></div>
            {p.autosave && (
              <div className="set-row"><span>자동 저장 간격</span>
                <Select value={p.autosaveMin} onChange={(v) => setPrefs({ autosaveMin: v })}
                  options={[1, 3, 5, 10].map((m) => ({ v: m, label: `${m}분` }))} />
              </div>
            )}
          </div>

          <div className="set-sec">
            <h3>애니메이션</h3>
            <div className="set-row"><span>새 키프레임의 움직임</span>
              <Select value={p.defaultEase} onChange={(v) => setPrefs({ defaultEase: v })}
                options={EASINGS.filter((e) => e.id !== 'custom').map((e) => ({ v: e.id, label: e.name }))} />
            </div>
          </div>

          <div className="set-sec">
            <h3>업데이트</h3>
            <div className="set-row">
              <span>{UPDATE_LABEL(us)}</span>
              {us.state === 'ready' ? (
                <button className="btn sm primary" onClick={() => up.install()}>재시작해서 설치</button>
              ) : us.state === 'available' ? (
                <button className="btn sm primary" onClick={() => window.odit.update.download()}>내려받기</button>
              ) : (
                <button className="btn sm" disabled={us.state === 'disabled' || us.state === 'checking' || us.state === 'downloading'} onClick={() => up.check()}>
                  <i className="fa-solid fa-rotate" />확인
                </button>
              )}
            </div>
            {us.state === 'downloading' && <div className="progress"><div style={{ width: `${Math.round(us.percent ?? 0)}%` }} /></div>}
            {us.state === 'error' && <div className="err-body">{us.error}</div>}
            <div className="set-row"><span>켤 때 새 버전 확인</span><Switch on={us.prefs.autoCheck} onChange={(v) => up.setPrefs({ autoCheck: v })} /></div>
            <div className="set-row"><span>새 버전 알아서 내려받기</span><Switch on={us.prefs.autoDownload} onChange={(v) => up.setPrefs({ autoDownload: v })} /></div>
          </div>

          <div className="set-sec">
            <h3>블렌더</h3>
            <div className="set-row">
              <div className="set-path">
                <input className="input" readOnly value={found ?? (found === null ? '찾지 못했어요' : '찾는 중…')} />
                <button className="btn sm" onClick={async () => {
                  const [f] = await window.odit.dialog.open('exe')
                  if (f) setPrefs({ blenderPath: f })
                }}>찾아보기</button>
                {p.blenderPath && <button className="btn ghost sm" onClick={() => setPrefs({ blenderPath: '' })}>자동</button>}
              </div>
            </div>
          </div>

          <div className="set-sec">
            <h3>단축키</h3>
            <div className="key-table">
              {KEYS.map(([k, v]) => <React.Fragment key={k}><span className="kbd">{k}</span><span>{v}</span></React.Fragment>)}
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <span className="set-ver">ODIT 3D {version}</span>
          <div className="spacer" />
          <button className="btn ghost" onClick={() => setPrefs({ ...DEFAULT_PREFS, blenderPath: p.blenderPath })}>기본값으로</button>
          <button className="btn primary" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  )
}
