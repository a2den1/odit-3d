import { PRIMS, LIGHTS } from '../core/defaults'
import { openMenu, type MenuItem } from './widgets'
import { addCameraFromView, addEmpty, addLight, addPrim, importModels } from './actions'

export function openAddMenu(x: number, y: number) {
  const items: MenuItem[] = [
    ...PRIMS.map((p) => ({ label: p.name, icon: p.icon, run: () => addPrim(p.kind) })),
    { sep: true },
    ...LIGHTS.map((l) => ({ label: l.name, icon: l.icon, run: () => addLight(l.kind) })),
    { label: '카메라', icon: 'fa-video', run: addCameraFromView },
    { label: '빈 오브젝트', icon: 'fa-crosshairs', run: addEmpty },
    { sep: true },
    { label: '3D 모델 불러오기', icon: 'fa-file-import', run: () => importModels() },
  ]
  openMenu(x, y, items)
}
