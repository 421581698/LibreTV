import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef
} from 'react'
import { createFridayOrb } from './friday-orb-core.js'

export type FridayState = 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING'

export interface FridayOrbEngine {
  setState(state: FridayState | string): void
  setAudioLevel(level: number): void
  setTheme(theme: 'dark' | 'light' | 'auto'): void
  setPaused(paused: boolean): void
  burst(x?: number, y?: number, scale?: number): void
  resize(): void
  getState(): unknown
  getMetrics(): unknown
  destroy(): void
}

export interface FridayOrbHandle {
  burst(x?: number, y?: number, scale?: number): void
  resize(): void
  getState(): unknown
  getMetrics(): unknown
}

export interface FridayOrbProps {
  state?: FridayState | string
  audioLevel?: number
  theme?: 'dark' | 'light' | 'auto'
  interactive?: boolean
  paused?: boolean
  respectReducedMotion?: boolean
  dprCap?: number
  quality?: number
  ariaLabel?: string
  className?: string
  style?: React.CSSProperties
  onReady?: (engine: FridayOrbEngine) => void
  onBurst?: (event: unknown) => void
  onVisibility?: (visible: boolean) => void
}

const FridayOrb = forwardRef<FridayOrbHandle, FridayOrbProps>(function FridayOrb(props, ref) {
  const {
    state = 'IDLE',
    audioLevel = 0,
    theme = 'dark',
    interactive = true,
    paused = false,
    respectReducedMotion = true,
    dprCap = 2,
    quality = 0,
    showHud = true,
    ariaLabel = 'Friday 全息能量核心',
    className = '',
    style,
    onReady,
    onBurst,
    onVisibility,
    ...rest
  } = props

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<FridayOrbEngine | null>(null)

  /* 只创建一次：后续全部走命令式接口，避免重建画布 */
  useEffect(() => {
    if (!canvasRef.current) return undefined

    const engine = createFridayOrb(canvasRef.current, {
      state,
      audioLevel,
      theme,
      interactive,
      paused,
      respectReducedMotion,
      dprCap,
      quality,
      showHud,
      ariaLabel,
      onBurst,
      onVisibility
    })
    
    engineRef.current = engine
    if (onReady) onReady(engine)

    return () => {
      engine.destroy()
      engineRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (engineRef.current) engineRef.current.setState(state)
  }, [state])

  useEffect(() => {
    if (engineRef.current) engineRef.current.setAudioLevel(audioLevel)
  }, [audioLevel])

  useEffect(() => {
    if (engineRef.current) engineRef.current.setTheme(theme)
  }, [theme])

  useEffect(() => {
    if (engineRef.current) engineRef.current.setPaused(paused)
  }, [paused])

  useImperativeHandle(ref, () => ({
    burst: (x?: number, y?: number, scale?: number) => engineRef.current?.burst(x, y, scale),
    resize: () => engineRef.current?.resize(),
    getState: () => engineRef.current?.getState(),
    getMetrics: () => engineRef.current?.getMetrics()
  }), [])

  return (
    <div
      className={['friday-orb', className].filter(Boolean).join(' ')}
      style={{ 
        position: 'relative', 
        width: '100%', 
        height: '100%', 
        aspectRatio: '1 / 1', 
        minWidth: 0, 
        minHeight: 0, 
        ...style 
      }}
      data-state={String(state).toUpperCase()}
      data-theme={theme}
      {...rest}
    >
      <canvas
        ref={canvasRef}
        className="friday-orb__canvas"
        role="img"
        aria-label={ariaLabel}
        style={{ display: 'block', width: '100%', height: '100%', touchAction: 'manipulation' }}
      />
    </div>
  )
})

export default FridayOrb
