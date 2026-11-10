import { useFrame } from '@react-three/fiber'
import { useEffect } from 'react'
import { create } from 'zustand'
import { useStore } from '../state/store'
import { IconSoundOff, IconSoundOn } from '../ui/icons'
import { preview, setMix, setSoundEnabled, setVolume, updateAudio, type MixKey, type PreviewKind } from './engine'

function load<T>(k: string, d: T): T {
  try { const v = localStorage.getItem(k); return v == null ? d : (JSON.parse(v) as T) } catch { return d }
}
function save(k: string, v: unknown) {
  try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ }
}

interface SoundPrefs { on: boolean; volume: number; mix: Record<MixKey, number>; toggle(): void; setVolume(v: number): void; setMix(k: MixKey, v: number): void }

export const useSound = create<SoundPrefs>((set, get) => ({
  on: load('imperial.sound', false),
  volume: load('imperial.volume', 0.6),
  mix: load('imperial.mix', { engines: 0.8, ambience: 0.5, effects: 0.7 }),
  toggle() {
    const on = !get().on
    save('imperial.sound', on)
    set({ on })
    setSoundEnabled(on) // called inside the click handler → satisfies the autoplay policy
  },
  setMix(k, v) {
    const mix = { ...get().mix, [k]: v }
    save('imperial.mix', mix)
    set({ mix })
    setMix(k, v)
  },
  setVolume(v) {
    save('imperial.volume', v)
    set({ volume: v })
    setVolume(v)
  },
}))

/** Inside the Canvas: drives listener + voices every frame. */
export function AudioLayer() {
  useFrame(({ camera }, dt) => updateAudio(camera, Math.min(dt, 0.1), useStore.getState().interior))
  return null
}

/** Outside the Canvas: if sound was left on last time, resume on the first user gesture. */
export function useSoundBootstrap() {
  useEffect(() => {
    setVolume(useSound.getState().volume)
    const m = useSound.getState().mix
    ;(Object.keys(m) as MixKey[]).forEach((k) => setMix(k, m[k]))
    if (!useSound.getState().on) return
    const go = () => {
      if (useSound.getState().on) setSoundEnabled(true)
      window.removeEventListener('pointerdown', go)
      window.removeEventListener('keydown', go)
    }
    window.addEventListener('pointerdown', go)
    window.addEventListener('keydown', go)
    return () => {
      window.removeEventListener('pointerdown', go)
      window.removeEventListener('keydown', go)
    }
  }, [])
}

export function SoundControl() {
  const { on, volume, toggle, setVolume: setV } = useSound()
  return (
    <div className="sound">
      <button className={`with-ico ${on ? 'on' : ''}`} aria-pressed={on} onClick={toggle} title="Synthesised sound effects (S)">{on ? <IconSoundOn /> : <IconSoundOff />} SOUND</button>
      {on && <input type="range" aria-label="Master volume" min={0} max={1} step={0.05} value={volume} onChange={(e) => setV(Number(e.target.value))} title="Volume" />}
    </div>
  )
}

/** Air Control panel section: per-category mix and isolated previews of each sound. */
export function SoundMixPanel() {
  const { on, mix, setMix: set, toggle } = useSound()
  const labels: Record<MixKey, string> = { engines: 'Engines', ambience: 'Wind & ambience', effects: 'Effects & alerts' }
  const previews: { k: PreviewKind; label: string }[] = [
    { k: 'tie', label: 'TIE flyby' }, { k: 'xwing', label: 'X-wing flyby' }, { k: 'shuttle', label: 'Shuttle engines' }, { k: 'alert', label: 'Alert tone' },
  ]
  return (
    <>
      <h4>Sound</h4>
      {!on && <div className="btns"><button onClick={toggle}>Enable sound</button></div>}
      {(Object.keys(labels) as MixKey[]).map((k) => (
        <div key={k} className="kv">
          <span>{labels[k]}</span>
          <input type="range" aria-label={`${labels[k]} volume`} min={0} max={1} step={0.05} value={mix[k]} onChange={(e) => set(k, Number(e.target.value))} />
        </div>
      ))}
      <div className="btns">
        {previews.map((p) => <button key={p.k} disabled={!on} onClick={() => preview(p.k)}>{p.label}</button>)}
      </div>
    </>
  )
}
