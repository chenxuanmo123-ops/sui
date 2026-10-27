import { useEffect, useState } from 'react'

/* A short opening frame, not a fake loading step: it only names the product and
   hands the screen to the welcome deck. Reading files never happens here.
   The overlay is decorative and pointer-transparent, so it can never block an
   import or a keyboard user. Reduced-motion visitors skip it entirely. */

const HOLD_MS = 980
const EXIT_MS = 420

type Phase = 'enter' | 'leave' | 'done'

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export default function BootIntro() {
  const [phase, setPhase] = useState<Phase>(() => (prefersReducedMotion() ? 'done' : 'enter'))

  useEffect(() => {
    const root = document.documentElement
    if (prefersReducedMotion()) {
      root.dataset.intro = 'done'
      return
    }
    root.dataset.intro = 'running'
    const leave = window.setTimeout(() => {
      // Reveal the welcome deck while this frame is still dissolving.
      root.dataset.intro = 'done'
      setPhase('leave')
    }, HOLD_MS)
    const end = window.setTimeout(() => setPhase('done'), HOLD_MS + EXIT_MS)
    return () => {
      window.clearTimeout(leave)
      window.clearTimeout(end)
      root.dataset.intro = 'done'
    }
  }, [])

  if (phase === 'done') return null

  return <div className={'boot-intro' + (phase === 'leave' ? ' is-leaving' : '')} aria-hidden="true">
    <span className="boot-grid" />
    <span className="boot-veil" />
    <div className="boot-stage">
      <span className="boot-ring boot-ring-a" />
      <span className="boot-ring boot-ring-b" />
      <span className="boot-ring boot-ring-c" />
      <span className="boot-sweep" />
      <span className="boot-mark">数鉴</span>
      <span className="boot-caption">DATA · EVIDENCE · LOCALLY</span>
      <span className="boot-track"><i /></span>
    </div>
    <div className="boot-foot">
      <span>本地优先</span>
      <span>原文件不上传</span>
      <span>每个数字可回查</span>
    </div>
  </div>
}
