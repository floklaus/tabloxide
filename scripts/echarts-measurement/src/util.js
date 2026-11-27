/** A random number generator with a seed, so that each run has the same data. */
export function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

export function mount(width = 1200, height = 500) {
  const el = document.createElement('div')
  el.style.cssText = `width:${width}px;height:${height}px`
  document.getElementById('host').appendChild(el)
  return el
}

/** Resolves when `chart` sends `event`. Rejects after `ms` milliseconds. */
export function once(chart, event, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout: no ${event} event`)),
      ms,
    )
    chart.on(event, function done() {
      clearTimeout(timer)
      chart.off(event, done)
      resolve()
    })
  })
}

/** Waits until the frames that are in the queue ran. */
export function settle() {
  return new Promise((resolve) =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setTimeout(resolve, 50)),
    ),
  )
}

export const log = (message) => console.log(`[measure] ${message}`)

/** Gives the results to the runner, and shows them for a person who opened the page. */
export function finish(results) {
  window.__results = results
  const pre = document.createElement('pre')
  pre.id = 'results'
  pre.textContent = JSON.stringify(results, null, 1)
  document.body.prepend(pre)
  document.title = 'DONE'
}
