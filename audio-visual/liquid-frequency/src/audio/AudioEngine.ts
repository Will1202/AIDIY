import { DemoConductor } from './DemoConductor'
import { DemoSynth } from './DemoSynth'
import { FeatureExtractor } from './FeatureExtractor'
import { type AudioFeatures, type SignalSource, createFeatures } from './features'

export interface TrackInfo {
  name: string
  duration: number
}

export interface AudioEngineEvents {
  onTrack?: (t: TrackInfo | null) => void
  onPlayState?: (playing: boolean) => void
  onSource?: (s: SignalSource) => void
  onError?: (msg: string) => void
  onEnded?: () => void
}

const AUDIO_EXT = /\.(mp3|wav|wave|ogg|oga|opus|m4a|aac|flac|webm|mp4)$/i

/**
 * Owns the AudioContext, the <audio> element used for uploaded music, the demo
 * synth, and produces one AudioFeatures frame per animation frame.
 *
 * Graph (music):  <audio> → MediaElementSource → Analyser → musicGain → volume → out
 * Graph (demo):   DemoSynth → volume → out          (visuals use DemoConductor)
 *
 * The analyser sits *before* the volume so analysis doesn't depend on volume.
 */
export class AudioEngine {
  ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private volume: GainNode | null = null
  private musicGain: GainNode | null = null
  private demoGain: GainNode | null = null
  private el: HTMLAudioElement | null = null
  private elSource: MediaElementAudioSourceNode | null = null
  private objectUrl: string | null = null
  private synth: DemoSynth | null = null
  private extractor = new FeatureExtractor()
  readonly conductor = new DemoConductor()

  readonly features: AudioFeatures = createFeatures()
  source: SignalSource = 'idle'
  playing = false
  demoMuted = false
  private vol = 0.8
  private demoPerfStart = 0
  private demoPausedAt = 0
  events: AudioEngineEvents = {}

  /** Must be called from a user gesture (click / key / drop). */
  ensureContext(): AudioContext | null {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) {
        this.events.onError?.('WEB AUDIO UNAVAILABLE · 当前浏览器不支持 Web Audio')
        return null
      }
      const ctx = new AC({ latencyHint: 'interactive' })
      this.ctx = ctx
      this.volume = ctx.createGain()
      this.volume.gain.value = this.vol
      this.volume.connect(ctx.destination)
      this.musicGain = ctx.createGain()
      this.musicGain.connect(this.volume)
      this.demoGain = ctx.createGain()
      this.demoGain.gain.value = this.demoMuted ? 0 : 1
      this.demoGain.connect(this.volume)
      this.analyser = ctx.createAnalyser()
      this.analyser.fftSize = 2048
      this.analyser.smoothingTimeConstant = 0.15
      this.analyser.minDecibels = -110
      this.analyser.maxDecibels = -10
      this.analyser.connect(this.musicGain)
      this.extractor.configure(this.analyser)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  private now() {
    return this.ctx ? this.ctx.currentTime : performance.now() / 1000
  }

  private setSource(s: SignalSource) {
    if (this.source === s) return
    this.source = s
    this.features.source = s
    this.events.onSource?.(s)
  }

  private setPlaying(p: boolean) {
    if (this.playing === p) return
    this.playing = p
    this.events.onPlayState?.(p)
  }

  // ---- DEMO -----------------------------------------------------------------------

  /** Start the demo loop, optionally resuming from a loop-local offset (seconds). */
  startDemo(offset = 0) {
    const ctx = this.ensureContext()
    if (this.el && !this.el.paused) this.el.pause()
    this.conductor.reset()
    this.demoPerfStart = performance.now() / 1000 + 0.08 - offset
    if (ctx && this.demoGain) {
      if (!this.synth) this.synth = new DemoSynth(ctx, this.demoGain)
      this.synth.start(ctx.currentTime + 0.08, offset)
    }
    this.setSource('demo')
    this.setPlaying(true)
  }

  stopDemo() {
    this.demoPausedAt = this.demoTime()
    this.synth?.stop()
    if (this.source === 'demo') this.setPlaying(false)
  }

  /** Loop-local demo time in seconds (0..30). Falls back to the page clock if audio is blocked. */
  demoTime() {
    if (this.synth && this.synth.running && this.ctx && this.ctx.state === 'running') {
      return this.synth.loopTime(this.ctx.currentTime)
    }
    const t = performance.now() / 1000 - this.demoPerfStart
    return ((t % 30) + 30) % 30
  }

  setDemoMuted(m: boolean) {
    this.demoMuted = m
    if (this.demoGain && this.ctx) this.demoGain.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.03)
  }

  // ---- MUSIC ----------------------------------------------------------------------

  isAudioFile(file: File) {
    return file.type.startsWith('audio/') || (file.type === 'video/mp4' || file.type === 'video/webm') || AUDIO_EXT.test(file.name)
  }

  async loadFile(file: File) {
    if (!this.isAudioFile(file)) {
      this.events.onError?.('NOT AN AUDIO FILE · 请上传 MP3 / WAV / OGG / M4A / FLAC 等音频文件')
      return false
    }
    const ctx = this.ensureContext()
    if (!ctx || !this.analyser) return false

    if (!this.el) {
      const el = new Audio()
      el.preload = 'auto'
      el.crossOrigin = 'anonymous'
      // Media events are async: ignore them once the demo has taken over.
      el.addEventListener('ended', () => {
        if (this.source !== 'music') return
        this.setPlaying(false)
        this.events.onEnded?.()
      })
      el.addEventListener('pause', () => this.source === 'music' && this.setPlaying(false))
      el.addEventListener('play', () => this.source === 'music' && this.setPlaying(true))
      el.addEventListener('error', () => {
        const code = el.error?.code
        const msg =
          code === 4
            ? 'UNSUPPORTED FORMAT · 浏览器无法解码该音频格式'
            : code === 3
              ? 'DECODE FAILED · 音频解码失败，文件可能已损坏'
              : 'AUDIO ERROR · 音频加载失败'
        this.events.onError?.(msg)
        if (this.source === 'music') this.setPlaying(false)
        this.events.onTrack?.(null)
      })
      this.el = el
      this.elSource = ctx.createMediaElementSource(el)
      this.elSource.connect(this.analyser)
    }
    const el = this.el
    el.pause()
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
    this.objectUrl = URL.createObjectURL(file)

    const probe = file.type ? el.canPlayType(file.type) : 'maybe'
    if (probe === '' && !AUDIO_EXT.test(file.name)) {
      this.events.onError?.('UNSUPPORTED FORMAT · 浏览器无法播放该格式')
      return false
    }

    el.src = this.objectUrl
    const ok = await new Promise<boolean>((resolve) => {
      const done = (v: boolean) => {
        el.removeEventListener('loadedmetadata', onMeta)
        el.removeEventListener('error', onErr)
        resolve(v)
      }
      const onMeta = () => done(true)
      const onErr = () => done(false)
      el.addEventListener('loadedmetadata', onMeta)
      el.addEventListener('error', onErr)
      el.load()
    })
    if (!ok) return false

    // only now that the file decodes do we hand the stage over from the demo
    this.synth?.stop()
    const name = file.name.replace(/\.[^.]+$/, '')
    this.events.onTrack?.({ name, duration: isFinite(el.duration) ? el.duration : 0 })
    this.extractor.reset(this.now(), true)
    this.setSource('music')
    try {
      await el.play()
    } catch {
      this.events.onError?.('PLAYBACK BLOCKED · 点击播放按钮开始')
    }
    return true
  }

  hasTrack() {
    return !!this.el && !!this.objectUrl
  }

  play() {
    if (this.source === 'demo') {
      this.startDemo(this.demoPausedAt)
      return
    }
    if (!this.el || !this.objectUrl) return
    this.ensureContext()
    this.extractor.reset(this.now(), false)
    void this.el.play().catch(() => this.events.onError?.('PLAYBACK BLOCKED · 点击播放按钮开始'))
  }

  pause() {
    if (this.source === 'demo') {
      this.stopDemo()
      return
    }
    this.el?.pause()
  }

  toggle() {
    if (this.playing) this.pause()
    else this.play()
  }

  /** Switch back to the music track (if any) from demo. */
  resumeMusic() {
    if (!this.el || !this.objectUrl) return false
    this.synth?.stop()
    this.setSource('music')
    this.play()
    return true
  }

  seek(t: number) {
    if (!this.el) return
    const d = this.el.duration
    if (!isFinite(d)) return
    this.el.currentTime = Math.max(0, Math.min(d - 0.05, t))
    this.extractor.reset(this.now(), false)
  }

  currentTime() {
    if (this.source === 'demo') return this.demoTime()
    return this.el ? this.el.currentTime : 0
  }

  duration() {
    if (this.source === 'demo') return 30
    return this.el && isFinite(this.el.duration) ? this.el.duration : 0
  }

  setVolume(v: number) {
    this.vol = v
    if (this.volume && this.ctx) this.volume.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02)
  }

  // ---- per-frame ----------------------------------------------------------------------

  update(dt: number) {
    const f = this.features
    if (this.source === 'music') {
      if (this.playing && this.analyser) this.extractor.analyze(this.analyser, f, dt, this.now())
      else this.extractor.decay(f, dt)
    } else if (this.source === 'demo') {
      if (this.playing) this.conductor.sample(this.demoTime(), dt, f)
      else {
        this.extractor.decay(f, dt)
        this.conductor.climaxNow = false
      }
    } else {
      this.extractor.decay(f, dt)
    }
  }

  dispose() {
    this.synth?.dispose()
    this.synth = null
    if (this.el) {
      this.el.pause()
      this.el.removeAttribute('src')
      this.el.load()
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
    this.objectUrl = null
    try {
      this.elSource?.disconnect()
      this.analyser?.disconnect()
    } catch {
      /* ignore */
    }
    void this.ctx?.close()
    this.ctx = null
    this.el = null
    this.elSource = null
    this.analyser = null
  }
}
