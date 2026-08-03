"use client"

import { useEffect, useRef } from "react"

/**
 * AuroraShader — aurora field "magnífico" via WebGL (fragment shader FBM).
 * Camada-base animada do AuroraBackdrop, só na landing pública.
 *
 * Decisões de engenharia (mesmo ethos do NeuralField):
 *  - WebGL puro (raw), ZERO deps novas: 1 quad full-screen + 1 fragment shader.
 *    Sem Three.js (150KB+) nem OGL (dep). ~ bundle leve, perf previsível.
 *  - SSR-safe: renderiza só <canvas> determinístico; todo acesso a
 *    window/gl/getComputedStyle fica no useEffect → sem mismatch de hidratação.
 *  - Fallback = zero regressão: o canvas começa transparente e só pinta se
 *    TODAS as guardas passarem. Senão, o `.aurora` CSS estático atrás aparece.
 *  - Guardas: WebGL disponível, prefers-reduced-motion (1 frame), DPR cap
 *    (1.5 desktop / 1.0 mobile, fill-rate bound), pausa em aba oculta / fora de
 *    vista, cleanup total, resiliência a context-loss. Mobile roda o shader.
 *  - Cores lidas dos CSS vars (getComputedStyle), parseadas p/ uniform vec3 —
 *    GLSL não lê CSS var. Fallbacks iguais aos tokens (nunca pinta preto).
 */

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform vec2  uRes;
uniform float uTime;
uniform vec3  uPurple;
uniform vec3  uCoral;
uniform vec3  uGlow;
uniform float uIntensity;

float hash(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, amp = 0.55;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += amp * noise(p); p = m * p; amp *= 0.5; }
  return v;
}
void main(){
  vec2 uv = vUv;
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = uTime * 0.06;                                   // drift lento
  vec2 q = vec2(fbm(p * 1.5 + vec2(0.0, t)), fbm(p * 1.5 + vec2(5.2, -t * 0.8)));
  float bands = fbm(p * 2.2 + q * 1.8 + vec2(0.0, t * 1.5)); // domínio warp → fitas
  float depth = smoothstep(1.05, 0.15, uv.y);               // mais forte no topo (casa com .aurora)
  float ribbon = smoothstep(0.35, 0.85, bands) * depth;
  vec3 col = mix(uPurple, uCoral, smoothstep(0.55, 0.95, bands) * 0.6);
  col += uGlow * pow(ribbon, 3.0) * 0.5;                    // brilho nas cristas
  float a = ribbon * uIntensity;
  a *= smoothstep(0.0, 0.25, uv.y);                         // fade na base
  gl_FragColor = vec4(col * a, a);                          // premultiplied alpha
}
`

/** Parseia "rgb(a)(...)" ou "#rrggbb" → [r,g,b] em 0..1. */
function parseColor(input: string, fallback: [number, number, number]): [number, number, number] {
  const s = input.trim()
  if (!s) return fallback
  const m = s.match(/rgba?\(([^)]+)\)/i)
  if (m) {
    const parts = m[1].split(",").map((v) => parseFloat(v))
    if (parts.length >= 3 && parts.every((n, i) => i > 2 || !Number.isNaN(n))) {
      return [parts[0] / 255, parts[1] / 255, parts[2] / 255]
    }
  }
  const hex6 = s.match(/^#([0-9a-f]{6})$/i)
  if (hex6) {
    const int = parseInt(hex6[1], 16)
    return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255]
  }
  // Tailwind 4 serializa rgba() como #rrggbbaa — GLSL precisa do rgb sem alpha.
  const hex8 = s.match(/^#([0-9a-f]{8})$/i)
  if (hex8) {
    const int = parseInt(hex8[1], 16)
    return [((int >> 24) & 255) / 255, ((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255]
  }
  return fallback
}

export function AuroraShader({
  className,
  intensity = 0.85,
}: {
  className?: string
  intensity?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return

    // Mobile também roda o shader, mas com DPR cap mais baixo (bateria/GPU).
    // Sem WebGL ou em reduced-motion o canvas fica transparente → .aurora CSS cobre.
    const isMobile = window.matchMedia("(max-width: 767px)").matches

    const glAttrs = { alpha: true, premultipliedAlpha: true, antialias: false } as const
    const gl = (cv.getContext("webgl2", glAttrs) ||
      cv.getContext("webgl", glAttrs)) as WebGLRenderingContext | null
    if (!gl) {
      cv.style.display = "none"
      return
    }

    // Cores do tema (mesmo padrão do NeuralField).
    const cs = getComputedStyle(cv)
    const uPurple = parseColor(cs.getPropertyValue("--noir-aurora-1"), [0.431, 0.373, 0.69])
    const uCoral = parseColor(cs.getPropertyValue("--coral"), [0.898, 0.451, 0.451])
    const uGlow = parseColor(cs.getPropertyValue("--noir-node-active"), [0.702, 0.651, 0.855])

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)
      if (!sh) return null
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        gl.deleteShader(sh)
        return null
      }
      return sh
    }

    let program: WebGLProgram | null = null
    let buffer: WebGLBuffer | null = null
    let uRes: WebGLUniformLocation | null = null
    let uTime: WebGLUniformLocation | null = null

    // (Re)cria TODOS os recursos de GL. Idempotente — roda no mount E no evento
    // `webglcontextrestored`. Chrome descarta o contexto WebGL de canvas fora de
    // tela (ex.: ao rolar pro #como-funciona, o hero sai da viewport); sem
    // reconstruir program/buffer/uniforms, o loop volta a desenhar com um
    // program morto = tela vazia até dar refresh. Aqui está a recuperação.
    const setup = (): boolean => {
      let prog: WebGLProgram | null = null
      try {
        const vs = compile(gl.VERTEX_SHADER, VERT)
        const fs = compile(gl.FRAGMENT_SHADER, FRAG)
        if (!vs || !fs) return false
        prog = gl.createProgram()
        if (!prog) return false
        gl.attachShader(prog, vs)
        gl.attachShader(prog, fs)
        gl.linkProgram(prog)
        gl.deleteShader(vs)
        gl.deleteShader(fs)
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
          gl.deleteProgram(prog)
          return false
        }
      } catch {
        return false
      }

      program = prog
      gl.useProgram(program)

      buffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
      const aPos = gl.getAttribLocation(program, "aPos")
      gl.enableVertexAttribArray(aPos)
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

      uRes = gl.getUniformLocation(program, "uRes")
      uTime = gl.getUniformLocation(program, "uTime")
      gl.uniform3fv(gl.getUniformLocation(program, "uPurple"), uPurple)
      gl.uniform3fv(gl.getUniformLocation(program, "uCoral"), uCoral)
      gl.uniform3fv(gl.getUniformLocation(program, "uGlow"), uGlow)
      gl.uniform1f(gl.getUniformLocation(program, "uIntensity"), intensity)

      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA) // premultiplied
      gl.clearColor(0, 0, 0, 0)
      return true
    }

    if (!setup()) {
      cv.style.display = "none"
      return
    }

    const resize = () => {
      const rect = cv.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1 : 1.5)
      const w = Math.max(1, Math.floor(rect.width * dpr))
      const h = Math.max(1, Math.floor(rect.height * dpr))
      if (cv.width !== w || cv.height !== h) {
        cv.width = w
        cv.height = h
      }
      gl.viewport(0, 0, w, h)
      if (uRes) gl.uniform2f(uRes, w, h)
    }

    const render = (seconds: number) => {
      if (uTime) gl.uniform1f(uTime, seconds)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    // Relógio acumulado: pausar/retomar sem salto.
    let clock = 0
    let last = 0
    let running = false

    const loop = (now: number) => {
      if (gl.isContextLost()) {
        running = false
        return // o handler webglcontextrestored reconstrói e retoma
      }
      if (last === 0) last = now
      clock += (now - last) / 1000
      last = now
      render(clock)
      rafRef.current = requestAnimationFrame(loop)
    }
    const start = () => {
      if (running) return
      running = true
      last = 0
      rafRef.current = requestAnimationFrame(loop)
    }
    const stop = () => {
      running = false
      cancelAnimationFrame(rafRef.current)
    }

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches

    resize()
    if (reduce) {
      render(0)
    }

    const ro = new ResizeObserver(() => {
      resize()
      if (reduce) render(0)
    })
    ro.observe(cv)

    // Pausa fora de vista.
    let onScreen = true
    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting
        if (reduce) return
        if (onScreen && !document.hidden) start()
        else stop()
      },
      { threshold: 0 },
    )
    io.observe(cv)

    // Pausa com aba oculta.
    const onVisibility = () => {
      if (reduce) return
      if (!document.hidden && onScreen) start()
      else stop()
    }
    document.addEventListener("visibilitychange", onVisibility)

    // bfcache: ao apertar "voltar", o browser restaura a página CONGELADA do
    // cache de back/forward. Ao CONGELAR (pagehide persisted) o RAF deixa de ser
    // chamado, mas `running` continua true e `last` guarda o timestamp velho —
    // então um start() ingênuo na volta dá early-return (`if (running) return`)
    // e a aurora nunca religa (só refresh ressuscita). Par pagehide/pageshow:
    //  - pagehide(persisted): stop() → zera `running`, cancela o RAF morto.
    //  - pageshow(persisted): reconstrói o GL se o contexto foi descartado no
    //    cache, recalcula tamanho, zera o relógio (`last=0`, sem salto) e religa.
    const onPageHide = (e: PageTransitionEvent) => {
      if (e.persisted) stop()
    }
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return
      stop() // defensivo: garante running=false mesmo se o pagehide não veio
      if (gl.isContextLost()) {
        if (!setup()) {
          cv.style.display = "none"
          return // sem GL: o `.aurora` CSS estático cobre
        }
      }
      resize()
      last = 0
      if (reduce) {
        render(0)
        return
      }
      if (onScreen && !document.hidden) start()
    }
    window.addEventListener("pagehide", onPageHide)
    window.addEventListener("pageshow", onPageShow)

    // Resiliência a context-loss.
    const onLost = (e: Event) => {
      e.preventDefault()
      stop()
    }
    const onRestored = () => {
      if (!setup()) {
        cv.style.display = "none"
        return // recursos invalidados pela perda — recria do zero
      }
      cv.style.display = "block"
      resize()
      if (reduce) {
        render(0)
        return
      }
      if (onScreen && !document.hidden) start()
    }
    cv.addEventListener("webglcontextlost", onLost as EventListener)
    cv.addEventListener("webglcontextrestored", onRestored as EventListener)

    if (!reduce && onScreen) start()

    return () => {
      stop()
      ro.disconnect()
      io.disconnect()
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("pagehide", onPageHide)
      window.removeEventListener("pageshow", onPageShow)
      cv.removeEventListener("webglcontextlost", onLost as EventListener)
      cv.removeEventListener("webglcontextrestored", onRestored as EventListener)
      if (buffer) gl.deleteBuffer(buffer)
      if (program) gl.deleteProgram(program)
      // Não chamar loseContext(): no Strict Mode (dev) o remount reutiliza o
      // mesmo <canvas> e um contexto “morto” bloqueia o fallback CSS .aurora.
    }
  }, [intensity])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      style={{ width: "100%", height: "100%", display: "block", mixBlendMode: "screen" }}
    />
  )
}
