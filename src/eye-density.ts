export interface EyeWindowSpec {
  unitIntervalSeconds: number
  windowOriginsSeconds?: number[]
  startTimeSeconds?: number
  endTimeSeconds?: number
}

const bound = (rows: number[][], time: number, upper = false) => {
  let lo = 0, hi = rows.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (rows[mid][0] < time || (upper && rows[mid][0] === time)) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Counts recorded timestamps, never interpolated display points. Windows overlap. */
export function eyeSampling(rows: number[][], eye: EyeWindowSpec) {
  const ui = eye.unitIntervalSeconds
  if (!Number.isFinite(ui) || ui <= 0) throw new RangeError('Eye UI must be finite and positive')
  if (rows.some((row, i) => !Number.isFinite(row[0]) || (i > 0 && row[0] <= rows[i - 1][0])))
    throw new RangeError('Recorded timestamps must be finite and strictly increasing')
  const firstTime = rows[0]?.[0] ?? 0, lastTime = rows.at(-1)?.[0] ?? 0
  const start = Math.max(firstTime, eye.startTimeSeconds ?? firstTime)
  const end = Math.min(lastTime, eye.endTimeSeconds ?? lastTime), epsilon = ui * 1e-9
  const origins = [...new Set(eye.windowOriginsSeconds ?? [])].filter(t => rows.length > 1 && Number.isFinite(t)
    && t >= start - epsilon && t + 2 * ui <= end + epsilon)
  const counts = origins.map(t => bound(rows, Math.min(lastTime, t + 2 * ui), true) - bound(rows, Math.max(firstTime, t))).sort((a, b) => a - b)
  const first = bound(rows, start), last = bound(rows, end, true)
  let maxGapSeconds = 0
  for (let i = Math.max(1, first); i < Math.min(rows.length, last + 1); i++)
    maxGapSeconds = Math.max(maxGapSeconds, Math.min(end, rows[i][0]) - Math.max(start, rows[i - 1][0]))
  return {
    actualSamples: rows.length, actualSamplesInGate: Math.max(0, last - first),
    completeWindows: eye.windowOriginsSeconds ? origins.length : null,
    rejectedWindows: eye.windowOriginsSeconds ? eye.windowOriginsSeconds.length - origins.length : null,
    minimumSamplesPerWindow: counts[0] ?? null,
    medianSamplesPerWindow: counts.length ? counts[Math.floor(counts.length / 2)] : null,
    maxGapSeconds, maxGapUi: maxGapSeconds / ui,
    gateFullyRecorded: rows.length > 1 && firstTime <= (eye.startTimeSeconds ?? firstTime) + epsilon
      && lastTime >= (eye.endTimeSeconds ?? lastTime) - epsilon,
    windowOriginsSeconds: origins,
  }
}

export interface EyeDensityOptions {
  width: number
  height: number
  yMin: number
  yMax: number
  xMin?: number
  xMax?: number
}

/** Equal time/voltage bins; each complete trace votes at most once per bin. */
export function eyeDensity(rows: number[][], column: number, eye: EyeWindowSpec, options: EyeDensityOptions) {
  const { width, height, yMin, yMax, xMin = 0, xMax = 2 * eye.unitIntervalSeconds } = options
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0) || width > 2048 || height > 1024)
    throw new RangeError('Density dimensions must be positive integers, at most 2048 by 1024')
  if (![xMin, xMax, yMin, yMax].every(Number.isFinite) || xMax <= xMin || yMax <= yMin
    || xMin < 0 || xMax > 2 * eye.unitIntervalSeconds)
    throw new RangeError('Density bounds must cover a finite voltage range within two UI')
  if (!Number.isInteger(column) || column < 1 || rows.some(row => !Number.isFinite(row[column])))
    throw new RangeError('Density needs a recorded finite voltage column')
  const sampling = eyeSampling(rows, eye), counts = new Uint32Array(width * height), seen = new Uint32Array(counts.length)
  const voltageBin = (v: number) => Math.max(0, Math.min(height - 1, Math.floor((yMax - v) / (yMax - yMin) * height)))
  sampling.windowOriginsSeconds.forEach((origin, window) => {
    const start = origin + xMin, end = origin + xMax, step = (xMax - xMin) / width
    // Rasterize the recorded piecewise-linear trace, including narrow extrema.
    // Deduplication makes collinear adaptive subdivisions contribute no extra hits.
    for (let i = Math.max(1, bound(rows, start)); i < rows.length && rows[i - 1][0] < end; i++) {
      const a = rows[i - 1], b = rows[i], left = Math.max(start, a[0]), right = Math.min(end, b[0])
      if (right <= left) continue
      const first = Math.max(0, Math.floor((left - start) / step)), last = Math.min(width - 1, Math.ceil((right - start) / step) - 1)
      const at = (t: number) => a[column] + (b[column] - a[column]) * (t - a[0]) / (b[0] - a[0])
      for (let x = first; x <= last; x++) {
        const va = at(Math.max(left, start + x * step)), vb = at(Math.min(right, start + (x + 1) * step))
        if (Math.max(va, vb) < yMin || Math.min(va, vb) > yMax) continue
        for (let y = voltageBin(Math.max(va, vb)); y <= voltageBin(Math.min(va, vb)); y++) {
          const cell = y * width + x
          if (seen[cell] !== window + 1) { counts[cell]++; seen[cell] = window + 1 }
        }
      }
    }
  })
  return { counts, sampling }
}
