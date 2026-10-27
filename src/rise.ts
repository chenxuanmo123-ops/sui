// Area-switch motion. anime.js is vendored (MIT) and loaded lazily so the
// first paint never waits for it; the Web Animations API is the fallback when
// the chunk is unavailable. Both paths:
//   · do nothing under prefers-reduced-motion;
//   · drop their inline transform when they finish, so a sticky bar inside the
//     animated block keeps pinning to the viewport.
type RiseOptions = { stagger?: number; distance?: number; duration?: number }

type Animated = { revert: () => void }
type AnimeModule = {
  animate: (targets: Element[], params: Record<string, unknown>) => Animated
  stagger: (value: number) => unknown
}

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

let animeChunk: Promise<AnimeModule> | null = null
let animeReady: AnimeModule | null = null
const running = new WeakMap<Element, Animated>()

function loadAnime(): Promise<AnimeModule> {
  animeChunk ??= import('./vendor/anime.esm.js').then(mod => {
    const ready = mod as unknown as AnimeModule
    animeReady = ready
    return ready
  })
  return animeChunk
}

/**
 * Load the motion chunk right after first paint. This runs inside an effect, so
 * the import never delays the first render; it just makes sure the very first
 * tab or view switch already has the module and animates instead of skipping.
 */
export function prefetchMotion() {
  if (reduced() || typeof window === 'undefined') return
  void loadAnime().catch(() => { animeChunk = null })
}

function targetsOf(root: Element) {
  const kids = Array.from(root.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && !child.hidden,
  )
  return kids.length ? kids.slice(0, 12) : [root as HTMLElement]
}

/** Staggered rise for the blocks of a panel that just became visible. */
export function riseIn(root: Element, options: RiseOptions = {}) {
  if (reduced()) return
  const targets = targetsOf(root)
  if (!targets.length) return
  // The chunk is fetched lazily. If it is not here yet, start the fetch and let
  // this change happen without motion: animating after the browser has already
  // painted the block would flash it (visible → hidden → visible).
  if (!animeReady) {
    void loadAnime().catch(() => { animeChunk = null })
    return
  }
  const { stagger = 34, distance = 14, duration = 400 } = options
  loadAnime().then(({ animate, stagger: staggerOf }) => {
    running.get(root)?.revert()
    let animation: Animated
    animation = animate(targets, {
      opacity: [0, 1],
      translateY: [distance, 0],
      duration,
      delay: staggerOf(stagger),
      ease: 'out(3)',
      onComplete: () => {
        animation.revert()
        if (running.get(root) === animation) running.delete(root)
      },
    })
    running.set(root, animation)
  }).catch(() => {
    const frames = targets.map((node, index) => {
      const motion = node.animate(
        [{ opacity: 0, transform: `translateY(${distance}px)` }, { opacity: 1, transform: 'none' }],
        { duration, delay: index * stagger, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both' },
      )
      void motion.finished.then(() => motion.cancel(), () => undefined)
      return motion
    })
    running.set(root, { revert: () => frames.forEach(frame => frame.cancel()) })
  })
}
