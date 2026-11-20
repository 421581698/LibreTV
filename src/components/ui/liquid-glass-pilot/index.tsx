import type * as React from "react"
import { forwardRef, memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { ShaderDisplacementGenerator, fragmentShaders } from "./shader-utils"
import { displacementMap, polarDisplacementMap, prominentDisplacementMap } from "./utils"

// Browser detection - evaluated once at module load
const IS_FIREFOX = typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("firefox")

// Default size avoids layout-dependent initialization
const DEFAULT_GLASS_SIZE = { width: 270, height: 69 }

// Module-level shader map cache - avoids regenerating identical displacement maps
const shaderMapCache = new Map<string, string>()

// Generate shader-based displacement map using shaderUtils (with caching)
const generateShaderDisplacementMap = (width: number, height: number): string => {
  const key = `${width}:${height}`
  const cached = shaderMapCache.get(key)
  if (cached) return cached

  const generator = new ShaderDisplacementGenerator({
    width,
    height,
    fragment: fragmentShaders.liquidGlass,
  })

  const dataUrl = generator.updateShader()
  generator.destroy()

  shaderMapCache.set(key, dataUrl)
  return dataUrl
}

const getMap = (mode: "standard" | "polar" | "prominent" | "shader", shaderMapUrl?: string) => {
  switch (mode) {
    case "standard":
      return displacementMap
    case "polar":
      return polarDisplacementMap
    case "prominent":
      return prominentDisplacementMap
    case "shader":
      return shaderMapUrl || displacementMap
    default:
      throw new Error(`Invalid mode: ${mode}`)
  }
}

/* ---------- SVG filter (memoized - only re-renders when filter params change) ---------- */
const GlassFilter = memo<{
  id: string
  displacementScale: number
  aberrationIntensity: number
  width: number
  height: number
  mode: "standard" | "polar" | "prominent" | "shader"
  shaderMapUrl?: string
}>(({ id, displacementScale, aberrationIntensity, width, height, mode, shaderMapUrl }) => (
  <svg style={{ position: "absolute", width, height }} aria-hidden="true">
    <defs>
      <radialGradient id={`${id}-edge-mask`} cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="black" stopOpacity="0" />
        <stop offset={`${Math.max(30, 80 - aberrationIntensity * 2)}%`} stopColor="black" stopOpacity="0" />
        <stop offset="100%" stopColor="white" stopOpacity="1" />
      </radialGradient>
      <filter id={id} x="-35%" y="-35%" width="170%" height="170%" colorInterpolationFilters="sRGB">
        <feImage id="feimage" x="0" y="0" width="100%" height="100%" result="DISPLACEMENT_MAP" href={getMap(mode, shaderMapUrl)} preserveAspectRatio="xMidYMid slice" />

        <feColorMatrix
          in="DISPLACEMENT_MAP"
          type="matrix"
          values="0.3 0.3 0.3 0 0
                 0.3 0.3 0.3 0 0
                 0.3 0.3 0.3 0 0
                 0 0 0 1 0"
          result="EDGE_INTENSITY"
        />
        <feComponentTransfer in="EDGE_INTENSITY" result="EDGE_MASK">
          <feFuncA type="discrete" tableValues={`0 ${aberrationIntensity * 0.05} 1`} />
        </feComponentTransfer>

        <feOffset in="SourceGraphic" dx="0" dy="0" result="CENTER_ORIGINAL" />

        <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP" scale={displacementScale * (mode === "shader" ? 1 : -1)} xChannelSelector="R" yChannelSelector="B" result="RED_DISPLACED" />
        <feColorMatrix
          in="RED_DISPLACED"
          type="matrix"
          values="1 0 0 0 0
                 0 0 0 0 0
                 0 0 0 0 0
                 0 0 0 1 0"
          result="RED_CHANNEL"
        />

        <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP" scale={displacementScale * ((mode === "shader" ? 1 : -1) - aberrationIntensity * 0.05)} xChannelSelector="R" yChannelSelector="B" result="GREEN_DISPLACED" />
        <feColorMatrix
          in="GREEN_DISPLACED"
          type="matrix"
          values="0 0 0 0 0
                 0 1 0 0 0
                 0 0 0 0 0
                 0 0 0 1 0"
          result="GREEN_CHANNEL"
        />

        <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP" scale={displacementScale * ((mode === "shader" ? 1 : -1) - aberrationIntensity * 0.1)} xChannelSelector="R" yChannelSelector="B" result="BLUE_DISPLACED" />
        <feColorMatrix
          in="BLUE_DISPLACED"
          type="matrix"
          values="0 0 0 0 0
                 0 0 0 0 0
                 0 0 1 0 0
                 0 0 0 1 0"
          result="BLUE_CHANNEL"
        />

        <feBlend in="GREEN_CHANNEL" in2="BLUE_CHANNEL" mode="screen" result="GB_COMBINED" />
        <feBlend in="RED_CHANNEL" in2="GB_COMBINED" mode="screen" result="RGB_COMBINED" />

        <feGaussianBlur in="RGB_COMBINED" stdDeviation={Math.max(0.1, 0.5 - aberrationIntensity * 0.1)} result="ABERRATED_BLURRED" />

        <feComposite in="ABERRATED_BLURRED" in2="EDGE_MASK" operator="in" result="EDGE_ABERRATION" />

        <feComponentTransfer in="EDGE_MASK" result="INVERTED_MASK">
          <feFuncA type="table" tableValues="1 0" />
        </feComponentTransfer>
        <feComposite in="CENTER_ORIGINAL" in2="INVERTED_MASK" operator="in" result="CENTER_CLEAN" />

        <feComposite in="EDGE_ABERRATION" in2="CENTER_CLEAN" operator="over" />
      </filter>
    </defs>
  </svg>
))

GlassFilter.displayName = "GlassFilter"

/* ---------- container (memoized) ---------- */
const GlassContainer = memo(
  forwardRef<
    HTMLDivElement,
    React.PropsWithChildren<{
      className?: string
      style?: React.CSSProperties
      displacementScale?: number
      blurAmount?: number
      saturation?: number
      aberrationIntensity?: number
      onMouseLeave?: () => void
      onMouseEnter?: () => void
      onMouseDown?: () => void
      onMouseUp?: () => void
      active?: boolean
      overLight?: boolean
      cornerRadius?: number
      padding?: string
      glassSize?: { width: number; height: number }
      onClick?: () => void
      mode?: "standard" | "polar" | "prominent" | "shader"
    }>
  >(
    (
      {
        children,
        className = "",
        style,
        displacementScale = 25,
        blurAmount = 12,
        saturation = 180,
        aberrationIntensity = 2,
        onMouseEnter,
        onMouseLeave,
        onMouseDown,
        onMouseUp,
        active = false,
        overLight = false,
        cornerRadius = 999,
        padding = "24px 32px",
        glassSize = { width: 270, height: 69 },
        onClick,
        mode = "standard",
      },
      ref,
    ) => {
      const filterId = useId()
      const shaderMapUrl = useMemo(
        () => (mode === "shader" ? generateShaderDisplacementMap(glassSize.width, glassSize.height) : ""),
        [mode, glassSize.width, glassSize.height],
      )

      const backdropFilter = `blur(${(overLight ? 12 : 4) + blurAmount * 32}px) saturate(${saturation}%)`

      return (
        <div ref={ref} className={`relative ${className} ${active ? "active" : ""} ${Boolean(onClick) ? "cursor-pointer" : ""}`} style={style} onClick={onClick}>
          <GlassFilter mode={mode} id={filterId} displacementScale={displacementScale} aberrationIntensity={aberrationIntensity} width={glassSize.width} height={glassSize.height} shaderMapUrl={shaderMapUrl} />

          <div
            className="glass"
            style={{
              borderRadius: `${cornerRadius}px`,
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              gap: "24px",
              padding,
              overflow: "hidden",
              transition: "all 0.2s ease-in-out",
              boxShadow: overLight ? "0px 16px 70px rgba(0, 0, 0, 0.75)" : "0px 12px 40px rgba(0, 0, 0, 0.25)",
            }}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUp}
          >
            <span
              className="glass__warp"
              style={{
                  filter: IS_FIREFOX ? undefined : `url(#${filterId})`,
                  backdropFilter,
                  position: "absolute",
                  inset: "0",
                }}
            />

            <div
              className="transition-all duration-150 ease-in-out text-white"
              style={{
                position: "relative",
                zIndex: 1,
                font: "500 20px/1 system-ui",
                textShadow: overLight ? "0px 2px 12px rgba(0, 0, 0, 0)" : "0px 2px 12px rgba(0, 0, 0, 0.4)",
              }}
            >
              {children}
            </div>
          </div>
        </div>
      )
    },
  ),
)

GlassContainer.displayName = "GlassContainer"

interface LiquidGlassProps {
  children: React.ReactNode
  displacementScale?: number
  blurAmount?: number
  saturation?: number
  aberrationIntensity?: number
  elasticity?: number
  cornerRadius?: number
  globalMousePos?: { x: number; y: number }
  mouseOffset?: { x: number; y: number }
  mouseContainer?: React.RefObject<HTMLElement | null> | null
  className?: string
  padding?: string
  style?: React.CSSProperties
  overLight?: boolean
  mode?: "standard" | "polar" | "prominent" | "shader"
  onClick?: () => void
  onRenderCount?: (count: number) => void
}

export default function LiquidGlass({
  children,
  displacementScale = 70,
  blurAmount = 0.0625,
  saturation = 140,
  aberrationIntensity = 2,
  elasticity = 0.15,
  cornerRadius = 999,
  globalMousePos: externalGlobalMousePos,
  mouseOffset: externalMouseOffset,
  mouseContainer = null,
  className = "",
  padding = "24px 32px",
  overLight = false,
  style = {},
  mode = "standard",
  onClick,
  onRenderCount,
}: LiquidGlassProps) {
  // ---- DOM refs for direct manipulation (bypasses React reconciliation) ----
  const glassRef = useRef<HTMLDivElement>(null)
  const olRef1 = useRef<HTMLDivElement>(null)
  const olRef2 = useRef<HTMLDivElement>(null)
  const brRef1 = useRef<HTMLSpanElement>(null)
  const brRef2 = useRef<HTMLSpanElement>(null)
  const hvRef1 = useRef<HTMLDivElement>(null)
  const hvRef2 = useRef<HTMLDivElement>(null)
  const hvRef3 = useRef<HTMLDivElement>(null)

  // ---- Mouse position stored in ref (NO state = NO re-renders on mouse move) ----
  const mousePosRef = useRef({ gx: 0, gy: 0, ox: 0, oy: 0 })
  const rafPending = useRef(false)
  const latestTransformRef = useRef("translate(-50%, -50%) scale(1)")
  // Cached rect for fast-path mouse rejection (avoids getBoundingClientRect per mousemove)
  const cachedRectRef = useRef<{ cx: number; cy: number; ts: number } | null>(null)

  // ---- UI state (only infrequent changes trigger re-renders) ----
  const [isHovered, setIsHovered] = useState(false)
  const [isActive, setIsActive] = useState(false)
  const [glassSize, setGlassSize] = useState(DEFAULT_GLASS_SIZE)

  // Render counting for benchmark
  const renderCountRef = useRef(0)
  renderCountRef.current++
  useEffect(() => {
    if (onRenderCount) onRenderCount(renderCountRef.current)
  })

  // ---- Mirror infrequent state/props to refs for rAF access ----
  const isActiveRef = useRef(false)
  const glassSizeRef = useRef(glassSize)
  const onClickRef = useRef(onClick)
  const elasticityRef = useRef(elasticity)

  useEffect(() => {
    glassSizeRef.current = glassSize
  }, [glassSize])
  useEffect(() => {
    onClickRef.current = onClick
  }, [onClick])
  useEffect(() => {
    elasticityRef.current = elasticity
  }, [elasticity])

  // ---- rAF-based DOM update ----
  const updateDOM = useCallback(() => {
    rafPending.current = false
    const el = glassRef.current
    if (!el) return

    // Single getBoundingClientRect call per frame (was 4-5x in original)
    const rect = el.getBoundingClientRect()
    const { gx, gy, ox, oy } = mousePosRef.current
    const size = glassSizeRef.current
    const elast = elasticityRef.current
    const hasClick = Boolean(onClickRef.current)
    const active = isActiveRef.current

    const pillCenterX = rect.left + rect.width / 2
    const pillCenterY = rect.top + rect.height / 2

    // Keep cached center fresh for fast-path rejection in mousemove handler
    cachedRectRef.current = { cx: pillCenterX, cy: pillCenterY, ts: performance.now() }
    const pillWidth = size.width
    const pillHeight = size.height

    const edgeDistX = Math.max(0, Math.abs(gx - pillCenterX) - pillWidth / 2)
    const edgeDistY = Math.max(0, Math.abs(gy - pillCenterY) - pillHeight / 2)
    const edgeDist = Math.sqrt(edgeDistX * edgeDistX + edgeDistY * edgeDistY)
    const activationZone = 200
    const fadeIn = edgeDist > activationZone ? 0 : 1 - edgeDist / activationZone

    // Skip all DOM writes for distant elements — major perf win with many elements
    if (fadeIn === 0 && !active) return

    const elasticX = (gx - pillCenterX) * elast * 0.1 * fadeIn
    const elasticY = (gy - pillCenterY) * elast * 0.1 * fadeIn

    let scaleStr = "scale(1)"
    if (gx && gy) {
      const deltaX = gx - pillCenterX
      const deltaY = gy - pillCenterY
      const centerDist = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
      if (centerDist > 0 && edgeDist <= activationZone) {
        const nx = deltaX / centerDist
        const ny = deltaY / centerDist
        const stretchIntensity = Math.min(centerDist / 300, 1) * elast * fadeIn
        const sx = 1 + Math.abs(nx) * stretchIntensity * 0.3 - Math.abs(ny) * stretchIntensity * 0.15
        const sy = 1 + Math.abs(ny) * stretchIntensity * 0.3 - Math.abs(nx) * stretchIntensity * 0.15
        scaleStr = `scaleX(${Math.max(0.8, sx)}) scaleY(${Math.max(0.8, sy)})`
      }
    }

    const transform = `translate(calc(-50% + ${elasticX}px), calc(-50% + ${elasticY}px)) ${active && hasClick ? "scale(0.96)" : scaleStr}`
    latestTransformRef.current = transform

    const elements = [el, olRef1.current, olRef2.current, brRef1.current, brRef2.current, hvRef1.current, hvRef2.current, hvRef3.current]
    for (const elem of elements) {
      if (elem) elem.style.transform = transform
    }

    const angle = 135 + ox * 1.2
    const stop1Pct = Math.max(10, 33 + oy * 0.3)
    const stop2Pct = Math.min(90, 66 + oy * 0.4)
    const absOx = Math.abs(ox)

    if (brRef1.current) {
      brRef1.current.style.background = `linear-gradient(${angle}deg, rgba(255,255,255,0) 0%, rgba(255,255,255,${0.12 + absOx * 0.008}) ${stop1Pct}%, rgba(255,255,255,${0.4 + absOx * 0.012}) ${stop2Pct}%, rgba(255,255,255,0) 100%)`
    }
    if (brRef2.current) {
      brRef2.current.style.background = `linear-gradient(${angle}deg, rgba(255,255,255,0) 0%, rgba(255,255,255,${0.32 + absOx * 0.008}) ${stop1Pct}%, rgba(255,255,255,${0.6 + absOx * 0.012}) ${stop2Pct}%, rgba(255,255,255,0) 100%)`
    }
  }, [])

  const scheduleUpdate = useCallback(() => {
    if (rafPending.current) return
    rafPending.current = true
    requestAnimationFrame(updateDOM)
  }, [updateDOM])

  // ---- Mouse move handler with fast-path rejection ----
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      const container = mouseContainer?.current || glassRef.current
      if (!container) return

      // Fast-path: use cached element center to reject distant mouse events
      // without calling getBoundingClientRect (which forces layout recalc)
      const cached = cachedRectRef.current
      const now = performance.now()
      if (cached && now - cached.ts < 500) {
        const dx = Math.abs(e.clientX - cached.cx)
        const dy = Math.abs(e.clientY - cached.cy)
        // If mouse is >350px from cached center, skip entirely
        if (dx > 350 && dy > 350) return
      }

      const rect = container.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2

      // Update cached center every 500ms
      if (!cached || now - cached.ts > 500) {
        cachedRectRef.current = { cx: centerX, cy: centerY, ts: now }
      }

      mousePosRef.current = {
        gx: e.clientX,
        gy: e.clientY,
        ox: ((e.clientX - centerX) / rect.width) * 100,
        oy: ((e.clientY - centerY) / rect.height) * 100,
      }

      scheduleUpdate()
    },
    [mouseContainer, scheduleUpdate],
  )

  useEffect(() => {
    if (externalGlobalMousePos && externalMouseOffset) return

    const container = mouseContainer?.current || glassRef.current
    if (!container) return

    container.addEventListener("mousemove", handleMouseMove)
    return () => container.removeEventListener("mousemove", handleMouseMove)
  }, [handleMouseMove, mouseContainer, externalGlobalMousePos, externalMouseOffset])

  useEffect(() => {
    if (externalGlobalMousePos && externalMouseOffset) {
      mousePosRef.current = {
        gx: externalGlobalMousePos.x,
        gy: externalGlobalMousePos.y,
        ox: externalMouseOffset.x,
        oy: externalMouseOffset.y,
      }
      scheduleUpdate()
    }
  }, [externalGlobalMousePos?.x, externalGlobalMousePos?.y, externalMouseOffset?.x, externalMouseOffset?.y, scheduleUpdate])

  useEffect(() => {
    const el = glassRef.current
    if (!el) return

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          setGlassSize({ width: Math.round(width), height: Math.round(height) })
        }
      }
    })

    ro.observe(el)
    // Initial measurement
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      setGlassSize({ width: Math.round(rect.width), height: Math.round(rect.height) })
    }

    return () => ro.disconnect()
  }, [])

  // ---- Stable callbacks ----
  const handleMouseEnter = useCallback(() => setIsHovered(true), [])
  const handleMouseLeave = useCallback(() => setIsHovered(false), [])
  const handleMouseDown = useCallback(() => {
    setIsActive(true)
    isActiveRef.current = true
    scheduleUpdate()
  }, [scheduleUpdate])
  const handleMouseUp = useCallback(() => {
    setIsActive(false)
    isActiveRef.current = false
    scheduleUpdate()
  }, [scheduleUpdate])

  const positionStyles = {
    position: (style.position || "relative") as React.CSSProperties["position"],
    top: style.top || "50%",
    left: style.left || "50%",
  }

  const baseTransition = "all ease-out 0.2s"

  return (
    <>
      <div
        ref={olRef1}
        className={`bg-black transition-all duration-150 ease-in-out pointer-events-none ${overLight ? "opacity-20" : "opacity-0"}`}
        style={{
          ...positionStyles,
          height: glassSize.height,
          width: glassSize.width,
          borderRadius: `${cornerRadius}px`,
          transform: latestTransformRef.current,
          transition: baseTransition,
        }}
      />
      <div
        ref={olRef2}
        className={`bg-black transition-all duration-150 ease-in-out pointer-events-none mix-blend-overlay ${overLight ? "opacity-100" : "opacity-0"}`}
        style={{
          ...positionStyles,
          height: glassSize.height,
          width: glassSize.width,
          borderRadius: `${cornerRadius}px`,
          transform: latestTransformRef.current,
          transition: baseTransition,
        }}
      />

      <GlassContainer
        ref={glassRef}
        className={className}
        style={{
          ...style,
          transform: latestTransformRef.current,
          transition: baseTransition,
        }}
        cornerRadius={cornerRadius}
        displacementScale={overLight ? displacementScale * 0.5 : displacementScale}
        blurAmount={blurAmount}
        saturation={saturation}
        aberrationIntensity={aberrationIntensity}
        glassSize={glassSize}
        padding={padding}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        active={isActive}
        overLight={overLight}
        onClick={onClick}
        mode={mode}
      >
        {children}
      </GlassContainer>

      <span
        ref={brRef1}
        style={{
          ...positionStyles,
          height: glassSize.height,
          width: glassSize.width,
          borderRadius: `${cornerRadius}px`,
          transform: latestTransformRef.current,
          transition: baseTransition,
          pointerEvents: "none",
          mixBlendMode: "screen",
          opacity: 0.2,
          padding: "1.5px",
          WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
          boxShadow: "0 0 0 0.5px rgba(255, 255, 255, 0.5) inset, 0 1px 3px rgba(255, 255, 255, 0.25) inset, 0 1px 4px rgba(0, 0, 0, 0.35)",
          background: "linear-gradient(135deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.12) 33%, rgba(255,255,255,0.4) 66%, rgba(255,255,255,0) 100%)",
        }}
      />

      <span
        ref={brRef2}
        style={{
          ...positionStyles,
          height: glassSize.height,
          width: glassSize.width,
          borderRadius: `${cornerRadius}px`,
          transform: latestTransformRef.current,
          transition: baseTransition,
          pointerEvents: "none",
          mixBlendMode: "overlay",
          padding: "1.5px",
          WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
          boxShadow: "0 0 0 0.5px rgba(255, 255, 255, 0.5) inset, 0 1px 3px rgba(255, 255, 255, 0.25) inset, 0 1px 4px rgba(0, 0, 0, 0.35)",
          background: "linear-gradient(135deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.32) 33%, rgba(255,255,255,0.6) 66%, rgba(255,255,255,0) 100%)",
        }}
      />

      {Boolean(onClick) && (
        <>
          <div
            ref={hvRef1}
            style={{
              ...positionStyles,
              height: glassSize.height,
              width: glassSize.width + 1,
              borderRadius: `${cornerRadius}px`,
              transform: latestTransformRef.current,
              pointerEvents: "none",
              transition: "all 0.2s ease-out",
              opacity: isHovered || isActive ? 0.5 : 0,
              backgroundImage: "radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0) 50%)",
              mixBlendMode: "overlay",
            }}
          />
          <div
            ref={hvRef2}
            style={{
              ...positionStyles,
              height: glassSize.height,
              width: glassSize.width + 1,
              borderRadius: `${cornerRadius}px`,
              transform: latestTransformRef.current,
              pointerEvents: "none",
              transition: "all 0.2s ease-out",
              opacity: isActive ? 0.5 : 0,
              backgroundImage: "radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0) 80%)",
              mixBlendMode: "overlay",
            }}
          />
          <div
            ref={hvRef3}
            style={{
              ...positionStyles,
              height: glassSize.height,
              width: glassSize.width + 1,
              borderRadius: `${cornerRadius}px`,
              transform: latestTransformRef.current,
              pointerEvents: "none",
              transition: "all 0.2s ease-out",
              opacity: isHovered ? 0.4 : isActive ? 0.8 : 0,
              backgroundImage: "radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0) 100%)",
              mixBlendMode: "overlay",
            }}
          />
        </>
      )}
    </>
  )
}
