// src/modeling.ts
import { z } from "zod";

// src/matrices.mjs
var Diagnostic = class extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
};
function fail(code, message) {
  throw new Diagnostic(code, message);
}
var sum = (xs) => xs.reduce((a2, b) => a2 + b, 0);
var scale = (a2, k2) => a2.map((r) => r.map((v2) => v2 * k2));
var transpose = (a2) => a2[0].map((_2, j) => a2.map((r) => r[j]));
var multiply = (a2, b) => a2.map((r) => transpose(b).map((c2) => sum(r.map((v2, k2) => v2 * c2[k2]))));
var symmetrize = (a2) => a2.map((r, i) => r.map((v2, j) => (v2 + a2[j][i]) / 2));
function validateMatrix(a2, name, tolerance = 0.02) {
  const n = a2.length;
  if (!n || a2.some((r) => r.length !== n || r.some((v2) => !Number.isFinite(v2)))) fail("matrix_format", `${name}: finite square matrix required`);
  const norm = Math.max(...a2.flat().map(Math.abs));
  if (!norm) fail("matrix_zero", name);
  const residual = Math.max(...a2.flatMap((r, i) => r.map((v2, j) => Math.abs(v2 - a2[j][i])))) / norm;
  if (residual > tolerance) fail("reciprocity", `${name}: residual ${residual} > ${tolerance}`);
  const m2 = symmetrize(a2), l = m2.map(() => Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    const v2 = m2[i][j] - sum(l[i].slice(0, j).map((x2, k2) => x2 * l[j][k2]));
    if (i === j) {
      if (v2 <= norm * 1e-12) fail("passivity", `${name}: nonpositive Cholesky pivot ${v2}`);
      l[i][j] = Math.sqrt(v2);
    } else l[i][j] = v2 / l[j][j];
  }
  return { matrix: m2, reciprocityResidual: residual, cholesky: l };
}
function loopImpedance(a2) {
  const n = a2.length - 1;
  if (![1, 2, 3].includes(n)) fail("matrix_dimension", "One to three signals plus a return required");
  const A = Array.from({ length: n + 1 }, (_2, i) => Array.from({ length: n }, (_3, j) => i === n ? -1 : Number(i === j)));
  return multiply(multiply(transpose(A), a2), A);
}
function referenceCapacitance(c2) {
  const row = c2.map(sum), denominator = sum(row);
  if (denominator <= 0) fail("reference", "C to infinity must have positive total common capacitance");
  const n = c2.length - 1, matrix = c2.slice(0, n).map((r, i) => r.slice(0, n).map((v2, j) => v2 - row[i] * row[j] / denominator));
  const checked = validateMatrix(matrix, "C loop");
  if (checked.matrix.some((r, i) => r.some((v2, j) => i !== j && v2 > 0) || sum(r) <= 0)) fail("capacitance_sign", "Referenced Maxwell C needs nonpositive mutual C and positive shunt C");
  return { ...checked, denominator, convention: "Q_total=0; Vsignal relative to finite return; infinity common voltage eliminated" };
}
function parseFastHenry(text) {
  const blocks = [...text.matchAll(/Impedance matrix for frequency\s*=\s*([\deE+.-]+)\s+(\d+)\s*x\s*(\d+)\s*\n([^]*?)(?=Impedance matrix|$)/g)];
  if (!blocks.length) fail("fasthenry_output", "No frequency matrices in Zc.mat");
  return blocks.map((b) => {
    const n = Number(b[2]), rows = b[4].trim().split(/\n/).filter((r) => r.trim()).slice(0, n);
    if (![2, 3, 4].includes(n) || Number(b[3]) !== n) fail("fasthenry_ports", "One to three signals and one return required");
    const matrix = rows.map((r) => [...r.matchAll(/([+-]?[\d.]+(?:[eE][+-]?\d+)?)\s+([+-]?[\d.]+(?:[eE][+-]?\d+)?)j/g)].map((m2) => [Number(m2[1]), Number(m2[2])]));
    if (matrix.length !== n || matrix.some((r) => r.length !== n)) fail("fasthenry_output", "Malformed complex matrix");
    return { frequencyHz: Number(b[1]), R: matrix.map((r) => r.map((v2) => v2[0])), L: matrix.map((r) => r.map((v2) => v2[1] / (2 * Math.PI * Number(b[1])))) };
  });
}
function parseFasterCap(text) {
  const blocks = [...text.matchAll(/Capacitance matrix is:\s*\nDimension\s+(\d+)\s+x\s+(\d+)\s*\n([^]*?)(?=\n\s*\n|\nTotal|\nMemory|$)/gi)];
  if (!blocks.length) fail("fastercap_output", "No 3D capacitance matrix in solver stdout");
  const b = blocks.at(-1), n = Number(b[1]);
  if (![2, 3, 4].includes(n) || Number(b[2]) !== n) fail("fastercap_ports", "Expected 2x2, 3x3 or 4x4 Maxwell matrix");
  const names = [], matrix = b[3].trim().split("\n").slice(0, n).map((r) => {
    const parts = r.trim().split(/\s+/);
    names.push(parts.shift());
    return parts.map(Number);
  });
  if (matrix.some((r) => r.length !== n || r.some((v2) => !Number.isFinite(v2)))) fail("fastercap_output", "Malformed C matrix");
  return { names, matrix, units: "F (3D FasterCap coordinates in metres)" };
}

// src/modeling.ts
var positive = z.number().finite().positive();
var id = z.string().min(1);
var profile = z.object({
  spacing_mm: positive,
  relative_permittivity: positive,
  return: z.object({
    width_mm: positive,
    thickness_mm: positive,
    length_factor: positive,
    center_y_mm: z.number().finite(),
    center_z_mm: z.number().finite()
  })
});
var channelSchema = z.object({
  reduction: z.enum(["routed-copper", "straightened-stages"]),
  sections: z.number().int().min(1).max(128),
  lanes: z.array(z.object({ name: id, driver_source_port_id: id, receiver_source_port_id: id })).min(1).max(3),
  reference_source_port_id: id,
  passive_source_component_ids: z.array(id).optional(),
  extraction: z.object({
    minimum_frequency_hz: positive,
    maximum_frequency_hz: positive,
    model_frequency_hz: positive,
    filaments: positive.int(),
    refinement_filaments: positive.int(),
    convergence_tolerance: positive,
    capacitance_tolerance: positive,
    reciprocity_tolerance: positive,
    dc_resistance_tolerance: positive,
    max_panel_length_mm: positive,
    ground_mesh_size_mm: positive.optional()
  }),
  relative_permittivity: positive.optional(),
  via_plating_thickness_mm: positive.optional(),
  via_equivalent_width_mm: positive.optional(),
  omit_through_via_stubs: z.boolean().optional(),
  straightened_stage_profiles: z.record(profile).optional()
}).superRefine((channel, ctx) => {
  const e = channel.extraction;
  const issue = (path, message) => ctx.addIssue({ code: "custom", path, message });
  if (e.minimum_frequency_hz > e.model_frequency_hz || e.model_frequency_hz > e.maximum_frequency_hz)
    issue(["extraction"], "Require minimum_frequency_hz <= model_frequency_hz <= maximum_frequency_hz");
  if (e.refinement_filaments <= e.filaments)
    issue(["extraction", "refinement_filaments"], "Must exceed filaments");
  if (new Set(channel.lanes.map((lane) => lane.name)).size !== channel.lanes.length)
    issue(["lanes"], "Lane names must be distinct");
  if (channel.reduction === "routed-copper" && e.ground_mesh_size_mm === void 0)
    issue(["extraction", "ground_mesh_size_mm"], "Required for routed-copper");
  if (channel.reduction === "straightened-stages" && !Object.keys(channel.straightened_stage_profiles ?? {}).length)
    issue(["straightened_stage_profiles"], "Profiles required for straightened-stages");
});
var canonical = (value2) => JSON.stringify(value2, (_2, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a2], [b]) => a2.localeCompare(b))) : item);
function modelingFromCircuitJson(circuitJson) {
  if (!Array.isArray(circuitJson)) fail("pcb_spice_channel", "Expected a Circuit JSON record array");
  const experiments = circuitJson.filter((record) => record.type === "simulation_experiment").filter((record) => record.spice_engine === "pcb_spice" && record.experiment_type === "spice_transient_analysis");
  if (!experiments.length) fail("pcb_spice_channel", "No pcb_spice transient pcb_spice_channel found; supply modeling or declare pcbSpiceChannel");
  const channels = experiments.map((record) => {
    const raw = Reflect.get(record, "pcb_spice_channel");
    if (raw === void 0) fail("pcb_spice_channel", `${record.simulation_experiment_id}: missing pcb_spice_channel; supply modeling or declare pcbSpiceChannel`);
    const parsed = channelSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      fail("pcb_spice_channel", `${record.simulation_experiment_id}: pcb_spice_channel.${issue.path.join(".")}: ${issue.message}`);
    }
    return parsed.data;
  });
  if (channels.some((channel) => canonical(channel) !== canonical(channels[0])))
    fail("pcb_spice_channel", "All pcb_spice transient experiments must declare deep-equal pcb_spice_channel values for shared extraction");
  const c2 = channels[0], e = c2.extraction;
  const modeling = {
    reduction: c2.reduction,
    sections: c2.sections,
    lanes: c2.lanes.map((lane) => ({ port: lane.name, from: { sourcePortId: lane.driver_source_port_id }, to: { sourcePortId: lane.receiver_source_port_id } })),
    channelReference: { sourcePortId: c2.reference_source_port_id },
    extraction: {
      minimumHz: e.minimum_frequency_hz,
      maximumHz: e.maximum_frequency_hz,
      modelHz: e.model_frequency_hz,
      filaments: e.filaments,
      refinementFilaments: e.refinement_filaments,
      convergenceTolerance: e.convergence_tolerance,
      capTolerance: e.capacitance_tolerance,
      reciprocityTolerance: e.reciprocity_tolerance,
      dcResistanceTolerance: e.dc_resistance_tolerance,
      maxPanelLengthMm: e.max_panel_length_mm
    }
  };
  if (e.ground_mesh_size_mm !== void 0) modeling.extraction.groundMeshMm = e.ground_mesh_size_mm;
  if (c2.passive_source_component_ids !== void 0) modeling.passiveComponents = c2.passive_source_component_ids.map((sourceComponentId) => ({ sourceComponentId }));
  if (c2.relative_permittivity !== void 0) modeling.relativePermittivity = c2.relative_permittivity;
  if (c2.via_plating_thickness_mm !== void 0) modeling.viaPlatingMm = c2.via_plating_thickness_mm;
  if (c2.via_equivalent_width_mm !== void 0) modeling.viaEquivalentWidthMm = c2.via_equivalent_width_mm;
  if (c2.omit_through_via_stubs !== void 0) modeling.omitThroughViaStubs = c2.omit_through_via_stubs;
  if (c2.straightened_stage_profiles !== void 0) modeling.profiles = Object.fromEntries(Object.entries(c2.straightened_stage_profiles).map(([name, p2]) => [name, {
    spacingMm: p2.spacing_mm,
    relativePermittivity: p2.relative_permittivity,
    return: {
      widthMm: p2.return.width_mm,
      thicknessMm: p2.return.thickness_mm,
      lengthFactor: p2.return.length_factor,
      centerYMm: p2.return.center_y_mm,
      centerZMm: p2.return.center_z_mm
    }
  }]));
  for (const record of circuitJson.filter((record2) => record2.type === "simulation_ibis_model")) {
    const hash = Reflect.get(record.ibis_model_asset, "sha256");
    if (hash === void 0) continue;
    const path = record.ibis_model_asset.project_relative_path;
    if (typeof hash !== "string" || !/^[a-f0-9]{64}$/i.test(hash)) fail("vendor_hash", `${path}: ibis_model_asset.sha256 must be a 64-digit SHA-256 hash`);
    const hashes = modeling.ibisModelAssetSha256 ??= {};
    if (hashes[path] && hashes[path] !== hash.toLowerCase()) fail("vendor_hash", `${path}: conflicting ibis_model_asset.sha256 hashes`);
    hashes[path] = hash.toLowerCase();
  }
  return modeling;
}

// node_modules/.pnpm/@noble+hashes@1.8.0/node_modules/@noble/hashes/esm/utils.js
function isBytes(a2) {
  return a2 instanceof Uint8Array || ArrayBuffer.isView(a2) && a2.constructor.name === "Uint8Array";
}
function abytes(b, ...lengths) {
  if (!isBytes(b))
    throw new Error("Uint8Array expected");
  if (lengths.length > 0 && !lengths.includes(b.length))
    throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput(out, instance) {
  abytes(out);
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error("digestInto() expects output buffer of length at least " + min);
  }
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
var hasHexBuiltin = /* @__PURE__ */ (() => (
  // @ts-ignore
  typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
))();
var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_2, i) => i.toString(16).padStart(2, "0"));
function bytesToHex(bytes) {
  abytes(bytes);
  if (hasHexBuiltin)
    return bytes.toHex();
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += hexes[bytes[i]];
  }
  return hex;
}
function utf8ToBytes(str) {
  if (typeof str !== "string")
    throw new Error("string expected");
  return new Uint8Array(new TextEncoder().encode(str));
}
function toBytes(data) {
  if (typeof data === "string")
    data = utf8ToBytes(data);
  abytes(data);
  return data;
}
var Hash = class {
};
function createHasher(hashCons) {
  const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
  const tmp = hashCons();
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = () => hashCons();
  return hashC;
}

// node_modules/.pnpm/@noble+hashes@1.8.0/node_modules/@noble/hashes/esm/_md.js
function setBigUint64(view, byteOffset, value2, isLE) {
  if (typeof view.setBigUint64 === "function")
    return view.setBigUint64(byteOffset, value2, isLE);
  const _32n = BigInt(32);
  const _u32_max = BigInt(4294967295);
  const wh = Number(value2 >> _32n & _u32_max);
  const wl = Number(value2 & _u32_max);
  const h = isLE ? 4 : 0;
  const l = isLE ? 0 : 4;
  view.setUint32(byteOffset + h, wh, isLE);
  view.setUint32(byteOffset + l, wl, isLE);
}
function Chi(a2, b, c2) {
  return a2 & b ^ ~a2 & c2;
}
function Maj(a2, b, c2) {
  return a2 & b ^ a2 & c2 ^ b & c2;
}
var HashMD = class extends Hash {
  constructor(blockLen, outputLen, padOffset, isLE) {
    super();
    this.finished = false;
    this.length = 0;
    this.pos = 0;
    this.destroyed = false;
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    data = toBytes(data);
    abytes(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
      }
    }
    this.length += data.length;
    this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    clean(this.buffer.subarray(pos));
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      pos = 0;
    }
    for (let i = pos; i < blockLen; i++)
      buffer[i] = 0;
    setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE);
    this.process(view, 0);
    const oview = createView(out);
    const len = this.outputLen;
    if (len % 4)
      throw new Error("_sha2: outputLen should be aligned to 32bit");
    const outLen = len / 4;
    const state = this.get();
    if (outLen > state.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    to || (to = new this.constructor());
    to.set(...this.get());
    const { blockLen, buffer, length: length2, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length2;
    to.pos = pos;
    if (length2 % blockLen)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);

// node_modules/.pnpm/@noble+hashes@1.8.0/node_modules/@noble/hashes/esm/sha2.js
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
var SHA256 = class extends HashMD {
  constructor(outputLen = 32) {
    super(64, outputLen, 8, false);
    this.A = SHA256_IV[0] | 0;
    this.B = SHA256_IV[1] | 0;
    this.C = SHA256_IV[2] | 0;
    this.D = SHA256_IV[3] | 0;
    this.E = SHA256_IV[4] | 0;
    this.F = SHA256_IV[5] | 0;
    this.G = SHA256_IV[6] | 0;
    this.H = SHA256_IV[7] | 0;
  }
  get() {
    const { A, B: B2, C, D: D2, E, F, G, H } = this;
    return [A, B2, C, D2, E, F, G, H];
  }
  // prettier-ignore
  set(A, B2, C, D2, E, F, G, H) {
    this.A = A | 0;
    this.B = B2 | 0;
    this.C = C | 0;
    this.D = D2 | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B: B2, C, D: D2, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T2 = sigma0 + Maj(A, B2, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D2 + T1 | 0;
      D2 = C;
      C = B2;
      B2 = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B2 = B2 + this.B | 0;
    C = C + this.C | 0;
    D2 = D2 + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B2, C, D2, E, F, G, H);
  }
  roundClean() {
    clean(SHA256_W);
  }
  destroy() {
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean(this.buffer);
  }
};
var sha256 = /* @__PURE__ */ createHasher(() => new SHA256());

// node_modules/.pnpm/@noble+hashes@1.8.0/node_modules/@noble/hashes/esm/sha256.js
var sha2562 = sha256;

// node_modules/.pnpm/@tscircuit+ibis-to-spice@https+++api.github.com+repos+tscircuit+ibis-to-spice+tarball+a_d99e0cfc4ef79e48d0e78dd0e788cf58/node_modules/@tscircuit/ibis-to-spice/dist/chunk-5WGMOTLW.js
var IbisError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "IbisError";
  }
  code;
};
function ibisNumber(token) {
  if (/^na$/i.test(token)) return null;
  const match = token.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(.*)$/i);
  if (!match)
    throw new IbisError(
      "invalid_number",
      `Invalid IBIS numeric value: ${token}`
    );
  const scales = {
    T: 1e12,
    G: 1e9,
    M: 1e6,
    k: 1e3,
    m: 1e-3,
    u: 1e-6,
    n: 1e-9,
    p: 1e-12,
    f: 1e-15
  };
  const suffix = match[2];
  if (!/^[TGMkmunpf]?(?:V|A|Ohm|ohm|F|H|s)?$/.test(suffix))
    throw new IbisError(
      "invalid_number",
      `Unsupported IBIS numeric suffix: ${token}`
    );
  const factor = scales[suffix[0]] ?? 1;
  const value2 = Number(match[1]) * factor;
  if (!Number.isFinite(value2))
    throw new IbisError("invalid_number", `Non-finite IBIS value: ${token}`);
  return value2;
}
function cornerValue(values, corner, field) {
  const value2 = values[{ typical: 0, minimum: 1, maximum: 2 }[corner]];
  if (value2 === null)
    throw new IbisError("missing_corner", `${field} has no ${corner} value`);
  return value2;
}
function range(tokens) {
  return [0, 1, 2].map(
    (index2) => ibisNumber(tokens[index2] ?? "NA")
  );
}
function sections(text) {
  const headers = [
    ...text.matchAll(/^[ \t]*\[([^\]\r\n]+)\][ \t]*([^\r\n]*)/gm)
  ];
  return headers.map((header, index2) => ({
    key: header[1].trim().toLowerCase().replace(/[_\s]+/g, " "),
    argument: header[2].split("|")[0].trim(),
    body: text.slice(
      header.index + header[0].length,
      headers[index2 + 1]?.index ?? text.length
    )
  }));
}
function lines(body) {
  return body.split(/\r?\n/).map((line) => line.split("|")[0].trim()).filter(Boolean);
}
function table(section) {
  const rows = lines(section.body).filter((line) => /^[+\-.\d]/.test(line)).map((line) => {
    const tokens = line.split(/\s+/);
    if (tokens.length < 4)
      throw new IbisError("invalid_table", `Incomplete ${section.key} row`);
    const x2 = ibisNumber(tokens[0]);
    if (x2 === null)
      throw new IbisError(
        "invalid_table",
        `Missing ${section.key} coordinate`
      );
    return [x2, ...range(tokens.slice(1))];
  });
  if (rows.length < 2)
    throw new IbisError(
      "invalid_table",
      `${section.key} needs at least two samples`
    );
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] <= rows[i - 1][0])
      throw new IbisError(
        "invalid_table",
        `${section.key} sample coordinates must increase`
      );
  }
  return rows;
}
function parameters(section) {
  return Object.fromEntries(
    lines(section.body).filter((line) => !/^[+\-.\d]/.test(line)).map((line) => {
      const [key, ...tokens] = line.replace(/=/g, " ").split(/\s+/);
      return [key.toLowerCase(), tokens];
    })
  );
}
function parseBuffer(name, text) {
  const parsed = sections(text);
  const first = parameters(parsed[0]);
  if (Object.keys(first).some((key) => key.startsWith("c_comp_")))
    throw new IbisError(
      "unsupported_feature",
      `${name}: split C_comp parameters are not supported`
    );
  const buffer = {
    name,
    type: first.model_type?.[0]?.toLowerCase() ?? "",
    polarity: first.polarity?.[0]?.toLowerCase(),
    enable: first.enable?.[0]?.toLowerCase(),
    voltage: [null, null, null],
    capacitance: range(first.c_comp ?? []),
    waveforms: []
  };
  if (buffer.polarity && !["inverting", "non-inverting"].includes(buffer.polarity))
    throw new IbisError("unsupported_polarity", `${name}: unsupported Polarity ${buffer.polarity}`);
  if (buffer.enable && !["active-high", "active-low"].includes(buffer.enable))
    throw new IbisError("unsupported_enable", `${name}: unsupported Enable ${buffer.enable}`);
  const scalarFields = {
    "voltage range": "voltage",
    "pullup reference": "pullupReference",
    "pulldown reference": "pulldownReference",
    "power clamp reference": "powerClampReference",
    "gnd clamp reference": "groundClampReference",
    "external reference": "externalReference"
  };
  const tables = {
    pullup: "pullup",
    pulldown: "pulldown",
    "power clamp": "powerClamp",
    "gnd clamp": "groundClamp"
  };
  for (const section of parsed) {
    const supported = [
      "model",
      "model spec",
      "voltage range",
      "temperature range",
      "pullup reference",
      "pulldown reference",
      "power clamp reference",
      "gnd clamp reference",
      "external reference",
      "pullup",
      "pulldown",
      "power clamp",
      "gnd clamp",
      "rising waveform",
      "falling waveform",
      "ramp",
      "end model data"
    ];
    if (!supported.includes(section.key))
      throw new IbisError(
        "unsupported_feature",
        `${name}: [${section.key}] is not supported`
      );
    if (scalarFields[section.key])
      buffer[scalarFields[section.key]] = range(section.argument.split(/\s+/));
    if (tables[section.key])
      buffer[tables[section.key]] = table(section);
    if (["rising waveform", "falling waveform"].includes(section.key)) {
      const fields = parameters(section);
      for (const field of [
        "c_fixture",
        "l_fixture",
        "r_dut",
        "l_dut",
        "c_dut"
      ]) {
        if (fields[field] && ibisNumber(fields[field][0]) !== 0)
          throw new IbisError(
            "unsupported_fixture",
            `${name}: nonzero ${field} is not supported`
          );
      }
      const resistance = ibisNumber(fields.r_fixture?.[0] ?? "NA");
      const fixture = ibisNumber(fields.v_fixture?.[0] ?? "NA");
      if (resistance === null || resistance <= 0 || fixture === null)
        throw new IbisError(
          "invalid_fixture",
          `${name}: resistive fixture values are required`
        );
      const waveform = {
        kind: section.key.startsWith("rising") ? "rising" : "falling",
        resistance,
        fixtureVoltage: [
          fixture,
          ibisNumber(fields.v_fixture_min?.[0] ?? String(fixture)),
          ibisNumber(fields.v_fixture_max?.[0] ?? String(fixture))
        ],
        data: table(section)
      };
      buffer.waveforms.push(waveform);
    }
  }
  return buffer;
}
function parseIbis(text) {
  text = text.replace(/^\uFEFF/, "");
  for (const declaration of text.matchAll(
    /^[ \t]*\[comment[ _]char\]\s*(.)_char/gim
  ))
    if (declaration[1] !== "|")
      throw new IbisError(
        "unsupported_feature",
        "Non-pipe IBIS comment characters are not supported"
      );
  if (!/^[ \t]*\[ibis[ _]ver\]/im.test(text) || /<html|<!doctype/i.test(text.slice(0, 512)))
    throw new IbisError("invalid_ibis", "Expected an IBIS text file");
  const headers = [
    ...text.matchAll(
      /^[ \t]*\[(component|model|model[ _]selector|define[ _]package[ _]model|end)\][ \t]*([^\r\n]*)/gim
    )
  ];
  const components = /* @__PURE__ */ Object.create(null);
  const selectors = /* @__PURE__ */ Object.create(null);
  const modelText = /* @__PURE__ */ Object.create(null);
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    const key = header[1].toLowerCase().replace(/_/g, " "), name = header[2].split("|")[0].trim();
    const block = text.slice(
      header.index,
      headers[i + 1]?.index ?? text.length
    );
    if (key === "model") {
      if (modelText[name])
        throw new IbisError("duplicate_model", `Duplicate IBIS buffer: ${name}`);
      modelText[name] = block;
    }
    if (key === "model selector")
      selectors[name] = lines(block.slice(header[0].length)).map(
        (line) => line.split(/\s+/)[0]
      );
    if (key === "component") {
      const component = {
        name,
        pins: /* @__PURE__ */ Object.create(null),
        package: {},
        differentialPins: [],
        pinMapping: /* @__PURE__ */ Object.create(null),
        unsupportedFeatures: []
      };
      for (const section of sections(block)) {
        if (["series pin mapping", "series switch groups", "external circuit", "circuit call", "driver schedule", "node declarations"].includes(section.key))
          component.unsupportedFeatures.push(section.key);
        if (section.key === "diff pin")
          for (const line of lines(section.body)) {
            const [pin, invertedPin, voltage2, ...delay] = line.split(/\s+/);
            if (!invertedPin || voltage2 === void 0)
              throw new IbisError("invalid_diff_pin", `${name}: incomplete [Diff Pin] row`);
            component.differentialPins.push({ pin, invertedPin, voltage: ibisNumber(voltage2), delay: range(delay) });
          }
        if (section.key === "pin mapping") {
          const columns = section.argument.toLowerCase().split(/\s+/);
          for (const line of lines(section.body)) {
            const tokens = line.split(/\s+/), pin = tokens[0];
            const value2 = (field) => {
              const index2 = columns.indexOf(field), token = index2 < 0 ? void 0 : tokens[index2 + 1];
              return token && !/^nc$/i.test(token) ? token : void 0;
            };
            component.pinMapping[pin] = { pullup: value2("pullup_ref"), pulldown: value2("pulldown_ref"), powerClamp: value2("power_clamp_ref"), groundClamp: value2("gnd_clamp_ref"), external: value2("ext_ref") };
          }
        }
        if (section.key === "package model")
          component.coupledPackage = section.argument;
        if (section.key === "package") {
          const fields = parameters(section);
          for (const [field, property] of [
            ["r_pkg", "resistance"],
            ["l_pkg", "inductance"],
            ["c_pkg", "capacitance"]
          ])
            if (fields[field])
              component.package[property] = range(fields[field]);
        }
        if (section.key === "pin")
          for (const line of lines(section.body)) {
            const tokens = line.split(/\s+/);
            const [pin, signal, model] = tokens;
            const columns = section.argument.toLowerCase().split(/\s+/);
            const value2 = (field) => columns.includes(field) ? tokens[columns.indexOf(field) + 1] : void 0;
            const r = value2("r_pin"), l = value2("l_pin"), c2 = value2("c_pin");
            if (!model)
              throw new IbisError(
                "invalid_pin",
                `Incomplete pin row in ${name}`
              );
            if (component.pins[pin]) throw new IbisError("duplicate_pin", `Duplicate physical pin ${pin} in ${name}`);
            component.pins[pin] = {
              name: pin,
              signal,
              model,
              resistance: r ? ibisNumber(r) ?? void 0 : void 0,
              inductance: l ? ibisNumber(l) ?? void 0 : void 0,
              capacitance: c2 ? ibisNumber(c2) ?? void 0 : void 0
            };
          }
      }
      components[name] = component;
    }
  }
  return {
    version: text.match(/\[ibis[ _]ver\]\s*(\S+)/i)[1],
    components,
    selectors,
    modelNames: Object.keys(modelText),
    getBuffer(name) {
      if (!modelText[name])
        throw new IbisError(
          "missing_model",
          `IBIS buffer ${name} was not found`
        );
      return parseBuffer(name, modelText[name]);
    }
  };
}
var CONVERTER_VERSION = "0.0.2";
var sourceHash = (source) => bytesToHex(
  sha2562(
    typeof source === "string" ? new TextEncoder().encode(source) : source
  )
);
var spiceNumber = (value2) => {
  if (!Number.isFinite(value2))
    throw new IbisError(
      "nonfinite_conversion",
      "Conversion produced a non-finite value"
    );
  return String(Number(value2.toPrecision(12)));
};
function interpolate(points2, x2) {
  if (x2 <= points2[0][0]) return points2[0][1];
  if (x2 >= points2.at(-1)[0]) return points2.at(-1)[1];
  let lo = 0, hi = points2.length - 1;
  while (hi - lo > 1) {
    const mid = lo + hi >> 1;
    if (points2[mid][0] <= x2) lo = mid;
    else hi = mid;
  }
  const [x0, y0] = points2[lo], [x1, y1] = points2[hi];
  return y0 + (y1 - y0) * (x2 - x0) / (x1 - x0);
}
function cornerTable(table22, corner, field) {
  if (!table22)
    return [
      [-10, 0],
      [10, 0]
    ];
  return table22.map(([x2, ...values]) => [x2, cornerValue(values, corner, field)]);
}
function reference(range2, fallback, corner, field) {
  return range2 ? cornerValue(range2, corner, field) : fallback;
}
function bufferTables(buffer, corner) {
  const vdd = cornerValue(buffer.voltage, corner, `${buffer.name} voltage`);
  const refs = {
    pu: reference(buffer.pullupReference, vdd, corner, "pullup reference"),
    pd: reference(buffer.pulldownReference, 0, corner, "pulldown reference"),
    pc: reference(
      buffer.powerClampReference,
      vdd,
      corner,
      "power clamp reference"
    ),
    gc: reference(
      buffer.groundClampReference,
      0,
      corner,
      "ground clamp reference"
    )
  };
  const raw = {
    pu: cornerTable(buffer.pullup, corner, "pullup"),
    pd: cornerTable(buffer.pulldown, corner, "pulldown"),
    pc: cornerTable(buffer.powerClamp, corner, "power clamp"),
    gc: cornerTable(buffer.groundClamp, corner, "ground clamp")
  };
  const voltage2 = Object.fromEntries(
    Object.entries(raw).map(([key, points2]) => [
      key,
      points2.map(([x2, y2]) => [
        key === "pu" || key === "pc" ? refs[key] - x2 : x2 + refs[key],
        y2
      ]).sort((a2, b) => a2[0] - b[0])
    ])
  );
  return { raw, voltage: voltage2, refs, vdd };
}
function derivative(values, time, i) {
  if (i === 0) return (values[1] - values[0]) / (time[1] - time[0]);
  if (i === time.length - 1)
    return (values[i] - values[i - 1]) / (time[i] - time[i - 1]);
  const hs = time[i] - time[i - 1], hd = time[i + 1] - time[i];
  return -hd / (hs * (hs + hd)) * values[i - 1] + (hd - hs) / (hs * hd) * values[i] + hs / (hd * (hs + hd)) * values[i + 1];
}
function switchingWeights(buffer, corner, edge) {
  const waves = buffer.waveforms.filter((wave) => wave.kind === edge).slice(0, 2);
  if (waves.length !== 2)
    throw new IbisError(
      "unsupported_waveforms",
      `${buffer.name}: two ${edge} resistive waveforms are required`
    );
  const time = [
    ...new Set(waves.flatMap((wave) => wave.data.map((row) => row[0])))
  ].sort((a2, b) => a2 - b);
  const { voltage: iv } = bufferTables(buffer, corner);
  const capacitance = cornerValue(buffer.capacitance, corner, "C_comp");
  const voltages = waves.map(
    (wave) => time.map((t) => interpolate(cornerTable(wave.data, corner, edge), t))
  );
  return time.map((t, i) => {
    const currents = voltages.map((v2) => ({
      pu: interpolate(iv.pu, v2[i]),
      pd: interpolate(iv.pd, v2[i]),
      pc: interpolate(iv.pc, v2[i]),
      gc: interpolate(iv.gc, v2[i])
    }));
    const rhs = waves.map(
      (wave, w2) => (cornerValue(wave.fixtureVoltage, corner, "V_fixture") - voltages[w2][i]) / wave.resistance - capacitance * derivative(voltages[w2], time, i) - currents[w2].pc - currents[w2].gc
    );
    const [a2, b] = currents;
    const determinant = a2.pu * b.pd - a2.pd * b.pu;
    const scale3 = Math.max(
      Math.abs(a2.pu),
      Math.abs(a2.pd),
      Math.abs(b.pu),
      Math.abs(b.pd)
    ) ** 2;
    if (Math.abs(determinant) <= scale3 * 1e-12)
      throw new IbisError(
        "singular_waveforms",
        `${buffer.name}: ${edge} fixtures do not independently determine pullup and pulldown weights`
      );
    const ku = (rhs[0] * b.pd - a2.pd * rhs[1]) / determinant;
    const kd = (a2.pu * rhs[1] - rhs[0] * b.pu) / determinant;
    if (![ku, kd].every(Number.isFinite))
      throw new IbisError(
        "nonfinite_conversion",
        `${buffer.name}: invalid switching weights`
      );
    return [t, ku, kd];
  });
}
function convertIbisBuffer(document, model, options) {
  const corner = options.corner ?? "typical", buffer = document.getBuffer(model);
  if (!["typical", "minimum", "maximum"].includes(corner) || !["input", "output"].includes(options.mode))
    throw new IbisError(
      "invalid_options",
      "Choose a supported IBIS corner and input/output mode"
    );
  if (cornerValue(buffer.voltage, corner, "voltage") <= 0 || cornerValue(buffer.capacitance, corner, "C_comp") < 0)
    throw new IbisError(
      "invalid_electrical_value",
      `${model}: supply must be positive and C_comp nonnegative`
    );
  if (!["input", "output", "i/o", "3-state"].includes(buffer.type))
    throw new IbisError(
      "unsupported_model_type",
      `${model}: Model_type ${buffer.type} is not supported`
    );
  if (options.mode === "output" && (buffer.type === "input" || !buffer.pullup || !buffer.pulldown))
    throw new IbisError(
      "unsupported_model_type",
      `${model} cannot be used as a CMOS output`
    );
  const name = options.name ?? `IBIS_${model.replace(/[^a-z0-9_]/gi, "_")}_${corner}`;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    throw new IbisError(
      "invalid_name",
      "SPICE subcircuit name must be an identifier"
    );
  const tables = bufferTables(buffer, corner);
  const referenceNode = (key) => options.separateReferences ? { pu: "PU_REF", pd: "PD_REF", pc: "PC_REF", gc: "GC_REF" }[key] : key === "pu" || key === "pc" ? "VDD" : "VSS";
  const groundNode = options.separateReferences ? "PD_REF" : "VSS";
  const lines2 = [
    `* IBIS ${model}; ${corner}; converter ${CONVERTER_VERSION}; package excluded`,
    `.subckt ${name} PAD ${options.separateReferences ? "PU_REF PD_REF PC_REF GC_REF" : "VDD VSS"}${options.externalReference ? " EXT_REF" : ""}${options.mode === "output" ? " KU KD" : ""}`,
    `Ccomp PAD ${groundNode} ${spiceNumber(cornerValue(buffer.capacitance, corner, "C_comp"))}`
  ];
  for (const key of ["pu", "pd", "pc", "gc"]) {
    if (options.mode === "input" && (key === "pu" || key === "pd")) continue;
    const pullupSide = key === "pu" || key === "pc";
    const expression = options.separateReferences ? pullupSide ? `V(${referenceNode(key)},PAD)` : `V(PAD,${referenceNode(key)})` : pullupSide ? `V(${referenceNode(key)},PAD)+(${spiceNumber(tables.refs[key] - tables.vdd)})` : `V(PAD,${referenceNode(key)})-(${spiceNumber(tables.refs[key])})`;
    const pairs = tables.raw[key].map(([x2, y2]) => `${spiceNumber(x2)},${spiceNumber(y2)}`).join(",");
    const boundedExpression = `min(max(${expression},${spiceNumber(tables.raw[key][0][0])}),${spiceNumber(tables.raw[key].at(-1)[0])})`;
    const factor = key === "pu" || key === "pd" ? `V(K${key === "pu" ? "U" : "D"},${groundNode})*` : "";
    lines2.push(
      `B${key} PAD ${referenceNode(key)} I={${factor}pwl(${boundedExpression},${pairs})}`
    );
  }
  lines2.push(`.ends ${name}`);
  return {
    source: lines2.join("\n") + "\n",
    name,
    buffer,
    corner,
    weights: options.mode === "output" && !options.skipSwitchingWeights ? {
      rising: switchingWeights(buffer, corner, "rising"),
      falling: switchingWeights(buffer, corner, "falling")
    } : void 0
  };
}
function seconds(value2) {
  const match = typeof value2 === "string" ? value2.match(/^\s*(\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*(s|ms|us|ns|ps)\s*$/i) : null;
  const time = typeof value2 === "number" ? value2 : match ? Number(match[1]) * { s: 1, ms: 1e-3, us: 1e-6, ns: 1e-9, ps: 1e-12 }[match[2].toLowerCase()] : NaN;
  if (!Number.isFinite(time) || time <= 0)
    throw new IbisError(
      "invalid_time",
      `Expected a positive time in seconds or explicit units: ${value2}`
    );
  return time;
}
function validateIbisDefinitionSource(source) {
  const forms = [source.url, source.file, source.content].filter((value2) => value2 !== void 0);
  if (forms.length !== 1) throw new IbisError("invalid_source", "Provide exactly one of source.url, source.file or source.content");
  if (source.archive && "sha256" in source.archive) throw new IbisError("invalid_archive", "archive.sha256 is unsupported; use source.sha256 for original bytes and archive.memberSha256 for extracted bytes");
  if (source.sha256 !== void 0 && !/^[a-f0-9]{64}$/i.test(source.sha256)) throw new IbisError("invalid_hash", "Original source SHA-256 must contain 64 hex digits");
  if (source.archive?.memberSha256 !== void 0 && !/^[a-f0-9]{64}$/i.test(source.archive.memberSha256)) throw new IbisError("invalid_hash", "Archive member SHA-256 must contain 64 hex digits");
  if (source.content !== void 0 && source.archive) throw new IbisError("invalid_source", "Inline IBIS text cannot select a ZIP archive member");
  if (source.archive && !source.archive.member) throw new IbisError("missing_archive_path", "ZIP sources require an explicit archive.member");
  if (source.url !== void 0 && !source.sha256) throw new IbisError("missing_hash", "URL-based IBIS models require the original downloaded bytes SHA-256");
}
var MAX_BYTES = 64 * 1024 * 1024;

// node_modules/.pnpm/@tscircuit+ibis-to-spice@https+++api.github.com+repos+tscircuit+ibis-to-spice+tarball+a_d99e0cfc4ef79e48d0e78dd0e788cf58/node_modules/@tscircuit/ibis-to-spice/dist/index.js
function ibisTimeSeconds(value2, allowZero = false) {
  const result = typeof value2 === "number" ? value2 * 1e-3 : /^\s*0(?:\.0*)?\s*(s|ms|us|ns|ps)\s*$/i.test(value2) ? 0 : seconds(value2);
  if (!Number.isFinite(result) || result < 0 || !allowZero && result === 0)
    throw new IbisError("invalid_time", `Expected ${allowZero ? "nonnegative" : "positive"} time: ${value2}`);
  return result;
}
function logicalBitSchedule(stimulus, durationInput, polarity = "non-inverting") {
  if (stimulus.pattern?.type !== "bits" || !/^[01]+$/.test(stimulus.pattern.bits) || typeof stimulus.pattern.repeat !== "boolean")
    throw new IbisError("invalid_pattern", "A nonempty binary bits pattern and explicit repeat boolean are required");
  if (![0, 1].includes(stimulus.initialState) || stimulus.inverted !== void 0 && typeof stimulus.inverted !== "boolean")
    throw new IbisError("invalid_stimulus", "initialState must be 0 or 1 and inverted must be boolean");
  const unitInterval = ibisTimeSeconds(stimulus.unitInterval), startTime = ibisTimeSeconds(stimulus.startTime, true), duration = ibisTimeSeconds(durationInput);
  if (startTime >= duration) throw new IbisError("invalid_stimulus", "Stimulus startTime must precede simulation duration");
  const intervals = (duration - startTime) / unitInterval;
  const count = Math.max(1, Math.ceil(intervals - Math.max(1, intervals) * Number.EPSILON * 8));
  if (!Number.isFinite(intervals) || count > 1e5) throw new IbisError("stimulus_too_long", "Stimulus exceeds 100000 bit intervals");
  if (!stimulus.pattern.repeat && count > stimulus.pattern.bits.length)
    throw new IbisError("uncovered_stimulus", "Nonrepeating bits must cover the simulation duration");
  const invert = Number(Boolean(stimulus.inverted)) ^ Number(polarity === "inverting");
  const initialState = stimulus.initialState ^ invert;
  let previous = initialState;
  const transitions = [];
  for (let i = 0; i < count; i++) {
    const state = Number(stimulus.pattern.bits[i % stimulus.pattern.bits.length]) ^ invert;
    if (state !== previous) transitions.push({ time: startTime + i * unitInterval, state });
    previous = state;
  }
  const value2 = { initialState, transitions, duration };
  return { ...value2, sha256: sourceHash(JSON.stringify(value2)) };
}
function bitWeights(converted, schedule) {
  const steady = (state) => state ? [1, 0] : [0, 1];
  const samples = [[0, ...steady(schedule.initialState)]];
  for (let i = 0; i < schedule.transitions.length; i++) {
    const transition = schedule.transitions[i], edge = transition.state ? "rising" : "falling", weights = converted.weights?.[edge];
    if (!weights) throw new IbisError("missing_weights", `Actual ${edge} transition requires two vendor waveform fixtures`);
    if (weights[0][0] !== 0) throw new IbisError("unsupported_waveforms", "Switching waveform must start at zero relative time");
    const edgeDuration = weights.at(-1)[0], nextTime = schedule.transitions[i + 1]?.time;
    if (nextTime !== void 0 && transition.time + edgeDuration >= nextTime)
      throw new IbisError("overlapping_edges", "Actual adjacent transitions overlap the IBIS switching waveform");
    const last = samples.at(-1);
    if (transition.time > last[0]) {
      const before = transition.time - Math.min(1e-15, (transition.time - last[0]) * 1e-6);
      if (before > last[0]) samples.push([before, last[1], last[2]]);
    }
    for (const [time, ku, kd] of weights) {
      const absolute = transition.time + time;
      if (absolute > schedule.duration) break;
      if (absolute === samples.at(-1)[0]) samples.pop();
      samples.push([absolute, ku, kd]);
    }
    const end = transition.time + edgeDuration;
    if (end > schedule.duration) {
      const after = weights.findIndex(([time]) => transition.time + time > schedule.duration);
      const a2 = weights[after - 1], b = weights[after], fraction = (schedule.duration - transition.time - a2[0]) / (b[0] - a2[0]);
      samples.push([schedule.duration, a2[1] + fraction * (b[1] - a2[1]), a2[2] + fraction * (b[2] - a2[2])]);
    }
  }
  if (samples.at(-1)[0] < schedule.duration) samples.push([schedule.duration, samples.at(-1)[1], samples.at(-1)[2]]);
  return samples;
}
function resolveReferences(component, definition, physicalPin, buffer) {
  const explicit = definition.references?.[physicalPin] ?? {}, vendor = component.pinMapping[physicalPin];
  for (const [key, value2] of Object.entries(explicit)) if (value2 !== void 0 && (typeof value2 !== "string" || !value2))
    throw new IbisError("invalid_reference", `${physicalPin}: ${key} reference must name a local TSX port`);
  const infer = (key) => {
    if (explicit[key]) return explicit[key];
    const kind = key === "pullup" || key === "powerClamp" || key === "external" ? "power" : "gnd";
    const network = vendor?.[key];
    const candidates = Object.entries(definition.pinMap).filter(([pin]) => {
      const candidate = component.pins[pin];
      if (candidate?.model.toLowerCase() !== kind) return false;
      return !network || component.pinMapping[pin]?.[key === "external" ? "pullup" : key] === network || candidate.signal === network || pin === network;
    }).map(([, port]) => port);
    const unique = [...new Set(candidates)];
    if (unique.length !== 1) throw new IbisError("ambiguous_reference", `${physicalPin}: explicit ${key} reference required; vendor data does not identify exactly one mapped ${kind} port`);
    return unique[0];
  };
  const pullup = infer("pullup"), pulldown = infer("pulldown");
  const selectedReference = (value2, label2) => cornerValue(value2, definition.corner, label2);
  const nominalPullup = selectedReference(buffer.pullupReference ?? buffer.voltage, "pullup reference");
  const nominalPulldown = selectedReference(buffer.pulldownReference ?? [0, 0, 0], "pulldown reference");
  if (buffer.powerClamp && !explicit.powerClamp && !vendor?.powerClamp && selectedReference(buffer.powerClampReference ?? buffer.voltage, "power clamp reference") !== nominalPullup)
    throw new IbisError("ambiguous_reference", `${physicalPin}: explicit powerClamp reference required because vendor scalar reference differs from pullup and no vendor clamp network identifies the rail`);
  if (buffer.groundClamp && !explicit.groundClamp && !vendor?.groundClamp && selectedReference(buffer.groundClampReference ?? [0, 0, 0], "ground clamp reference") !== nominalPulldown)
    throw new IbisError("ambiguous_reference", `${physicalPin}: explicit groundClamp reference required because vendor scalar reference differs from pulldown and no vendor clamp network identifies the rail`);
  const powerClamp = explicit.powerClamp || vendor?.powerClamp ? infer("powerClamp") : pullup;
  const groundClamp = explicit.groundClamp || vendor?.groundClamp ? infer("groundClamp") : pulldown;
  if (pullup === pulldown) throw new IbisError("invalid_reference", `${physicalPin}: pullup and pulldown references must differ`);
  const external = explicit.external || vendor?.external ? infer("external") : void 0;
  return { pullup, pulldown, powerClamp, groundClamp, ...external ? { external } : {} };
}
function pinPackage(component, physicalPin, corner) {
  const pin = component.pins[physicalPin];
  const values = ["resistance", "inductance", "capacitance"].map((field) => pin[field] ?? (component.package[field] && cornerValue(component.package[field], corner, `${physicalPin} package ${field}`)));
  if (values.some((value2) => value2 === void 0 || !Number.isFinite(value2) || value2 < 0)) throw new IbisError("invalid_package", `${physicalPin}: complete nonnegative vendor package R/L/C required`);
  return values;
}
function convertIbisModelToSpice(input, definition, run) {
  validateIbisDefinitionSource(definition.source);
  const hash = sourceHash(input), text = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
  if (definition.source.content !== void 0 && sourceHash(definition.source.content) !== hash) throw new IbisError("source_mismatch", "Resolved inline IBIS bytes differ from the electrical definition");
  const expectedInputHash = definition.source.archive ? definition.source.archive.memberSha256 : definition.source.sha256;
  if (expectedInputHash && hash !== expectedInputHash.toLowerCase()) throw new IbisError("hash_mismatch", "Resolved IBIS bytes do not match the electrical definition's member/direct SHA-256");
  if (!["vendor", "omit"].includes(definition.packagePolicy)) throw new IbisError("missing_package_policy", "Select packagePolicy=vendor or omit explicitly");
  if (!["typical", "minimum", "maximum"].includes(definition.corner)) throw new IbisError("invalid_corner", "Select an explicit IBIS corner");
  const duration = ibisTimeSeconds(run.duration), document = parseIbis(text), component = document.components[definition.component];
  if (!component) throw new IbisError("missing_component", `IBIS component ${definition.component} was not found`);
  if (component.unsupportedFeatures?.length) throw new IbisError("unsupported_feature", `${component.name}: [${component.unsupportedFeatures.join("] [")}] is unsupported`);
  if (definition.packagePolicy === "vendor" && component.coupledPackage) throw new IbisError("unsupported_package", "Coupled vendor package models are unsupported; choose omit explicitly to exclude them");
  const mapped = Object.entries(definition.pinMap).sort(([a2], [b]) => a2 < b ? -1 : a2 > b ? 1 : 0);
  if (!mapped.length) throw new IbisError("missing_pins", "Select physical signal pins and required reference rails");
  for (const [pin, port] of mapped) if (!component.pins[pin] || !port) throw new IbisError("invalid_mapping", `Unknown physical IBIS pin or empty local port: ${pin}`);
  const signals = mapped.filter(([pin]) => !["power", "gnd", "nc"].includes(component.pins[pin].model.toLowerCase()));
  if (!signals.length) throw new IbisError("missing_pins", "At least one mapped signal pin is required");
  if (new Set(signals.map(([, port]) => port)).size !== signals.length) throw new IbisError("duplicate_pin", "Signal pins must map to distinct local TSX ports");
  const signalPorts = new Set(signals.map(([, port]) => port));
  for (const port of [...Object.keys(run.pinStates), ...Object.keys(run.stimuli)]) if (!signalPorts.has(port)) throw new IbisError("unknown_run_port", `Run state/stimulus port ${port} is not a modeled signal`);
  for (const pin of [...Object.keys(definition.modelSelections ?? {}), ...Object.keys(definition.references ?? {})]) if (!signals.some(([physical]) => physical === pin)) throw new IbisError("unknown_signal_pin", `Model selection/reference ${pin} is not a mapped signal pin`);
  const pins = [];
  const convertedBuffers = [];
  const schedules = [];
  for (const [physicalPin, port] of signals) {
    const declaredState = run.pinStates[port];
    if (!declaredState || !["input", "output"].includes(declaredState.mode) || declaredState.mode === "output" && typeof declaredState.enabled !== "boolean") throw new IbisError("missing_run_state", `${port}: explicit compatible input/output state is required`);
    const state = declaredState.mode === "input" ? { mode: "input" } : { mode: "output", enabled: declaredState.enabled };
    const pin = component.pins[physicalPin], choices = document.selectors[pin.model] ?? [pin.model];
    const model = definition.modelSelections?.[physicalPin] ?? (choices.length === 1 ? choices[0] : void 0);
    if (!model) throw new IbisError("ambiguous_selector", `${physicalPin}: choose a buffer from ${choices.join(", ")}`);
    if (!choices.includes(model)) throw new IbisError("invalid_selection", `${model} is not allowed for pin ${physicalPin}`);
    const buffer = document.getBuffer(model), stimulus = run.stimuli[port];
    if (state.mode === "input" && buffer.type === "output") throw new IbisError("incompatible_run_state", `${port}: output-only model cannot operate as an input`);
    if (state.mode === "output" && buffer.type === "input") throw new IbisError("incompatible_run_state", `${port}: input-only model cannot drive output`);
    if (state.mode === "output" && !state.enabled && !["i/o", "3-state"].includes(buffer.type)) throw new IbisError("unsupported_disable", `${port}: output-only model has no drive-enable capability`);
    const enabled = state.mode === "output" && state.enabled;
    if (enabled && !stimulus) throw new IbisError("missing_stimulus", `${port}: enabled output needs exactly one explicit bit stimulus`);
    if (!enabled && stimulus) throw new IbisError("invalid_stimulus", `${port}: input/disabled output cannot have a drive stimulus`);
    const schedule = stimulus ? logicalBitSchedule(stimulus, run.duration, buffer.polarity) : void 0;
    const references = resolveReferences(component, definition, physicalPin, buffer);
    for (const pair of component.differentialPins.filter((pair2) => pair2.pin === physicalPin || pair2.invertedPin === physicalPin)) {
      const delay = pair.delay[{ typical: 0, minimum: 1, maximum: 2 }[definition.corner]];
      if (delay !== null && delay !== 0) throw new IbisError("unsupported_diff_delay", `${physicalPin}: nonzero vendor differential pair delay is unsupported`);
    }
    convertedBuffers.push(convertIbisBuffer(document, model, { corner: definition.corner, mode: enabled ? "output" : "input", separateReferences: true, externalReference: Boolean(references.external), skipSwitchingWeights: schedule?.transitions.length === 0 }));
    schedules.push(schedule);
    const enableControlLevel = state.mode === "output" && buffer.enable ? Number(state.enabled) ^ Number(buffer.enable === "active-low") : void 0;
    pins.push({ physicalPin, port, model, selector: pin.model, selectorChoices: choices, modelType: buffer.type, polarity: buffer.polarity ?? "non-inverting", polarityDeclared: buffer.polarity !== void 0, enable: buffer.enable, enableControlLevel, runState: state, references, stimulusHash: schedule?.sha256 });
  }
  const rails = [...new Set(pins.flatMap((pin) => Object.values(pin.references)))].sort();
  if (definition.packagePolicy === "vendor") {
    for (const [physicalPin, port] of mapped.filter(([, port2]) => rails.includes(port2)))
      if (pinPackage(component, physicalPin, definition.corner).some((value2) => value2 !== 0))
        throw new IbisError("unsupported_supply_package", `${physicalPin}: nonzero vendor reference/supply-pin package impedance is unsupported; choose packagePolicy=omit explicitly`);
  }
  const omissions = definition.packagePolicy === "omit" ? ["Vendor package excluded by explicit packagePolicy=omit"] : [];
  const cornerIndex = { typical: 0, minimum: 1, maximum: 2 }[definition.corner];
  const packageData = {
    coupledModel: component.coupledPackage,
    mappedPins: mapped.filter(([, port]) => rails.includes(port) || signalPorts.has(port)).map(([physicalPin, port]) => {
      const pin = component.pins[physicalPin];
      const value2 = (field) => pin[field] ?? component.package[field]?.[cornerIndex] ?? null;
      return { physicalPin, port, role: signalPorts.has(port) ? "signal" : "reference", resistanceOhms: value2("resistance"), inductanceHenries: value2("inductance"), capacitanceFarads: value2("capacitance") };
    })
  };
  const metadata = { converterVersion: CONVERTER_VERSION, sourceSha256: hash, packagePolicy: definition.packagePolicy, tableExtrapolation: "hold-endpoint-current", omissions, packageData, differentialPins: component.differentialPins, pins };
  const name = `IBIS_${sourceHash(JSON.stringify([metadata, schedules, duration])).slice(0, 20)}`;
  if (rails.some((rail) => signalPorts.has(rail))) throw new IbisError("invalid_reference", "A signal port cannot also serve as a buffer reference rail");
  const mapping = Object.fromEntries(signals.map(([, port], i) => [`PAD${i}`, port]));
  rails.forEach((port, i) => {
    mapping[`REF${i}`] = port;
  });
  const refNode = (port) => `REF${rails.indexOf(port)}`;
  const lines2 = [`* General table-based IBIS ${definition.component}; SHA-256 ${hash}; converter ${CONVERTER_VERSION}`, `.subckt ${name} ${Object.keys(mapping).join(" ")}`];
  const buffers = [];
  for (const [i, pin] of pins.entries()) {
    const converted = convertedBuffers[i], bufferName = `${name}_BUF${i}`;
    buffers.push(converted.source.replaceAll(converted.name, bufferName));
    const ground = refNode(pin.references.pulldown);
    let die = `PAD${i}`;
    if (definition.packagePolicy === "vendor") {
      const [r, l, c2] = pinPackage(component, pin.physicalPin, definition.corner);
      if (r > 0) {
        lines2.push(`RPKG${i} ${die} PKGR${i} ${spiceNumber(r)}`);
        die = `PKGR${i}`;
      }
      if (l > 0) {
        lines2.push(`LPKG${i} ${die} PKGL${i} ${spiceNumber(l)}`);
        die = `PKGL${i}`;
      }
      if (c2 > 0) lines2.push(`CPKG${i} PAD${i} ${ground} ${spiceNumber(c2)}`);
    }
    const schedule = schedules[i];
    if (schedule) {
      const weights = bitWeights(converted, schedule);
      for (const [label2, column] of [["KU", 1], ["KD", 2]]) lines2.push(`V${label2}${i} ${label2}${i} ${ground} PWL(${weights.map((sample) => `${spiceNumber(sample[0])} ${spiceNumber(sample[column])}`).join(" ")})`);
    }
    lines2.push(`XBUF${i} ${die} ${[pin.references.pullup, pin.references.pulldown, pin.references.powerClamp, pin.references.groundClamp, ...pin.references.external ? [pin.references.external] : []].map(refNode).join(" ")}${schedule ? ` KU${i} KD${i}` : ""} ${bufferName}`);
  }
  lines2.push(`.ends ${name}`);
  return { source: [...lines2, ...buffers].join("\n") + "\n", spicePinMapping: mapping, sourceSha256: hash, warnings: omissions, metadata };
}

// src/schema.ts
import { z as z2 } from "zod";
import * as base from "circuit-json";
import {
  simulation_ibis_model,
  simulation_ibis_pin_state,
  simulation_digital_stimulus,
  simulation_eye_diagram
} from "circuit-json";
var compatible = (schema, normalize) => z2.preprocess((value2) => {
  let normalized = value2;
  if (value2 && typeof value2 === "object") normalized = normalize({ ...value2 });
  return [value2, normalized];
}, z2.tuple([z2.unknown(), schema])).transform(([original]) => original);
var physicalCompatibility = {
  source_port: compatible(base.source_port, (record) => {
    if (record.source_component_id === null) delete record.source_component_id;
    return record;
  }),
  pcb_component: compatible(base.pcb_component, (record) => {
    for (const key of ["display_offset_x", "display_offset_y"])
      if (typeof record[key] === "number" && Number.isFinite(record[key])) record[key] = `${record[key]}mm`;
    return record;
  }),
  pcb_silkscreen_text: base.pcb_silkscreen_text.extend({ pcb_component_id: z2.string().nullable() }),
  pcb_hole: z2.union([base.pcb_hole, z2.object({
    type: z2.literal("pcb_hole"),
    pcb_hole_id: z2.string().min(1),
    pcb_component_id: z2.null(),
    hole_shape: z2.literal("circle"),
    hole_diameter: z2.number().finite().positive(),
    x: z2.number().finite(),
    y: z2.number().finite(),
    subcircuit_id: z2.string().min(1).optional(),
    is_covered_with_solder_mask: z2.boolean().optional()
  }).passthrough()]),
  pcb_plated_hole: compatible(base.pcb_plated_hole, (record) => {
    if (record.shape === "circular_hole_with_rect_pad") return { ...record, hole_shape: record.hole_shape ?? "circle", pad_shape: record.pad_shape ?? "rect" };
    return record;
  })
};
function recordSchema(record) {
  let schemaName = record.type;
  if (record.type === "source_component") schemaName = `source_${record.ftype}`;
  return physicalCompatibility[record.type] ?? Reflect.get(base, schemaName);
}
function parseRecord(record) {
  if (!record || typeof record !== "object" || !("type" in record) || typeof record.type !== "string") throw new Error("Circuit record requires a type");
  const schema = recordSchema(record);
  if (!schema) throw new Error(`Unknown Circuit JSON record: ${record.type}`);
  return schema.parse(record);
}

// src/stackup.ts
import { pcb_stackup } from "circuit-json";
var defaultCopperConductivitySm = 58e6;
function stackupFromCircuitJson(circuit) {
  const boards = circuit.filter((record) => record.type === "pcb_board");
  const records = circuit.filter((record) => record.type === "pcb_stackup");
  if (!records.length) throw new Error(`Board ${boards[0]?.pcb_board_id ?? "(missing pcb_board)"} has no pcb_stackup. Set fabricatorPreset (e.g. "jlcpcb_standard") on <board>/<ImportedBoard> so the JLC stackup template is resolved into Circuit JSON.`);
  if (records.length !== 1) fail("stackup", "One pcb_stackup per simulation entry is supported");
  const stackup = pcb_stackup.parse(records[0]);
  if (boards.length !== 1 || boards[0].pcb_board_id !== stackup.pcb_board_id)
    fail("stackup", `Expected one pcb_board referenced by ${stackup.pcb_board_id}`);
  const layers = stackup.layers.filter((layer2) => layer2.layer_type !== "soldermask");
  const copper = layers.filter((layer2) => layer2.layer_type === "copper");
  if (copper.length !== boards[0].num_layers || copper[0]?.layer !== "top" || copper.at(-1)?.layer !== "bottom" || new Set(copper.map((layer2) => layer2.layer)).size !== copper.length)
    fail("stackup", "Copper layers must be distinct, ordered top to bottom, and match pcb_board.num_layers");
  if (layers[0]?.layer_type !== "copper" || layers.at(-1)?.layer_type !== "copper")
    fail("stackup", "Physical stack must start and end with copper (outside soldermask is ignored)");
  const copperLayers = [], dielectrics = [];
  const round = (value2) => Math.round(value2 * 1e10) / 1e10;
  let z5 = -copper.at(-1).thickness;
  for (const layer2 of [...layers].reverse()) {
    const zMinMm = round(z5), zMaxMm = round(z5 + layer2.thickness);
    if (layer2.layer_type === "copper") copperLayers.push({
      name: layer2.layer,
      zMinMm,
      zMaxMm,
      conductivitySm: layer2.electrical_conductivity_s_per_m ?? defaultCopperConductivitySm
    });
    else dielectrics.push({ material: layer2.material_name, zMinMm, zMaxMm, relativePermittivity: layer2.relative_permittivity });
    z5 = zMaxMm;
  }
  for (let i = 1; i < copperLayers.length; i++) if (copperLayers[i].zMinMm <= copperLayers[i - 1].zMaxMm)
    fail("stackup", "Copper layers require a positive dielectric gap");
  const thickness = dielectrics.reduce((sum3, layer2) => sum3 + layer2.zMaxMm - layer2.zMinMm, 0);
  const relativePermittivity = thickness > 0 && dielectrics.every((layer2) => layer2.relativePermittivity !== void 0) ? dielectrics.reduce((sum3, layer2) => sum3 + (layer2.zMaxMm - layer2.zMinMm) * layer2.relativePermittivity, 0) / thickness : void 0;
  return { pcbBoardId: stackup.pcb_board_id, copperLayers, dielectrics, relativePermittivity, viaPlatingMm: stackup.plated_hole_copper_thickness };
}

// src/copper.ts
import earcut, { refine } from "earcut";

// node_modules/.pnpm/splaytree@3.2.3/node_modules/splaytree/dist/splaytree.js
var f = class {
  constructor(t, e) {
    this.next = null, this.key = t, this.data = e, this.left = null, this.right = null;
  }
};
function d(n, t) {
  return n > t ? 1 : n < t ? -1 : 0;
}
function u(n, t, e) {
  const r = new f(null, null);
  let l = r, i = r;
  for (; ; ) {
    const o = e(n, t.key);
    if (o < 0) {
      if (t.left === null) break;
      if (e(n, t.left.key) < 0) {
        const s = t.left;
        if (t.left = s.right, s.right = t, t = s, t.left === null) break;
      }
      i.left = t, i = t, t = t.left;
    } else if (o > 0) {
      if (t.right === null) break;
      if (e(n, t.right.key) > 0) {
        const s = t.right;
        if (t.right = s.left, s.left = t, t = s, t.right === null) break;
      }
      l.right = t, l = t, t = t.right;
    } else break;
  }
  return l.right = t.left, i.left = t.right, t.left = r.right, t.right = r.left, t;
}
function c(n, t, e, r) {
  const l = new f(n, t);
  if (e === null)
    return l.left = l.right = null, l;
  e = u(n, e, r);
  const i = r(n, e.key);
  return i < 0 ? (l.left = e.left, l.right = e, e.left = null) : i >= 0 && (l.right = e.right, l.left = e, e.right = null), l;
}
function m(n, t, e) {
  let r = null, l = null;
  if (t) {
    t = u(n, t, e);
    const i = e(t.key, n);
    i === 0 ? (r = t.left, l = t.right) : i < 0 ? (l = t.right, t.right = null, r = t) : (r = t.left, t.left = null, l = t);
  }
  return { left: r, right: l };
}
function w(n, t, e) {
  return t === null ? n : (n === null || (t = u(n.key, t, e), t.left = n), t);
}
function _(n, t, e, r, l) {
  if (n) {
    r(`${t}${e ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 "}${l(n)}
`);
    const i = t + (e ? "    " : "\u2502   ");
    n.left && _(n.left, i, false, r, l), n.right && _(n.right, i, true, r, l);
  }
}
var z3 = class {
  constructor(t = d) {
    this._root = null, this._size = 0, this._comparator = t;
  }
  /**
   * Inserts a key, allows duplicates
   */
  insert(t, e) {
    return this._size++, this._root = c(t, e, this._root, this._comparator);
  }
  /**
   * Adds a key, if it is not present in the tree
   */
  add(t, e) {
    const r = new f(t, e);
    this._root === null && (r.left = r.right = null, this._size++, this._root = r);
    const l = this._comparator, i = u(t, this._root, l), o = l(t, i.key);
    return o === 0 ? this._root = i : (o < 0 ? (r.left = i.left, r.right = i, i.left = null) : o > 0 && (r.right = i.right, r.left = i, i.right = null), this._size++, this._root = r), this._root;
  }
  /**
   * @param  {Key} key
   * @return {Node|null}
   */
  remove(t) {
    this._root = this._remove(t, this._root, this._comparator);
  }
  /**
   * Deletes i from the tree if it's there
   */
  _remove(t, e, r) {
    let l;
    return e === null ? null : (e = u(t, e, r), r(t, e.key) === 0 ? (e.left === null ? l = e.right : (l = u(t, e.left, r), l.right = e.right), this._size--, l) : e);
  }
  /**
   * Removes and returns the node with smallest key
   */
  pop() {
    let t = this._root;
    if (t) {
      for (; t.left; ) t = t.left;
      return this._root = u(t.key, this._root, this._comparator), this._root = this._remove(t.key, this._root, this._comparator), { key: t.key, data: t.data };
    }
    return null;
  }
  /**
   * Find without splaying
   */
  findStatic(t) {
    let e = this._root;
    const r = this._comparator;
    for (; e; ) {
      const l = r(t, e.key);
      if (l === 0) return e;
      l < 0 ? e = e.left : e = e.right;
    }
    return null;
  }
  find(t) {
    return this._root && (this._root = u(t, this._root, this._comparator), this._comparator(t, this._root.key) !== 0) ? null : this._root;
  }
  contains(t) {
    let e = this._root;
    const r = this._comparator;
    for (; e; ) {
      const l = r(t, e.key);
      if (l === 0) return true;
      l < 0 ? e = e.left : e = e.right;
    }
    return false;
  }
  forEach(t, e) {
    let r = this._root;
    const l = [];
    let i = false;
    for (; !i; )
      r !== null ? (l.push(r), r = r.left) : l.length !== 0 ? (r = l.pop(), t.call(e, r), r = r.right) : i = true;
    return this;
  }
  /**
   * Walk key range from `low` to `high`. Stops if `fn` returns a value.
   */
  range(t, e, r, l) {
    const i = [], o = this._comparator;
    let s = this._root, h;
    for (; i.length !== 0 || s; )
      if (s)
        i.push(s), s = s.left;
      else {
        if (s = i.pop(), h = o(s.key, e), h > 0)
          break;
        if (o(s.key, t) >= 0 && r.call(l, s))
          return this;
        s = s.right;
      }
    return this;
  }
  /**
   * Returns array of keys
   */
  keys() {
    const t = [];
    return this.forEach(({ key: e }) => {
      t.push(e);
    }), t;
  }
  /**
   * Returns array of all the data in the nodes
   */
  values() {
    const t = [];
    return this.forEach(({ data: e }) => {
      t.push(e);
    }), t;
  }
  min() {
    return this._root ? this.minNode(this._root).key : null;
  }
  max() {
    return this._root ? this.maxNode(this._root).key : null;
  }
  minNode(t = this._root) {
    if (t) for (; t.left; ) t = t.left;
    return t;
  }
  maxNode(t = this._root) {
    if (t) for (; t.right; ) t = t.right;
    return t;
  }
  /**
   * Returns node at given index
   */
  at(t) {
    let e = this._root, r = false, l = 0;
    const i = [];
    for (; !r; )
      if (e)
        i.push(e), e = e.left;
      else if (i.length > 0) {
        if (e = i.pop(), l === t) return e;
        l++, e = e.right;
      } else r = true;
    return null;
  }
  next(t) {
    let e = this._root, r = null;
    if (t.right) {
      for (r = t.right; r.left; ) r = r.left;
      return r;
    }
    const l = this._comparator;
    for (; e; ) {
      const i = l(t.key, e.key);
      if (i === 0) break;
      i < 0 ? (r = e, e = e.left) : e = e.right;
    }
    return r;
  }
  prev(t) {
    let e = this._root, r = null;
    if (t.left !== null) {
      for (r = t.left; r.right; ) r = r.right;
      return r;
    }
    const l = this._comparator;
    for (; e; ) {
      const i = l(t.key, e.key);
      if (i === 0) break;
      i < 0 ? e = e.left : (r = e, e = e.right);
    }
    return r;
  }
  clear() {
    return this._root = null, this._size = 0, this;
  }
  toList() {
    return k(this._root);
  }
  /**
   * Bulk-load items. Both array have to be same size
   */
  load(t, e = [], r = false) {
    let l = t.length;
    const i = this._comparator;
    if (r && g(t, e, 0, l - 1, i), this._root === null)
      this._root = a(t, e, 0, l), this._size = l;
    else {
      const o = y(
        this.toList(),
        x(t, e),
        i
      );
      l = this._size + l, this._root = p({ head: o }, 0, l);
    }
    return this;
  }
  isEmpty() {
    return this._root === null;
  }
  get size() {
    return this._size;
  }
  get root() {
    return this._root;
  }
  toString(t = (e) => String(e.key)) {
    const e = [];
    return _(this._root, "", true, (r) => e.push(r), t), e.join("");
  }
  update(t, e, r) {
    const l = this._comparator;
    let { left: i, right: o } = m(t, this._root, l);
    l(t, e) < 0 ? o = c(e, r, o, l) : i = c(e, r, i, l), this._root = w(i, o, l);
  }
  split(t) {
    return m(t, this._root, this._comparator);
  }
  *[Symbol.iterator]() {
    let t = this._root;
    const e = [];
    let r = false;
    for (; !r; )
      t !== null ? (e.push(t), t = t.left) : e.length !== 0 ? (t = e.pop(), yield t, t = t.right) : r = true;
  }
};
function a(n, t, e, r) {
  const l = r - e;
  if (l > 0) {
    const i = e + Math.floor(l / 2), o = n[i], s = t[i], h = new f(o, s);
    return h.left = a(n, t, e, i), h.right = a(n, t, i + 1, r), h;
  }
  return null;
}
function x(n, t) {
  const e = new f(null, null);
  let r = e;
  for (let l = 0; l < n.length; l++)
    r = r.next = new f(n[l], t[l]);
  return r.next = null, e.next;
}
function k(n) {
  let t = n;
  const e = [];
  let r = false;
  const l = new f(null, null);
  let i = l;
  for (; !r; )
    t ? (e.push(t), t = t.left) : e.length > 0 ? (t = i = i.next = e.pop(), t = t.right) : r = true;
  return i.next = null, l.next;
}
function p(n, t, e) {
  const r = e - t;
  if (r > 0) {
    const l = t + Math.floor(r / 2), i = p(n, t, l), o = n.head;
    return o.left = i, n.head = n.head.next, o.right = p(n, l + 1, e), o;
  }
  return null;
}
function y(n, t, e) {
  const r = new f(null, null);
  let l = r, i = n, o = t;
  for (; i !== null && o !== null; )
    e(i.key, o.key) < 0 ? (l.next = i, i = i.next) : (l.next = o, o = o.next), l = l.next;
  return i !== null ? l.next = i : o !== null && (l.next = o), r.next;
}
function g(n, t, e, r, l) {
  if (e >= r) return;
  const i = n[e + r >> 1];
  let o = e - 1, s = r + 1;
  for (; ; ) {
    do
      o++;
    while (l(n[o], i) < 0);
    do
      s--;
    while (l(n[s], i) > 0);
    if (o >= s) break;
    let h = n[o];
    n[o] = n[s], n[s] = h, h = t[o], t[o] = t[s], t[s] = h;
  }
  g(n, t, e, s, l), g(n, t, s + 1, r, l);
}

// node_modules/.pnpm/robust-predicates@3.0.3/node_modules/robust-predicates/esm/util.js
var epsilon = 11102230246251565e-32;
var splitter = 134217729;
var resulterrbound = (3 + 8 * epsilon) * epsilon;
function sum2(elen, e, flen, f2, h) {
  let Q, Qnew, hh, bvirt;
  let enow = e[0];
  let fnow = f2[0];
  let eindex = 0;
  let findex = 0;
  if (fnow > enow === fnow > -enow) {
    Q = enow;
    enow = e[++eindex];
  } else {
    Q = fnow;
    fnow = f2[++findex];
  }
  let hindex = 0;
  if (eindex < elen && findex < flen) {
    if (fnow > enow === fnow > -enow) {
      Qnew = enow + Q;
      hh = Q - (Qnew - enow);
      enow = e[++eindex];
    } else {
      Qnew = fnow + Q;
      hh = Q - (Qnew - fnow);
      fnow = f2[++findex];
    }
    Q = Qnew;
    if (hh !== 0) {
      h[hindex++] = hh;
    }
    while (eindex < elen && findex < flen) {
      if (fnow > enow === fnow > -enow) {
        Qnew = Q + enow;
        bvirt = Qnew - Q;
        hh = Q - (Qnew - bvirt) + (enow - bvirt);
        enow = e[++eindex];
      } else {
        Qnew = Q + fnow;
        bvirt = Qnew - Q;
        hh = Q - (Qnew - bvirt) + (fnow - bvirt);
        fnow = f2[++findex];
      }
      Q = Qnew;
      if (hh !== 0) {
        h[hindex++] = hh;
      }
    }
  }
  while (eindex < elen) {
    Qnew = Q + enow;
    bvirt = Qnew - Q;
    hh = Q - (Qnew - bvirt) + (enow - bvirt);
    enow = e[++eindex];
    Q = Qnew;
    if (hh !== 0) {
      h[hindex++] = hh;
    }
  }
  while (findex < flen) {
    Qnew = Q + fnow;
    bvirt = Qnew - Q;
    hh = Q - (Qnew - bvirt) + (fnow - bvirt);
    fnow = f2[++findex];
    Q = Qnew;
    if (hh !== 0) {
      h[hindex++] = hh;
    }
  }
  if (Q !== 0 || hindex === 0) {
    h[hindex++] = Q;
  }
  return hindex;
}
function estimate(elen, e) {
  let Q = e[0];
  for (let i = 1; i < elen; i++) Q += e[i];
  return Q;
}
function vec(n) {
  return new Float64Array(n);
}

// node_modules/.pnpm/robust-predicates@3.0.3/node_modules/robust-predicates/esm/orient2d.js
var ccwerrboundA = (3 + 16 * epsilon) * epsilon;
var ccwerrboundB = (2 + 12 * epsilon) * epsilon;
var ccwerrboundC = (9 + 64 * epsilon) * epsilon * epsilon;
var B = vec(4);
var C1 = vec(8);
var C2 = vec(12);
var D = vec(16);
var u2 = vec(4);
function orient2dadapt(ax, ay, bx, by, cx, cy, detsum) {
  let acxtail, acytail, bcxtail, bcytail;
  let bvirt, c2, ahi, alo, bhi, blo, _i, _j, _0, s1, s0, t1, t0, u32;
  const acx = ax - cx;
  const bcx = bx - cx;
  const acy = ay - cy;
  const bcy = by - cy;
  s1 = acx * bcy;
  c2 = splitter * acx;
  ahi = c2 - (c2 - acx);
  alo = acx - ahi;
  c2 = splitter * bcy;
  bhi = c2 - (c2 - bcy);
  blo = bcy - bhi;
  s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
  t1 = acy * bcx;
  c2 = splitter * acy;
  ahi = c2 - (c2 - acy);
  alo = acy - ahi;
  c2 = splitter * bcx;
  bhi = c2 - (c2 - bcx);
  blo = bcx - bhi;
  t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
  _i = s0 - t0;
  bvirt = s0 - _i;
  B[0] = s0 - (_i + bvirt) + (bvirt - t0);
  _j = s1 + _i;
  bvirt = _j - s1;
  _0 = s1 - (_j - bvirt) + (_i - bvirt);
  _i = _0 - t1;
  bvirt = _0 - _i;
  B[1] = _0 - (_i + bvirt) + (bvirt - t1);
  u32 = _j + _i;
  bvirt = u32 - _j;
  B[2] = _j - (u32 - bvirt) + (_i - bvirt);
  B[3] = u32;
  let det = estimate(4, B);
  let errbound = ccwerrboundB * detsum;
  if (det >= errbound || -det >= errbound) {
    return det;
  }
  bvirt = ax - acx;
  acxtail = ax - (acx + bvirt) + (bvirt - cx);
  bvirt = bx - bcx;
  bcxtail = bx - (bcx + bvirt) + (bvirt - cx);
  bvirt = ay - acy;
  acytail = ay - (acy + bvirt) + (bvirt - cy);
  bvirt = by - bcy;
  bcytail = by - (bcy + bvirt) + (bvirt - cy);
  if (acxtail === 0 && acytail === 0 && bcxtail === 0 && bcytail === 0) {
    return det;
  }
  errbound = ccwerrboundC * detsum + resulterrbound * Math.abs(det);
  det += acx * bcytail + bcy * acxtail - (acy * bcxtail + bcx * acytail);
  if (det >= errbound || -det >= errbound) return det;
  s1 = acxtail * bcy;
  c2 = splitter * acxtail;
  ahi = c2 - (c2 - acxtail);
  alo = acxtail - ahi;
  c2 = splitter * bcy;
  bhi = c2 - (c2 - bcy);
  blo = bcy - bhi;
  s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
  t1 = acytail * bcx;
  c2 = splitter * acytail;
  ahi = c2 - (c2 - acytail);
  alo = acytail - ahi;
  c2 = splitter * bcx;
  bhi = c2 - (c2 - bcx);
  blo = bcx - bhi;
  t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
  _i = s0 - t0;
  bvirt = s0 - _i;
  u2[0] = s0 - (_i + bvirt) + (bvirt - t0);
  _j = s1 + _i;
  bvirt = _j - s1;
  _0 = s1 - (_j - bvirt) + (_i - bvirt);
  _i = _0 - t1;
  bvirt = _0 - _i;
  u2[1] = _0 - (_i + bvirt) + (bvirt - t1);
  u32 = _j + _i;
  bvirt = u32 - _j;
  u2[2] = _j - (u32 - bvirt) + (_i - bvirt);
  u2[3] = u32;
  const C1len = sum2(4, B, 4, u2, C1);
  s1 = acx * bcytail;
  c2 = splitter * acx;
  ahi = c2 - (c2 - acx);
  alo = acx - ahi;
  c2 = splitter * bcytail;
  bhi = c2 - (c2 - bcytail);
  blo = bcytail - bhi;
  s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
  t1 = acy * bcxtail;
  c2 = splitter * acy;
  ahi = c2 - (c2 - acy);
  alo = acy - ahi;
  c2 = splitter * bcxtail;
  bhi = c2 - (c2 - bcxtail);
  blo = bcxtail - bhi;
  t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
  _i = s0 - t0;
  bvirt = s0 - _i;
  u2[0] = s0 - (_i + bvirt) + (bvirt - t0);
  _j = s1 + _i;
  bvirt = _j - s1;
  _0 = s1 - (_j - bvirt) + (_i - bvirt);
  _i = _0 - t1;
  bvirt = _0 - _i;
  u2[1] = _0 - (_i + bvirt) + (bvirt - t1);
  u32 = _j + _i;
  bvirt = u32 - _j;
  u2[2] = _j - (u32 - bvirt) + (_i - bvirt);
  u2[3] = u32;
  const C2len = sum2(C1len, C1, 4, u2, C2);
  s1 = acxtail * bcytail;
  c2 = splitter * acxtail;
  ahi = c2 - (c2 - acxtail);
  alo = acxtail - ahi;
  c2 = splitter * bcytail;
  bhi = c2 - (c2 - bcytail);
  blo = bcytail - bhi;
  s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
  t1 = acytail * bcxtail;
  c2 = splitter * acytail;
  ahi = c2 - (c2 - acytail);
  alo = acytail - ahi;
  c2 = splitter * bcxtail;
  bhi = c2 - (c2 - bcxtail);
  blo = bcxtail - bhi;
  t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
  _i = s0 - t0;
  bvirt = s0 - _i;
  u2[0] = s0 - (_i + bvirt) + (bvirt - t0);
  _j = s1 + _i;
  bvirt = _j - s1;
  _0 = s1 - (_j - bvirt) + (_i - bvirt);
  _i = _0 - t1;
  bvirt = _0 - _i;
  u2[1] = _0 - (_i + bvirt) + (bvirt - t1);
  u32 = _j + _i;
  bvirt = u32 - _j;
  u2[2] = _j - (u32 - bvirt) + (_i - bvirt);
  u2[3] = u32;
  const Dlen = sum2(C2len, C2, 4, u2, D);
  return D[Dlen - 1];
}
function orient2d(ax, ay, bx, by, cx, cy) {
  const detleft = (ay - cy) * (bx - cx);
  const detright = (ax - cx) * (by - cy);
  const det = detleft - detright;
  const detsum = Math.abs(detleft + detright);
  if (Math.abs(det) >= ccwerrboundA * detsum) return det;
  return -orient2dadapt(ax, ay, bx, by, cx, cy, detsum);
}

// node_modules/.pnpm/robust-predicates@3.0.3/node_modules/robust-predicates/esm/orient3d.js
var o3derrboundA = (7 + 56 * epsilon) * epsilon;
var o3derrboundB = (3 + 28 * epsilon) * epsilon;
var o3derrboundC = (26 + 288 * epsilon) * epsilon * epsilon;
var bc = vec(4);
var ca = vec(4);
var ab = vec(4);
var at_b = vec(4);
var at_c = vec(4);
var bt_c = vec(4);
var bt_a = vec(4);
var ct_a = vec(4);
var ct_b = vec(4);
var bct = vec(8);
var cat = vec(8);
var abt = vec(8);
var u3 = vec(4);
var _8 = vec(8);
var _8b = vec(8);
var _16 = vec(16);
var _12 = vec(12);
var fin = vec(192);
var fin2 = vec(192);

// node_modules/.pnpm/robust-predicates@3.0.3/node_modules/robust-predicates/esm/incircle.js
var iccerrboundA = (10 + 96 * epsilon) * epsilon;
var iccerrboundB = (4 + 48 * epsilon) * epsilon;
var iccerrboundC = (44 + 576 * epsilon) * epsilon * epsilon;
var bc2 = vec(4);
var ca2 = vec(4);
var ab2 = vec(4);
var aa = vec(4);
var bb = vec(4);
var cc = vec(4);
var u4 = vec(4);
var v = vec(4);
var axtbc = vec(8);
var aytbc = vec(8);
var bxtca = vec(8);
var bytca = vec(8);
var cxtab = vec(8);
var cytab = vec(8);
var abt2 = vec(8);
var bct2 = vec(8);
var cat2 = vec(8);
var abtt = vec(4);
var bctt = vec(4);
var catt = vec(4);
var _82 = vec(8);
var _162 = vec(16);
var _16b = vec(16);
var _16c = vec(16);
var _32 = vec(32);
var _32b = vec(32);
var _48 = vec(48);
var _64 = vec(64);
var fin3 = vec(1152);
var fin22 = vec(1152);

// node_modules/.pnpm/robust-predicates@3.0.3/node_modules/robust-predicates/esm/insphere.js
var isperrboundA = (16 + 224 * epsilon) * epsilon;
var isperrboundB = (5 + 72 * epsilon) * epsilon;
var isperrboundC = (71 + 1408 * epsilon) * epsilon * epsilon;
var ab3 = vec(4);
var bc3 = vec(4);
var cd = vec(4);
var de = vec(4);
var ea = vec(4);
var ac = vec(4);
var bd = vec(4);
var ce = vec(4);
var da = vec(4);
var eb = vec(4);
var abc = vec(24);
var bcd = vec(24);
var cde = vec(24);
var dea = vec(24);
var eab = vec(24);
var abd = vec(24);
var bce = vec(24);
var cda = vec(24);
var deb = vec(24);
var eac = vec(24);
var adet = vec(1152);
var bdet = vec(1152);
var cdet = vec(1152);
var ddet = vec(1152);
var edet = vec(1152);
var abdet = vec(2304);
var cddet = vec(2304);
var cdedet = vec(3456);
var deter = vec(5760);
var _83 = vec(8);
var _8b2 = vec(8);
var _8c = vec(8);
var _163 = vec(16);
var _24 = vec(24);
var _482 = vec(48);
var _48b = vec(48);
var _96 = vec(96);
var _192 = vec(192);
var _384x = vec(384);
var _384y = vec(384);
var _384z = vec(384);
var _768 = vec(768);
var xdet = vec(96);
var ydet = vec(96);
var zdet = vec(96);
var fin4 = vec(1152);

// node_modules/.pnpm/polygon-clipping@0.15.7/node_modules/polygon-clipping/dist/polygon-clipping.esm.js
var isInBbox = (bbox, point) => {
  return bbox.ll.x <= point.x && point.x <= bbox.ur.x && bbox.ll.y <= point.y && point.y <= bbox.ur.y;
};
var getBboxOverlap = (b1, b2) => {
  if (b2.ur.x < b1.ll.x || b1.ur.x < b2.ll.x || b2.ur.y < b1.ll.y || b1.ur.y < b2.ll.y) return null;
  const lowerX = b1.ll.x < b2.ll.x ? b2.ll.x : b1.ll.x;
  const upperX = b1.ur.x < b2.ur.x ? b1.ur.x : b2.ur.x;
  const lowerY = b1.ll.y < b2.ll.y ? b2.ll.y : b1.ll.y;
  const upperY = b1.ur.y < b2.ur.y ? b1.ur.y : b2.ur.y;
  return {
    ll: {
      x: lowerX,
      y: lowerY
    },
    ur: {
      x: upperX,
      y: upperY
    }
  };
};
var epsilon2 = Number.EPSILON;
if (epsilon2 === void 0) epsilon2 = Math.pow(2, -52);
var EPSILON_SQ = epsilon2 * epsilon2;
var cmp = (a2, b) => {
  if (-epsilon2 < a2 && a2 < epsilon2) {
    if (-epsilon2 < b && b < epsilon2) {
      return 0;
    }
  }
  const ab4 = a2 - b;
  if (ab4 * ab4 < EPSILON_SQ * a2 * b) {
    return 0;
  }
  return a2 < b ? -1 : 1;
};
var PtRounder = class {
  constructor() {
    this.reset();
  }
  reset() {
    this.xRounder = new CoordRounder();
    this.yRounder = new CoordRounder();
  }
  round(x2, y2) {
    return {
      x: this.xRounder.round(x2),
      y: this.yRounder.round(y2)
    };
  }
};
var CoordRounder = class {
  constructor() {
    this.tree = new z3();
    this.round(0);
  }
  // Note: this can rounds input values backwards or forwards.
  //       You might ask, why not restrict this to just rounding
  //       forwards? Wouldn't that allow left endpoints to always
  //       remain left endpoints during splitting (never change to
  //       right). No - it wouldn't, because we snap intersections
  //       to endpoints (to establish independence from the segment
  //       angle for t-intersections).
  round(coord) {
    const node = this.tree.add(coord);
    const prevNode = this.tree.prev(node);
    if (prevNode !== null && cmp(node.key, prevNode.key) === 0) {
      this.tree.remove(coord);
      return prevNode.key;
    }
    const nextNode = this.tree.next(node);
    if (nextNode !== null && cmp(node.key, nextNode.key) === 0) {
      this.tree.remove(coord);
      return nextNode.key;
    }
    return coord;
  }
};
var rounder = new PtRounder();
var crossProduct = (a2, b) => a2.x * b.y - a2.y * b.x;
var dotProduct = (a2, b) => a2.x * b.x + a2.y * b.y;
var compareVectorAngles = (basePt, endPt1, endPt2) => {
  const res = orient2d(basePt.x, basePt.y, endPt1.x, endPt1.y, endPt2.x, endPt2.y);
  if (res > 0) return -1;
  if (res < 0) return 1;
  return 0;
};
var length = (v2) => Math.sqrt(dotProduct(v2, v2));
var sineOfAngle = (pShared, pBase, pAngle) => {
  const vBase = {
    x: pBase.x - pShared.x,
    y: pBase.y - pShared.y
  };
  const vAngle = {
    x: pAngle.x - pShared.x,
    y: pAngle.y - pShared.y
  };
  return crossProduct(vAngle, vBase) / length(vAngle) / length(vBase);
};
var cosineOfAngle = (pShared, pBase, pAngle) => {
  const vBase = {
    x: pBase.x - pShared.x,
    y: pBase.y - pShared.y
  };
  const vAngle = {
    x: pAngle.x - pShared.x,
    y: pAngle.y - pShared.y
  };
  return dotProduct(vAngle, vBase) / length(vAngle) / length(vBase);
};
var horizontalIntersection = (pt, v2, y2) => {
  if (v2.y === 0) return null;
  return {
    x: pt.x + v2.x / v2.y * (y2 - pt.y),
    y: y2
  };
};
var verticalIntersection = (pt, v2, x2) => {
  if (v2.x === 0) return null;
  return {
    x: x2,
    y: pt.y + v2.y / v2.x * (x2 - pt.x)
  };
};
var intersection$1 = (pt1, v1, pt2, v2) => {
  if (v1.x === 0) return verticalIntersection(pt2, v2, pt1.x);
  if (v2.x === 0) return verticalIntersection(pt1, v1, pt2.x);
  if (v1.y === 0) return horizontalIntersection(pt2, v2, pt1.y);
  if (v2.y === 0) return horizontalIntersection(pt1, v1, pt2.y);
  const kross = crossProduct(v1, v2);
  if (kross == 0) return null;
  const ve = {
    x: pt2.x - pt1.x,
    y: pt2.y - pt1.y
  };
  const d1 = crossProduct(ve, v1) / kross;
  const d2 = crossProduct(ve, v2) / kross;
  const x1 = pt1.x + d2 * v1.x, x2 = pt2.x + d1 * v2.x;
  const y1 = pt1.y + d2 * v1.y, y2 = pt2.y + d1 * v2.y;
  const x3 = (x1 + x2) / 2;
  const y3 = (y1 + y2) / 2;
  return {
    x: x3,
    y: y3
  };
};
var SweepEvent = class _SweepEvent {
  // for ordering sweep events in the sweep event queue
  static compare(a2, b) {
    const ptCmp = _SweepEvent.comparePoints(a2.point, b.point);
    if (ptCmp !== 0) return ptCmp;
    if (a2.point !== b.point) a2.link(b);
    if (a2.isLeft !== b.isLeft) return a2.isLeft ? 1 : -1;
    return Segment.compare(a2.segment, b.segment);
  }
  // for ordering points in sweep line order
  static comparePoints(aPt, bPt) {
    if (aPt.x < bPt.x) return -1;
    if (aPt.x > bPt.x) return 1;
    if (aPt.y < bPt.y) return -1;
    if (aPt.y > bPt.y) return 1;
    return 0;
  }
  // Warning: 'point' input will be modified and re-used (for performance)
  constructor(point, isLeft) {
    if (point.events === void 0) point.events = [this];
    else point.events.push(this);
    this.point = point;
    this.isLeft = isLeft;
  }
  link(other) {
    if (other.point === this.point) {
      throw new Error("Tried to link already linked events");
    }
    const otherEvents = other.point.events;
    for (let i = 0, iMax = otherEvents.length; i < iMax; i++) {
      const evt = otherEvents[i];
      this.point.events.push(evt);
      evt.point = this.point;
    }
    this.checkForConsuming();
  }
  /* Do a pass over our linked events and check to see if any pair
   * of segments match, and should be consumed. */
  checkForConsuming() {
    const numEvents = this.point.events.length;
    for (let i = 0; i < numEvents; i++) {
      const evt1 = this.point.events[i];
      if (evt1.segment.consumedBy !== void 0) continue;
      for (let j = i + 1; j < numEvents; j++) {
        const evt2 = this.point.events[j];
        if (evt2.consumedBy !== void 0) continue;
        if (evt1.otherSE.point.events !== evt2.otherSE.point.events) continue;
        evt1.segment.consume(evt2.segment);
      }
    }
  }
  getAvailableLinkedEvents() {
    const events = [];
    for (let i = 0, iMax = this.point.events.length; i < iMax; i++) {
      const evt = this.point.events[i];
      if (evt !== this && !evt.segment.ringOut && evt.segment.isInResult()) {
        events.push(evt);
      }
    }
    return events;
  }
  /**
   * Returns a comparator function for sorting linked events that will
   * favor the event that will give us the smallest left-side angle.
   * All ring construction starts as low as possible heading to the right,
   * so by always turning left as sharp as possible we'll get polygons
   * without uncessary loops & holes.
   *
   * The comparator function has a compute cache such that it avoids
   * re-computing already-computed values.
   */
  getLeftmostComparator(baseEvent) {
    const cache = /* @__PURE__ */ new Map();
    const fillCache = (linkedEvent) => {
      const nextEvent = linkedEvent.otherSE;
      cache.set(linkedEvent, {
        sine: sineOfAngle(this.point, baseEvent.point, nextEvent.point),
        cosine: cosineOfAngle(this.point, baseEvent.point, nextEvent.point)
      });
    };
    return (a2, b) => {
      if (!cache.has(a2)) fillCache(a2);
      if (!cache.has(b)) fillCache(b);
      const {
        sine: asine,
        cosine: acosine
      } = cache.get(a2);
      const {
        sine: bsine,
        cosine: bcosine
      } = cache.get(b);
      if (asine >= 0 && bsine >= 0) {
        if (acosine < bcosine) return 1;
        if (acosine > bcosine) return -1;
        return 0;
      }
      if (asine < 0 && bsine < 0) {
        if (acosine < bcosine) return -1;
        if (acosine > bcosine) return 1;
        return 0;
      }
      if (bsine < asine) return -1;
      if (bsine > asine) return 1;
      return 0;
    };
  }
};
var segmentId = 0;
var Segment = class _Segment {
  /* This compare() function is for ordering segments in the sweep
   * line tree, and does so according to the following criteria:
   *
   * Consider the vertical line that lies an infinestimal step to the
   * right of the right-more of the two left endpoints of the input
   * segments. Imagine slowly moving a point up from negative infinity
   * in the increasing y direction. Which of the two segments will that
   * point intersect first? That segment comes 'before' the other one.
   *
   * If neither segment would be intersected by such a line, (if one
   * or more of the segments are vertical) then the line to be considered
   * is directly on the right-more of the two left inputs.
   */
  static compare(a2, b) {
    const alx = a2.leftSE.point.x;
    const blx = b.leftSE.point.x;
    const arx = a2.rightSE.point.x;
    const brx = b.rightSE.point.x;
    if (brx < alx) return 1;
    if (arx < blx) return -1;
    const aly = a2.leftSE.point.y;
    const bly = b.leftSE.point.y;
    const ary = a2.rightSE.point.y;
    const bry = b.rightSE.point.y;
    if (alx < blx) {
      if (bly < aly && bly < ary) return 1;
      if (bly > aly && bly > ary) return -1;
      const aCmpBLeft = a2.comparePoint(b.leftSE.point);
      if (aCmpBLeft < 0) return 1;
      if (aCmpBLeft > 0) return -1;
      const bCmpARight = b.comparePoint(a2.rightSE.point);
      if (bCmpARight !== 0) return bCmpARight;
      return -1;
    }
    if (alx > blx) {
      if (aly < bly && aly < bry) return -1;
      if (aly > bly && aly > bry) return 1;
      const bCmpALeft = b.comparePoint(a2.leftSE.point);
      if (bCmpALeft !== 0) return bCmpALeft;
      const aCmpBRight = a2.comparePoint(b.rightSE.point);
      if (aCmpBRight < 0) return 1;
      if (aCmpBRight > 0) return -1;
      return 1;
    }
    if (aly < bly) return -1;
    if (aly > bly) return 1;
    if (arx < brx) {
      const bCmpARight = b.comparePoint(a2.rightSE.point);
      if (bCmpARight !== 0) return bCmpARight;
    }
    if (arx > brx) {
      const aCmpBRight = a2.comparePoint(b.rightSE.point);
      if (aCmpBRight < 0) return 1;
      if (aCmpBRight > 0) return -1;
    }
    if (arx !== brx) {
      const ay = ary - aly;
      const ax = arx - alx;
      const by = bry - bly;
      const bx = brx - blx;
      if (ay > ax && by < bx) return 1;
      if (ay < ax && by > bx) return -1;
    }
    if (arx > brx) return 1;
    if (arx < brx) return -1;
    if (ary < bry) return -1;
    if (ary > bry) return 1;
    if (a2.id < b.id) return -1;
    if (a2.id > b.id) return 1;
    return 0;
  }
  /* Warning: a reference to ringWindings input will be stored,
   *  and possibly will be later modified */
  constructor(leftSE, rightSE, rings, windings) {
    this.id = ++segmentId;
    this.leftSE = leftSE;
    leftSE.segment = this;
    leftSE.otherSE = rightSE;
    this.rightSE = rightSE;
    rightSE.segment = this;
    rightSE.otherSE = leftSE;
    this.rings = rings;
    this.windings = windings;
  }
  static fromRing(pt1, pt2, ring) {
    let leftPt, rightPt, winding;
    const cmpPts = SweepEvent.comparePoints(pt1, pt2);
    if (cmpPts < 0) {
      leftPt = pt1;
      rightPt = pt2;
      winding = 1;
    } else if (cmpPts > 0) {
      leftPt = pt2;
      rightPt = pt1;
      winding = -1;
    } else throw new Error(`Tried to create degenerate segment at [${pt1.x}, ${pt1.y}]`);
    const leftSE = new SweepEvent(leftPt, true);
    const rightSE = new SweepEvent(rightPt, false);
    return new _Segment(leftSE, rightSE, [ring], [winding]);
  }
  /* When a segment is split, the rightSE is replaced with a new sweep event */
  replaceRightSE(newRightSE) {
    this.rightSE = newRightSE;
    this.rightSE.segment = this;
    this.rightSE.otherSE = this.leftSE;
    this.leftSE.otherSE = this.rightSE;
  }
  bbox() {
    const y1 = this.leftSE.point.y;
    const y2 = this.rightSE.point.y;
    return {
      ll: {
        x: this.leftSE.point.x,
        y: y1 < y2 ? y1 : y2
      },
      ur: {
        x: this.rightSE.point.x,
        y: y1 > y2 ? y1 : y2
      }
    };
  }
  /* A vector from the left point to the right */
  vector() {
    return {
      x: this.rightSE.point.x - this.leftSE.point.x,
      y: this.rightSE.point.y - this.leftSE.point.y
    };
  }
  isAnEndpoint(pt) {
    return pt.x === this.leftSE.point.x && pt.y === this.leftSE.point.y || pt.x === this.rightSE.point.x && pt.y === this.rightSE.point.y;
  }
  /* Compare this segment with a point.
   *
   * A point P is considered to be colinear to a segment if there
   * exists a distance D such that if we travel along the segment
   * from one * endpoint towards the other a distance D, we find
   * ourselves at point P.
   *
   * Return value indicates:
   *
   *   1: point lies above the segment (to the left of vertical)
   *   0: point is colinear to segment
   *  -1: point lies below the segment (to the right of vertical)
   */
  comparePoint(point) {
    if (this.isAnEndpoint(point)) return 0;
    const lPt = this.leftSE.point;
    const rPt = this.rightSE.point;
    const v2 = this.vector();
    if (lPt.x === rPt.x) {
      if (point.x === lPt.x) return 0;
      return point.x < lPt.x ? 1 : -1;
    }
    const yDist = (point.y - lPt.y) / v2.y;
    const xFromYDist = lPt.x + yDist * v2.x;
    if (point.x === xFromYDist) return 0;
    const xDist = (point.x - lPt.x) / v2.x;
    const yFromXDist = lPt.y + xDist * v2.y;
    if (point.y === yFromXDist) return 0;
    return point.y < yFromXDist ? -1 : 1;
  }
  /**
   * Given another segment, returns the first non-trivial intersection
   * between the two segments (in terms of sweep line ordering), if it exists.
   *
   * A 'non-trivial' intersection is one that will cause one or both of the
   * segments to be split(). As such, 'trivial' vs. 'non-trivial' intersection:
   *
   *   * endpoint of segA with endpoint of segB --> trivial
   *   * endpoint of segA with point along segB --> non-trivial
   *   * endpoint of segB with point along segA --> non-trivial
   *   * point along segA with point along segB --> non-trivial
   *
   * If no non-trivial intersection exists, return null
   * Else, return null.
   */
  getIntersection(other) {
    const tBbox = this.bbox();
    const oBbox = other.bbox();
    const bboxOverlap = getBboxOverlap(tBbox, oBbox);
    if (bboxOverlap === null) return null;
    const tlp = this.leftSE.point;
    const trp = this.rightSE.point;
    const olp = other.leftSE.point;
    const orp = other.rightSE.point;
    const touchesOtherLSE = isInBbox(tBbox, olp) && this.comparePoint(olp) === 0;
    const touchesThisLSE = isInBbox(oBbox, tlp) && other.comparePoint(tlp) === 0;
    const touchesOtherRSE = isInBbox(tBbox, orp) && this.comparePoint(orp) === 0;
    const touchesThisRSE = isInBbox(oBbox, trp) && other.comparePoint(trp) === 0;
    if (touchesThisLSE && touchesOtherLSE) {
      if (touchesThisRSE && !touchesOtherRSE) return trp;
      if (!touchesThisRSE && touchesOtherRSE) return orp;
      return null;
    }
    if (touchesThisLSE) {
      if (touchesOtherRSE) {
        if (tlp.x === orp.x && tlp.y === orp.y) return null;
      }
      return tlp;
    }
    if (touchesOtherLSE) {
      if (touchesThisRSE) {
        if (trp.x === olp.x && trp.y === olp.y) return null;
      }
      return olp;
    }
    if (touchesThisRSE && touchesOtherRSE) return null;
    if (touchesThisRSE) return trp;
    if (touchesOtherRSE) return orp;
    const pt = intersection$1(tlp, this.vector(), olp, other.vector());
    if (pt === null) return null;
    if (!isInBbox(bboxOverlap, pt)) return null;
    return rounder.round(pt.x, pt.y);
  }
  /**
   * Split the given segment into multiple segments on the given points.
   *  * Each existing segment will retain its leftSE and a new rightSE will be
   *    generated for it.
   *  * A new segment will be generated which will adopt the original segment's
   *    rightSE, and a new leftSE will be generated for it.
   *  * If there are more than two points given to split on, new segments
   *    in the middle will be generated with new leftSE and rightSE's.
   *  * An array of the newly generated SweepEvents will be returned.
   *
   * Warning: input array of points is modified
   */
  split(point) {
    const newEvents = [];
    const alreadyLinked = point.events !== void 0;
    const newLeftSE = new SweepEvent(point, true);
    const newRightSE = new SweepEvent(point, false);
    const oldRightSE = this.rightSE;
    this.replaceRightSE(newRightSE);
    newEvents.push(newRightSE);
    newEvents.push(newLeftSE);
    const newSeg = new _Segment(newLeftSE, oldRightSE, this.rings.slice(), this.windings.slice());
    if (SweepEvent.comparePoints(newSeg.leftSE.point, newSeg.rightSE.point) > 0) {
      newSeg.swapEvents();
    }
    if (SweepEvent.comparePoints(this.leftSE.point, this.rightSE.point) > 0) {
      this.swapEvents();
    }
    if (alreadyLinked) {
      newLeftSE.checkForConsuming();
      newRightSE.checkForConsuming();
    }
    return newEvents;
  }
  /* Swap which event is left and right */
  swapEvents() {
    const tmpEvt = this.rightSE;
    this.rightSE = this.leftSE;
    this.leftSE = tmpEvt;
    this.leftSE.isLeft = true;
    this.rightSE.isLeft = false;
    for (let i = 0, iMax = this.windings.length; i < iMax; i++) {
      this.windings[i] *= -1;
    }
  }
  /* Consume another segment. We take their rings under our wing
   * and mark them as consumed. Use for perfectly overlapping segments */
  consume(other) {
    let consumer = this;
    let consumee = other;
    while (consumer.consumedBy) consumer = consumer.consumedBy;
    while (consumee.consumedBy) consumee = consumee.consumedBy;
    const cmp2 = _Segment.compare(consumer, consumee);
    if (cmp2 === 0) return;
    if (cmp2 > 0) {
      const tmp = consumer;
      consumer = consumee;
      consumee = tmp;
    }
    if (consumer.prev === consumee) {
      const tmp = consumer;
      consumer = consumee;
      consumee = tmp;
    }
    for (let i = 0, iMax = consumee.rings.length; i < iMax; i++) {
      const ring = consumee.rings[i];
      const winding = consumee.windings[i];
      const index2 = consumer.rings.indexOf(ring);
      if (index2 === -1) {
        consumer.rings.push(ring);
        consumer.windings.push(winding);
      } else consumer.windings[index2] += winding;
    }
    consumee.rings = null;
    consumee.windings = null;
    consumee.consumedBy = consumer;
    consumee.leftSE.consumedBy = consumer.leftSE;
    consumee.rightSE.consumedBy = consumer.rightSE;
  }
  /* The first segment previous segment chain that is in the result */
  prevInResult() {
    if (this._prevInResult !== void 0) return this._prevInResult;
    if (!this.prev) this._prevInResult = null;
    else if (this.prev.isInResult()) this._prevInResult = this.prev;
    else this._prevInResult = this.prev.prevInResult();
    return this._prevInResult;
  }
  beforeState() {
    if (this._beforeState !== void 0) return this._beforeState;
    if (!this.prev) this._beforeState = {
      rings: [],
      windings: [],
      multiPolys: []
    };
    else {
      const seg = this.prev.consumedBy || this.prev;
      this._beforeState = seg.afterState();
    }
    return this._beforeState;
  }
  afterState() {
    if (this._afterState !== void 0) return this._afterState;
    const beforeState = this.beforeState();
    this._afterState = {
      rings: beforeState.rings.slice(0),
      windings: beforeState.windings.slice(0),
      multiPolys: []
    };
    const ringsAfter = this._afterState.rings;
    const windingsAfter = this._afterState.windings;
    const mpsAfter = this._afterState.multiPolys;
    for (let i = 0, iMax = this.rings.length; i < iMax; i++) {
      const ring = this.rings[i];
      const winding = this.windings[i];
      const index2 = ringsAfter.indexOf(ring);
      if (index2 === -1) {
        ringsAfter.push(ring);
        windingsAfter.push(winding);
      } else windingsAfter[index2] += winding;
    }
    const polysAfter = [];
    const polysExclude = [];
    for (let i = 0, iMax = ringsAfter.length; i < iMax; i++) {
      if (windingsAfter[i] === 0) continue;
      const ring = ringsAfter[i];
      const poly = ring.poly;
      if (polysExclude.indexOf(poly) !== -1) continue;
      if (ring.isExterior) polysAfter.push(poly);
      else {
        if (polysExclude.indexOf(poly) === -1) polysExclude.push(poly);
        const index2 = polysAfter.indexOf(ring.poly);
        if (index2 !== -1) polysAfter.splice(index2, 1);
      }
    }
    for (let i = 0, iMax = polysAfter.length; i < iMax; i++) {
      const mp = polysAfter[i].multiPoly;
      if (mpsAfter.indexOf(mp) === -1) mpsAfter.push(mp);
    }
    return this._afterState;
  }
  /* Is this segment part of the final result? */
  isInResult() {
    if (this.consumedBy) return false;
    if (this._isInResult !== void 0) return this._isInResult;
    const mpsBefore = this.beforeState().multiPolys;
    const mpsAfter = this.afterState().multiPolys;
    switch (operation.type) {
      case "union": {
        const noBefores = mpsBefore.length === 0;
        const noAfters = mpsAfter.length === 0;
        this._isInResult = noBefores !== noAfters;
        break;
      }
      case "intersection": {
        let least;
        let most;
        if (mpsBefore.length < mpsAfter.length) {
          least = mpsBefore.length;
          most = mpsAfter.length;
        } else {
          least = mpsAfter.length;
          most = mpsBefore.length;
        }
        this._isInResult = most === operation.numMultiPolys && least < most;
        break;
      }
      case "xor": {
        const diff = Math.abs(mpsBefore.length - mpsAfter.length);
        this._isInResult = diff % 2 === 1;
        break;
      }
      case "difference": {
        const isJustSubject = (mps) => mps.length === 1 && mps[0].isSubject;
        this._isInResult = isJustSubject(mpsBefore) !== isJustSubject(mpsAfter);
        break;
      }
      default:
        throw new Error(`Unrecognized operation type found ${operation.type}`);
    }
    return this._isInResult;
  }
};
var RingIn = class {
  constructor(geomRing, poly, isExterior) {
    if (!Array.isArray(geomRing) || geomRing.length === 0) {
      throw new Error("Input geometry is not a valid Polygon or MultiPolygon");
    }
    this.poly = poly;
    this.isExterior = isExterior;
    this.segments = [];
    if (typeof geomRing[0][0] !== "number" || typeof geomRing[0][1] !== "number") {
      throw new Error("Input geometry is not a valid Polygon or MultiPolygon");
    }
    const firstPoint = rounder.round(geomRing[0][0], geomRing[0][1]);
    this.bbox = {
      ll: {
        x: firstPoint.x,
        y: firstPoint.y
      },
      ur: {
        x: firstPoint.x,
        y: firstPoint.y
      }
    };
    let prevPoint = firstPoint;
    for (let i = 1, iMax = geomRing.length; i < iMax; i++) {
      if (typeof geomRing[i][0] !== "number" || typeof geomRing[i][1] !== "number") {
        throw new Error("Input geometry is not a valid Polygon or MultiPolygon");
      }
      let point = rounder.round(geomRing[i][0], geomRing[i][1]);
      if (point.x === prevPoint.x && point.y === prevPoint.y) continue;
      this.segments.push(Segment.fromRing(prevPoint, point, this));
      if (point.x < this.bbox.ll.x) this.bbox.ll.x = point.x;
      if (point.y < this.bbox.ll.y) this.bbox.ll.y = point.y;
      if (point.x > this.bbox.ur.x) this.bbox.ur.x = point.x;
      if (point.y > this.bbox.ur.y) this.bbox.ur.y = point.y;
      prevPoint = point;
    }
    if (firstPoint.x !== prevPoint.x || firstPoint.y !== prevPoint.y) {
      this.segments.push(Segment.fromRing(prevPoint, firstPoint, this));
    }
  }
  getSweepEvents() {
    const sweepEvents = [];
    for (let i = 0, iMax = this.segments.length; i < iMax; i++) {
      const segment = this.segments[i];
      sweepEvents.push(segment.leftSE);
      sweepEvents.push(segment.rightSE);
    }
    return sweepEvents;
  }
};
var PolyIn = class {
  constructor(geomPoly, multiPoly) {
    if (!Array.isArray(geomPoly)) {
      throw new Error("Input geometry is not a valid Polygon or MultiPolygon");
    }
    this.exteriorRing = new RingIn(geomPoly[0], this, true);
    this.bbox = {
      ll: {
        x: this.exteriorRing.bbox.ll.x,
        y: this.exteriorRing.bbox.ll.y
      },
      ur: {
        x: this.exteriorRing.bbox.ur.x,
        y: this.exteriorRing.bbox.ur.y
      }
    };
    this.interiorRings = [];
    for (let i = 1, iMax = geomPoly.length; i < iMax; i++) {
      const ring = new RingIn(geomPoly[i], this, false);
      if (ring.bbox.ll.x < this.bbox.ll.x) this.bbox.ll.x = ring.bbox.ll.x;
      if (ring.bbox.ll.y < this.bbox.ll.y) this.bbox.ll.y = ring.bbox.ll.y;
      if (ring.bbox.ur.x > this.bbox.ur.x) this.bbox.ur.x = ring.bbox.ur.x;
      if (ring.bbox.ur.y > this.bbox.ur.y) this.bbox.ur.y = ring.bbox.ur.y;
      this.interiorRings.push(ring);
    }
    this.multiPoly = multiPoly;
  }
  getSweepEvents() {
    const sweepEvents = this.exteriorRing.getSweepEvents();
    for (let i = 0, iMax = this.interiorRings.length; i < iMax; i++) {
      const ringSweepEvents = this.interiorRings[i].getSweepEvents();
      for (let j = 0, jMax = ringSweepEvents.length; j < jMax; j++) {
        sweepEvents.push(ringSweepEvents[j]);
      }
    }
    return sweepEvents;
  }
};
var MultiPolyIn = class {
  constructor(geom, isSubject) {
    if (!Array.isArray(geom)) {
      throw new Error("Input geometry is not a valid Polygon or MultiPolygon");
    }
    try {
      if (typeof geom[0][0][0] === "number") geom = [geom];
    } catch (ex) {
    }
    this.polys = [];
    this.bbox = {
      ll: {
        x: Number.POSITIVE_INFINITY,
        y: Number.POSITIVE_INFINITY
      },
      ur: {
        x: Number.NEGATIVE_INFINITY,
        y: Number.NEGATIVE_INFINITY
      }
    };
    for (let i = 0, iMax = geom.length; i < iMax; i++) {
      const poly = new PolyIn(geom[i], this);
      if (poly.bbox.ll.x < this.bbox.ll.x) this.bbox.ll.x = poly.bbox.ll.x;
      if (poly.bbox.ll.y < this.bbox.ll.y) this.bbox.ll.y = poly.bbox.ll.y;
      if (poly.bbox.ur.x > this.bbox.ur.x) this.bbox.ur.x = poly.bbox.ur.x;
      if (poly.bbox.ur.y > this.bbox.ur.y) this.bbox.ur.y = poly.bbox.ur.y;
      this.polys.push(poly);
    }
    this.isSubject = isSubject;
  }
  getSweepEvents() {
    const sweepEvents = [];
    for (let i = 0, iMax = this.polys.length; i < iMax; i++) {
      const polySweepEvents = this.polys[i].getSweepEvents();
      for (let j = 0, jMax = polySweepEvents.length; j < jMax; j++) {
        sweepEvents.push(polySweepEvents[j]);
      }
    }
    return sweepEvents;
  }
};
var RingOut = class _RingOut {
  /* Given the segments from the sweep line pass, compute & return a series
   * of closed rings from all the segments marked to be part of the result */
  static factory(allSegments) {
    const ringsOut = [];
    for (let i = 0, iMax = allSegments.length; i < iMax; i++) {
      const segment = allSegments[i];
      if (!segment.isInResult() || segment.ringOut) continue;
      let prevEvent = null;
      let event = segment.leftSE;
      let nextEvent = segment.rightSE;
      const events = [event];
      const startingPoint = event.point;
      const intersectionLEs = [];
      while (true) {
        prevEvent = event;
        event = nextEvent;
        events.push(event);
        if (event.point === startingPoint) break;
        while (true) {
          const availableLEs = event.getAvailableLinkedEvents();
          if (availableLEs.length === 0) {
            const firstPt = events[0].point;
            const lastPt = events[events.length - 1].point;
            throw new Error(`Unable to complete output ring starting at [${firstPt.x}, ${firstPt.y}]. Last matching segment found ends at [${lastPt.x}, ${lastPt.y}].`);
          }
          if (availableLEs.length === 1) {
            nextEvent = availableLEs[0].otherSE;
            break;
          }
          let indexLE = null;
          for (let j = 0, jMax = intersectionLEs.length; j < jMax; j++) {
            if (intersectionLEs[j].point === event.point) {
              indexLE = j;
              break;
            }
          }
          if (indexLE !== null) {
            const intersectionLE = intersectionLEs.splice(indexLE)[0];
            const ringEvents = events.splice(intersectionLE.index);
            ringEvents.unshift(ringEvents[0].otherSE);
            ringsOut.push(new _RingOut(ringEvents.reverse()));
            continue;
          }
          intersectionLEs.push({
            index: events.length,
            point: event.point
          });
          const comparator = event.getLeftmostComparator(prevEvent);
          nextEvent = availableLEs.sort(comparator)[0].otherSE;
          break;
        }
      }
      ringsOut.push(new _RingOut(events));
    }
    return ringsOut;
  }
  constructor(events) {
    this.events = events;
    for (let i = 0, iMax = events.length; i < iMax; i++) {
      events[i].segment.ringOut = this;
    }
    this.poly = null;
  }
  getGeom() {
    let prevPt = this.events[0].point;
    const points2 = [prevPt];
    for (let i = 1, iMax = this.events.length - 1; i < iMax; i++) {
      const pt2 = this.events[i].point;
      const nextPt2 = this.events[i + 1].point;
      if (compareVectorAngles(pt2, prevPt, nextPt2) === 0) continue;
      points2.push(pt2);
      prevPt = pt2;
    }
    if (points2.length === 1) return null;
    const pt = points2[0];
    const nextPt = points2[1];
    if (compareVectorAngles(pt, prevPt, nextPt) === 0) points2.shift();
    points2.push(points2[0]);
    const step = this.isExteriorRing() ? 1 : -1;
    const iStart = this.isExteriorRing() ? 0 : points2.length - 1;
    const iEnd = this.isExteriorRing() ? points2.length : -1;
    const orderedPoints = [];
    for (let i = iStart; i != iEnd; i += step) orderedPoints.push([points2[i].x, points2[i].y]);
    return orderedPoints;
  }
  isExteriorRing() {
    if (this._isExteriorRing === void 0) {
      const enclosing = this.enclosingRing();
      this._isExteriorRing = enclosing ? !enclosing.isExteriorRing() : true;
    }
    return this._isExteriorRing;
  }
  enclosingRing() {
    if (this._enclosingRing === void 0) {
      this._enclosingRing = this._calcEnclosingRing();
    }
    return this._enclosingRing;
  }
  /* Returns the ring that encloses this one, if any */
  _calcEnclosingRing() {
    let leftMostEvt = this.events[0];
    for (let i = 1, iMax = this.events.length; i < iMax; i++) {
      const evt = this.events[i];
      if (SweepEvent.compare(leftMostEvt, evt) > 0) leftMostEvt = evt;
    }
    let prevSeg = leftMostEvt.segment.prevInResult();
    let prevPrevSeg = prevSeg ? prevSeg.prevInResult() : null;
    while (true) {
      if (!prevSeg) return null;
      if (!prevPrevSeg) return prevSeg.ringOut;
      if (prevPrevSeg.ringOut !== prevSeg.ringOut) {
        if (prevPrevSeg.ringOut.enclosingRing() !== prevSeg.ringOut) {
          return prevSeg.ringOut;
        } else return prevSeg.ringOut.enclosingRing();
      }
      prevSeg = prevPrevSeg.prevInResult();
      prevPrevSeg = prevSeg ? prevSeg.prevInResult() : null;
    }
  }
};
var PolyOut = class {
  constructor(exteriorRing) {
    this.exteriorRing = exteriorRing;
    exteriorRing.poly = this;
    this.interiorRings = [];
  }
  addInterior(ring) {
    this.interiorRings.push(ring);
    ring.poly = this;
  }
  getGeom() {
    const geom = [this.exteriorRing.getGeom()];
    if (geom[0] === null) return null;
    for (let i = 0, iMax = this.interiorRings.length; i < iMax; i++) {
      const ringGeom = this.interiorRings[i].getGeom();
      if (ringGeom === null) continue;
      geom.push(ringGeom);
    }
    return geom;
  }
};
var MultiPolyOut = class {
  constructor(rings) {
    this.rings = rings;
    this.polys = this._composePolys(rings);
  }
  getGeom() {
    const geom = [];
    for (let i = 0, iMax = this.polys.length; i < iMax; i++) {
      const polyGeom = this.polys[i].getGeom();
      if (polyGeom === null) continue;
      geom.push(polyGeom);
    }
    return geom;
  }
  _composePolys(rings) {
    const polys = [];
    for (let i = 0, iMax = rings.length; i < iMax; i++) {
      const ring = rings[i];
      if (ring.poly) continue;
      if (ring.isExteriorRing()) polys.push(new PolyOut(ring));
      else {
        const enclosingRing = ring.enclosingRing();
        if (!enclosingRing.poly) polys.push(new PolyOut(enclosingRing));
        enclosingRing.poly.addInterior(ring);
      }
    }
    return polys;
  }
};
var SweepLine = class {
  constructor(queue) {
    let comparator = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : Segment.compare;
    this.queue = queue;
    this.tree = new z3(comparator);
    this.segments = [];
  }
  process(event) {
    const segment = event.segment;
    const newEvents = [];
    if (event.consumedBy) {
      if (event.isLeft) this.queue.remove(event.otherSE);
      else this.tree.remove(segment);
      return newEvents;
    }
    const node = event.isLeft ? this.tree.add(segment) : this.tree.find(segment);
    if (!node) throw new Error(`Unable to find segment #${segment.id} [${segment.leftSE.point.x}, ${segment.leftSE.point.y}] -> [${segment.rightSE.point.x}, ${segment.rightSE.point.y}] in SweepLine tree.`);
    let prevNode = node;
    let nextNode = node;
    let prevSeg = void 0;
    let nextSeg = void 0;
    while (prevSeg === void 0) {
      prevNode = this.tree.prev(prevNode);
      if (prevNode === null) prevSeg = null;
      else if (prevNode.key.consumedBy === void 0) prevSeg = prevNode.key;
    }
    while (nextSeg === void 0) {
      nextNode = this.tree.next(nextNode);
      if (nextNode === null) nextSeg = null;
      else if (nextNode.key.consumedBy === void 0) nextSeg = nextNode.key;
    }
    if (event.isLeft) {
      let prevMySplitter = null;
      if (prevSeg) {
        const prevInter = prevSeg.getIntersection(segment);
        if (prevInter !== null) {
          if (!segment.isAnEndpoint(prevInter)) prevMySplitter = prevInter;
          if (!prevSeg.isAnEndpoint(prevInter)) {
            const newEventsFromSplit = this._splitSafely(prevSeg, prevInter);
            for (let i = 0, iMax = newEventsFromSplit.length; i < iMax; i++) {
              newEvents.push(newEventsFromSplit[i]);
            }
          }
        }
      }
      let nextMySplitter = null;
      if (nextSeg) {
        const nextInter = nextSeg.getIntersection(segment);
        if (nextInter !== null) {
          if (!segment.isAnEndpoint(nextInter)) nextMySplitter = nextInter;
          if (!nextSeg.isAnEndpoint(nextInter)) {
            const newEventsFromSplit = this._splitSafely(nextSeg, nextInter);
            for (let i = 0, iMax = newEventsFromSplit.length; i < iMax; i++) {
              newEvents.push(newEventsFromSplit[i]);
            }
          }
        }
      }
      if (prevMySplitter !== null || nextMySplitter !== null) {
        let mySplitter = null;
        if (prevMySplitter === null) mySplitter = nextMySplitter;
        else if (nextMySplitter === null) mySplitter = prevMySplitter;
        else {
          const cmpSplitters = SweepEvent.comparePoints(prevMySplitter, nextMySplitter);
          mySplitter = cmpSplitters <= 0 ? prevMySplitter : nextMySplitter;
        }
        this.queue.remove(segment.rightSE);
        newEvents.push(segment.rightSE);
        const newEventsFromSplit = segment.split(mySplitter);
        for (let i = 0, iMax = newEventsFromSplit.length; i < iMax; i++) {
          newEvents.push(newEventsFromSplit[i]);
        }
      }
      if (newEvents.length > 0) {
        this.tree.remove(segment);
        newEvents.push(event);
      } else {
        this.segments.push(segment);
        segment.prev = prevSeg;
      }
    } else {
      if (prevSeg && nextSeg) {
        const inter = prevSeg.getIntersection(nextSeg);
        if (inter !== null) {
          if (!prevSeg.isAnEndpoint(inter)) {
            const newEventsFromSplit = this._splitSafely(prevSeg, inter);
            for (let i = 0, iMax = newEventsFromSplit.length; i < iMax; i++) {
              newEvents.push(newEventsFromSplit[i]);
            }
          }
          if (!nextSeg.isAnEndpoint(inter)) {
            const newEventsFromSplit = this._splitSafely(nextSeg, inter);
            for (let i = 0, iMax = newEventsFromSplit.length; i < iMax; i++) {
              newEvents.push(newEventsFromSplit[i]);
            }
          }
        }
      }
      this.tree.remove(segment);
    }
    return newEvents;
  }
  /* Safely split a segment that is currently in the datastructures
   * IE - a segment other than the one that is currently being processed. */
  _splitSafely(seg, pt) {
    this.tree.remove(seg);
    const rightSE = seg.rightSE;
    this.queue.remove(rightSE);
    const newEvents = seg.split(pt);
    newEvents.push(rightSE);
    if (seg.consumedBy === void 0) this.tree.add(seg);
    return newEvents;
  }
};
var POLYGON_CLIPPING_MAX_QUEUE_SIZE = 1e6;
var POLYGON_CLIPPING_MAX_SWEEPLINE_SEGMENTS = 1e6;
var Operation = class {
  run(type, geom, moreGeoms) {
    operation.type = type;
    rounder.reset();
    const multipolys = [new MultiPolyIn(geom, true)];
    for (let i = 0, iMax = moreGeoms.length; i < iMax; i++) {
      multipolys.push(new MultiPolyIn(moreGeoms[i], false));
    }
    operation.numMultiPolys = multipolys.length;
    if (operation.type === "difference") {
      const subject = multipolys[0];
      let i = 1;
      while (i < multipolys.length) {
        if (getBboxOverlap(multipolys[i].bbox, subject.bbox) !== null) i++;
        else multipolys.splice(i, 1);
      }
    }
    if (operation.type === "intersection") {
      for (let i = 0, iMax = multipolys.length; i < iMax; i++) {
        const mpA = multipolys[i];
        for (let j = i + 1, jMax = multipolys.length; j < jMax; j++) {
          if (getBboxOverlap(mpA.bbox, multipolys[j].bbox) === null) return [];
        }
      }
    }
    const queue = new z3(SweepEvent.compare);
    for (let i = 0, iMax = multipolys.length; i < iMax; i++) {
      const sweepEvents = multipolys[i].getSweepEvents();
      for (let j = 0, jMax = sweepEvents.length; j < jMax; j++) {
        queue.insert(sweepEvents[j]);
        if (queue.size > POLYGON_CLIPPING_MAX_QUEUE_SIZE) {
          throw new Error("Infinite loop when putting segment endpoints in a priority queue (queue size too big).");
        }
      }
    }
    const sweepLine = new SweepLine(queue);
    let prevQueueSize = queue.size;
    let node = queue.pop();
    while (node) {
      const evt = node.key;
      if (queue.size === prevQueueSize) {
        const seg = evt.segment;
        throw new Error(`Unable to pop() ${evt.isLeft ? "left" : "right"} SweepEvent [${evt.point.x}, ${evt.point.y}] from segment #${seg.id} [${seg.leftSE.point.x}, ${seg.leftSE.point.y}] -> [${seg.rightSE.point.x}, ${seg.rightSE.point.y}] from queue.`);
      }
      if (queue.size > POLYGON_CLIPPING_MAX_QUEUE_SIZE) {
        throw new Error("Infinite loop when passing sweep line over endpoints (queue size too big).");
      }
      if (sweepLine.segments.length > POLYGON_CLIPPING_MAX_SWEEPLINE_SEGMENTS) {
        throw new Error("Infinite loop when passing sweep line over endpoints (too many sweep line segments).");
      }
      const newEvents = sweepLine.process(evt);
      for (let i = 0, iMax = newEvents.length; i < iMax; i++) {
        const evt2 = newEvents[i];
        if (evt2.consumedBy === void 0) queue.insert(evt2);
      }
      prevQueueSize = queue.size;
      node = queue.pop();
    }
    rounder.reset();
    const ringsOut = RingOut.factory(sweepLine.segments);
    const result = new MultiPolyOut(ringsOut);
    return result.getGeom();
  }
};
var operation = new Operation();
var union = function(geom) {
  for (var _len = arguments.length, moreGeoms = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
    moreGeoms[_key - 1] = arguments[_key];
  }
  return operation.run("union", geom, moreGeoms);
};
var intersection = function(geom) {
  for (var _len2 = arguments.length, moreGeoms = new Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
    moreGeoms[_key2 - 1] = arguments[_key2];
  }
  return operation.run("intersection", geom, moreGeoms);
};
var xor = function(geom) {
  for (var _len3 = arguments.length, moreGeoms = new Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++) {
    moreGeoms[_key3 - 1] = arguments[_key3];
  }
  return operation.run("xor", geom, moreGeoms);
};
var difference = function(subjectGeom) {
  for (var _len4 = arguments.length, clippingGeoms = new Array(_len4 > 1 ? _len4 - 1 : 0), _key4 = 1; _key4 < _len4; _key4++) {
    clippingGeoms[_key4 - 1] = arguments[_key4];
  }
  return operation.run("difference", subjectGeom, clippingGeoms);
};
var index = {
  union,
  intersection,
  xor,
  difference
};

// src/copper.ts
var copperCapacitanceScaleToFarads = 1e-3;
var finite = (value2) => Number.isFinite(value2);
var distance = (a2, b) => Math.hypot(...a2.map((v2, i) => v2 - b[i]));
var area = (ring) => ring.reduce((s, p2, i) => {
  const q = ring[(i + 1) % ring.length];
  return s + p2[0] * q[1] - q[0] * p2[1];
}, 0) / 2;
var closed = (ring) => [...ring, ring[0]];
var layer = (m2, name) => {
  const found = m2.stackup.find((l) => l.name === name);
  if (!found) fail("stackup", `No copper z range for ${name}`);
  return found;
};
var z4 = (m2, name) => {
  const l = layer(m2, name);
  return (l.zMinMm + l.zMaxMm) / 2;
};
function connectedSourceIds(circuit, seed) {
  const ids = /* @__PURE__ */ new Set([seed]), traces = circuit.filter((e) => e.type === "source_trace");
  let changed = true;
  while (changed) {
    changed = false;
    for (const trace of traces) {
      const members = [...trace.connected_source_port_ids, ...trace.connected_source_net_ids ?? []];
      if (members.some((id2) => ids.has(id2))) {
        for (const id2 of members) if (!ids.has(id2)) {
          ids.add(id2);
          changed = true;
        }
      }
    }
  }
  return ids;
}
var ringBounds = /* @__PURE__ */ new WeakMap();
function inRing(p2, ring) {
  let box = ringBounds.get(ring);
  if (!box) {
    box = [Math.min(...ring.map((p3) => p3[0])), Math.min(...ring.map((p3) => p3[1])), Math.max(...ring.map((p3) => p3[0])), Math.max(...ring.map((p3) => p3[1]))];
    ringBounds.set(ring, box);
  }
  if (p2[0] < box[0] || p2[1] < box[1] || p2[0] > box[2] || p2[1] > box[3]) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a2 = ring[i], b = ring[j];
    if (a2[1] > p2[1] !== b[1] > p2[1] && p2[0] < (b[0] - a2[0]) * (p2[1] - a2[1]) / (b[1] - a2[1]) + a2[0]) inside = !inside;
  }
  return inside;
}
var contains = (p2, polygon) => inRing(p2, polygon[0]) && !polygon.slice(1).some((ring) => inRing(p2, ring));
function routePath(route, m2) {
  if (!Array.isArray(route) || route.length < 2 || route[0].route_type !== "wire") fail("route_geometry", "Copper routes must start with a wire at a physical port");
  for (const point of route) {
    if (!["wire", "via"].includes(point.route_type) || ![point.x, point.y].every(finite)) fail("route_geometry", "Only finite wire/via coordinates are supported");
    if (point.route_type === "wire") {
      if (!finite(point.width) || point.width <= 0) fail("route_geometry", "Positive finite wire widths are required");
      if (point.start_width !== void 0 || point.end_width !== void 0 || point.width_interpolation_mode !== void 0) fail("varying_width", "Tapered copper routes require an explicit supported reduction");
      layer(m2, point.layer);
    }
  }
  const segments = [];
  for (let i = 1; i < route.length; i++) {
    const a2 = route[i - 1], b = route[i];
    if (b.route_type === "via") {
      if (a2.route_type !== "wire" || Math.hypot(b.x - a2.x, b.y - a2.y) > 1e-5 || a2.layer !== b.from_layer || b.from_layer === b.to_layer) fail("via_geometry", "Via must follow a co-located wire and continue its layer");
      if (b.hole_diameter !== void 0 && b.via_hole_diameter !== void 0 && b.hole_diameter !== b.via_hole_diameter) fail("via_geometry", "Conflicting current and legacy via hole diameters");
      const hole = b.hole_diameter ?? b.via_hole_diameter, plating = m2.viaPlatingMm, width = m2.viaEquivalentWidthMm;
      if (![hole, plating, width].every((value2) => typeof value2 === "number" && finite(value2) && value2 > 0)) fail("via_geometry", "Positive finite via hole, plating and equivalent width required");
      if (!m2.omitThroughViaStubs) fail("via_stub", "Select omitThroughViaStubs for routed vias");
      segments.push({
        a: [b.x, b.y, z4(m2, b.from_layer)],
        b: [b.x, b.y, z4(m2, b.to_layer)],
        widthMm: width,
        thicknessMm: Math.PI * ((hole / 2 + plating) ** 2 - (hole / 2) ** 2) / width
      });
    } else {
      const name = a2.route_type === "via" ? a2.to_layer : a2.layer, l = layer(m2, name);
      if (b.layer !== name || !Number.isFinite(b.width) || b.width <= 0) fail("route_geometry", "Continuous layer and positive width required");
      if (Math.hypot(b.x - a2.x, b.y - a2.y) > 1e-10) segments.push({ a: [a2.x, a2.y, z4(m2, name)], b: [b.x, b.y, z4(m2, name)], widthMm: b.width, thicknessMm: l.zMaxMm - l.zMinMm, conductivitySm: l.conductivitySm });
    }
  }
  if (!segments.length || segments.some((s) => ![...s.a, ...s.b, s.widthMm, s.thicknessMm].every(finite))) fail("route_geometry", "Nonempty finite copper path required");
  for (let i = 1; i < segments.length; i++) if (distance(segments[i - 1].b, segments[i].a) > 1e-5) fail("route_geometry", "Disconnected copper route");
  return { segments, terminals: [segments[0].a, segments.at(-1).b] };
}
function groundConnection(circuit, m2, portId, netIds, pours) {
  const ports = circuit.filter((e) => e.type === "pcb_port").filter((e) => e.source_port_id === portId);
  if (ports.length !== 1 || ports[0].layers.length !== 1) fail("ground_connection", `${portId}: one PCB reference port/layer required`);
  const port = ports[0], start = [port.x, port.y, z4(m2, port.layers[0])];
  if (![port.x, port.y].every(finite)) fail("ground_connection", `${portId}: finite physical reference coordinates required`);
  if (pours.some((p2) => p2.layer === port.layers[0] && contains([port.x, port.y], p2.polygon))) {
    const pads = circuit.filter((e) => e.type === "pcb_smtpad").filter((e) => e.pcb_port_id === port.pcb_port_id);
    if (pads.length !== 1) fail("ground_connection", `${portId}: reference contact needs one physical copper pad`);
    const pad = pads[0], radius = pad.shape === "circle" ? pad.radius : Math.min(Number(Reflect.get(pad, "width")), Number(Reflect.get(pad, "height"))) / 2;
    if (!Number.isFinite(radius) || radius <= 0) fail("ground_connection", `${portId}: reference pad requires a finite contact area`);
    return { segments: [], terminals: [start, start], contactRadiusMm: radius };
  }
  const traceIds = new Set(circuit.filter((e) => e.type === "source_trace").filter((e) => e.connected_source_port_ids.includes(portId) && e.connected_source_net_ids?.some((id2) => netIds.has(id2))).map((e) => e.type === "source_trace" ? e.source_trace_id : ""));
  const traces = circuit.filter((e) => e.type === "pcb_trace").filter((e) => traceIds.has(e.source_trace_id ?? ""));
  if (traces.length !== 1) fail("ground_connection", `${portId}: require one routed ground lead to a reference via/pour`);
  let route = traces[0].route;
  if (!Array.isArray(route) || route.length < 2) fail("ground_connection", `${portId}: reference lead requires a complete physical route`);
  if (Math.hypot(route[0].x - port.x, route[0].y - port.y) > 1e-5) route = [...route].reverse().map((p2) => p2.route_type === "via" ? { ...p2, from_layer: p2.to_layer, to_layer: p2.from_layer } : p2);
  if (Math.hypot(route[0].x - port.x, route[0].y - port.y) > 1e-5) fail("ground_connection", `${portId}: reference route does not start at its physical pad`);
  const first = route[0];
  if (first.route_type !== "wire" || first.layer !== port.layers[0]) fail("ground_connection", `${portId}: reference route must start on its physical pad layer`);
  for (const key of ["start_pcb_port_id", "end_pcb_port_id"]) if (first[key] && first[key] !== port.pcb_port_id) fail("ground_connection", `${portId}: reference route endpoint metadata disagrees with its physical pad`);
  const end = route.at(-1);
  let contactRadiusMm;
  if (end.route_type !== "wire") fail("ground_connection", `${portId}: ground lead must end on a wire layer`);
  if (!pours.some((p2) => p2.layer === end.layer && contains([end.x, end.y], p2.polygon))) {
    const vias = circuit.filter((e) => e.type === "pcb_via").filter((e) => e.source_net_id && netIds.has(e.source_net_id) && e.layers.includes(end.layer) && Math.hypot(e.x - end.x, e.y - end.y) < 1e-5);
    const targets = vias.flatMap((via2) => pours.filter((p2) => via2.layers.some((name) => name === p2.layer) && contains([via2.x, via2.y], p2.polygon)).map((p2) => ({ via: via2, pour: p2 })));
    if (targets.length !== 1) fail("ground_connection", `${portId}: reference via must connect unambiguously to actual ground copper`);
    const { via, pour } = targets[0];
    if (!finite(via.outer_diameter) || !finite(via.hole_diameter) || via.hole_diameter <= 0 || via.outer_diameter <= via.hole_diameter) fail("via_geometry", `${portId}: reference via needs a positive hole and larger finite copper diameter`);
    contactRadiusMm = via.outer_diameter / 2;
    if (!m2.omitThroughViaStubs) fail("via_stub", "Select omitThroughViaStubs for the reference lead");
    route = [...route, { route_type: "via", x: end.x, y: end.y, from_layer: end.layer, to_layer: pour.layer, hole_diameter: via.hole_diameter }];
  } else contactRadiusMm = end.width / 2;
  const path = routePath(route, m2);
  if (!pours.some((p2) => Math.abs((p2.zMinMm + p2.zMaxMm) / 2 - path.terminals[1][2]) < 1e-8 && contains(path.terminals[1].slice(0, 2), p2.polygon))) fail("ground_connection", `${portId}: reference lead misses ground copper`);
  return { ...path, contactRadiusMm };
}
function routedCopperGeometry(circuit, m2, mappings) {
  const reference2 = selectPort(circuit, m2.channelReference).source_port_id, connected = connectedSourceIds(circuit, reference2);
  const groundNets = circuit.filter((e) => e.type === "source_net").filter((e) => e.is_ground && connected.has(e.source_net_id));
  if (groundNets.length !== 1) fail("ground_net", "The channel reference must connect to exactly one source_net marked is_ground");
  const net = groundNets[0], netIds = new Set(circuit.filter((e) => e.type === "source_net").filter((e) => connected.has(e.source_net_id)).map((e) => e.type === "source_net" ? e.source_net_id : ""));
  const pours = circuit.filter((e) => e.type === "pcb_copper_pour").filter((e) => netIds.has(e.source_net_id ?? "")).map((pour) => {
    if (pour.shape !== "brep") fail("ground_geometry", `${pour.pcb_copper_pour_id}: polygon BREP copper required`);
    const rings = [pour.brep_shape.outer_ring, ...pour.brep_shape.inner_rings];
    const polygon = rings.map((ring, i) => {
      const points2 = ring.vertices.map((p2) => [p2.x, p2.y]);
      if (points2.length < 3 || points2.some((p2) => !p2.every(finite)) || Math.abs(area(points2)) < 1e-12) fail("ground_geometry", "Ground copper requires finite, nonzero polygon rings");
      if (ring.vertices.some((p2) => "bulge" in p2 && p2.bulge)) fail("ground_geometry", "Curved copper edges require tessellation");
      return area(points2) * (i ? -1 : 1) > 0 ? points2 : points2.reverse();
    });
    return { pcbCopperPourId: pour.pcb_copper_pour_id, layer: pour.layer, polygon, ...layer(m2, pour.layer) };
  });
  if (!pours.length) fail("ground_geometry", `${net.name}: no physical ground copper pours found`);
  let receiver;
  if (m2.groundReturn) receiver = selectPort(circuit, m2.groundReturn).source_port_id;
  else {
    const candidates = /* @__PURE__ */ new Set();
    for (const lane of mappings) for (const model of circuit.filter((e) => e.type === "simulation_ibis_model")) {
      for (const [pin, id2] of Object.entries(model.ibis_pin_name_to_source_port_id)) if (id2 === lane.to) {
        const refs = model.ibis_pin_name_to_reference_source_port_ids?.[pin];
        for (const id3 of [refs?.pulldown_reference_source_port_id, refs?.ground_clamp_reference_source_port_id]) if (id3 && connected.has(id3)) candidates.add(id3);
      }
    }
    if (candidates.size !== 1) fail("ground_reference", "Receiver IBIS bindings must identify one ground reference; otherwise set groundReturn");
    receiver = [...candidates][0];
  }
  if (!connected.has(receiver) || receiver === reference2) fail("ground_reference", "Distinct driver/receiver ground pins must connect to the same ground net");
  const signals = mappings.map((mapping) => routePath(mapping.originalRoute, m2));
  const connections = [reference2, receiver].map((id2) => groundConnection(circuit, m2, id2, netIds, pours));
  const terminalPours = connections.map((path) => pours.find((p2) => Math.abs((p2.zMinMm + p2.zMaxMm) / 2 - path.terminals[1][2]) < 1e-8 && contains(path.terminals[1].slice(0, 2), p2.polygon)));
  if (!terminalPours[0] || terminalPours[0] !== terminalPours[1]) fail("ground_connectivity", "Reference leads must reach one connected pour; inter-pour stitching extraction is not supported");
  const routedCopper = { sourceNetId: net.source_net_id, sourceNetName: net.name, referenceSourcePortIds: [reference2, receiver], pours, signals, connections };
  const conductors = signals.map((path, i) => ({
    name: `sig${i}`,
    lengthM: path.segments.reduce((s, p2) => s + distance(p2.a, p2.b), 0) / 1e3,
    widthM: Math.min(...path.segments.map((s) => s.widthMm)) / 1e3,
    thicknessM: Math.min(...path.segments.map((s) => s.thicknessMm)) / 1e3,
    yM: path.terminals[0][1] / 1e3,
    zM: path.terminals[0][2] / 1e3
  }));
  conductors.push({
    name: "return",
    lengthM: distance(connections[0].terminals[0], connections[1].terminals[0]) / 1e3,
    widthM: 0,
    thicknessM: (pours[0].zMaxMm - pours[0].zMinMm) / 1e3,
    yM: 0,
    zM: (pours[0].zMaxMm + pours[0].zMinMm) / 2e3
  });
  return {
    mappings,
    cells: [{ stage: 0, profile: "routed-copper", conductivitySm: m2.conductivitySm, relativePermittivity: m2.relativePermittivity, conductors, routedCopper }],
    units: { circuitJson: "mm", geometry: "m", conductivity: "S/m" },
    approximations: [
      "Original routed signal coordinates and net-connected ground copper boundaries/cutouts; copper heights/thicknesses from stackup",
      "FastHenry ground polygons discretized into an adaptive rectangular conductor mesh; cutout boundaries rasterized and edge strips have mesh-dependent boundary extension; finite reference contact areas resolved locally; ground mesh and filaments refined together",
      "FasterCap uses closed polygon solids, preserving pour cutouts; ground islands on the same electrical net treated as equipotential",
      "Only the driver and receiver reference leads/vias are extracted; other ground routing, reference stitching and package/PDN impedance omitted",
      "Via rectangular equivalent preserves plated barrel metal area; pads and unused through-via stubs omitted; wire joins rounded",
      "Homogeneous explicit effective permittivity; other power copper, neighboring unselected nets, dielectric loss and copper roughness omitted",
      "Whole routed network R/L/C distributed into uniform pi sections; constant R/L at modelHz; broadband dispersion and spatially varying transmission-line parameters not fitted"
    ]
  };
}
function groundMesh(pour, meshMm, contacts, contactDivisions = 2) {
  const points2 = [], edges = [], indices = /* @__PURE__ */ new Map();
  const node = (x2, y2) => {
    const key = `${x2.toFixed(10)},${y2.toFixed(10)}`;
    let index2 = indices.get(key);
    if (index2 === void 0) {
      index2 = points2.length;
      indices.set(key, index2);
      points2.push([x2, y2]);
    }
    return index2;
  };
  const lines2 = /* @__PURE__ */ new Map();
  const add = (horizontal, fixed, a2, b, width) => {
    const key = `${horizontal}:${fixed.toFixed(10)}`;
    if (!lines2.has(key)) lines2.set(key, { horizontal, fixed, intervals: [] });
    lines2.get(key).intervals.push([a2, b, width]);
  };
  const ring = pour.polygon[0], xs = ring.map((p2) => p2[0]), ys = ring.map((p2) => p2[1]);
  const boundary = pour.polygon.flatMap((r) => r.map((a2, i) => ({ a: a2, b: r[(i + 1) % r.length] })));
  const visit = (x0, y0, x1, y1, borders, depth) => {
    const crosses = borders.filter(({ a: a2, b }) => Math.max(a2[0], b[0]) > x0 + 1e-9 && Math.min(a2[0], b[0]) < x1 - 1e-9 && Math.max(a2[1], b[1]) > y0 + 1e-9 && Math.min(a2[1], b[1]) < y1 - 1e-9);
    const center = [(x0 + x1) / 2, (y0 + y1) / 2], inside = contains(center, pour.polygon), size = Math.max(x1 - x0, y1 - y0);
    if (!crosses.length && !inside) return;
    let target = crosses.length ? meshMm / 4 : meshMm;
    for (const c2 of contacts) {
      const dx = Math.max(x0 - c2.point[0], 0, c2.point[0] - x1), dy = Math.max(y0 - c2.point[1], 0, c2.point[1] - y1);
      if (Math.hypot(dx, dy) < c2.radius) target = Math.min(target, c2.radius / contactDivisions);
    }
    if (size > target && depth < 28) {
      if (x1 - x0 >= y1 - y0) {
        const mid = (x0 + x1) / 2;
        visit(x0, y0, mid, y1, crosses, depth + 1);
        visit(mid, y0, x1, y1, crosses, depth + 1);
      } else {
        const mid = (y0 + y1) / 2;
        visit(x0, y0, x1, mid, crosses, depth + 1);
        visit(x0, mid, x1, y1, crosses, depth + 1);
      }
    } else if (inside && !crosses.length) {
      add(true, y0, x0, x1, (y1 - y0) / 2);
      add(true, y1, x0, x1, (y1 - y0) / 2);
      add(false, x0, y0, y1, (x1 - x0) / 2);
      add(false, x1, y0, y1, (x1 - x0) / 2);
    }
  };
  visit(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), boundary, 0);
  for (const line of lines2.values()) {
    const events = /* @__PURE__ */ new Map();
    for (const [a2, b, w2] of line.intervals) {
      events.set(a2, (events.get(a2) ?? 0) + w2);
      events.set(b, (events.get(b) ?? 0) - w2);
    }
    const positions = [...events.keys()].sort((a2, b) => a2 - b);
    let width = 0;
    for (let i = 0; i < positions.length - 1; i++) {
      const a2 = positions[i], b = positions[i + 1];
      width += events.get(a2);
      if (width > 1e-10 && b - a2 > 1e-10) edges.push([line.horizontal ? node(a2, line.fixed) : node(line.fixed, a2), line.horizontal ? node(b, line.fixed) : node(line.fixed, b), width]);
    }
  }
  const groups = contacts.map((c2) => points2.flatMap((p2, i) => Math.hypot(p2[0] - c2.point[0], p2[1] - c2.point[1]) <= c2.radius ? [i] : []));
  if (groups.some((g2) => g2.length < 4)) fail("ground_mesh", "Reference contact area is unresolved; decrease extraction.groundMeshMm");
  const parents = points2.map((_2, i) => i), root = (i) => parents[i] === i ? i : parents[i] = root(parents[i]);
  for (const [a2, b] of edges) parents[root(a2)] = root(b);
  if (groups.length > 1 && groups.some((g2) => root(g2[0]) !== root(groups[0][0]))) fail("ground_mesh", "Ground mesh disconnects reference contacts; decrease extraction.groundMeshMm");
  return { points: points2, edges, contacts: groups };
}
function copperFastHenryDeck(cell, extraction) {
  const copper = cell.routedCopper, mesh = extraction.groundMeshMm;
  const lines2 = ["* Actual routed signals and inferred ground copper; dimensions in metres", ".units m", `.default sigma=${cell.conductivitySm} nhinc=${extraction.filaments} nwinc=${extraction.filaments}`];
  const coordinates = (p2) => `x=${p2[0] / 1e3} y=${p2[1] / 1e3} z=${p2[2] / 1e3}`;
  let serial = 0;
  const path = (p2, a2, b) => {
    if (!p2.segments.length) {
      lines2.push(`${a2} ${coordinates(p2.terminals[0])}`);
      if (a2 !== b) lines2.push(`${b} ${coordinates(p2.terminals[0])}`, `.equiv ${a2} ${b}`);
      return;
    }
    const names = [a2, ...p2.segments.slice(1).map(() => `Nt${serial++}`), b];
    lines2.push(`${names[0]} ${coordinates(p2.segments[0].a)}`);
    for (const [i, s] of p2.segments.entries()) {
      lines2.push(`${names[i + 1]} ${coordinates(s.b)}`);
      const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], horizontal = Math.hypot(dx, dy);
      lines2.push(`E${serial++} ${names[i]} ${names[i + 1]} w=${s.widthMm / 1e3} h=${s.thicknessMm / 1e3} sigma=${s.conductivitySm ?? cell.conductivitySm} wx=${horizontal ? -dy / horizontal : 1} wy=${horizontal ? dx / horizontal : 0} wz=0`);
    }
  };
  copper.signals.forEach((p2, i) => path(p2, `N${i}a`, `N${i}b`));
  const n = copper.signals.length;
  copper.connections.forEach((p2, i) => path(p2, `N${n}${i ? "b" : "a"}`, `Ng${i}`));
  for (const [index2, pour] of copper.pours.entries()) {
    const contacts = copper.connections.map((p2, i) => ({ p: p2, i })).filter(({ p: p2 }) => Math.abs((pour.zMinMm + pour.zMaxMm) / 2 - p2.terminals[1][2]) < 1e-8 && contains(p2.terminals[1].slice(0, 2), pour.polygon));
    const ground = groundMesh(pour, mesh, contacts.map(({ p: p2 }) => ({ point: p2.terminals[1].slice(0, 2), radius: p2.contactRadiusMm })), Math.max(2, Math.ceil(Math.sqrt(extraction.filaments))));
    const zz = (pour.zMinMm + pour.zMaxMm) / 2e3, thickness = (pour.zMaxMm - pour.zMinMm) / 1e3;
    lines2.push(`* ${pour.pcbCopperPourId} layer=${pour.layer} cutouts=${pour.polygon.length - 1} meshMm=${mesh}`);
    ground.points.forEach((p2, j) => lines2.push(`Np${index2}_${j} x=${p2[0] / 1e3} y=${p2[1] / 1e3} z=${zz}`));
    ground.edges.forEach(([a2, b, width], j) => {
      const [u5, v2] = [ground.points[a2], ground.points[b]], dx = v2[0] - u5[0], dy = v2[1] - u5[1], length2 = Math.hypot(dx, dy);
      lines2.push(`Eg${index2}_${j} Np${index2}_${a2} Np${index2}_${b} w=${width / 1e3} h=${thickness} sigma=${pour.conductivitySm ?? cell.conductivitySm} wx=${-dy / length2} wy=${dx / length2} wz=0 nwinc=1 nhinc=${extraction.filaments}`);
    });
    contacts.forEach(({ i }, j) => ground.contacts[j].forEach((id2) => lines2.push(`.equiv Ng${i} Np${index2}_${id2}`)));
  }
  for (let i = 0; i <= n; i++) lines2.push(`.external N${i}a N${i}b`);
  lines2.push(`.freq fmin=${extraction.minimumHz} fmax=${extraction.maximumHz} ndec=1`, ".end");
  return lines2.join("\n") + "\n";
}
function pathSolids(path) {
  const solids = [];
  for (const s of path.segments) {
    const [x2, y2, zz] = s.a, [xx, yy, zzz] = s.b, length2 = Math.hypot(xx - x2, yy - y2);
    if (!length2) {
      const w2 = s.widthMm / 2, h = s.thicknessMm / 2;
      solids.push({ polygon: [[[x2 - w2, y2 - h], [x2 + w2, y2 - h], [x2 + w2, y2 + h], [x2 - w2, y2 + h]]], zMinMm: Math.min(zz, zzz), zMaxMm: Math.max(zz, zzz) });
    } else {
      const dx = -(yy - y2) * s.widthMm / (2 * length2), dy = (xx - x2) * s.widthMm / (2 * length2);
      const limits = { zMinMm: zz - s.thicknessMm / 2, zMaxMm: zz + s.thicknessMm / 2 };
      solids.push({ polygon: [[[x2 + dx, y2 + dy], [x2 - dx, y2 - dy], [xx - dx, yy - dy], [xx + dx, yy + dy]]], ...limits });
      for (const p2 of [s.a, s.b]) solids.push({ polygon: [Array.from({ length: 16 }, (_2, i) => [p2[0] + s.widthMm / 2 * Math.cos(2 * Math.PI * i / 16), p2[1] + s.widthMm / 2 * Math.sin(2 * Math.PI * i / 16)])], ...limits });
    }
  }
  return solids;
}
var copperEpsilonMm = 1e-8;
function cleanPolygons(polygons) {
  const result = [];
  for (const polygon of polygons) {
    const rings = [];
    for (const ring of polygon) {
      let points2 = ring.slice(0, -1).filter((p2, i) => i === 0 || Math.hypot(p2[0] - ring[i - 1][0], p2[1] - ring[i - 1][1]) > copperEpsilonMm);
      let changed = true;
      while (changed && points2.length >= 3) {
        changed = false;
        points2 = points2.filter((p2, i) => {
          const a2 = points2[(i + points2.length - 1) % points2.length], b = points2[(i + 1) % points2.length];
          const u5 = [p2[0] - a2[0], p2[1] - a2[1]], v2 = [b[0] - p2[0], b[1] - p2[1]];
          const length2 = Math.max(Math.hypot(...u5), Math.hypot(...v2)), cross = Math.abs(u5[0] * v2[1] - u5[1] * v2[0]);
          const remove = length2 === 0 || cross <= copperEpsilonMm * length2 && u5[0] * v2[0] + u5[1] * v2[1] >= -(copperEpsilonMm ** 2);
          if (remove) changed = true;
          return !remove;
        });
      }
      if (points2.length >= 3 && Math.abs(area(points2)) > copperEpsilonMm ** 2) rings.push(closed(points2));
      else if (rings.length === 0) break;
    }
    if (rings.length) result.push(rings);
  }
  return result;
}
function surfacePanels(solids, name) {
  const levels = [...new Set(solids.flatMap((s) => [s.zMinMm, s.zMaxMm]))].sort((a2, b) => a2 - b), rows = ["* Closed union of actual copper polygons; millimetres; physical capacitance = raw matrix * 0.001"];
  const polygon = (p2) => p2.map(closed);
  const slabs = levels.slice(1).map((high, i) => {
    const low = levels[i], active = solids.filter((s) => s.zMinMm < high - 1e-10 && s.zMaxMm > low + 1e-10);
    return active.length ? cleanPolygons(index.union(polygon(active[0].polygon), ...active.slice(1).map((s) => polygon(s.polygon)))) : [];
  });
  const emit = (kind, pts) => rows.push(`${kind} ${name} ${pts.flat().join(" ")}`);
  const face = (polys, zz, up) => {
    for (const p2 of cleanPolygons(polys)) {
      const rings = p2.map((r) => r.slice(0, -1)), points2 = rings.flat(), starts = [];
      let count = rings[0].length;
      for (const r of rings.slice(1)) {
        starts.push(count);
        count += r.length;
      }
      const flat = points2.flat(), indices = earcut(flat, starts);
      refine(indices, flat);
      const polygonArea = Math.abs(area(rings[0])) - rings.slice(1).reduce((s, r) => s + Math.abs(area(r)), 0);
      let trianglesArea = 0;
      for (let i = 0; i < indices.length; i += 3) {
        const triangle = indices.slice(i, i + 3).map((index2) => points2[index2]);
        trianglesArea += Math.abs(area(triangle));
        if (area(triangle) > 0 !== up) triangle.reverse();
        emit("T", triangle.map((p3) => [p3[0], p3[1], zz]));
      }
      if (Math.abs(trianglesArea - polygonArea) > Math.max(1e-8, polygonArea * 1e-8)) fail("copper_surface", "Copper triangulation does not preserve polygon area/cutouts");
    }
  };
  for (let i = 0; i < slabs.length; i++) {
    const slab = slabs[i], previous = slabs[i - 1] ?? [], next = slabs[i + 1] ?? [];
    if (!slab.length) continue;
    face(previous.length ? index.difference(slab, previous) : slab, levels[i], false);
    face(next.length ? index.difference(slab, next) : slab, levels[i + 1], true);
    for (const p2 of slab) for (const ring of p2) for (let j = 1; j < ring.length; j++) {
      const a2 = ring[j - 1], b = ring[j];
      emit("Q", [[a2[0], a2[1], levels[i]], [b[0], b[1], levels[i]], [b[0], b[1], levels[i + 1]], [a2[0], a2[1], levels[i + 1]]]);
    }
  }
  return rows.join("\n") + "\n";
}
function copperFasterCapDeck(cell) {
  const copper = cell.routedCopper, files = {}, list = ["* Actual routed copper in millimetres; physical capacitance = raw matrix * 0.001; homogeneous dielectric"];
  const solids = [...copper.signals.map(pathSolids), [...copper.pours, ...copper.connections.flatMap(pathSolids)]];
  solids.forEach((pieces, i) => {
    const name = i === copper.signals.length ? "return" : `sig${i}`;
    files[`${name}.txt`] = surfacePanels(pieces, name);
    list.push(`C ${name}.txt ${cell.relativePermittivity} 0 0 0`);
  });
  files["channel.lst"] = list.join("\n") + "\n";
  return files;
}

// src/geometry.ts
var positive2 = (v2, label2) => {
  if (typeof v2 !== "number" || !Number.isFinite(v2) || v2 <= 0) fail("modeling_input", `${label2} must be a positive number`);
  return v2;
};
var finite2 = (v2, label2) => {
  if (typeof v2 !== "number" || !Number.isFinite(v2)) fail("modeling_input", `${label2} must be explicit and finite`);
  return v2;
};
function validateModeling(m2) {
  if (!["straightened-stages", "routed-copper"].includes(m2.reduction)) fail("reduction", "Select straightened-stages or routed-copper");
  if (!Array.isArray(m2.lanes) || ![1, 2, 3].includes(m2.lanes.length)) fail("lanes", "One to three explicit source/receiver lanes are supported");
  for (const [i, l] of m2.lanes.entries()) if (!l.port || !l.from || !l.to) fail("pin_mapping", `Lane ${i}: port/from/to mappings required`);
  if (new Set(m2.lanes.map((l) => l.port)).size !== m2.lanes.length) fail("pin_mapping", "Lane port labels must be distinct");
  if (m2.reduction === "routed-copper") {
    positive2(m2.relativePermittivity, "relativePermittivity (homogeneous dielectric approximation)");
    positive2(m2.extraction?.groundMeshMm, "extraction.groundMeshMm");
  } else if (!m2.profiles) fail("return_geometry", "Explicit profiles with reference conductor geometry and permittivity required");
  for (const [name, p2] of Object.entries(m2.reduction === "routed-copper" ? {} : m2.profiles)) {
    positive2(p2.spacingMm, `${name} spacingMm`);
    positive2(p2.relativePermittivity, `${name} relativePermittivity`);
    if (!p2.return) fail("return_geometry", `${name}: explicit finite return required`);
    for (const key of ["widthMm", "thicknessMm", "lengthFactor"]) positive2(p2.return[key], `${name}.return.${key}`);
    finite2(p2.return.centerYMm, `${name}.return.centerYMm`);
    finite2(p2.return.centerZMm, `${name}.return.centerZMm`);
  }
  if (!m2.extraction) fail("extraction", "Explicit mesh/frequency/model settings required");
  for (const key of ["minimumHz", "maximumHz", "modelHz", "filaments", "refinementFilaments", "convergenceTolerance", "capTolerance", "maxPanelLengthMm", "reciprocityTolerance", "dcResistanceTolerance"]) positive2(m2.extraction[key], `extraction.${key}`);
  if (m2.extraction.minimumHz > m2.extraction.modelHz || m2.extraction.modelHz > m2.extraction.maximumHz || !Number.isInteger(m2.extraction.filaments)) fail("extraction", "Require minimumHz <= modelHz <= maximumHz and integer filaments");
  if (!Number.isInteger(m2.extraction.refinementFilaments) || m2.extraction.refinementFilaments <= m2.extraction.filaments) fail("extraction", "Integer refinementFilaments must exceed filaments");
  if (!Number.isInteger(m2.sections) || m2.sections < 1 || m2.sections > 128) fail("sections", "sections must be an integer 1..128");
}
function selectPort(cj, s) {
  if (!s) fail("pin_mapping", "Explicit physical source port selector required");
  if (s.sourcePortId) {
    const ports2 = cj.filter((e) => e.type === "source_port" && e.source_port_id === s.sourcePortId);
    if (ports2.length !== 1) fail("pin_mapping", `${s.sourcePortId}: expected one source port, got ${ports2.length}`);
    return ports2[0];
  }
  const components = cj.filter((e) => e.type === "source_component").filter((e) => e.name === s.component);
  if (components.length !== 1) fail("pin_mapping", `${s.component}: expected one source component, got ${components.length}; use sourcePortId in repeated scopes`);
  const component = components[0];
  const ports = cj.filter((e) => e.type === "source_port").filter((e) => e.source_component_id === component.source_component_id && (e.port_hints?.includes(s.port ?? "") || e.name === s.port || `pin${e.pin_number}` === s.port));
  if (ports.length !== 1) fail("pin_mapping", `${s.component}.${s.port}: expected one source port, got ${ports.length}`);
  return ports[0];
}
function geometryFromCircuitJson(cj, modeling) {
  if (!Array.isArray(cj)) fail("circuit_json", "Expected a Circuit JSON element array, not a mesh-preparation object");
  const stackup = stackupFromCircuitJson(cj);
  for (const key of ["stackup", "conductivitySm", "copperLayers"]) if (key in modeling)
    fail("modeling_input", `Remove modeling.${key}; physical construction comes from Circuit JSON pcb_stackup`);
  const m2 = {
    ...modeling,
    stackup: stackup.copperLayers,
    conductivitySm: defaultCopperConductivitySm,
    relativePermittivity: modeling.relativePermittivity ?? stackup.relativePermittivity,
    viaPlatingMm: modeling.viaPlatingMm ?? stackup.viaPlatingMm
  };
  validateModeling(m2);
  const routes = [], mappings = [];
  const selectedTraces = /* @__PURE__ */ new Set(), selectedPorts = /* @__PURE__ */ new Set();
  for (const lane of m2.lanes) {
    const from = selectPort(cj, lane.from), to = selectPort(cj, lane.to);
    if (from.source_port_id === to.source_port_id || [from.source_port_id, to.source_port_id].some((id2) => selectedPorts.has(id2))) fail("pin_mapping", `${lane.port}: selected lanes require distinct physical source and receiver ports`);
    selectedPorts.add(from.source_port_id);
    selectedPorts.add(to.source_port_id);
    const sources = cj.filter((e) => e.type === "source_trace").filter((e) => lane.sourceTraceId ? e.source_trace_id === lane.sourceTraceId : e.connected_source_port_ids?.includes(from.source_port_id) && e.connected_source_port_ids?.includes(to.source_port_id));
    if (sources.length !== 1) fail("route_selection", `${lane.port}: expected one source trace; specify sourceTraceId`);
    const src = sources[0];
    if (!src.connected_source_port_ids?.includes(from.source_port_id) || !src.connected_source_port_ids?.includes(to.source_port_id)) fail("pin_mapping", `${lane.port}: selected trace does not connect requested source ports`);
    if (src.connected_source_port_ids.length !== 2) fail("route_selection", `${lane.port}: fan-out is unsupported; selected trace must connect exactly the two requested ports`);
    if (selectedTraces.has(src.source_trace_id)) fail("route_selection", `${lane.port}: selected lanes must use distinct source traces`);
    selectedTraces.add(src.source_trace_id);
    const traces = cj.filter((e) => e.type === "pcb_trace").filter((e) => e.source_trace_id === src.source_trace_id);
    if (traces.length !== 1) fail("route_selection", `${lane.port}: expected one complete PCB route, got ${traces.length}`);
    const original = traces[0].route;
    if (!Array.isArray(original) || original.length < 2) fail("empty_route", `${lane.port}: at least two routed vertices required`);
    let route = original.map((p2, i) => {
      if (p2.route_type !== "wire" && p2.route_type !== "via") fail("route_type", "Only wire/via routed primitives supported");
      finite2(p2.x, `${lane.port} route[${i}].x`);
      finite2(p2.y, `${lane.port} route[${i}].y`);
      if (p2.route_type === "wire") {
        positive2(p2.width, `${lane.port} route[${i}].width`);
        if (p2.start_width !== void 0 || p2.end_width !== void 0 || p2.width_interpolation_mode !== void 0) fail("varying_width", "Tapered routes are not supported by the straightened-stage reduction");
      }
      return p2;
    });
    if (route[0].route_type !== "wire" || route[route.length - 1].route_type !== "wire") fail("route_type", "Routed endpoints must be wire vertices at the selected PCB ports");
    const ports = [from, to].map((p2) => {
      const matches2 = cj.filter((e) => e.type === "pcb_port").filter((e) => e.source_port_id === p2.source_port_id);
      if (matches2.length !== 1) fail("pin_mapping", `${lane.port}: expected one PCB port for ${p2.source_port_id}, got ${matches2.length}`);
      return matches2[0];
    });
    for (const p2 of ports) {
      finite2(p2.x, `${p2.pcb_port_id}.x`);
      finite2(p2.y, `${p2.pcb_port_id}.y`);
    }
    const matches = (a2, p2) => Math.hypot(a2.x - p2.x, a2.y - p2.y) < 1e-5;
    if (matches(route[0], ports[1]) && matches(route[route.length - 1], ports[0])) route = [...route].reverse().map((p2) => p2.route_type === "via" ? { ...p2, from_layer: p2.to_layer, to_layer: p2.from_layer } : p2);
    if (!matches(route[0], ports[0]) || !matches(route[route.length - 1], ports[1])) fail("endpoint_position", `${lane.port}: routed endpoints do not match selected physical source/receiver ports`);
    for (const [point, port] of [[route[0], ports[0]], [route[route.length - 1], ports[1]]]) {
      if (point.route_type === "wire" && !port.layers.includes(point.layer)) fail("endpoint_layer", `${lane.port}: route layer does not reach physical pad ${port.pcb_port_id}`);
      for (const key of ["start_pcb_port_id", "end_pcb_port_id"]) if (point.route_type === "wire" && point[key] && point[key] !== port.pcb_port_id) fail("stale_endpoint", `${lane.port}: ${key}=${point[key]} disagrees with ${port.pcb_port_id}; repair source metadata explicitly`);
    }
    const stages = [];
    const layer2 = (n) => {
      const l = m2.stackup.find((l2) => l2.name === n);
      if (!l) fail("stackup", `No copper z range for ${n}`);
      return l;
    };
    for (let i = 1; i < route.length; i++) {
      const a2 = route[i - 1], b = route[i];
      if (!["wire", "via"].includes(a2.route_type) || !["wire", "via"].includes(b.route_type)) fail("route_type", "Only wire/via routed primitives supported");
      const distance2 = Math.hypot(b.x - a2.x, b.y - a2.y);
      if (b.route_type === "via") {
        if (distance2 > 1e-5) fail("via_geometry", "Via must follow a co-located wire vertex");
        if (a2.route_type !== "wire" || a2.layer !== b.from_layer || b.from_layer === b.to_layer) fail("via_geometry", "Via must continue preceding wire layer and change layer");
        const la = layer2(b.from_layer), lb = layer2(b.to_layer);
        const plating = positive2(m2.viaPlatingMm, "viaPlatingMm (not recorded in ordinary Circuit JSON)"), width = positive2(m2.viaEquivalentWidthMm, "viaEquivalentWidthMm");
        if (!m2.omitThroughViaStubs) fail("via_stub", "This reduction requires explicit omitThroughViaStubs=true");
        if (b.hole_diameter !== void 0 && b.via_hole_diameter !== void 0 && b.hole_diameter !== b.via_hole_diameter) fail("via_geometry", "Conflicting current and legacy via hole diameter fields");
        const hole = positive2(b.hole_diameter ?? b.via_hole_diameter, "via_hole_diameter / hole_diameter");
        const area2 = Math.PI * ((hole / 2 + plating) ** 2 - (hole / 2) ** 2);
        const length2 = Math.abs((la.zMinMm + la.zMaxMm - lb.zMinMm - lb.zMaxMm) / 2);
        positive2(length2, "via active length");
        stages.push({ kind: "via", profile: "via", lengthMm: length2, widthMm: width, thicknessMm: area2 / width, holeMm: hole, platingMm: plating });
      } else if (distance2 > 1e-10) {
        const layerName = a2.route_type === "via" ? a2.to_layer : a2.layer;
        if (b.layer !== layerName) fail("layer_transition", "Layer change requires explicit via");
        const l = layer2(layerName), width = positive2(b.width, "route wire width");
        if (a2.route_type === "wire" && a2.width !== b.width) fail("varying_width", "Width transitions require explicit supported stage reduction");
        const last = stages.at(-1);
        if (last?.kind === "wire" && last.profile === layerName && last.widthMm === width) last.lengthMm += distance2;
        else stages.push({ kind: "wire", profile: layerName, lengthMm: distance2, widthMm: width, thicknessMm: l.zMaxMm - l.zMinMm, conductivitySm: l.conductivitySm });
      } else if (b.layer !== (a2.route_type === "via" ? a2.to_layer : a2.layer)) {
        fail("layer_transition", "Co-located layer change still requires explicit via");
      }
    }
    if (!stages.length) fail("empty_route", lane.port);
    routes.push(stages);
    mappings.push({ port: lane.port, sourceTraceId: src.source_trace_id, pcbTraceId: traces[0].pcb_trace_id, from: from.source_port_id, to: to.source_port_id, pcbPorts: ports.map((p2) => p2.pcb_port_id), stages, originalRoute: route });
  }
  if (m2.reduction === "routed-copper") return { ...routedCopperGeometry(cj, m2, mappings), stackup };
  if (routes.some((route) => route.length !== routes[0].length || route.some((s, i) => s.profile !== routes[0][i].profile))) fail("route_topology", "Selected routes must have identical ordered layer/via stage topology");
  const cells = routes[0].map((_2, i) => {
    const signals = routes.map((r) => r[i]), profile2 = m2.profiles[signals[0].profile];
    if (!profile2) fail("return_geometry", `Missing ${signals[0].profile} return/material profile`);
    const conductors = signals.map((s, j) => ({ name: `sig${j}`, lengthM: s.lengthMm / 1e3, widthM: s.widthMm / 1e3, thicknessM: s.thicknessMm / 1e3, conductivitySm: s.conductivitySm ?? defaultCopperConductivitySm, yM: (j - (signals.length - 1) / 2) * profile2.spacingMm / 1e3, zM: 0 }));
    conductors.push({ name: "return", lengthM: Math.max(...signals.map((s) => s.lengthMm)) / 1e3 * profile2.return.lengthFactor, widthM: profile2.return.widthMm / 1e3, thicknessM: profile2.return.thicknessMm / 1e3, conductivitySm: defaultCopperConductivitySm, yM: profile2.return.centerYMm / 1e3, zM: profile2.return.centerZMm / 1e3 });
    for (let a2 = 0; a2 < conductors.length; a2++) for (let b = a2 + 1; b < conductors.length; b++) if (Math.abs(conductors[a2].yM - conductors[b].yM) < (conductors[a2].widthM + conductors[b].widthM) / 2 && Math.abs(conductors[a2].zM - conductors[b].zM) < (conductors[a2].thicknessM + conductors[b].thicknessM) / 2) fail("conductor_overlap", `Stage ${i}: ${conductors[a2].name}/${conductors[b].name} overlap`);
    return { stage: i, profile: signals[0].profile, conductors, relativePermittivity: profile2.relativePermittivity, conductivitySm: m2.conductivitySm };
  });
  return { stackup, cells, mappings, units: { circuitJson: "mm", geometry: "m", conductivity: "S/m" }, approximations: ["Actual stage lengths, widths and ordered layer transitions from routed Circuit JSON; routes straightened within each stage", "Uniform declared signal center spacing per profile; actual varying route spacing is not extracted", "Finite parallel return bar per stage; isolated neutral conductor group, with ideal reference joins between stages", "Homogeneous explicit effective permittivity per stage; no dielectric loss, roughness, plane cutouts, unselected neighboring nets or bend coupling", "Via rectangle preserves assumed plated barrel metal area; pads and unconnected through-via stubs omitted", "Whole-stage matrices divided into uniform pi sections; constant R/L at modelHz; frequency dispersion not fitted"] };
}
function fastHenryDeck(cell, extraction) {
  if (cell.routedCopper) return copperFastHenryDeck(cell, extraction);
  const lines2 = [`* PCB pipeline: ${cell.conductors.length} primitive paths, all oriented +x`, ".units m", `.default sigma=${cell.conductivitySm} nhinc=${extraction.filaments} nwinc=${extraction.filaments}`];
  for (const [i, c2] of cell.conductors.entries()) lines2.push(`N${i}a x=0 y=${c2.yM} z=${c2.zM}`, `N${i}b x=${c2.lengthM} y=${c2.yM} z=${c2.zM}`, `E${i} N${i}a N${i}b w=${c2.widthM} h=${c2.thicknessM} sigma=${c2.conductivitySm ?? cell.conductivitySm} wx=0 wy=1 wz=0`);
  for (let i = 0; i < cell.conductors.length; i++) lines2.push(`.external N${i}a N${i}b`);
  lines2.push(`.freq fmin=${extraction.minimumHz} fmax=${extraction.maximumHz} ndec=1`, ".end");
  return lines2.join("\n") + "\n";
}
function fasterCapDeck(cell, extraction) {
  if (cell.routedCopper) return copperFasterCapDeck(cell);
  const files = {}, list = ["* 3D conductor surfaces; metres; homogeneous dielectric"];
  for (const c2 of cell.conductors) {
    const rows = ["* closed box conductor surface"], n = Math.ceil(c2.lengthM / (extraction.maxPanelLengthMm / 1e3));
    const y0 = c2.yM - c2.widthM / 2, y1 = c2.yM + c2.widthM / 2, z0 = c2.zM - c2.thicknessM / 2, z1 = c2.zM + c2.thicknessM / 2;
    const quad = (vs) => rows.push(`Q ${c2.name} ${vs.flat().join(" ")}`);
    for (let k2 = 0; k2 < n; k2++) {
      const a2 = c2.lengthM * k2 / n, b = c2.lengthM * (k2 + 1) / n;
      quad([[a2, y0, z0], [b, y0, z0], [b, y1, z0], [a2, y1, z0]]);
      quad([[a2, y1, z1], [b, y1, z1], [b, y0, z1], [a2, y0, z1]]);
      quad([[a2, y0, z1], [b, y0, z1], [b, y0, z0], [a2, y0, z0]]);
      quad([[a2, y1, z0], [b, y1, z0], [b, y1, z1], [a2, y1, z1]]);
    }
    quad([[0, y0, z0], [0, y1, z0], [0, y1, z1], [0, y0, z1]]);
    quad([[c2.lengthM, y0, z1], [c2.lengthM, y1, z1], [c2.lengthM, y1, z0], [c2.lengthM, y0, z0]]);
    files[`${c2.name}.txt`] = rows.join("\n") + "\n";
    list.push(`C ${c2.name}.txt ${cell.relativePermittivity} 0 0 0`);
  }
  files["channel.lst"] = list.join("\n") + "\n";
  return files;
}

// src/stimulus.ts
function transmittedBits(value2, code = "stimulus_pattern") {
  if ((Array.isArray(value2) || typeof value2 === "string") && value2.length > 65536)
    fail(code, "Transmission patterns must contain at most 65536 bits");
  if (Array.isArray(value2) && value2.length && Array.from(value2).every((bit) => bit === 0 || bit === 1)) return value2.join("");
  if (typeof value2 === "string" && /^[01]+$/.test(value2)) return value2;
  fail(code, "A nonempty binary string or array of numeric 0/1 bits is required");
}

// src/declarations.ts
var milliseconds = (value2, label2, { positive: positive3 = false } = {}) => {
  if (typeof value2 !== "number" || !Number.isFinite(value2) || (positive3 ? value2 <= 0 : value2 < 0)) fail("simulation_timing", `${label2}: finite ${positive3 ? "positive" : "nonnegative"} milliseconds required`);
  return value2 / 1e3;
};
var exactly = (items, label2) => {
  if (items.length !== 1) fail("simulation_reference", `${label2}: expected exactly one record, got ${items.length}`);
  return items[0];
};
function circuitNodes(circuit, geometry, modeling) {
  const parents = /* @__PURE__ */ new Map();
  const add = (id2) => {
    if (id2 && !parents.has(id2)) parents.set(id2, id2);
  };
  const find = (id2) => {
    const parent = parents.get(id2);
    if (parent === void 0) fail("simulation_reference", `Unknown source port/net ${id2}`);
    if (parent === id2) return id2;
    const root = find(parent);
    parents.set(id2, root);
    return root;
  };
  const union2 = (ids) => {
    for (const id2 of ids) add(id2);
    for (const id2 of ids.slice(1)) parents.set(find(id2), find(ids[0]));
  };
  for (const element of circuit) {
    if (element.type === "source_port") add(element.source_port_id);
    if (element.type === "source_net") add(element.source_net_id);
  }
  const channelTraces = new Set(geometry.mappings.map((mapping) => mapping.sourceTraceId));
  for (const trace of circuit.filter((e) => e.type === "source_trace")) {
    if (channelTraces.has(trace.source_trace_id)) continue;
    union2([...trace.connected_source_port_ids ?? [], ...trace.connected_source_net_ids ?? []]);
  }
  const ground = selectPort(circuit, modeling.channelReference).source_port_id, groundRoot = find(ground), names = /* @__PURE__ */ new Map([[groundRoot, "0"]]);
  const node = (id2) => {
    const root = find(id2), name = names.get(root) ?? `n${names.size}`;
    names.set(root, name);
    return name;
  };
  for (const id2 of parents.keys()) node(id2);
  for (const mapping of geometry.mappings) if (node(mapping.from) === node(mapping.to)) fail("channel_short", `${mapping.port}: extracted endpoints are shorted by another ideal source trace`);
  return { node, groundSourcePortId: ground, mapping: Object.fromEntries([...parents.keys()].map((id2) => [id2, node(id2)])) };
}
function generalDeclarations(circuit, geometry, modeling) {
  for (const type of ["simulation_experiment", "simulation_ibis_model", "simulation_voltage_probe", "simulation_eye_diagram", "source_port", "source_net", "source_component"]) {
    const seen = /* @__PURE__ */ new Set();
    for (const record of circuit.filter((e) => e.type === type)) {
      const id2 = Reflect.get(record, `${type}_id`);
      if (typeof id2 !== "string" || !id2) fail("simulation_reference", `${type}: nonempty identifier required`);
      if (seen.has(id2)) fail("simulation_reference", `Duplicate ${type} identifier ${id2}`);
      seen.add(id2);
    }
  }
  const errors = circuit.filter((e) => e.type === "source_invalid_component_property_error").filter((e) => ["ibisModel", "ibisPinStates", "probeRef", "simulationRef", "sourcePinRef", "bitDuration", "transmittedData"].includes(e.property_name));
  if (errors.length) fail("native_declaration", errors.map((e) => e.message).join("; "));
  const models = circuit.filter((e) => e.type === "simulation_ibis_model").map((model, i) => ({ ...model, pipelineId: model.simulation_ibis_model_id ?? `model-${i}` }));
  if (!models.length) fail("ibis_model", "At least one serialized native IBIS model required");
  const nodes = circuitNodes(circuit, geometry, modeling), ports = new Map(circuit.filter((e) => e.type === "source_port").map((e) => [e.source_port_id, e]));
  const groups = new Map(circuit.filter((e) => e.type === "source_group").map((e) => [e.source_group_id, e]));
  const components = circuit.filter((e) => e.type === "source_component");
  const componentScope = (id2) => {
    const component = components.find((e) => e.source_component_id === id2);
    if (!component) fail("simulation_scope", "Missing component for scoped physical port");
    if (component.subcircuit_id) return component.subcircuit_id;
    let groupId = component.source_group_id;
    const visited = /* @__PURE__ */ new Set();
    while (groupId) {
      if (visited.has(groupId)) fail("simulation_scope", "Cyclic source-group ownership");
      visited.add(groupId);
      const group = groups.get(groupId);
      if (!group) fail("simulation_scope", "Missing source group for modeled component");
      if (group.subcircuit_id) return group.subcircuit_id;
      groupId = group.parent_source_group_id;
    }
    return null;
  };
  for (const model of models) {
    const sourceComponent = exactly(components.filter((e) => e.source_component_id === model.source_component_id), `${model.pipelineId} component`);
    for (const refs of Object.values(model.ibis_pin_name_to_reference_source_port_ids ?? {}))
      for (const id2 of Object.values(refs)) if (id2 !== void 0 && (!ports.has(id2) || ports.get(id2)?.source_component_id !== sourceComponent.source_component_id)) fail("ibis_mapping", `${sourceComponent.name}: reference port points outside its chip`);
    for (const id2 of Object.values(model.ibis_pin_name_to_source_port_id ?? {})) if (!ports.has(id2) || ports.get(id2)?.source_component_id !== sourceComponent.source_component_id) fail("ibis_mapping", `${sourceComponent.name}: physical pin mapping points outside its chip`);
  }
  const declaredExperiments = circuit.filter((e) => e.type === "simulation_experiment");
  const declaredExperimentIds = new Set(declaredExperiments.map((experiment) => experiment.simulation_experiment_id));
  const experiments = declaredExperiments.filter((experiment) => experiment.spice_engine === "pcb_spice");
  if (!experiments.length) fail("simulation_experiment", "A transient experiment with spiceEngine=pcb_spice is required");
  const pcbExperimentIds = new Set(experiments.map((experiment) => experiment.simulation_experiment_id));
  if (experiments.some((experiment) => experiment.experiment_type !== "spice_transient_analysis") || circuit.some((e) => e.type === "simulation_parameter_sweep" && pcbExperimentIds.has(e.simulation_experiment_id))) fail("simulation_capability", "This PCB backend supports unswept transient experiments only");
  const ids = /* @__PURE__ */ new Set();
  const plans = experiments.map((experiment) => {
    const id2 = experiment.simulation_experiment_id;
    if (!id2 || ids.has(id2)) fail("simulation_experiment", "Experiment IDs must be unique");
    ids.add(id2);
    const scopes = new Set(models.map((model) => componentScope(model.source_component_id)));
    const scope = experiment.subcircuit_id ?? (scopes.size === 1 ? [...scopes][0] : void 0);
    if (scope === void 0) fail("simulation_scope", `${experiment.name}: multiple modeled subcircuits require an explicit experiment scope`);
    const scopedModels = models.filter((model) => componentScope(model.source_component_id) === scope);
    if (!scopedModels.length) fail("simulation_scope", `${experiment.name}: no models in its explicit subcircuit scope`);
    for (const mapping of geometry.mappings) for (const endpoint of [mapping.from, mapping.to]) {
      const port = ports.get(endpoint);
      if (!port) fail("ibis_mapping", `${mapping.port}: missing channel endpoint ${endpoint}`);
      if (componentScope(port.source_component_id) !== scope) fail("simulation_scope", `${experiment.name}: this explicit PCB channel belongs to another scope; separate channel configurations are required`);
    }
    const durationSeconds = milliseconds(experiment.end_time_ms, `${id2} end_time_ms`, { positive: true }), startTimeSeconds = milliseconds(experiment.start_time_ms ?? 0, `${id2} start_time_ms`), maxStepSeconds = milliseconds(experiment.time_per_step, `${id2} time_per_step`, { positive: true });
    if (startTimeSeconds >= durationSeconds || maxStepSeconds >= durationSeconds - startTimeSeconds) fail("simulation_timing", `${experiment.name}: recording must have positive duration and a smaller maximum timestep`);
    const states = circuit.filter((e) => e.type === "simulation_ibis_pin_state").filter((e) => e.simulation_experiment_id === id2);
    const stimuli = circuit.filter((e) => e.type === "simulation_digital_stimulus").filter((e) => e.simulation_experiment_id === id2).map((stimulus) => ({ ...stimulus, transmission_pattern: { ...stimulus.transmission_pattern, bits: transmittedBits(stimulus.transmission_pattern?.bits) } }));
    const stateIds = /* @__PURE__ */ new Set(), stimulusIds = /* @__PURE__ */ new Set();
    for (const state of states) {
      if (stateIds.has(state.source_port_id)) fail("ibis_state", `${experiment.name}: duplicate run state for ${state.source_port_id}`);
      stateIds.add(state.source_port_id);
      if (typeof state.is_output !== "boolean" || state.is_output && typeof state.is_output_enabled !== "boolean" || !state.is_output && state.is_output_enabled !== void 0) fail("ibis_state", `${experiment.name}: explicit compatible input/output enable state required`);
      const attachments = scopedModels.filter((model) => Object.values(model.ibis_pin_name_to_source_port_id).includes(state.source_port_id));
      if (attachments.length !== 1) fail("ibis_state", `${experiment.name}: run state must select exactly one modeled pin`);
    }
    for (const mapping of geometry.mappings) for (const endpoint of [mapping.from, mapping.to]) {
      const bindings = scopedModels.flatMap((model) => Object.values(model.ibis_pin_name_to_source_port_id)).filter((port) => port === endpoint);
      if (bindings.length !== 1 || !stateIds.has(endpoint)) fail("channel_model", `${experiment.name} ${mapping.port}: endpoint ${endpoint} requires exactly one modeled physical pin and an explicit run state`);
    }
    for (const stimulus of stimuli) {
      if (stimulusIds.has(stimulus.source_port_id)) fail("stimulus_duplicate", `${experiment.name}: multiple stimuli drive the same physical output`);
      stimulusIds.add(stimulus.source_port_id);
      const state = states.find((s) => s.source_port_id === stimulus.source_port_id);
      if (state?.is_output !== true || state.is_output_enabled !== true) fail("stimulus_state", `${stimulus.name}: stimulus requires an enabled IBIS output in this experiment`);
      milliseconds(stimulus.bit_duration_ms, `${stimulus.name} bit_duration_ms`, { positive: true });
      milliseconds(stimulus.start_time_ms, `${stimulus.name} start_time_ms`);
      if (![0, 1].includes(stimulus.initial_state) || stimulus.inverted !== void 0 && typeof stimulus.inverted !== "boolean" || stimulus.transmission_pattern?.transmission_type !== "bits" || typeof stimulus.transmission_pattern.repeat !== "boolean") fail("stimulus_pattern", `${stimulus.name}: explicit binary bits, inversion/repeat booleans and initial state required`);
      if (stimulus.start_time_ms / 1e3 >= durationSeconds) fail("stimulus_coverage", `${stimulus.name}: stimulus starts after the experiment ends`);
      if (!stimulus.transmission_pattern.repeat && (stimulus.start_time_ms + stimulus.transmission_pattern.bits.length * stimulus.bit_duration_ms) / 1e3 < durationSeconds - 1e-12 * durationSeconds) fail("stimulus_coverage", `${stimulus.name}: nonrepeating bits do not cover the complete run`);
    }
    for (const state of states) if (state.is_output && state.is_output_enabled && !stimulusIds.has(state.source_port_id)) fail("stimulus_missing", `${experiment.name}: enabled output requires one explicit digital stimulus`);
    const eyeRecords = circuit.filter((e) => e.type === "simulation_eye_diagram").filter((e) => e.simulation_experiment_id === id2);
    const probes = circuit.filter((e) => e.type === "simulation_voltage_probe").filter((e) => (e.subcircuit_id ?? null) === scope).map((probe, i) => {
      const signal = probe.signal_input_source_port_id ?? probe.signal_input_source_net_id;
      const reference2 = probe.reference_input_source_port_id ?? probe.reference_input_source_net_id;
      if (!signal) fail("probe_reference", `${probe.name}: signal port/net required`);
      for (const source of [signal, reference2].filter(Boolean)) if (!circuit.some((e) => e.type === "source_port" && e.source_port_id === source || e.type === "source_net" && e.source_net_id === source)) fail("probe_reference", `${probe.name}: unknown signal/reference source`);
      const signalNode = nodes.node(signal), referenceNode = reference2 ? nodes.node(reference2) : "0";
      if (signalNode === referenceNode) fail("probe_reference", `${probe.name}: signal and reference resolve to the same circuit node`);
      return { simulationVoltageProbeId: probe.simulation_voltage_probe_id, name: probe.name ?? probe.simulation_voltage_probe_id, column: i + 1, signalSourceId: signal, referenceSourceId: reference2 ?? null, signalNode, referenceNode };
    });
    if (!probes.length) fail("simulation_probe", `${experiment.name}: at least one voltage probe required`);
    const eyes = eyeRecords.map((eye) => {
      const probe = exactly(probes.filter((p2) => p2.simulationVoltageProbeId === eye.simulation_voltage_probe_id), `${eye.name} probeRef`);
      const unitIntervalSeconds = milliseconds(eye.unit_interval_ms, `${eye.name} UI`, { positive: true }), timeOriginSeconds = eye.time_origin_ms / 1e3;
      if (!Number.isFinite(timeOriginSeconds)) fail("eye_timing", `${eye.name}: explicit finite timeOrigin required`);
      const start = eye.start_time_ms === void 0 ? startTimeSeconds : milliseconds(eye.start_time_ms, `${eye.name} startTime`), end = eye.end_time_ms === void 0 ? durationSeconds : milliseconds(eye.end_time_ms, `${eye.name} endTime`);
      if (start < startTimeSeconds || end > durationSeconds || start >= end || end - start < 2 * unitIntervalSeconds) fail("eye_timing", `${eye.name}: measurement gate must fit the recorded run and contain a complete two-UI window`);
      return { simulationEyeDiagramId: eye.simulation_eye_diagram_id, name: eye.name, simulationExperimentId: id2, simulationVoltageProbeId: probe.simulationVoltageProbeId, column: probe.column, unitIntervalSeconds, timeOriginSeconds, startTimeSeconds: start, endTimeSeconds: end };
    });
    return { simulationExperimentId: id2, name: experiment.name, subcircuitId: scope, durationSeconds, startTimeSeconds, maxStepSeconds, experiment, states, stimuli, probes, eyes, models: scopedModels };
  });
  for (const eye of circuit.filter((e) => e.type === "simulation_eye_diagram")) if (!declaredExperimentIds.has(eye.simulation_experiment_id)) fail("eye_reference", `${eye.name}: unknown or unsupported transient experiment`);
  for (const record of circuit.filter((e) => e.type === "simulation_digital_stimulus" || e.type === "simulation_ibis_pin_state")) if (!declaredExperimentIds.has(record.simulation_experiment_id)) fail("simulation_reference", `${"name" in record ? record.name : record.type}: unknown transient experiment`);
  const usedModelIds = new Set(plans.flatMap((plan) => plan.models.map((model) => model.pipelineId)));
  return { models: models.filter((model) => usedModelIds.has(model.pipelineId)), nodes, plans, ports };
}
function modelRunDefinition(model, plan) {
  const pinMap = model.ibis_pin_name_to_source_port_id, selected = new Set(Object.values(pinMap));
  const pinStates = /* @__PURE__ */ Object.create(null), stimuli = /* @__PURE__ */ Object.create(null);
  for (const state of plan.states) if (selected.has(state.source_port_id)) {
    if (!state.is_output) pinStates[state.source_port_id] = { mode: "input" };
    else {
      if (typeof state.is_output_enabled !== "boolean") fail("ibis_state", `${state.source_port_id}: explicit output enable state required`);
      pinStates[state.source_port_id] = { mode: "output", enabled: state.is_output_enabled };
    }
  }
  for (const stimulus of plan.stimuli) if (selected.has(stimulus.source_port_id)) stimuli[stimulus.source_port_id] = { unitInterval: stimulus.bit_duration_ms, startTime: stimulus.start_time_ms, initialState: stimulus.initial_state, inverted: stimulus.inverted ?? false, pattern: { type: "bits", bits: stimulus.transmission_pattern.bits, repeat: stimulus.transmission_pattern.repeat } };
  const references = Object.fromEntries(Object.entries(model.ibis_pin_name_to_reference_source_port_ids ?? {}).map(([pin, refs]) => [pin, { pullup: refs.pullup_reference_source_port_id, pulldown: refs.pulldown_reference_source_port_id, powerClamp: refs.power_clamp_reference_source_port_id, groundClamp: refs.ground_clamp_reference_source_port_id, external: refs.external_reference_source_port_id }]));
  let packagePolicy = "omit";
  if (model.include_package_parasitics) packagePolicy = "vendor";
  return { definition: { source: { file: model.ibis_model_asset.project_relative_path }, component: model.ibis_component_name, pinMap, modelSelections: model.ibis_pin_name_to_model_name, references, corner: model.model_value_corner, packagePolicy }, run: { duration: plan.durationSeconds * 1e3, pinStates, stimuli } };
}

// src/spice.ts
var num = (value2) => Number(value2.toPrecision(12)).toString();
function channelSpice(extracted, sections2) {
  if (!Number.isInteger(sections2) || sections2 < 1 || sections2 > 128) fail("sections", "sections must be an integer 1..128");
  if (!extracted.length || !extracted[0].R.length) fail("matrix_dimension", "At least one extracted channel stage is required");
  const n = extracted[0].R.length;
  for (const [stage, matrices] of extracted.entries()) {
    for (const kind of ["R", "L", "C"]) {
      if (matrices[kind].length !== n) fail("matrix_dimension", `Stage ${stage} ${kind}: channel dimensions disagree`);
      validateMatrix(matrices[kind], `Stage ${stage} ${kind}`, 1e-10);
    }
    if (matrices.C.some((row, i) => row.some((entry, j) => i !== j && entry > 0) || sum(row) <= 0)) {
      fail("capacitance_sign", `Stage ${stage}: referenced Maxwell C requires nonpositive mutual and positive shunt capacitance`);
    }
  }
  const inputs = Array.from({ length: n }, (_2, i) => `IN${i}`);
  const outputs = Array.from({ length: n }, (_2, i) => `OUT${i}`);
  const lines2 = ["* Constant-frequency passive matrix pi channel; explicit reference terminal", `.subckt CHANNEL ${[...inputs, ...outputs, "REF"].join(" ")}`];
  let global = 0;
  for (const [stage, e] of extracted.entries()) for (let section = 0; section < sections2; section++) {
    const g2 = global++, R = scale(e.R, 1 / sections2), L = scale(e.L, 1 / sections2), C = scale(e.C, 1 / sections2);
    const first = g2 === 0, last = stage === extracted.length - 1 && section === sections2 - 1;
    const before = inputs.map((input, i) => first ? input : `N${g2}_${i}`);
    const after = outputs.map((output, i) => last ? output : `N${g2 + 1}_${i}`);
    for (let i = 0; i < n; i++) {
      lines2.push(`VS${g2}_${i} ${before[i]} S${g2}_${i} 0`, `R${g2}_${i} S${g2}_${i} R${g2}_${i} ${num(R[i][i])}`);
      if (n > 1) lines2.push(`E${g2}_${i} R${g2}_${i} L${g2}_${i} value={${R[i].flatMap((r, j) => j === i ? [] : [`${num(r)}*i(VS${g2}_${j})`]).join("+")}}`);
      lines2.push(`L${g2}_${i} ${n > 1 ? `L${g2}_${i}` : `R${g2}_${i}`} ${after[i]} ${num(L[i][i])}`);
    }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) lines2.push(`K${g2}_${i}_${j} L${g2}_${i} L${g2}_${j} ${num(L[i][j] / Math.sqrt(L[i][i] * L[j][j]))}`);
    for (const [label2, nodes] of [["a", before], ["b", after]]) {
      for (let i = 0; i < n; i++) lines2.push(`CG${g2}${label2}${i} ${nodes[i]} REF ${num(sum(C[i]) / 2)}`);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (C[i][j] < 0) lines2.push(`CM${g2}${label2}${i}_${j} ${nodes[i]} ${nodes[j]} ${num(-C[i][j] / 2)}`);
    }
  }
  lines2.push(".ends CHANNEL");
  return lines2.join("\n") + "\n";
}

// src/general-spice.ts
var num2 = (value2) => Number(value2.toPrecision(17)).toString();
var finite3 = (input, label2, positive3 = false) => {
  if (typeof input !== "number" || !Number.isFinite(input) || positive3 && input <= 0) return fail("electrical_input", `${label2}: explicit finite ${positive3 ? "positive " : ""}value required`);
  return input;
};
var value = (input, label2, positive3 = false) => num2(finite3(input, label2, positive3));
var safeComment = (text) => text.replace(/[\r\n]/g, " ");
function namespaceSpice(source, prefix) {
  const names = [...source.matchAll(/^\.subckt\s+(\S+)/gmi)].map((match) => match[1]);
  if (!names.length) fail("ibis_contract", "Converter did not emit a SPICE component wrapper");
  const renamed = new Map(names.map((name) => [name.toLowerCase(), `${prefix}_${name}`]));
  return { source: source.replace(/\S+/g, (token) => renamed.get(token.toLowerCase()) ?? token), wrapper: `${prefix}_${names[0]}` };
}
function electricalSources(circuit, modeling, nodes) {
  const sources = [], passives = [], activeNodes = /* @__PURE__ */ new Set(["0"]), dcConnections = [];
  const sourceBindings = [];
  const sourcePorts = circuit.filter((e) => e.type === "source_port"), sourceComponents = circuit.filter((e) => e.type === "source_component");
  const terminals = (positive3, negative) => {
    activeNodes.add(positive3);
    activeNodes.add(negative);
    return `${positive3} ${negative}`;
  };
  for (const [i, source] of circuit.filter((e) => e.type === "simulation_voltage_source").entries()) {
    const positive3 = source.is_dc_source ? source.positive_source_port_id ?? source.positive_source_net_id : source.terminal1_source_port_id;
    const negative = source.is_dc_source ? source.negative_source_port_id ?? source.negative_source_net_id : source.terminal2_source_port_id;
    if (!positive3 || !negative) return fail("supply_reference", "Voltage sources require explicit positive and negative source port/net terminals");
    const pos = nodes.node(positive3), neg = nodes.node(negative);
    if (pos === neg) fail("supply_short", "Voltage source terminals resolve to the same node");
    let expression;
    if (source.is_dc_source || !source.wave_shape) expression = value(source.voltage, "voltage source voltage");
    else if (source.wave_shape === "square") {
      const period = source.period === void 0 ? 1 / finite3(source.frequency, "source frequency", true) : source.period / 1e3;
      const amplitude = finite3(source.peak_to_peak_voltage ?? source.voltage, "source amplitude");
      const low = source.peak_to_peak_voltage === void 0 ? 0 : finite3(source.voltage, "source offset") - amplitude / 2, high = low + amplitude;
      const rise = (source.rise_time ?? 0) / 1e3, fall = (source.fall_time ?? 0) / 1e3;
      if (rise <= 0 || fall <= 0) fail("source_edge", "Square voltage sources require explicit positive rise/fall times");
      expression = `PULSE(${value(low, "source low")} ${value(high, "source high")} ${value((source.pulse_delay ?? 0) / 1e3, "source delay")} ${value(rise, "source rise", true)} ${value(fall, "source fall", true)} ${value(source.pulse_width === void 0 ? period * (source.duty_cycle ?? 0.5) : source.pulse_width / 1e3, "source width", true)} ${value(period, "source period", true)})`;
    } else return fail("source_capability", `Voltage waveform ${source.wave_shape} is unsupported by this PCB backend`);
    sources.push(`VPHYSICAL${i} ${terminals(pos, neg)} ${expression}`);
    const port = sourcePorts.find((e) => e.source_port_id === positive3);
    const component = sourceComponents.find((e) => e.source_component_id === port?.source_component_id);
    sourceBindings.push({ name: component?.name ?? source.simulation_voltage_source_id, positiveNode: pos, negativeNode: neg });
    dcConnections.push([pos, neg]);
  }
  for (const [i, source] of (modeling.supplies ?? []).entries()) {
    const pos = nodes.node(selectPort(circuit, source.positive).source_port_id), neg = nodes.node(selectPort(circuit, source.negative).source_port_id);
    if (pos === neg) fail("supply_short", "Explicit supply terminals resolve to the same node");
    sources.push(`VDECLARED${i} ${terminals(pos, neg)} ${value(source.voltageV, "declared supply")}`);
    sourceBindings.push({ name: `modeling.supplies[${i}]`, positiveNode: pos, negativeNode: neg });
    dcConnections.push([pos, neg]);
  }
  for (const [i, selection] of (modeling.passiveComponents ?? []).entries()) {
    const components = sourceComponents.filter((e) => selection.sourceComponentId ? e.source_component_id === selection.sourceComponentId : e.name === selection.component);
    if (components.length !== 1) fail("passive_reference", "Selected passive component is missing or ambiguous");
    const component = components[0];
    const ports = sourcePorts.filter((e) => e.source_component_id === component.source_component_id).sort((a2, b) => Number(a2.pin_number) - Number(b.pin_number));
    if (ports.length !== 2) fail("passive_capability", `${component.name}: expected two physical ports`);
    const pos = nodes.node(ports[0].source_port_id), neg = nodes.node(ports[1].source_port_id);
    let kind, amount, quantity;
    switch (component.ftype) {
      case "simple_resistor":
        kind = "R";
        amount = component.resistance;
        quantity = "resistance";
        break;
      case "simple_capacitor":
        kind = "C";
        amount = component.capacitance;
        quantity = "capacitance";
        break;
      case "simple_inductor":
        kind = "L";
        amount = component.inductance;
        quantity = "inductance";
        break;
      default:
        return fail("passive_capability", `${component.name}: only explicit resistor/capacitor/inductor models supported`);
    }
    passives.push(`${kind}PHYSICAL${i} ${terminals(pos, neg)} ${value(amount, `${component.name} ${quantity}`, true)}`);
    if (kind !== "C") dcConnections.push([pos, neg]);
  }
  if (!sources.length) fail("supply_missing", "Declare physical voltage sources or explicit source-port supplies; this backend never invents VDD");
  const grounded = /* @__PURE__ */ new Set(["0"]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [a2, b] of dcConnections) if (grounded.has(a2) || grounded.has(b)) {
      for (const node of [a2, b]) if (!grounded.has(node)) {
        grounded.add(node);
        changed = true;
      }
    }
  }
  for (const source of sourceBindings) if (!grounded.has(source.positiveNode) || !grounded.has(source.negativeNode)) fail("floating_source", `${source.name}: ideal voltage source has no explicit DC connection to channelReference; wire its physical terminals to the modeled supply/reference ports`);
  return { lines: [...sources, ...passives], activeNodes, grounded, sourceBindings, scope: { voltageSources: sources.length, passiveComponents: passives.length, unselectedBoardComponents: "Excluded from this explicitly selected channel experiment" } };
}
function simulationSpiceOptions(overrides = {}) {
  const options = { reltol: 1e-5, abstol: 1e-12, method: "gear" };
  for (const [key, input] of Object.entries({ ...overrides })) {
    if (key === "method") {
      if (input !== "gear" && input !== "trap") return fail("spice_options", "Unsupported integration method");
      options.method = input;
    } else {
      if (key !== "reltol" && key !== "abstol" && key !== "vntol") return fail("spice_options", `Unsupported solver option ${key}`);
      if (typeof input !== "number" && typeof input !== "string" || !Number.isFinite(Number(input)) || Number(input) <= 0) return fail("spice_options", `Invalid solver option ${key}`);
      options[key] = Number(input);
    }
  }
  return options;
}
function generalSimulationSpice(plan, geometry, modeling, extracted, models, nodes, electrical) {
  const lines2 = ["Native transient: explicit physical source rails, IBIS run controls and extracted PCB channel"];
  const options = simulationSpiceOptions(plan.experiment.spice_options);
  lines2.push(".options " + Object.entries(options).map(([key, input]) => `${key}=${input}`).join(" "), ...electrical.lines);
  for (const [i, model] of models.entries()) {
    const renamed = namespaceSpice(model.source, `IBIS${i}`);
    const wrapper = model.source.match(/^\.subckt\s+\S+\s+(.+)$/mi);
    if (!wrapper) return fail("ibis_contract", "Converter did not emit a component wrapper");
    const terminals = wrapper[1].trim().split(/\s+/).map((terminal) => {
      const id2 = model.spicePinMapping[terminal];
      if (!id2) fail("ibis_contract", `Missing returned terminal ${terminal}`);
      return nodes.node(id2);
    });
    lines2.push(`* ${safeComment(model.name)}`, renamed.source, `XIBIS${i} ${terminals.join(" ")} ${renamed.wrapper}`);
  }
  if (extracted.some((stage) => stage.R.length !== geometry.mappings.length)) fail("matrix_dimension", "Extracted channels must match every selected signal");
  const channel = [...geometry.mappings.map((mapping) => nodes.node(mapping.from)), ...geometry.mappings.map((mapping) => nodes.node(mapping.to))];
  if (channel.includes("0") || new Set(channel).size !== channel.length) fail("channel_short", "Every selected signal must have distinct driver and receiver nodes separate from the reference");
  lines2.push(channelSpice(extracted, modeling.sections), `XCHAN ${[...channel, "0"].join(" ")} CHANNEL`);
  validateProbeScope(plan, geometry, models, nodes, electrical);
  lines2.push(".control", "set wr_singlescale", "set wr_vecnames", "set numdgt=17", "save all", `tran ${num2(plan.maxStepSeconds)} ${num2(plan.durationSeconds)} ${num2(plan.startTimeSeconds)} ${num2(plan.maxStepSeconds)}`);
  for (const [i, probe] of plan.probes.entries()) lines2.push(`let probe${i} = ${probe.signalNode === "0" ? "0" : `v(${probe.signalNode})`}-${probe.referenceNode === "0" ? "0" : `v(${probe.referenceNode})`}`);
  lines2.push(`wrdata waveform.dat ${plan.probes.map((_2, i) => `probe${i}`).join(" ")}`, "quit", ".endc", ".end", "");
  return lines2.join("\n");
}
function validateProbeScope(plan, geometry, models, nodes, electrical) {
  const active = new Set(electrical.activeNodes);
  for (const model of models) for (const id2 of Object.values(model.spicePinMapping)) active.add(nodes.node(id2));
  for (const model of models) for (const pin of model.metadata?.pins ?? []) for (const [role, id2] of Object.entries(pin.references ?? {})) if (!electrical.grounded.has(nodes.node(id2))) fail("floating_reference", `${model.name} physical pin ${pin.physicalPin} ${role}: reference rail has no explicit source/passive DC path to channelReference`);
  for (const mapping of geometry.mappings) {
    active.add(nodes.node(mapping.from));
    active.add(nodes.node(mapping.to));
  }
  for (const probe of plan.probes) if (!active.has(probe.signalNode) || !active.has(probe.referenceNode)) fail("probe_observation", `${probe.name}: signal/reference is outside the declared electrical model scope`);
}

// src/solver.ts
function jsonFile(files, path, value2) {
  files[path] = JSON.stringify(value2, null, 2) + "\n";
}
async function executeSolver(runSolver, artifacts, directory, request) {
  const supplied = { ...request.files };
  const result = await runSolver({ ...request, files: { ...supplied }, args: [...request.args], outputFiles: [...request.outputFiles] });
  if (!result || typeof result.stdout !== "string" || typeof result.stderr !== "string" || !result.files || typeof result.files !== "object")
    fail("solver_result", `${request.solver}: expected stdout, stderr and files`);
  if (result.exitCode !== void 0 && result.exitCode !== 0)
    fail("native_solver", `${request.solver}: exited ${result.exitCode}
${result.stdout}
${result.stderr}`);
  for (const file of request.outputFiles) if (!Object.hasOwn(result.files, file) || typeof result.files[file] !== "string")
    fail("native_output", `${request.solver}: missing ${file}`);
  for (const [path, body] of Object.entries({ ...supplied, ...result.files })) {
    if (typeof body !== "string") fail("solver_result", `${request.solver}: ${path} must be a string`);
    artifacts[`${directory}/${path}`] = body;
  }
  artifacts[`${directory}/${request.solver}.stdout.log`] = result.stdout;
  artifacts[`${directory}/${request.solver}.stderr.log`] = result.stderr;
  jsonFile(artifacts, `${directory}/${request.solver}.request.json`, request);
  return result;
}

// src/extraction.ts
function checkNativeRun(run, directory, solver) {
  let output = `${run.stdout}
${run.stderr}`;
  if (solver === "fastercap") output = output.replace(/^\s*Error: cannot retrieve (?:the )?information about (?:the )?free memory quantity\r?\n[ \t]*Cannot go out-of-core, continuing in-core[ \t]*$/gmi, "");
  const lines2 = output.split(/\r?\n/), name = solver === "fasthenry" ? "FastHenry" : "FasterCap";
  const unconverged = lines2.find((line) => /\b(?:convergence\s+not\s+reached|(?:did\s+not|failed\s+to|not)\s+converg(?:e|ing))\b/i.test(line));
  if (unconverged) fail("native_convergence", `${name}: ${unconverged.trim()}; see ${directory}/${solver}.stdout.log and ${solver}.stderr.log`);
  const skipped = solver === "fastercap" && lines2.find((line) => /\bdegenerate\s+(?:quadrilateral|triangular|triangle)\s+panel\b|\bskipping\s+the\s+panel\b/i.test(line));
  if (skipped) fail("native_geometry", `${name}: ${skipped.trim()}; requested copper panels were omitted; see ${directory}/${solver}.stdout.log and ${solver}.stderr.log`);
  const failure = lines2.find((line) => solver === "fasthenry" ? /\b(?:error|fatal|failed|failure|severe warning|internal warning|nonphysical overlap)\b|\bHuh\?|\buh oh, segs don.t seem parallel\b/i.test(line) && !/^\s*(?:Error tolerance:|Not an error:)/i.test(line) : /^\s*(?:(?:error|fatal)\b|(?:severe|internal)\s+(?:warning|error)\b)|\b(?:failed|failure)\b/i.test(line));
  if (failure) fail("native_solver", `${name}: ${failure.trim()}; see ${directory}/${solver}.stdout.log and ${solver}.stderr.log`);
}
function impedanceSamples(text, cell) {
  for (let i = 0; i < cell.conductors.length; i++) {
    if (!new RegExp(`Row ${i + 1}:\\s+N${i}a\\s+to\\s+N${i}b`, "i").test(text)) {
      fail("matrix_order", "FastHenry external port ordering disagrees with declared signals/return");
    }
  }
  const samples = parseFastHenry(text);
  for (const sample of samples) {
    if (!Number.isFinite(sample.frequencyHz) || sample.frequencyHz <= 0) fail("model_frequency", "FastHenry frequency must be finite and positive");
    for (const matrix of [sample.R, sample.L]) {
      if (matrix.length !== cell.conductors.length || matrix.some((row) => row.length !== cell.conductors.length || row.some((value2) => !Number.isFinite(value2)))) {
        fail("matrix_dimension", "FastHenry must report every selected conductor and return");
      }
    }
  }
  return samples;
}
async function extractChannel(geometry, modeling, files, runSolver, onProgress = () => {
}) {
  const extracted = [];
  for (const cell of geometry.cells) {
    onProgress(`Extract stage ${cell.stage} (${cell.profile}) with actual native FastHenry and FasterCap`);
    const dir = `stage-${cell.stage}`;
    const coarseFiles = { "channel.inp": fastHenryDeck(cell, modeling.extraction) };
    const fc = fasterCapDeck(cell, modeling.extraction);
    const henryArgs = cell.routedCopper ? ["-p", "seg", "channel.inp"] : ["channel.inp"];
    const coarseRun = await executeSolver(runSolver, files, dir, { solver: "fasthenry", args: henryArgs, files: coarseFiles, outputFiles: ["Zc.mat"] });
    checkNativeRun(coarseRun, dir, "fasthenry");
    const ztext = coarseRun.files["Zc.mat"];
    const spectrum = impedanceSamples(ztext, cell);
    const lowest = spectrum.reduce((a2, b) => a2.frequencyHz < b.frequencyHz ? a2 : b), coarse = spectrum.find((s) => Math.abs(s.frequencyHz / modeling.extraction.modelHz - 1) < 1e-8);
    if (!coarse) fail("model_frequency", "modelHz must be one executed FastHenry sample frequency");
    const refinement = dir + "/refinement";
    const refinedDeck = fastHenryDeck(cell, { ...modeling.extraction, minimumHz: modeling.extraction.modelHz, maximumHz: modeling.extraction.modelHz, filaments: modeling.extraction.refinementFilaments, groundMeshMm: modeling.extraction.groundMeshMm === void 0 ? void 0 : modeling.extraction.groundMeshMm / 2 });
    const refinedRun = await executeSolver(runSolver, files, refinement, { solver: "fasthenry", args: henryArgs, files: { "channel.inp": refinedDeck }, outputFiles: ["Zc.mat"] });
    checkNativeRun(refinedRun, refinement, "fasthenry");
    const refined = impedanceSamples(refinedRun.files["Zc.mat"], cell);
    if (refined.length !== 1 || Math.abs(refined[0].frequencyHz / modeling.extraction.modelHz - 1) > 1e-8) fail("model_frequency", "FastHenry refinement must execute exactly modelHz");
    const selected = refined[0];
    const convergence = { R: 0, L: 0, coarseFilaments: modeling.extraction.filaments, refinedFilaments: modeling.extraction.refinementFilaments, ...cell.routedCopper ? { coarseGroundMeshMm: modeling.extraction.groundMeshMm, refinedGroundMeshMm: modeling.extraction.groundMeshMm / 2 } : {}, frequencyHz: selected.frequencyHz, definition: "max(abs(refined-coarse))/max(abs(refined)) for full referenced matrix; routed copper also halves ground mesh spacing", tolerance: modeling.extraction.convergenceTolerance };
    for (const kind of ["R", "L"]) {
      const a2 = loopImpedance(coarse[kind]), b = loopImpedance(selected[kind]);
      convergence[kind] = Math.max(...b.flatMap((r, i) => r.map((v3, j) => Math.abs(v3 - a2[i][j])))) / Math.max(...b.flat().map(Math.abs));
      if (!Number.isFinite(convergence[kind]) || convergence[kind] > convergence.tolerance) fail("mesh_convergence", `Stage ${cell.stage} ${kind} refinement residual ${convergence[kind]} > ${convergence.tolerance}; increase filaments and refinementFilaments${cell.routedCopper ? " and halve groundMeshMm" : ""} explicitly`);
    }
    const analytic = cell.routedCopper ? cell.routedCopper.signals.map((p2) => p2.segments.reduce((sum3, s) => sum3 + Math.hypot(...s.a.map((v3, i) => v3 - s.b[i])) * 1e3 / ((s.conductivitySm ?? cell.conductivitySm) * s.widthMm * s.thicknessMm), 0)) : cell.conductors.map((c2) => c2.lengthM / ((c2.conductivitySm ?? cell.conductivitySm) * c2.widthM * c2.thicknessM));
    const errors = analytic.map((v3, i) => Math.abs(lowest.R[i][i] / v3 - 1));
    if (errors.some((e) => !Number.isFinite(e) || e > modeling.extraction.dcResistanceTolerance)) fail("analytic_resistance", `DC geometry check failed: errors ${errors.join(",")}`);
    const analyticLoop = cell.routedCopper ? null : loopImpedance(analytic.map((v3, i) => analytic.map((_2, j) => i === j ? v3 : 0))), dcLoop = loopImpedance(lowest.R);
    const dcLoopResidual = analyticLoop ? Math.max(...dcLoop.flatMap((r, i) => r.map((v3, j) => Math.abs(v3 - analyticLoop[i][j])))) / Math.max(...analyticLoop.flat()) : null;
    if (dcLoopResidual !== null && (!Number.isFinite(dcLoopResidual) || dcLoopResidual > modeling.extraction.dcResistanceTolerance)) fail("analytic_return", `Shared-return DC resistance mismatch ${dcLoopResidual}`);
    const R = validateMatrix(loopImpedance(selected.R), "R loop", modeling.extraction.reciprocityTolerance), L = validateMatrix(loopImpedance(selected.L), "L loop", modeling.extraction.reciprocityTolerance);
    validateMatrix(selected.R, "R primitive", modeling.extraction.reciprocityTolerance);
    validateMatrix(selected.L, "L primitive", modeling.extraction.reciprocityTolerance);
    const capRun = await executeSolver(runSolver, files, dir, { solver: "fastercap", args: ["channel.lst", "-b", `-a${modeling.extraction.capTolerance}`, ...cell.routedCopper ? ["-ap"] : [], "-e"], files: fc, outputFiles: [] });
    checkNativeRun(capRun, dir, "fastercap");
    const cap = parseFasterCap(capRun.stdout);
    const capacitanceScaleToFarads = cell.routedCopper ? copperCapacitanceScaleToFarads : 1;
    cap.matrix = cap.matrix.map((row) => row.map((value2) => value2 * capacitanceScaleToFarads));
    const capDiff = [...capRun.stdout.matchAll(/Weighted Frobenius norm of the difference between capacitance \(auto option\):\s*([\deE+.-]+)/g)].at(-1);
    const capConvergence = capDiff ? Number(capDiff[1]) : null;
    if (capConvergence === null || !Number.isFinite(capConvergence) || capConvergence < 0 || capConvergence > modeling.extraction.capTolerance) fail("cap_convergence", "FasterCap did not report converged automatic refinement within requested tolerance");
    if (cap.names.length !== cell.conductors.length || cap.matrix.length !== cell.conductors.length || !cap.names.every((n, i) => n.endsWith(`_${cell.conductors[i].name}`))) fail("matrix_order", `FasterCap C conductor ordering changed: ${cap.names}`);
    const primitiveC = validateMatrix(cap.matrix, "C primitive", modeling.extraction.reciprocityTolerance), C = referenceCapacitance(primitiveC.matrix);
    if (primitiveC.matrix.some((r, i) => sum(r) <= 0 || r.some((v3, j) => i !== j && v3 > 0))) fail("capacitance_sign", "Primitive Maxwell matrix needs nonpositive off-diagonals and positive capacitance to infinity");
    const cr = primitiveC.matrix.map(sum), v2 = cell.conductors.slice(0, -1).map((_2, i) => i === 0 ? 1.2 : -0.7), offset = -sum(v2.map((value2, i) => cr[i] * value2)) / C.denominator, full = v2.map((value2) => [value2 + offset]).concat([[offset]]), q = multiply(primitiveC.matrix, full);
    const energy = multiply(transpose(full), q)[0][0], reducedEnergy = multiply(multiply([v2], C.matrix), transpose([v2]))[0][0];
    const energyResidual = Math.abs(energy - reducedEnergy) / Math.abs(energy), neutralityResidual = Math.abs(sum(q.flat())) / Math.max(...q.flat().map(Math.abs));
    if (!Number.isFinite(energyResidual) || !Number.isFinite(neutralityResidual) || energyResidual > 1e-10 || neutralityResidual > 1e-10) fail("reference_energy", "Neutral finite-return charge/energy reconstruction failed");
    const result = { stage: cell.stage, profile: cell.profile, R: R.matrix, L: L.matrix, C: C.matrix, units: { R: "ohm", L: "H", C: "F" }, frequencyHz: selected.frequencyHz, primitiveOrder: cell.conductors.map((c2) => c2.name), primitiveImpedance: spectrum, modelPrimitiveImpedance: selected, primitiveCapacitance: cap.matrix, checks: { R, L, C, primitiveC, convergence, capConvergence, analyticResistanceOhm: analytic, analyticResistanceRelativeErrors: errors, analyticFrequencyHz: lowest.frequencyHz, analyticLoopResistanceOhm: analyticLoop, dcLoopResidual, energyResidual, neutralityResidual }, conversions: { impedance: "R=Re(Z), L=Im(Z)/(2*pi*f); A=[I;-ones]; loop=A^T primitive A", capacitance: C.convention, capacitanceSolverCoordinateUnits: cell.routedCopper ? "mm" : "m", capacitanceScaleToFarads, neutralityDenominatorF: C.denominator } };
    jsonFile(files, dir + "/extraction.json", result);
    extracted.push(result);
  }
  return extracted;
}

// src/metrics.mjs
function eyeWindowBudget(first, last, pointsPerWindow, { maxWindows = 1e4, maxSamples = 1e6 } = {}) {
  const windows = last - first + 1;
  if (![maxWindows, maxSamples].every((value2) => Number.isSafeInteger(value2) && value2 > 0)) fail("eye_budget", "Eye limits must be positive safe integers");
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || !Number.isSafeInteger(windows) || windows > maxWindows)
    fail("eye_budget", `Eye windows exceed the limit of ${maxWindows} or have unsafe boundary indices`);
  if (!Number.isSafeInteger(pointsPerWindow) || windows > Math.floor(maxSamples / pointsPerWindow))
    fail("eye_budget", `Eye plotted samples exceed the limit of ${maxSamples}`);
  return windows;
}
function probeWaveformRows(text, probes) {
  const rows = text.trim().split(/\r?\n/).slice(1).map((line) => line.trim().split(/\s+/).map(Number));
  if (!rows.length || rows.some((row) => row.length !== probes.length + 1 || row.some((value2) => !Number.isFinite(value2)))) fail("waveform", "Expected actual time and one finite column per declared probe");
  if (rows.some((row, i) => i && row[0] <= rows[i - 1][0])) fail("waveform", "Actual solver timestamps must strictly increase");
  return rows;
}
function foldProbeEye(rows, eye, pointsPerWindow = 1200, limits = {}) {
  const ui = eye.unitIntervalSeconds, origin = eye.timeOriginSeconds, column = eye.column;
  if (!Number.isInteger(pointsPerWindow) || pointsPerWindow < 2) fail("eye_resolution", "At least two plotting points per window required");
  if (!Number.isFinite(ui) || ui <= 0 || !Number.isFinite(origin)) fail("eye_timing", `${eye.name}: positive UI and finite timeOrigin required`);
  if (!Number.isInteger(column) || column < 1 || rows.some((row) => column >= row.length)) fail("eye_probe", `${eye.name}: missing recorded probe column`);
  const start = Math.max(rows[0][0], eye.startTimeSeconds), end = Math.min(rows.at(-1)[0], eye.endTimeSeconds);
  const received = eye.captureTimesSeconds !== void 0;
  const epsilon3 = 1e-9;
  const first = Math.ceil((start + ui / 2 - origin) / ui - epsilon3), last = Math.floor((end - 3 * ui / 2 - origin) / ui + epsilon3);
  let origins;
  if (received) {
    if (Array.isArray(eye.captureTimesSeconds)) eyeWindowBudget(0, eye.captureTimesSeconds.length - 1, pointsPerWindow, limits);
    if (!Array.isArray(eye.captureTimesSeconds) || eye.captureTimesSeconds.some((t, i, a2) => !Number.isFinite(t) || i && t <= a2[i - 1])) fail("eye_timing", "Received capture times must be finite and strictly increasing");
    origins = eye.captureTimesSeconds.map((t) => t - ui).filter((t) => t >= start && t + 2 * ui <= end);
  } else {
    if (!Number.isFinite(first) || !Number.isFinite(last) || first > last) fail("eye_windows", `${eye.name}: no complete two-UI windows within measurement gate [${eye.startTimeSeconds}, ${eye.endTimeSeconds}] s; UI ${ui} s; skip ${(eye.startTimeSeconds - origin) / ui} UI from timeOrigin ${origin} s; recorded timestamps [${rows[0][0]}, ${rows.at(-1)[0]}] s`);
    eyeWindowBudget(first, last, pointsPerWindow, limits);
    origins = Array.from({ length: last - first + 1 }, (_2, i) => origin + (first + i) * ui - ui / 2);
  }
  const count = eyeWindowBudget(0, origins.length - 1, pointsPerWindow, limits);
  const samples = [], windowOriginsSeconds = [], boundaryIndices = [];
  let index2 = 1;
  for (let offsetIndex = 0; offsetIndex < count; offsetIndex++) {
    const k2 = first + offsetIndex;
    const windowStart = origins[offsetIndex], window = windowOriginsSeconds.length;
    windowOriginsSeconds.push(windowStart);
    if (!received) boundaryIndices.push(k2);
    index2 = 1;
    for (let point = 0; point < pointsPerWindow; point++) {
      const offset = 2 * ui * point / (pointsPerWindow - 1), time = windowStart + offset;
      while (index2 < rows.length - 1 && rows[index2][0] < time) index2++;
      const a2 = rows[index2 - 1], b = rows[index2];
      if (time < a2[0] - ui * 1e-12 || time > b[0] + ui * 1e-12) fail("eye_interpolation", "Eye sample is outside the recorded waveform");
      samples.push([window, offset, time, a2[column] + (b[column] - a2[column]) * (time - a2[0]) / (b[0] - a2[0])]);
    }
  }
  const values = rows.filter((row) => row[0] >= start && row[0] <= end).map((row) => row[column]);
  for (const time of [start, end]) {
    const i = rows.findIndex((row) => row[0] >= time), b = rows[i], a2 = rows[Math.max(0, i - 1)];
    if (b) values.push(a2[0] === b[0] ? b[column] : a2[column] + (b[column] - a2[column]) * (time - a2[0]) / (b[0] - a2[0]));
  }
  const range2 = values.reduce(([low, high], value2) => [Math.min(low, value2), Math.max(high, value2)], [Infinity, -Infinity]);
  return {
    samples,
    windows: windowOriginsSeconds.length,
    pointsPerWindow,
    windowOriginsSeconds,
    boundaryIndices,
    metrics: { kind: "finite observed voltage eye", alignment: received ? "received-differential-dqs" : "stimulus-clock", samples: rows.length, voltageRangeV: range2, unitIntervalSeconds: ui, timeOriginSeconds: received ? null : origin, measurementStartSeconds: eye.startTimeSeconds, measurementEndSeconds: eye.endTimeSeconds, observedStartSeconds: rows[0][0], observedEndSeconds: rows.at(-1)[0], windows: windowOriginsSeconds.length, limitations: ["No eye-opening estimator, BER extrapolation or protocol compliance; DDR checks, if configured, are reported separately"] }
  };
}

// src/ddr.ts
function validateDdrConfig(c2) {
  if (!c2 || typeof c2 !== "object") fail("ddr_config", "Explicit DDR assessment configuration required");
  const finite4 = (value2, field, minimum = -Infinity) => {
    if (typeof value2 !== "number" || !Number.isFinite(value2) || value2 < minimum) fail("ddr_config", `${c2.name}: explicit finite ${field} required (minimum ${minimum})`);
  };
  if (![c2.name, c2.dataProbe, c2.strobeProbe].every((v2) => typeof v2 === "string" && v2.trim()) || c2.dataProbe === c2.strobeProbe)
    fail("ddr_config", "DDR name and distinct dataProbe/strobeProbe names are required");
  if (!["read", "write"].includes(c2.direction)) fail("ddr_config", `${c2.name}: explicit read/write direction required`);
  finite4(c2.sampleOffsetSeconds, "sampleOffsetSeconds");
  finite4(c2.vrefV, "vrefV");
  finite4(c2.setupSeconds, "setupSeconds", 0);
  finite4(c2.holdSeconds, "holdSeconds", 0);
  finite4(c2.minimumStrobeDifferentialV, "minimumStrobeDifferentialV", Number.MIN_VALUE);
  finite4(c2.maximumStrobeIntervalErrorSeconds, "maximumStrobeIntervalErrorSeconds", 0);
  for (const key of ["vilAcV", "vilDcV", "vihDcV", "vihAcV"]) finite4(c2.thresholds?.[key], `thresholds.${key}`);
  const { vilAcV, vilDcV, vihDcV, vihAcV } = c2.thresholds;
  if (!(vilAcV < vilDcV && vilDcV < c2.vrefV && c2.vrefV < vihDcV && vihDcV < vihAcV))
    fail("ddr_config", `${c2.name}: require VIL(AC) < VIL(DC) < VREF < VIH(DC) < VIH(AC)`);
  if (c2.experimentNames !== void 0 && (!Array.isArray(c2.experimentNames) || !c2.experimentNames.length || c2.experimentNames.some((n) => typeof n !== "string" || !n.trim())))
    fail("ddr_config", `${c2.name}: experimentNames must contain explicit experiment names`);
  if (c2.characterization && (c2.characterization.referencePlane !== "receiver-pad" || ["source", "receiver", "speedGrade", "conditions", "derating"].some((key) => typeof Reflect.get(c2.characterization, key) !== "string" || !Reflect.get(c2.characterization, key).trim())))
    fail("ddr_config", `${c2.name}: characterization requires source, receiver, speedGrade, conditions, derating and receiver-pad referencePlane`);
}
function resolveDdrAssessments(plans, geometry, configs = []) {
  if (!Array.isArray(configs)) fail("ddr_config", "modeling.ddrAssessments must be an array");
  const resolved = [], selected = /* @__PURE__ */ new Set(), names = /* @__PURE__ */ new Set();
  for (const config of configs) {
    validateDdrConfig(config);
    if (names.has(config.name)) fail("ddr_config", `Duplicate DDR assessment name ${config.name}`);
    names.add(config.name);
    for (const name of config.experimentNames ?? []) if (!plans.some((p2) => p2.name === name)) fail("ddr_config", `${config.name}: unknown experiment ${name}`);
    for (const plan of plans.filter((p2) => !config.experimentNames || config.experimentNames.includes(p2.name))) {
      const probe = (name) => {
        const matches = plan.probes.filter((p2) => p2.name === name);
        if (matches.length !== 1) fail("ddr_probe", `${plan.name}: ${name} must select exactly one native voltage probe`);
        return matches[0];
      };
      const data = probe(config.dataProbe), strobe = probe(config.strobeProbe);
      const ids = [data.signalSourceId, strobe.signalSourceId, strobe.referenceSourceId];
      if (new Set(ids).size !== 3 || !ids.every((id2) => geometry.mappings.some((m2) => m2.to === id2)) || data.referenceNode !== "0")
        fail("ddr_probe", `${config.name}: require ground-referenced DQ and differential DQS/DQSn at three distinct extracted receiver pads`);
      if (ids.some((id2) => !plan.states.some((s) => s.source_port_id === id2 && s.is_output === false)))
        fail("ddr_probe", `${config.name}: each receiving pad must have an explicit input state`);
      const eyes = plan.eyes.filter((e) => e.simulationVoltageProbeId === data.simulationVoltageProbeId);
      if (eyes.length !== 1) fail("ddr_probe", `${config.name}: dataProbe must have exactly one native eye per selected experiment`);
      const eye = eyes[0], key = `${plan.simulationExperimentId}/${eye.simulationEyeDiagramId}`;
      if (selected.has(key)) fail("ddr_config", `${config.name}: duplicate assessment for the same data eye`);
      selected.add(key);
      if (config.maximumStrobeIntervalErrorSeconds >= eye.unitIntervalSeconds / 2)
        fail("ddr_config", `${config.name}: strobe interval tolerance must be less than half a UI`);
      resolved.push({ config, data, strobe, eye });
    }
  }
  return resolved;
}
function lowerBound(rows, time) {
  let lo = 0, hi = rows.length - 1;
  while (lo < hi) {
    const m2 = lo + hi >>> 1;
    if (rows[m2][0] < time) lo = m2 + 1;
    else hi = m2;
  }
  return lo;
}
function voltage(rows, column, time) {
  const i = lowerBound(rows, time), b = rows[i], a2 = rows[Math.max(0, i - 1)];
  return a2[0] === b[0] ? b[column] : a2[column] + (b[column] - a2[column]) * (time - a2[0]) / (b[0] - a2[0]);
}
function points(rows, column, start, end) {
  const out = [[start, voltage(rows, column, start)]];
  for (let i = lowerBound(rows, start); i < rows.length && rows[i][0] < end; i++) if (rows[i][0] > start) out.push([rows[i][0], rows[i][column]]);
  out.push([end, voltage(rows, column, end)]);
  return out;
}
function zeroCrossings(rows, column) {
  const edges = [];
  const ambiguities = [];
  let previous = -1, firstZero, lastZero;
  for (let i = 0; i < rows.length; i++) {
    const v2 = rows[i][column];
    if (v2 === 0) {
      firstZero ??= rows[i][0];
      lastZero = rows[i][0];
      continue;
    }
    if (firstZero !== void 0 && (firstZero !== lastZero || previous >= 0 && Math.sign(rows[previous][column]) === Math.sign(v2)))
      ambiguities.push({ start: firstZero, end: lastZero });
    if (previous >= 0 && rows[previous][column] * v2 < 0) {
      const a2 = rows[previous], b = rows[i];
      edges.push({ time: firstZero ?? a2[0] - a2[column] * (b[0] - a2[0]) / (v2 - a2[column]), rising: v2 > 0, plateau: firstZero !== lastZero });
    }
    previous = i;
    firstZero = lastZero = void 0;
  }
  if (firstZero !== void 0) ambiguities.push({ start: firstZero, end: lastZero });
  return { edges, ambiguities };
}
function assessDdr(rows, { config: c2, data, strobe, eye }) {
  validateDdrConfig(c2);
  const result = {
    name: c2.name,
    status: "not-evaluated",
    config: c2,
    dataProbe: data.name,
    strobeProbe: strobe.name,
    alignment: "received-differential-dqs",
    checks: { status: "not-evaluated", captures: 0, violations: 0, unevaluated: 0 },
    compliance: { status: "not-evaluated", reason: "Finite selected-lane simulation cannot establish DDR/JEDEC or board compliance, even when configured checks are satisfied." },
    strobe: { status: "not-evaluated", crossingsSeconds: [] },
    captureTimesSeconds: [],
    captures: [],
    reasons: [],
    limitations: [
      "Receiver-pad voltages only; no inferred internal receiver timing, training or package de-embedding.",
      `Both polarities of received differential DQS zero crossings plus explicit sample offset ${c2.sampleOffsetSeconds} s; no transmit-clock phase substitution.`,
      `Explicit constant VREF ${c2.vrefV} V relative to DQ probe ground; VREF noise and drift are not modeled.`,
      "Setup starts at the first AC-threshold attainment after the latest DC-invalid excursion; DC validity must continue through capture and hold. Capture-boundary timing values are lower bounds.",
      "Linear interpolation of recorded adaptive timestamps cannot bound unresolved ringing or integration error; display sample count does not establish convergence.",
      "Observed high/low levels are inferred from received voltage, not checked against transmitted bits; no bit correctness or BER claim.",
      "No full-bus, command/address, common-mode, overshoot/undershoot, pulse-width, slew-rate derating, PVT, firmware or hardware validation is performed.",
      c2.characterization ? "Characterized limit evidence is user-supplied and has not been independently verified." : "Illustrative explicit limits only: no characterized receiver, speed grade, conditions or timing derating evidence supplied."
    ]
  };
  const unavailable = (reason) => {
    result.reasons.push(reason);
    result.strobe.reason = reason;
    return result;
  };
  if (rows.length < 2 || rows.some((r, i) => [0, data.column, strobe.column].some((col) => !Number.isFinite(r[col])) || i > 0 && r[0] <= rows[i - 1][0]))
    return unavailable("Missing, nonfinite or nonmonotonic recorded waveform.");
  const start = eye.startTimeSeconds, end = eye.endTimeSeconds, ui = eye.unitIntervalSeconds;
  if (rows[0][0] > start || rows.at(-1)[0] < end) return unavailable("Incomplete capture: the recorded waveform does not cover the entire requested gate.");
  const observed = zeroCrossings(rows, strobe.column), edges = observed.edges.filter((e) => e.time >= start && e.time <= end);
  result.strobe.crossingsSeconds = edges.map((e) => e.time);
  if (edges.length < 2) return unavailable("No usable received DQS train: quiet or fewer than two differential crossings in the measurement gate.");
  if (edges.length > 1e4) return unavailable("Received DQS train exceeds the 10000-edge analysis budget.");
  const tolerance = c2.maximumStrobeIntervalErrorSeconds;
  if (observed.ambiguities.some((a2) => a2.end >= start && a2.start <= end) || edges.some((e, i) => e.plateau || i > 0 && Math.abs(e.time - edges[i - 1].time - ui) > tolerance) || edges[0].time - start > ui + tolerance || end - edges.at(-1).time > ui + tolerance) {
    result.strobe.status = "violated";
    return unavailable("Ambiguous, extra or missing received DQS crossings (ringing, zero touch/plateau or interval outside configured UI tolerance).");
  }
  if (edges.some((e, i) => {
    const before = points(rows, strobe.column, i ? edges[i - 1].time : Math.max(rows[0][0], e.time - ui), e.time);
    const after = points(rows, strobe.column, e.time, i + 1 < edges.length ? edges[i + 1].time : Math.min(rows.at(-1)[0], e.time + ui));
    return !before.some((p2) => (e.rising ? -p2[1] : p2[1]) >= c2.minimumStrobeDifferentialV) || !after.some((p2) => (e.rising ? p2[1] : -p2[1]) >= c2.minimumStrobeDifferentialV);
  })) return unavailable("Received DQS does not reach the configured differential magnitude on both sides of every crossing.");
  result.strobe.status = "within-configured-limits";
  for (const edge of edges) {
    const time = edge.time + c2.sampleOffsetSeconds;
    const capture = { strobeTimeSeconds: edge.time, sampleTimeSeconds: time, rising: edge.rising, voltageV: null, level: "indeterminate", status: "not-evaluated" };
    result.captures.push(capture);
    if (time - c2.setupSeconds < start || time + c2.holdSeconds > end) {
      capture.reason = "Setup/hold aperture is outside the measurement gate.";
      continue;
    }
    const value2 = voltage(rows, data.column, time), high = value2 > c2.vrefV, sign = high ? 1 : -1;
    capture.voltageV = value2;
    const dc = high ? c2.thresholds.vihDcV : c2.thresholds.vilDcV, ac2 = high ? c2.thresholds.vihAcV : c2.thresholds.vilAcV;
    capture.dcMarginV = sign * (value2 - dc);
    if (capture.dcMarginV < 0) {
      capture.status = "violated";
      capture.reason = "DQ is inside the DC-invalid voltage band at capture.";
      continue;
    }
    capture.level = high ? "high" : "low";
    let left = lowerBound(rows, time) - 1, right = lowerBound(rows, time);
    while (left >= 0 && sign * (rows[left][data.column] - dc) >= 0) left--;
    while (right < rows.length && sign * (rows[right][data.column] - dc) >= 0) right++;
    const boundary = (a3, b2) => a3[0] + (dc - a3[data.column]) * (b2[0] - a3[0]) / (b2[data.column] - a3[data.column]);
    const begin = left < 0 ? rows[0][0] : boundary(rows[left], rows[left + 1]);
    const finish = right === rows.length ? rows.at(-1)[0] : boundary(rows[right - 1], rows[right]);
    const preceding = points(rows, data.column, begin, time);
    const firstAc = preceding.findIndex((p2) => sign * (p2[1] - ac2) >= 0);
    capture.holdSeconds = finish - time;
    capture.holdIsLowerBound = right === rows.length;
    capture.holdMarginSeconds = capture.holdSeconds - c2.holdSeconds;
    if (firstAc < 0) {
      capture.status = "violated";
      capture.reason = "DQ never reaches its AC threshold in the current DC-valid interval.";
      continue;
    }
    const b = preceding[firstAc], a2 = preceding[Math.max(0, firstAc - 1)];
    const acquired = firstAc === 0 ? b[0] : a2[0] + (ac2 - a2[1]) * (b[0] - a2[0]) / (b[1] - a2[1]);
    capture.setupSeconds = time - acquired;
    capture.setupIsLowerBound = firstAc === 0 && left < 0;
    capture.setupMarginSeconds = capture.setupSeconds - c2.setupSeconds;
    capture.status = capture.setupMarginSeconds >= 0 && capture.holdMarginSeconds >= 0 ? "within-configured-limits" : "violated";
    if (capture.status === "violated") capture.reason = "Interpolated AC setup or DC hold time is below the explicit configured requirement.";
  }
  const violations = result.captures.filter((c3) => c3.status === "violated").length, unevaluated = result.captures.filter((c3) => c3.status === "not-evaluated").length;
  result.checks = { status: violations ? "violated" : unevaluated ? "not-evaluated" : "within-configured-limits", captures: result.captures.length, violations, unevaluated };
  result.status = violations ? "violated" : unevaluated ? "not-evaluated" : c2.characterization ? "within-characterized-limits" : "illustrative";
  if (unevaluated) result.reasons.push("At least one received edge lacks a complete setup/hold aperture; incomplete evidence cannot satisfy the assessment.");
  result.captureTimesSeconds = result.captures.map((c3) => c3.sampleTimeSeconds);
  return result;
}

// src/hash.ts
var sha2563 = (value2) => bytesToHex(sha2562(value2));

// src/model-source.ts
function relativeFile(path) {
  if (!path || /[\\:\0]/.test(path) || path.startsWith("/") || path.split("/").some((part) => !part || part === "." || part === ".."))
    fail("file_path", `Expected a safe project-relative file path: ${path}`);
  return path;
}
function loadModelSource(model, sources) {
  const asset = model.ibis_model_asset, path = relativeFile(asset.project_relative_path);
  if (!sources || !Object.hasOwn(sources, path)) fail("ibis_asset_missing", `Supply IBIS bytes for ${path} in ibisSources`);
  const source = sources[path];
  if (typeof source !== "string" && !(source instanceof Uint8Array)) fail("ibis_asset", `${path}: expected a string or Uint8Array`);
  const bytes = typeof source === "string" ? new TextEncoder().encode(source) : source;
  if (bytes.length > 64 * 1024 * 1024) fail("ibis_asset", "IBIS asset exceeds 64 MiB");
  if (bytes[0] === 80 && bytes[1] === 75) fail("ibis_asset", "IBIS asset must be a plain .ibs file; extract ZIP archives explicitly");
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  if (/^\s*(?:<!doctype\s+html|<html)\b/i.test(text)) fail("ibis_asset", "IBIS asset contains HTML instead of model data");
  const id2 = model.pipelineId, sourceSha256 = sha2563(bytes), ibsFile = `inputs/ibis/${id2}.ibs`;
  return { text, bytes, evidence: { simulationIbisModelId: id2, ibisModelAsset: asset, resolvedFrom: "provided", ibsFile, sourceSha256, rawSourceFile: ibsFile, rawSourceSha256: sourceSha256 } };
}

// src/circuit-schema.mjs
function validateCircuitRecords(records) {
  if (!Array.isArray(records)) fail("circuit_schema", "Expected a Circuit JSON record array");
  for (const record of records) {
    const type = record?.type, id2 = record?.[`${type}_id`] ?? record?.name ?? "(unnamed)";
    const schema = typeof type === "string" ? recordSchema(record) : void 0;
    if (!schema?.safeParse) fail("circuit_schema", `${type ?? "(missing type)"} ${id2}: no registered record schema`);
    const parsed = schema.safeParse(record);
    if (!parsed.success) {
      const issue = parsed.error.issues[0], path = issue.path?.join(".");
      fail("circuit_schema", `${type} ${id2}: ${path ? path + ": " : ""}${issue.message}`);
    }
  }
}

// src/general-pipeline.ts
var safeId = (id2) => {
  if (typeof id2 !== "string" || !/^[a-zA-Z0-9_-]+$/.test(id2)) fail("simulation_id", "Serialized simulation IDs must be safe stable identifiers");
  return id2;
};
async function runPipeline({ circuitJson, modeling, ibisSources, runSolver, onProgress = () => {
} }) {
  const explicitModeling = modeling !== void 0;
  modeling ??= modelingFromCircuitJson(circuitJson);
  validateCircuitRecords(circuitJson);
  if (typeof convertIbisModelToSpice !== "function") fail("converter_version", "Install the pinned upstream general IBIS converter");
  const geometry = geometryFromCircuitJson(circuitJson, modeling), declarations = generalDeclarations(circuitJson, geometry, modeling);
  const ddrAssessments = resolveDdrAssessments(declarations.plans, geometry, modeling.ddrAssessments);
  const electrical = electricalSources(circuitJson, modeling, declarations.nodes);
  for (const plan of declarations.plans) {
    safeId(plan.simulationExperimentId);
    for (const eye of plan.eyes) safeId(eye.simulationEyeDiagramId);
  }
  const expectedHashes = modeling.ibisModelAssetSha256;
  if (expectedHashes !== void 0 && (!expectedHashes || typeof expectedHashes !== "object" || Array.isArray(expectedHashes))) fail("vendor_hash", "modeling.ibisModelAssetSha256 must map project-relative IBIS asset paths to SHA-256 hashes");
  const loaded = [];
  for (const model of declarations.models) {
    const path = model.ibis_model_asset.project_relative_path;
    let expected;
    if (expectedHashes !== void 0) {
      expected = expectedHashes[path];
      if ((explicitModeling || expected !== void 0) && (typeof expected !== "string" || !/^[a-f0-9]{64}$/i.test(expected))) fail("vendor_hash", `${path}: modeling.ibisModelAssetSha256 requires an expected 64-digit SHA-256 hash for each used IBIS asset`);
    }
    const source = loadModelSource(model, ibisSources);
    if (expected !== void 0 && source.evidence.sourceSha256 !== expected.toLowerCase()) fail("vendor_hash", `${path}: IBIS asset bytes differ from modeling.ibisModelAssetSha256`);
    loaded.push(source);
  }
  const compiled = declarations.plans.map((plan) => plan.models.map((model) => {
    const index2 = declarations.models.findIndex((selected) => selected.pipelineId === model.pipelineId);
    const input = modelRunDefinition(model, plan), source = loaded[index2];
    input.definition.source = { file: source.evidence.ibsFile, sha256: source.evidence.sourceSha256 };
    const result = convertIbisModelToSpice(source.bytes, input.definition, input.run);
    return { ...result, name: model.ibis_component_name, pipelineId: model.pipelineId, input, sourceEvidence: loaded[index2].evidence };
  }));
  for (const [i, plan] of declarations.plans.entries()) validateProbeScope(plan, geometry, compiled[i], declarations.nodes, electrical);
  const files = /* @__PURE__ */ Object.create(null);
  for (const source of loaded) files[source.evidence.ibsFile] = source.text;
  jsonFile(files, "inputs/modeling.json", modeling);
  jsonFile(files, "inputs/circuit.json", circuitJson);
  jsonFile(files, "geometry.json", geometry);
  jsonFile(files, "electrical-node-map.json", { nodes: declarations.nodes.mapping, channelReferenceSourcePortId: declarations.nodes.groundSourcePortId, scope: electrical.scope });
  jsonFile(files, "vendor-sources.json", loaded.map((source) => source.evidence));
  const extracted = await extractChannel(geometry, modeling, files, runSolver, onProgress);
  files["channel.cir"] = channelSpice(extracted, modeling.sections);
  const pcbExperimentIds = new Set(declarations.plans.map((plan) => plan.simulationExperimentId));
  const results = circuitJson.filter((record) => record.type !== "simulation_transient_voltage_graph" || !pcbExperimentIds.has(record.simulation_experiment_id)), experiments = [];
  for (const [index2, plan] of declarations.plans.entries()) {
    const relative = `experiments/${plan.simulationExperimentId}`, dir = relative;
    const solverFiles = /* @__PURE__ */ Object.create(null);
    const models = compiled[index2], assembly = [];
    for (const model of models) {
      solverFiles[`${safeId(model.pipelineId)}.lib`] = model.source;
      assembly.push({ simulationIbisModelId: model.pipelineId, definition: model.input.definition, run: model.input.run, spicePinMapping: model.spicePinMapping, sourceSha256: model.sourceSha256, spiceSha256: sha2563(model.source), sourceEvidence: model.sourceEvidence, metadata: model.metadata, warnings: model.warnings });
    }
    jsonFile(files, dir + "/native-ibis-assembly.json", assembly);
    jsonFile(files, dir + "/experiment.json", plan);
    solverFiles["simulation.cir"] = generalSimulationSpice(plan, geometry, modeling, extracted, models, declarations.nodes, electrical);
    onProgress(`Simulate ${plan.name} (${plan.probes.length} probes, ${plan.eyes.length} eyes)`);
    const solve = await executeSolver(runSolver, files, dir, { solver: "ngspice", files: solverFiles, args: ["-n", "-b", "simulation.cir"], outputFiles: ["waveform.dat"] });
    const diagnostic = (solve.stdout + "\n" + solve.stderr).split(/\r?\n/).find((line) => /\b(?:error|fatal|aborted|timestep too small)\b/i.test(line));
    if (diagnostic) fail("native_solver", `${plan.name}: ${diagnostic.trim()}`);
    const waveformText = solve.files["waveform.dat"];
    const rows = probeWaveformRows(waveformText, plan.probes);
    if (rows[0][0] > plan.startTimeSeconds + Math.max(plan.maxStepSeconds, plan.durationSeconds * 1e-8)) fail("simulation_start", `${plan.name}: solver output omits the beginning of the declared recording`);
    if (Math.abs(rows[rows.length - 1][0] - plan.durationSeconds) > plan.durationSeconds * 1e-8) fail("simulation_duration", `${plan.name}: native solver did not complete the declared duration`);
    files[dir + "/waveform.csv"] = "time_s," + plan.probes.map((probe) => probe.simulationVoltageProbeId + "_v").join(",") + "\n" + rows.map((row) => row.join(",")).join("\n") + "\n";
    jsonFile(files, dir + "/waveform.json", { simulationExperimentId: plan.simulationExperimentId, probes: plan.probes, samples: rows.length, timestamps: "actual adaptive solver times in seconds", source: "waveform.dat", sourceSha256: sha2563(waveformText) });
    const eyes = [];
    for (const eye of plan.eyes) {
      const assessment = ddrAssessments.find((a2) => a2.eye === eye), ddrAssessment = assessment ? assessDdr(rows, assessment) : void 0;
      const alignment = ddrAssessment ? "received-differential-dqs" : "stimulus-clock";
      const relativeEye = `eyes/${eye.simulationEyeDiagramId}`, eyeDir = dir + "/" + relativeEye, folded = foldProbeEye(
        rows,
        ddrAssessment ? { ...eye, captureTimesSeconds: ddrAssessment.captureTimesSeconds } : eye
      );
      files[eyeDir + "/eye-data.csv"] = "window,folded_time_s,time_s,voltage_v\n" + folded.samples.map((row) => row.join(",")).join("\n") + "\n";
      const descriptor = { ...eye, samples: folded.samples, alignment, ddrAssessment, directory: relativeEye, windows: folded.windows, pointsPerWindow: folded.pointsPerWindow, windowOriginsSeconds: folded.windowOriginsSeconds, boundaryIndices: folded.boundaryIndices, interpolation: "linear interpolation of actual adaptive solver timestamps", windowDefinition: ddrAssessment ? "[received DQS crossing + sampleOffset - UI, received DQS crossing + sampleOffset + UI]; capture at center; complete windows only" : "b_k=timeOrigin+k*UI; [b_k-UI/2,b_k+3*UI/2]; complete windows only", source: "../../waveform.csv", sourceSha256: sha2563(files[dir + "/waveform.csv"]), metrics: folded.metrics };
      jsonFile(files, eyeDir + "/eye-data.json", descriptor);
      eyes.push(descriptor);
    }
    jsonFile(files, dir + "/eyes.json", eyes);
    for (const probe of plan.probes) results.push(parseRecord({ type: "simulation_transient_voltage_graph", simulation_transient_voltage_graph_id: `simulation_transient_voltage_graph_${plan.simulationExperimentId}_${probe.column}`, simulation_experiment_id: plan.simulationExperimentId, simulation_voltage_probe_id: probe.simulationVoltageProbeId, timestamps_ms: rows.map((row) => row[0] * 1e3), voltage_levels: rows.map((row) => row[probe.column]), time_per_step: plan.maxStepSeconds * 1e3, start_time_ms: rows[0][0] * 1e3, end_time_ms: rows[rows.length - 1][0] * 1e3, name: probe.name }));
    experiments.push({ plan, waveform: { timeUnit: "s", voltageUnit: "V", rows }, simulationExperimentId: plan.simulationExperimentId, name: plan.name, directory: relative, durationSeconds: plan.durationSeconds, startTimeSeconds: plan.startTimeSeconds, maxStepSeconds: plan.maxStepSeconds, probes: plan.probes, eyes, solverInvocations: 1, waveformSamples: rows.length, assembly, assemblyFile: relative + "/native-ibis-assembly.json" });
  }
  for (const graph of results.filter((record) => record.type === "simulation_transient_voltage_graph")) if (pcbExperimentIds.has(graph.simulation_experiment_id) && !graph.simulation_voltage_probe_id) fail("result_schema", "Installed Circuit JSON schema discarded the result probe ID");
  jsonFile(files, "circuit-results.json", results);
  const limitations = [
    ...geometry.approximations,
    ...compiled.flatMap((models) => models.flatMap((model) => model.warnings ?? [])),
    "Only selected channel components/passives and explicit ideal source rails are simulated; unrelated board electronics excluded",
    "Finite observed transient eyes; no implicit traffic, random jitter, BER extrapolation, protocol compliance or hardware accuracy claim",
    "Maximum solver integration step and display resolution are separate settings"
  ];
  return { circuitJson, simulationResultCircuitJson: results, modeling, geometry, matrices: extracted, experiments, limitations, files };
}

// src/viewer-client.generated.ts
var browserClient = "// Serialized as a standalone function so results.html works offline, including file://.\nfunction viewerClient() {\n    const data = JSON.parse(document.getElementById('simulation-data').textContent);\n    const $ = (id) => document.getElementById(id);\n    const runSelect = $('run'), probeSelect = $('probe'), eyeSelect = $('eye');\n    const overlay = $('overlay'), canvas = $('plot'), ctx = canvas.getContext('2d');\n    const colors = ['#2563eb', '#e96535', '#159c80', '#a855d0'];\n    let mode = 'waveform', xMin = 0, xMax = 1, fullMin = 0, fullMax = 1, drag = null;\n    let width = 1, height = 1, plotWidth = 1, plotHeight = 1, yMin = 0, yMax = 1;\n    const pad = { left: 68, right: 24, top: 28, bottom: 48 };\n    const selectedRun = () => data.runs[Number(runSelect.value)];\n    const selectedProbe = () => selectedRun().probes[Number(probeSelect.value)];\n    const selectedEye = () => selectedRun().eyes[Number(eyeSelect.value)];\n    const nearestIndex = (rows, time) => {\n        let a = 0, b = rows.length - 1;\n        while (a < b) {\n            const middle = Math.floor((a + b) / 2);\n            if (rows[middle][0] < time)\n                a = middle + 1;\n            else\n                b = middle;\n        }\n        return a;\n    };\n    const series = () => {\n        const probe = selectedProbe();\n        return (overlay.checked ? data.runs : [selectedRun()]).flatMap(run => {\n            const match = run.probes.find(item => item.name === probe.name);\n            return match ? [{ run, probe: match }] : [];\n        });\n    };\n    const option = (parent, label, value) => { const item = document.createElement('option'); item.textContent = label; item.value = String(value); parent.append(item); };\n    data.runs.forEach((run, i) => option(runSelect, run.name, i));\n    overlay.disabled = data.runs.length < 2;\n    overlay.checked = Boolean(data.changes?.length) && data.runs.length > 1;\n    const updateProbes = () => {\n        const previous = probeSelect.selectedOptions[0]?.textContent ?? data.comparisonProbeName;\n        probeSelect.replaceChildren();\n        selectedRun().probes.forEach((probe, i) => option(probeSelect, probe.name, i));\n        const match = selectedRun().probes.findIndex(probe => probe.name === previous);\n        if (match >= 0)\n            probeSelect.value = String(match);\n        updateEyes();\n    };\n    const updateEyes = () => {\n        eyeSelect.replaceChildren();\n        selectedRun().eyes.forEach((eye, i) => { if (eye.simulationVoltageProbeId === selectedProbe().simulationVoltageProbeId)\n            option(eyeSelect, eye.name, i); });\n        $('eye-button').toggleAttribute('disabled', !eyeSelect.options.length);\n        if (!eyeSelect.options.length)\n            mode = 'waveform';\n        reset();\n    };\n    const reset = () => {\n        const curves = series();\n        fullMin = mode === 'eye' ? 0 : Math.min(...curves.map(({ run }) => run.rows[0][0]));\n        fullMax = mode === 'eye' ? 2 * selectedEye().unitIntervalSeconds : Math.max(...curves.map(({ run }) => run.rows.at(-1)[0]));\n        xMin = fullMin;\n        xMax = fullMax;\n        draw();\n    };\n    const format = (value) => Number(value.toPrecision(6)).toString();\n    const draw = () => {\n        width = canvas.clientWidth;\n        height = canvas.clientHeight;\n        canvas.width = width * devicePixelRatio;\n        canvas.height = height * devicePixelRatio;\n        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);\n        plotWidth = width - pad.left - pad.right;\n        plotHeight = height - pad.top - pad.bottom;\n        ctx.clearRect(0, 0, width, height);\n        const curves = series();\n        yMin = Infinity;\n        yMax = -Infinity;\n        for (const { run, probe } of curves)\n            for (const row of run.rows) {\n                yMin = Math.min(yMin, row[probe.column]);\n                yMax = Math.max(yMax, row[probe.column]);\n            }\n        const margin = Math.max((yMax - yMin) * .08, .02);\n        yMin -= margin;\n        yMax += margin;\n        const sx = (x) => pad.left + (x - xMin) / (xMax - xMin) * plotWidth;\n        const sy = (y) => pad.top + (yMax - y) / (yMax - yMin) * plotHeight;\n        ctx.font = '12px system-ui';\n        ctx.lineWidth = 1;\n        for (let i = 0; i <= 5; i++) {\n            const x = pad.left + i / 5 * plotWidth, y = pad.top + i / 5 * plotHeight;\n            ctx.strokeStyle = '#e8edf2';\n            ctx.beginPath();\n            ctx.moveTo(x, pad.top);\n            ctx.lineTo(x, height - pad.bottom);\n            ctx.moveTo(pad.left, y);\n            ctx.lineTo(width - pad.right, y);\n            ctx.stroke();\n            ctx.fillStyle = '#65758a';\n            ctx.textAlign = 'center';\n            ctx.fillText(format((xMin + i / 5 * (xMax - xMin)) * 1e9), x, height - 22);\n            ctx.textAlign = 'right';\n            ctx.fillText(format(yMax - i / 5 * (yMax - yMin)), pad.left - 10, y + 4);\n        }\n        ctx.textAlign = 'left';\n        ctx.fillText('Voltage (V)', 12, 14);\n        ctx.textAlign = 'center';\n        ctx.fillText(mode === 'eye' ? 'Time within two UI (ns)' : 'Time (ns)', pad.left + plotWidth / 2, height - 3);\n        ctx.save();\n        ctx.beginPath();\n        ctx.rect(pad.left, pad.top, plotWidth, plotHeight);\n        ctx.clip();\n        const drawRows = (rows, column, start, end, origin) => {\n            // Per-pixel first/min/max/last envelopes preserve narrow peaks during zoom.\n            // Raw samples and metric calculations are never reduced.\n            let bucket = -Infinity, points = [];\n            const flush = () => {\n                if (!points.length)\n                    return;\n                let low = points[0], high = points[0];\n                for (const p of points) {\n                    if (p[1] < low[1])\n                        low = p;\n                    if (p[1] > high[1])\n                        high = p;\n                }\n                const chosen = [...new Set([points[0], low, high, points.at(-1)])].sort((a, b) => a[0] - b[0]);\n                for (const [x, y] of chosen)\n                    ctx.lineTo(sx(x - origin), sy(y));\n            };\n            const first = Math.max(0, nearestIndex(rows, start) - 1), last = Math.min(rows.length - 1, nearestIndex(rows, end));\n            ctx.beginPath();\n            ctx.moveTo(sx(rows[first][0] - origin), sy(rows[first][column]));\n            for (let i = first; i <= last; i++) {\n                const p = rows[i], next = Math.floor(sx(p[0] - origin));\n                if (next !== bucket) {\n                    flush();\n                    points = [];\n                    bucket = next;\n                }\n                points.push([p[0], p[column]]);\n            }\n            flush();\n            ctx.stroke();\n        };\n        curves.forEach(({ run, probe }, i) => {\n            ctx.strokeStyle = colors[i % colors.length];\n            ctx.lineWidth = mode === 'eye' ? .8 : 1.6;\n            ctx.globalAlpha = mode === 'eye' ? .2 : 1;\n            if (mode === 'waveform')\n                drawRows(run.rows, probe.column, xMin, xMax, 0);\n            else {\n                const eye = run.eyes.find(e => e.simulationVoltageProbeId === probe.simulationVoltageProbeId && e.name === selectedEye().name)\n                    ?? run.eyes.find(e => e.simulationVoltageProbeId === probe.simulationVoltageProbeId);\n                if (eye && eye.unitIntervalSeconds === selectedEye().unitIntervalSeconds)\n                    for (const origin of eye.windowOriginsSeconds)\n                        drawRows(run.rows, probe.column, origin + xMin, origin + xMax, origin);\n            }\n        });\n        ctx.restore();\n        ctx.globalAlpha = 1;\n        $('legend').replaceChildren();\n        curves.forEach(({ run, probe }, i) => { const item = document.createElement('span'); item.textContent = `${run.name} \xB7 ${probe.name}`; item.style.color = colors[i % colors.length]; $('legend').append(item); });\n        $('selection').textContent = `${selectedRun().name} / ${selectedProbe().name}`;\n        $('binding').textContent = `Measured voltage = ${selectedProbe().signalLabel ?? selectedProbe().signalSourceId ?? 'recorded signal'} \u2212 ${selectedProbe().referenceLabel ?? selectedProbe().referenceSourceId ?? 'channel ground'}`;\n        if (mode === 'eye') {\n            const eye = selectedEye();\n            $('binding').textContent += eye.alignment === 'received-differential-dqs'\n                ? ` \xB7 Received DQS alignment; capture at ${format(eye.unitIntervalSeconds * 1e9)} ns \xB7 ${eye.windowOriginsSeconds.length} complete windows \xB7 ${eye.ddrAssessment?.status ?? 'not-evaluated'} \xB7 DDR compliance not evaluated`\n                : ' \xB7 Declared stimulus clock alignment';\n        }\n        $('sample-count').textContent = curves.map(({ run }) => run.rows.length.toLocaleString()).join(' + ') + ' actual samples';\n        $('waveform-button').setAttribute('aria-pressed', String(mode === 'waveform'));\n        $('eye-button').setAttribute('aria-pressed', String(mode === 'eye'));\n        $('eye-field').hidden = mode !== 'eye';\n        $('start').value = format(xMin * 1e9);\n        $('end').value = format(xMax * 1e9);\n    };\n    const limit = () => { const span = Math.min(xMax - xMin, fullMax - fullMin); xMin = Math.max(fullMin, Math.min(xMin, fullMax - span)); xMax = xMin + span; };\n    const tabs = Array.from(document.querySelectorAll('[data-tab]'));\n    const activateTab = (id) => {\n        for (const tab of tabs) {\n            const active = tab.dataset.tab === id;\n            $(tab.dataset.tab).hidden = !active;\n            tab.setAttribute('aria-selected', String(active));\n            tab.tabIndex = active ? 0 : -1;\n        }\n        if (id === 'explore')\n            draw();\n    };\n    tabs.forEach((tab, i) => {\n        tab.onclick = () => activateTab(tab.dataset.tab);\n        tab.onkeydown = event => {\n            const next = event.key === 'ArrowRight' ? (i + 1) % tabs.length : event.key === 'ArrowLeft' ? (i + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;\n            if (next >= 0) {\n                event.preventDefault();\n                tabs[next].focus();\n                activateTab(tabs[next].dataset.tab);\n            }\n        };\n    });\n    runSelect.onchange = updateProbes;\n    probeSelect.onchange = updateEyes;\n    eyeSelect.onchange = reset;\n    overlay.onchange = reset;\n    $('waveform-button').onclick = () => { mode = 'waveform'; reset(); };\n    $('eye-button').onclick = () => { if (eyeSelect.options.length) {\n        mode = 'eye';\n        reset();\n    } };\n    $('reset').onclick = reset;\n    canvas.ondblclick = reset;\n    $('csv').onclick = event => {\n        event.preventDefault();\n        const run = selectedRun(), quote = (value) => `\"${value.replace(/\"/g, '\"\"')}\"`;\n        const csv = ['time_s,' + run.probes.map(probe => quote(probe.name + '_v')).join(','),\n            ...run.rows.map(row => [row[0], ...run.probes.map(probe => row[probe.column])].join(','))].join('\\n') + '\\n';\n        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), anchor = document.createElement('a');\n        anchor.href = url;\n        anchor.download = run.name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.csv';\n        anchor.click();\n        setTimeout(() => URL.revokeObjectURL(url), 1000);\n    };\n    const applyRange = () => { const a = Number($('start').value) * 1e-9, b = Number($('end').value) * 1e-9; if (Number.isFinite(a) && Number.isFinite(b) && b > a) {\n        xMin = a;\n        xMax = b;\n        limit();\n    } ; draw(); };\n    $('start').onchange = applyRange;\n    $('end').onchange = applyRange;\n    canvas.addEventListener('wheel', event => {\n        event.preventDefault();\n        const fraction = Math.max(0, Math.min(1, (event.offsetX - pad.left) / plotWidth)), anchor = xMin + fraction * (xMax - xMin);\n        const span = Math.max((fullMax - fullMin) * 1e-7, (xMax - xMin) * (event.deltaY > 0 ? 1.2 : 1 / 1.2));\n        xMin = anchor - fraction * span;\n        xMax = xMin + span;\n        limit();\n        draw();\n    }, { passive: false });\n    canvas.onpointerdown = event => { drag = { x: event.offsetX, min: xMin, max: xMax }; canvas.setPointerCapture(event.pointerId); };\n    canvas.onpointerup = () => { drag = null; };\n    canvas.onpointercancel = () => { drag = null; };\n    canvas.onpointermove = event => {\n        if (drag) {\n            const shift = (event.offsetX - drag.x) / plotWidth * (drag.max - drag.min);\n            xMin = drag.min - shift;\n            xMax = drag.max - shift;\n            limit();\n            draw();\n        }\n        else if (mode === 'waveform') {\n            const time = xMin + (event.offsetX - pad.left) / plotWidth * (xMax - xMin), run = selectedRun(), probe = selectedProbe();\n            const index = nearestIndex(run.rows, time), point = run.rows[index];\n            $('cursor').textContent = `${format(point[0] * 1e9)} ns \xB7 ${format(point[probe.column])} V \xB7 actual sample ${index + 1}`;\n        }\n    };\n    $('summary').textContent = `${data.runs.length} runs \xB7 ${new Set(data.runs.flatMap(run => run.probes.map(probe => probe.name))).size} probes \xB7 ${data.runs.reduce((sum, run) => sum + run.eyes.length, 0)} eyes`;\n    document.querySelectorAll('[data-run]').forEach(button => {\n        button.onclick = () => {\n            runSelect.value = button.dataset.run;\n            overlay.checked = false;\n            updateProbes();\n            probeSelect.value = button.dataset.probe;\n            mode = button.dataset.mode;\n            updateEyes();\n            activateTab('explore');\n        };\n    });\n    updateProbes();\n    new ResizeObserver(draw).observe(canvas);\n}\n";

// src/report.ts
var html = (value2) => String(value2 ?? "").replace(/[&<>"']/g, (c2) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c2]);
var number = (value2, unit = "", scale3 = 1) => value2 === void 0 ? "Not recorded" : `${Number((value2 * scale3).toPrecision(6))}${unit ? ` ${unit}` : ""}`;
var csv = (rows) => rows.map((row) => row.map((value2) => typeof value2 === "number" ? String(value2) : `"${String(value2 ?? "").replace(/"/g, '""')}"`).join(",")).join("\n") + "\n";
var table2 = (heads, rows) => `<div class="table-scroll"><table><thead><tr>${heads.map((h) => `<th>${html(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${html(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
var label = (context, id2) => id2 ? context?.ports[id2] ?? id2 : "Channel ground";
var probeLabels = (probe, context) => [probe.signalLabel ?? (probe.signalSourceId ? label(context, probe.signalSourceId) : "Recorded signal"), probe.referenceLabel ?? label(context, probe.referenceSourceId)];
var tracePath = (points2) => {
  let connected = false;
  return points2.map((point) => {
    if (point.start && point.end) {
      connected = true;
      return `M${point.start.x},${-point.start.y} L${point.end.x},${-point.end.y}`;
    }
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      connected = false;
      return "";
    }
    const command = connected ? "L" : "M";
    connected = true;
    return `${command}${point.x},${-point.y}`;
  }).join(" ");
};
function reportContext(circuit, geometry, modeling) {
  const ports = {};
  const components = new Map(circuit.filter((e) => e.type === "source_component").map((e) => [e.source_component_id, e]));
  for (const port of circuit.filter((e) => e.type === "source_port")) {
    const component = components.get(port.source_component_id ?? "");
    ports[port.source_port_id] = `${component?.name ?? port.source_component_id}.${port.name ?? `pin${port.pin_number}`}`;
  }
  const counts = /* @__PURE__ */ new Map();
  for (const value2 of Object.values(ports)) counts.set(value2, (counts.get(value2) ?? 0) + 1);
  for (const [id2, value2] of Object.entries(ports)) if (counts.get(value2) > 1) ports[id2] = `${value2} (${id2})`;
  for (const net of circuit.filter((e) => e.type === "source_net")) ports[net.source_net_id] = net.name;
  const sourcePorts = new Map(circuit.filter((e) => e.type === "source_port").map((port) => [port.source_port_id, port]));
  const used = /* @__PURE__ */ new Set();
  const usePort = (id2) => {
    const component = sourcePorts.get(id2 ?? "")?.source_component_id;
    if (component) used.add(component);
  };
  for (const lane of geometry.mappings) {
    usePort(lane.from);
    usePort(lane.to);
  }
  for (const selection of modeling.passiveComponents ?? []) for (const [id2, component] of components)
    if (selection.sourceComponentId ? selection.sourceComponentId === id2 : selection.component === component.name) used.add(id2);
  for (const source of circuit.filter((e) => e.type === "simulation_voltage_source")) for (const id2 of source.is_dc_source ? [source.positive_source_port_id, source.negative_source_port_id] : [source.terminal1_source_port_id, source.terminal2_source_port_id]) usePort(id2);
  for (const supply of modeling.supplies ?? []) {
    usePort(selectPort(circuit, supply.positive).source_port_id);
    usePort(selectPort(circuit, supply.negative).source_port_id);
  }
  const boardComponents = circuit.filter((e) => e.type === "pcb_component").filter((e) => e.do_not_place !== true).map((component) => ({
    id: component.pcb_component_id,
    name: components.get(component.source_component_id)?.name ?? component.pcb_component_id,
    x: component.center.x,
    y: component.center.y,
    width: component.width,
    height: component.height,
    used: used.has(component.source_component_id)
  }));
  const outlines = circuit.filter((e) => e.type === "pcb_board").flatMap((board) => !board.outline?.length && board.width !== void 0 && board.height !== void 0 ? [{ x: board.center.x, y: board.center.y, width: board.width, height: board.height }] : []);
  const outlinePoints = circuit.filter((e) => e.type === "pcb_board").flatMap((board) => board.outline ?? []);
  const outlinePaths = circuit.filter((e) => e.type === "pcb_board").flatMap((board) => board.outline?.length ? [tracePath(board.outline) + " Z"] : []);
  const allPoints = circuit.filter((e) => e.type === "pcb_trace").flatMap((trace) => trace.route).flatMap((point) => point.route_type === "through_pad" ? [point.start, point.end] : [{ x: point.x, y: point.y }]);
  allPoints.push(...outlinePoints);
  for (const box of [...boardComponents, ...outlines]) for (const sign of [-1, 1]) allPoints.push({ x: box.x + sign * box.width / 2, y: box.y + sign * box.height / 2 });
  const bounds = allPoints.reduce(
    (b, point) => ({ minX: Math.min(b.minX, point.x), maxX: Math.max(b.maxX, point.x), minY: Math.min(b.minY, point.y), maxY: Math.max(b.maxY, point.y) }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  );
  return {
    description: modeling.description,
    ports,
    board: allPoints.length ? {
      bounds,
      outlines,
      outlinePaths,
      components: boardComponents,
      traces: circuit.filter((e) => e.type === "pcb_trace").map((trace) => ({ id: trace.pcb_trace_id, path: tracePath(trace.route) }))
    } : void 0,
    lanes: geometry.mappings.map((lane) => ({
      name: lane.port,
      from: lane.from,
      to: lane.to,
      sourceTraceId: lane.sourceTraceId,
      pcbTraceId: lane.pcbTraceId,
      lengthMm: lane.stages.reduce((sum3, stage) => sum3 + stage.lengthMm, 0),
      layers: lane.stages.map((stage) => stage.profile),
      widthsMm: [...new Set(lane.stages.filter((stage) => stage.kind === "wire").map((stage) => stage.widthMm))],
      vias: lane.stages.filter((stage) => stage.kind === "via").length,
      route: lane.originalRoute.map(({ x: x2, y: y2 }) => ({ x: x2, y: y2 }))
    })),
    settings: [
      ["Channel model", modeling.reduction === "routed-copper" ? "Original routed signals and inferred ground copper polygons, with mutual R/L/C coupling" : "Straightened stages from selected routed traces, with full mutual R/L/C coupling and an explicit finite return conductor"],
      ["R/L model frequency", number(modeling.extraction.modelHz, "MHz", 1e-6)],
      ["Extraction frequency range", `${number(modeling.extraction.minimumHz, "Hz")} to ${number(modeling.extraction.maximumHz, "MHz", 1e-6)}`],
      ["Lumped sections per stage", String(modeling.sections)],
      ["Conductivity", geometry.stackup?.copperLayers.map((layer2) => `${layer2.name}: ${number(layer2.conductivitySm, "S/m")}`).join("; ") ?? number(geometry.cells?.[0]?.conductivitySm ?? 58e6, "S/m")],
      ...(modeling.supplies ?? []).map((s, i) => [
        `Declared supply ${i + 1}`,
        `${number(s.voltageV, "V DC")}; ${ports[selectPort(circuit, s.positive).source_port_id]} \u2212 ${ports[selectPort(circuit, s.negative).source_port_id]}`
      ]),
      ...circuit.filter((e) => e.type === "simulation_voltage_source").map((s) => [
        "Physical voltage source",
        `${number(s.voltage, "V")} ${s.is_dc_source || !s.wave_shape ? "DC" : s.wave_shape}; ${label({ ports }, s.is_dc_source ? s.positive_source_port_id ?? s.positive_source_net_id : s.terminal1_source_port_id)} \u2212 ${label({ ports }, s.is_dc_source ? s.negative_source_port_id ?? s.negative_source_net_id : s.terminal2_source_port_id)}`
      ]),
      ...modeling.reduction === "routed-copper" ? [["Ground mesh spacing", number(modeling.extraction.groundMeshMm, "mm")], ["Homogeneous relative permittivity", number(modeling.relativePermittivity ?? geometry.stackup?.relativePermittivity)]] : [],
      ...Object.entries(modeling.profiles ?? {}).map(([name, profile2]) => [
        name + " material / return",
        `Signal center spacing ${number(profile2.spacingMm, "mm")}; relative permittivity ${number(profile2.relativePermittivity)}; return width ${number(profile2.return.widthMm, "mm")}, thickness ${number(profile2.return.thicknessMm, "mm")}, center y/z ${number(profile2.return.centerYMm, "mm")} / ${number(profile2.return.centerZMm, "mm")}, length factor ${profile2.return.lengthFactor}`
      ])
    ]
  };
}
function reportFiles(data) {
  const files = [], summaries = [], probes = [], tests = [], eyes = [], assessments = [];
  const add = (path, label2, description, content) => files.push({ path: "csv/" + path, label: label2, description, content });
  data.runs.forEach((run, i) => {
    const prefix = `${String(i + 1).padStart(2, "0")}-${run.name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 64) || "experiment"}`;
    add(
      `${prefix}-waveforms.csv`,
      `${run.name} \xB7 full waveforms`,
      `${run.rows.length.toLocaleString("en-US")} recorded adaptive timestamps; time in seconds, voltage in volts.`,
      csv([["time_s", ...run.probes.map((p2) => p2.name + "_v")], ...run.rows.map((row) => [row[0], ...run.probes.map((p2) => row[p2.column])])])
    );
    for (const probe of run.probes) {
      let minimum = Infinity, maximum = -Infinity;
      for (const row of run.rows) {
        minimum = Math.min(minimum, row[probe.column]);
        maximum = Math.max(maximum, row[probe.column]);
      }
      summaries.push([i + 1, run.name, probe.name, ...probeLabels(probe, data.context), run.rows.length, run.rows[0][0], run.rows.at(-1)[0], minimum, maximum]);
      probes.push([run.name, probe.name, probe.name + "_v", ...probeLabels(probe, data.context), probe.signalSourceId, probe.referenceSourceId, probe.simulationVoltageProbeId]);
    }
    for (const stimulus of run.test?.stimuli ?? []) tests.push([
      i + 1,
      run.name,
      label(data.context, stimulus.source_port_id),
      stimulus.transmission_pattern.bits,
      stimulus.transmission_pattern.repeat,
      Boolean(stimulus.inverted),
      stimulus.initial_state,
      stimulus.bit_duration_ms / 1e3,
      stimulus.start_time_ms / 1e3,
      run.test.startTimeSeconds,
      run.test.durationSeconds,
      run.test.maxStepSeconds
    ]);
    run.eyes.forEach((eye, index2) => {
      eyes.push([
        run.name,
        eye.name,
        run.probes.find((p2) => p2.simulationVoltageProbeId === eye.simulationVoltageProbeId)?.name,
        eye.startTimeSeconds,
        eye.endTimeSeconds,
        eye.unitIntervalSeconds,
        eye.timeOriginSeconds,
        eye.windows ?? eye.windowOriginsSeconds?.length,
        eye.metrics?.voltageRangeV[0],
        eye.metrics?.voltageRangeV[1]
      ]);
      if (eye.csv !== void 0) add(`${prefix}-eye-${index2 + 1}.csv`, `${run.name} \xB7 ${eye.name}`, "Complete folded eye samples, linearly interpolated from recorded waveforms; both original and folded time in seconds.", eye.csv);
      const ddr = eye.ddrAssessment;
      if (ddr) {
        assessments.push([
          run.name,
          ddr.name,
          ddr.status,
          ddr.checks.status,
          ddr.compliance.status,
          ddr.strobe.status,
          ddr.checks.captures,
          ddr.checks.violations,
          ddr.checks.unevaluated,
          ddr.reasons.join("; "),
          JSON.stringify(ddr.config)
        ]);
        add(
          `${prefix}-ddr-${index2 + 1}.csv`,
          `${run.name} \xB7 ${ddr.name} timing checks`,
          "Every observed received DQS edge; interpolated AC setup and DC hold margins. Blank values are not evaluated. No DDR compliance claim.",
          csv([
            ["strobe_s", "capture_s", "rising", "dq_v", "level", "status", "ac_setup_s", "dc_hold_s", "setup_margin_s", "hold_margin_s", "dc_margin_v", "setup_lower_bound", "hold_lower_bound", "reason"],
            ...ddr.captures.map((c2) => [
              c2.strobeTimeSeconds,
              c2.sampleTimeSeconds,
              c2.rising,
              c2.voltageV,
              c2.level,
              c2.status,
              c2.setupSeconds,
              c2.holdSeconds,
              c2.setupMarginSeconds,
              c2.holdMarginSeconds,
              c2.dcMarginV,
              c2.setupIsLowerBound,
              c2.holdIsLowerBound,
              c2.reason
            ])
          ])
        );
      }
    });
  });
  const overview = [];
  const summary = (path, label2, description, rows) => overview.push({ path: "csv/" + path, label: label2, description, content: csv(rows) });
  summary(
    "results-summary.csv",
    "Results summary",
    "One row per experiment and measured probe; voltage extrema over the full recorded time range.",
    [["order", "experiment", "probe", "signal", "reference", "samples", "start_s", "end_s", "minimum_v", "maximum_v"], ...summaries]
  );
  summary(
    "probe-map.csv",
    "Probe and column map",
    "What each voltage column measures: signal minus reference.",
    [["experiment", "probe", "csv_column", "signal", "reference", "signal_source_id", "reference_source_id", "probe_id"], ...probes]
  );
  if (data.context) summary(
    "trace-map.csv",
    "Selected trace map",
    "Physical endpoints, original trace IDs, total modeled path length including via barrels, wire widths and ordered stages.",
    [
      ["trace", "driver", "receiver", "source_trace_id", "pcb_trace_id", "length_mm", "wire_widths_mm", "stage_order", "vias"],
      ...data.context.lanes.map((lane) => [lane.name, label(data.context, lane.from), label(data.context, lane.to), lane.sourceTraceId, lane.pcbTraceId, lane.lengthMm, lane.widthsMm.join(" / "), lane.layers.join(" > "), lane.vias])
    ]
  );
  if (tests.length) summary(
    "test-plan.csv",
    "Experiment and stimulus plan",
    "Declared bits before optional inversion; one row per driven signal. Timing units are seconds.",
    [["order", "experiment", "drives", "bits", "repeat", "inverted", "initial_state_before_inversion", "unit_interval_s", "stimulus_start_s", "recording_start_s", "simulation_end_s", "maximum_step_s"], ...tests]
  );
  if (eyes.length) summary(
    "eye-summary.csv",
    "Eye measurement summary",
    "Declared measurement gates, folding origins and finite observed voltage ranges. No eye opening or compliance estimate.",
    [["experiment", "eye", "probe", "gate_start_s", "gate_end_s", "unit_interval_s", "origin_s", "complete_windows", "minimum_v", "maximum_v"], ...eyes]
  );
  if (assessments.length) summary(
    "ddr-summary.csv",
    "Configured DDR checks",
    "Illustrative unless complete characterization evidence is supplied. Compliance is always not evaluated. Configuration includes every explicit limit and its evidence.",
    [["experiment", "assessment", "status", "configured_checks", "compliance", "strobe", "captures", "violations", "unevaluated", "reason", "config_json"], ...assessments]
  );
  if (data.changes?.length) summary(
    "comparison.csv",
    "Quiet versus switching measurements",
    "Switching minus quiet; extrema of piecewise-linear recorded data, with RMS integrated over the stated gate.",
    [
      ["probe", "quiet", "switching", "gate_start_s", "gate_end_s", "peak_absolute_difference_v", "time_rms_difference_v"],
      ...data.changes.map((c2) => [data.comparisonProbeName, c2.quiet, c2.active, c2.startSeconds, c2.endSeconds, c2.peakAbsoluteV, c2.timeRmsV])
    ]
  );
  return [...overview, ...files];
}
function routeDrawing(context) {
  const points2 = context.lanes.flatMap((lane) => lane.route);
  if (!points2.length) return "";
  const colors = ["#2563eb", "#e96535", "#159c80"], board = context.board;
  const boxes = board?.components.filter((component) => component.used) ?? [];
  const selectedBounds = points2.reduce(
    (b, p2) => ({ minX: Math.min(b.minX, p2.x), maxX: Math.max(b.maxX, p2.x), minY: Math.min(b.minY, p2.y), maxY: Math.max(b.maxY, p2.y) }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  );
  const full = board?.bounds ?? selectedBounds;
  const view = (bounds) => {
    const margin = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1) * 0.06 + 0.5;
    return `${bounds.minX - margin} ${-bounds.maxY - margin} ${bounds.maxX - bounds.minX + 2 * margin} ${bounds.maxY - bounds.minY + 2 * margin}`;
  };
  const selectedIds = new Set(context.lanes.map((lane) => lane.pcbTraceId)), fontSize = Math.max((full.maxX - full.minX) / 75, 0.5);
  const rect = (box) => `x="${box.x - box.width / 2}" y="${-box.y - box.height / 2}" width="${box.width}" height="${box.height}"`;
  return `<div class="route-map"><div class="board-toolbar">${board?.traces.length ?? context.lanes.length} traces \xB7 ${board?.components.length ?? 0} components \xB7 all copper layers</div><svg id="board-diagram" viewBox="${view(full)}" role="img" aria-label="Board overview: unused traces and component bounds in gray; simulated traces and components highlighted">
    <g class="board-outline">${board?.outlines.map((box) => `<rect ${rect(box)}/>`).join("") ?? ""}${board?.outlinePaths.map((path) => `<path d="${path}"/>`).join("") ?? ""}</g>
    <g class="unused-components">${board?.components.filter((component) => !component.used).map((component) => `<rect ${rect(component)} data-component="${html(component.id)}"><title>${html(component.name)} \xB7 outside this simulation</title></rect>`).join("") ?? ""}</g>
    <g class="unused-traces">${board?.traces.filter((trace) => !selectedIds.has(trace.id)).map((trace) => `<path d="${trace.path}" data-trace="${html(trace.id)}"><title>${html(trace.id)} \xB7 outside this simulation</title></path>`).join("") ?? ""}</g>
    <g class="used-components">${boxes.map((component) => `<rect ${rect(component)} data-component="${html(component.id)}"><title>${html(component.name)} \xB7 used by this simulation</title></rect>`).join("")}</g>
    <g class="used-traces">${context.lanes.map((lane, i) => `<g stroke="${colors[i % colors.length]}"><path d="${tracePath(lane.route)}" data-trace="${html(lane.pcbTraceId)}"><title>${html(lane.name)}: ${html(label(context, lane.from))} \u2192 ${html(label(context, lane.to))}</title></path>${[lane.route[0], lane.route.at(-1)].map((p2, endpoint) => `<circle cx="${p2.x}" cy="${-p2.y}" r=".22" fill="${endpoint ? colors[i % colors.length] : "#fff"}"><title>${endpoint ? "Receiver" : "Driver"}: ${html(label(context, endpoint ? lane.to : lane.from))}</title></circle>`).join("")}</g>`).join("")}</g>
    <g class="component-labels" font-size="${fontSize}">${boxes.map((box) => `<text x="${box.x}" y="${-box.y + fontSize / 3}">${html(box.name)}</text>`).join("")}</g>
    </svg><div class="board-legend">${context.lanes.map((lane, i) => `<span style="color:${colors[i % colors.length]}">\u25CF ${html(lane.name)}</span>`).join("")}<span class="component-key">\u25A3 Simulated components</span><span class="unused-key">\u2014 Context only</span></div><p class="hint">Top view \xB7 component bounds \xB7 gray geometry is outside this simulation.</p></div>`;
}
function bufferState(state) {
  if (state.is_output) return ["output", String(state.is_output_enabled)];
  return ["input", "\u2014"];
}
function ddrFindings(eyes) {
  return eyes.flatMap((eye) => eye.ddrAssessment ? [eye.ddrAssessment] : []).map((d2) => {
    const c2 = d2.config, t = c2.thresholds;
    const minimum = (key) => {
      const values = d2.captures.flatMap((c3) => c3[key] === void 0 ? [] : [c3[key]]);
      return values.length ? number(Math.min(...values), "ps", 1e12) : "Not evaluated";
    };
    return `<h3>${html(d2.name)} \xB7 ${html(d2.status)}</h3><p>DDR compliance: ${html(d2.compliance.status)}. ${html(d2.compliance.reason)}</p>
      ${d2.reasons.map((reason) => `<p>${html(reason)}</p>`).join("")}
      ${table2(["Received reference", "Configured checks", "Violations / captures", "Min AC setup margin", "Min DC hold margin"], [[d2.strobeProbe, d2.checks.status, `${d2.checks.violations} / ${d2.checks.captures} (${d2.checks.unevaluated} unevaluated)`, minimum("setupMarginSeconds"), minimum("holdMarginSeconds")]])}
      <details open><summary>Explicit receiver limits and assumptions</summary>${table2(["Limit", "Value"], [
      ["Direction / sample offset", `${c2.direction}; ${number(c2.sampleOffsetSeconds, "ps", 1e12)} after received DQS crossing`],
      ["VREF", number(c2.vrefV, "V")],
      ["VIL(AC) / VIL(DC)", `${number(t.vilAcV, "V")} / ${number(t.vilDcV, "V")}`],
      ["VIH(DC) / VIH(AC)", `${number(t.vihDcV, "V")} / ${number(t.vihAcV, "V")}`],
      ["Required setup / hold", `${number(c2.setupSeconds, "ps", 1e12)} / ${number(c2.holdSeconds, "ps", 1e12)}`],
      ["DQS magnitude / interval tolerance", `${number(c2.minimumStrobeDifferentialV, "V")} / ${number(c2.maximumStrobeIntervalErrorSeconds, "ps", 1e12)}`],
      ["Characterization evidence", c2.characterization ? Object.entries(c2.characterization).map(([key, value2]) => `${key}: ${value2}`).join("; ") : "Absent; illustrative limits only"]
    ])}<p>${d2.limitations.map(html).join("<br>")}</p></details>`;
  }).join("");
}
function reportSections(data, files) {
  const context = data.context, observed = new Set(data.runs.flatMap((run) => run.probes.filter((p2) => p2.name === data.comparisonProbeName).map((p2) => p2.signalSourceId)));
  const traces = context ? `<div class="board-layout">${routeDrawing(context)}<aside class="trace-inspector"><h2>Selected network</h2>${context.lanes.map((lane, i) => `<div class="trace-row"><h3><span style="color:${["#2563eb", "#e96535", "#159c80"][i % 3]}">\u25CF</span> ${html(lane.name)} <small>${data.changes?.length && observed.size ? observed.has(lane.to) ? "Victim" : "Neighbor" : ""}</small></h3><div class="pin-pair">${html(label(context, lane.from))} \u2192 ${html(label(context, lane.to))}</div><dl><dt>Path length</dt><dd>${number(lane.lengthMm, "mm")}</dd><dt>Wire width</dt><dd>${lane.widthsMm.map((v2) => number(v2, "mm")).join(" / ")}</dd><dt>Vias</dt><dd>${lane.vias}</dd></dl><div class="hint">${html(lane.layers.join(" \u2192 "))}</div></div>`).join("")}<details><summary>Trace IDs</summary>${table2(["Trace", "Source / PCB ID"], context.lanes.map((lane) => [lane.name, `${lane.sourceTraceId} / ${lane.pcbTraceId}`]))}</details></aside></div>` : "<p>Trace geometry unavailable.</p>";
  const plan = data.runs.map((run) => `<article class="test-card"><h2>${html(run.name)}</h2>${run.test ? `<p class="hint">${number(run.test.startTimeSeconds, "ns", 1e9)}\u2013${number(run.test.durationSeconds, "ns", 1e9)} \xB7 max step ${number(run.test.maxStepSeconds, "ps", 1e12)} \xB7 ${run.rows.length.toLocaleString("en-US")} samples</p>${table2(["Trace / driver", "Drive bits", "Schedule", "Initial bit"], run.test.stimuli.map((s) => [
    `${context?.lanes.find((lane) => lane.from === s.source_port_id)?.name ?? "Signal"} \xB7 ${label(context, s.source_port_id)}`,
    s.inverted ? s.transmission_pattern.bits.replace(/[01]/g, (bit) => bit === "0" ? "1" : "0") : s.transmission_pattern.bits,
    `${s.transmission_pattern.repeat ? "Repeat" : "Once"}; UI ${number(s.bit_duration_ms, "ns", 1e6)}; starts ${number(s.start_time_ms, "ns", 1e6)}`,
    s.initial_state ^ Number(s.inverted ?? false)
  ]))}${run.test.states?.length ? `<details><summary>Buffer states</summary>${table2(["Pin", "Mode", "Enabled"], run.test.states.map((state) => [label(context, state.source_port_id), ...bufferState(state)]))}</details>` : ""}` : "<p>Settings unavailable.</p>"}</article>`).join("");
  const findings = data.runs.map((run, i) => `<article class="result-card"><div class="result-heading"><h2>${html(run.name)}</h2><button data-run="${i}" data-probe="${Math.max(0, run.probes.findIndex((p2) => p2.name === data.comparisonProbeName))}" data-mode="waveform">Open waveforms</button></div>${table2(["Probe", "Signal \u2212 reference", "Minimum", "Maximum"], run.probes.map((probe) => {
    let minimum = Infinity, maximum = -Infinity;
    for (const row of run.rows) {
      minimum = Math.min(minimum, row[probe.column]);
      maximum = Math.max(maximum, row[probe.column]);
    }
    return [probe.name, probeLabels(probe, context).join(" \u2212 "), number(minimum, "V"), number(maximum, "V")];
  }))}${run.eyes.length ? table2(["Eye / probe", "Gate", "UI / origin", "Windows", "Voltage range"], run.eyes.map((eye) => [
    `${eye.name} / ${run.probes.find((p2) => p2.simulationVoltageProbeId === eye.simulationVoltageProbeId)?.name ?? "recorded probe"}`,
    `${number(eye.startTimeSeconds, "ns", 1e9)} to ${number(eye.endTimeSeconds, "ns", 1e9)}`,
    `${number(eye.unitIntervalSeconds, "ns", 1e9)} / ${eye.alignment === "received-differential-dqs" ? "Received DQS; capture at center" : number(eye.timeOriginSeconds, "ns", 1e9)}`,
    eye.windows ?? eye.windowOriginsSeconds?.length ?? "Not recorded",
    eye.metrics ? eye.metrics.voltageRangeV.map((v2) => number(v2, "V")).join(" to ") : "Not recorded"
  ])) : ""}${ddrFindings(run.eyes)}</article>`).join("");
  const changes = data.changes?.length ? `<div class="comparison-summary"><h2>Neighbor switching \xB7 ${html(data.comparisonProbeName ?? "Selected probe")}</h2>${table2(["Switching \u2212 quiet", "Gate", "Peak absolute \u0394V", "Time RMS \u0394V"], data.changes.map((c2) => [
    `${c2.active} \u2212 ${c2.quiet}`,
    `${number(c2.startSeconds, "ns", 1e9)} to ${number(c2.endSeconds, "ns", 1e9)}`,
    number(c2.peakAbsoluteV, "mV", 1e3),
    number(c2.timeRmsV, "mV", 1e3)
  ]))}</div>` : "";
  const models = data.runs.map((run) => run.test?.models ?? []).flat().filter((model, i, all) => all.findIndex((m2) => m2.pipelineId === model.pipelineId) === i);
  const settings = context ? `<details><summary>Electrical model and extraction settings</summary>${table2(["Setting", "Value"], context.settings)}${models.length ? table2(["IBIS device", "Selected buffers", "Corner / package parasitics", "Model asset"], models.map((model) => [
    model.ibis_component_name,
    Object.entries(model.ibis_pin_name_to_model_name ?? {}).map(([pin, buffer]) => `${pin}: ${buffer}`).join("; "),
    `${model.model_value_corner} / ${String(model.include_package_parasitics)}`,
    model.ibis_model_asset.project_relative_path
  ])) : ""}</details>` : "";
  return {
    traces,
    plan,
    findings: changes + findings,
    settings,
    downloads: `<p class="hint">Time: seconds \xB7 voltage: volts. Keep the csv folder beside results.html.</p><div class="table-scroll"><table><thead><tr><th>File</th><th>Data</th><th>Size</th></tr></thead><tbody>${files.map((file) => `<tr><td><a href="${html(file.path)}" download title="${html(file.description)}">${html(file.path.slice(4))}</a></td><td>${html(file.label)}</td><td>${number(new TextEncoder().encode(file.content).byteLength / 1024, "KB")}</td></tr>`).join("")}</tbody></table></div>`
  };
}

// src/viewer.ts
function generateReport(result) {
  return generateReportData({
    context: reportContext(result.circuitJson, result.geometry, result.modeling),
    limitations: result.limitations,
    runs: result.experiments.map((run) => ({
      name: run.name,
      rows: run.waveform.rows,
      probes: run.probes,
      test: run.plan,
      eyes: run.eyes.map(({ samples, ...eye }) => ({ ...eye, csv: result.files[`${run.directory}/${eye.directory}/eye-data.csv`] }))
    }))
  });
}
function generateReportData(data, title = "Signal integrity report") {
  const files = reportFiles(data), sections2 = reportSections(data, files);
  const output = Object.fromEntries(files.map((file) => [file.path, file.content]));
  const { context, ...viewerData } = data;
  const payload = JSON.stringify({ ...viewerData, runs: data.runs.map(({ test, ...run }) => ({
    ...run,
    probes: run.probes.map((probe) => context ? {
      ...probe,
      signalLabel: context.ports[probe.signalSourceId ?? ""] ?? probe.signalSourceId,
      referenceLabel: probe.referenceSourceId ? context.ports[probe.referenceSourceId] ?? probe.referenceSourceId : "Channel ground"
    } : probe),
    eyes: run.eyes.map(({ csv: csv2, ...eye }) => eye)
  })) }).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  output["results.html"] = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${html(title)}</title>
<style>
[hidden]{display:none!important}*{box-sizing:border-box}body{margin:0;color:#202b38;background:#fff;font:13px system-ui,-apple-system,sans-serif;line-height:1.5}main{max-width:1480px;margin:auto;padding:0 28px}h1{font-size:18px;letter-spacing:-.025em;margin:0;font-weight:650}h2{font-size:14px;margin:0 0 10px;font-weight:650}h3{font-size:13px;margin:0 0 6px}p{margin:8px 0;color:#697586}a{color:#245eb5;text-decoration:none}a:hover{text-decoration:underline}
.app-header{display:flex;align-items:center;gap:18px;padding:20px 0 12px}.app-mark{font-size:11px;color:#6c7989;border-right:1px solid #dce2e9;padding-right:18px}.status{margin-left:auto;font-size:12px;color:#2a7155}#summary{font-size:12px;color:#6c7989;margin-bottom:16px}
nav{display:flex;gap:24px;border-bottom:1px solid #dce2e9;overflow:auto}nav button{border:0;border-bottom:2px solid transparent;border-radius:0;padding:10px 0;background:none;color:#77818e;white-space:nowrap}nav button[aria-selected=true]{border-bottom-color:#245eb5;color:#1c3557;font-weight:650}.panel{padding:20px 0;min-width:0}
button,select,input,.download{font:inherit;border:1px solid #d4dce6;border-radius:4px;padding:6px 10px;color:#334155;background:#fff}button,a{cursor:pointer}button:hover{background:#f5f7fa}button[aria-pressed=true]{background:#edf3ff;border-color:#a9bfe8;color:#245eb5}button:disabled{opacity:.4;cursor:default}button:focus-visible,a:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #769fe7;outline-offset:2px}
.board-layout{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:28px}.board-toolbar{font-size:11px;color:#7a8493;margin-bottom:8px}.route-map{min-width:0}.route-map svg{display:block;width:100%;height:590px;background:#fafbfd;border:1px solid #e5e9ef}.board-legend{display:flex;gap:16px;flex-wrap:wrap;font-size:11px;margin-top:12px}.component-key{color:#4567ac}.unused-key{color:#84909e}
.board-outline rect,.board-outline path{fill:#fff;stroke:#b4bfce;stroke-width:1.5}.unused-components rect{fill:#f2f4f7;stroke:#c2cbd6;stroke-width:.7}.unused-traces path{fill:none;stroke:#c2cbd6;stroke-opacity:.7;stroke-width:.7}.used-components rect{fill:#dce8ff;fill-opacity:.75;stroke:#4567ac;stroke-width:1.8}.used-traces path{fill:none;stroke-width:2.6}.used-traces circle{stroke-width:1.5}.route-map path,.route-map rect,.route-map circle{vector-effect:non-scaling-stroke}.component-labels{text-anchor:middle;fill:#243f70;stroke:#fff;stroke-width:.2;paint-order:stroke;font-weight:750;pointer-events:none}
.trace-inspector{border-left:1px solid #e5e9ef;padding-left:24px}.trace-row{padding:14px 0;border-bottom:1px solid #e5e9ef}.trace-row small{float:right;font-size:11px;color:#7a8493;font-weight:400}.pin-pair{font:11px ui-monospace,monospace;color:#536277;margin-bottom:10px}dl{display:grid;grid-template-columns:1fr auto;margin:0 0 8px;font-size:12px}dt{color:#7a8493}dd{margin:0;font-variant-numeric:tabular-nums}.hint{font-size:11px;color:#7a8493}
.table-scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px;margin:10px 0 18px}th,td{text-align:left;padding:9px 12px;border-bottom:1px solid #e5e9ef;vertical-align:top;overflow-wrap:anywhere}th{font-weight:500;color:#7a8493;background:#f8fafc}td{min-width:85px;max-width:400px}th:first-child,td:first-child{padding-left:0}.trace-inspector td{font-size:10px;min-width:50px}details{margin-top:8px}summary{cursor:pointer;color:#637389;font-size:12px;padding:7px 0}pre{white-space:pre-wrap;font:12px/1.7 ui-monospace,monospace;color:#637389}
.test-card,.result-card{padding:0 0 20px;margin-bottom:20px;border-bottom:1px solid #e5e9ef}.test-card:last-child,.result-card:last-child{border-bottom:0}.result-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:8px}.result-heading button{font-size:11px}.comparison-summary{margin-bottom:24px}.comparison-summary table{background:#fbfcfe}
.toolbar{display:flex;align-items:end;gap:16px;flex-wrap:wrap}label{display:flex;flex-direction:column;gap:5px;font-size:11px;color:#6c7989}select{min-width:150px;max-width:100%}.check{flex-direction:row;align-items:center;padding-bottom:7px}.check input{margin:0}.grow{flex:1}.title{font-size:14px;font-weight:650;margin-top:20px}.binding{font-size:11px;color:#7a8493;margin-top:4px;overflow-wrap:anywhere}#legend{display:flex;gap:18px;flex-wrap:wrap;font-size:11px;margin:12px 0}canvas{display:block;width:100%;height:400px;touch-action:none;cursor:crosshair}#cursor{font:11px ui-monospace,monospace;min-height:20px;color:#637389}footer{display:flex;align-items:end;gap:14px;flex-wrap:wrap;border-top:1px solid #e5e9ef;padding-top:14px;margin-top:10px}input[type=number]{width:110px}.download{font-size:12px}#sample-count{font-size:11px;color:#7a8493;padding-bottom:7px}
@media(max-width:900px){.board-layout{grid-template-columns:minmax(0,1fr) 240px;gap:16px}.trace-inspector{padding-left:16px}.route-map svg{height:520px}}@media(max-width:700px){main{padding:0 16px}.app-header{gap:12px}.app-mark{display:none}h1{font-size:16px}nav{gap:22px}.board-layout{grid-template-columns:1fr}.trace-inspector{border-left:0;padding:0}.route-map svg{height:380px}.trace-row{padding:12px 0}.panel{padding-top:16px}canvas{height:330px}th,td{padding:8px}footer{gap:10px}.status{font-size:11px}}
</style></head><body><main>
<header class="app-header"><span class="app-mark">SIMULATION</span><h1>${html(title.replace(/\s+report$/i, ""))}</h1><span class="status">\u25CF Simulation complete</span></header><div id="summary"></div>
<nav role="tablist" aria-label="Simulation views">${[["traces", "Board"], ["tests", "Tests"], ["results", "Results"], ["explore", "Plots"], ["downloads", "CSV files"], ["assumptions", "Model"]].map(([id2, label2], i) => `<button id="tab-${id2}" role="tab" data-tab="${id2}" aria-controls="${id2}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${label2}</button>`).join("")}</nav>
<section class="panel" id="traces" role="tabpanel" aria-labelledby="tab-traces">${sections2.traces}</section>
<section class="panel" id="tests" role="tabpanel" aria-labelledby="tab-tests" hidden>${sections2.plan}<p class="hint">Drive bits include stimulus inversion.</p></section>
<section class="panel" id="results" role="tabpanel" aria-labelledby="tab-results" hidden>${sections2.findings}<p class="hint">Min/max use the full recording. Eye ranges use their declared gates.</p></section>
<section class="panel" id="explore" role="tabpanel" aria-labelledby="tab-explore" aria-label="Interactive simulation results" hidden><div class="toolbar"><label>Experiment<select id="run"></select></label><label>Probe<select id="probe"></select></label><label class="check"><input id="overlay" type="checkbox">Overlay runs</label><span class="grow"></span><button id="waveform-button" aria-pressed="true">Waveform</button><button id="eye-button" aria-pressed="false">Eye</button></div><div class="title" id="selection"></div><div class="binding" id="binding"></div><div id="legend"></div><label id="eye-field" hidden>Eye<select id="eye"></select></label><canvas id="plot" role="img" aria-label="Voltage plot: scroll to zoom, drag to pan, double click to reset"></canvas><div id="cursor" aria-live="off"></div><footer><label>Start (ns)<input id="start" type="number" step="any"></label><label>End (ns)<input id="end" type="number" step="any"></label><button id="reset">Reset</button><span class="grow"></span><span id="sample-count"></span><a id="csv" href="#" class="download" download>Download CSV</a></footer><p class="hint">Scroll to zoom \xB7 drag to pan \xB7 double-click to reset.</p></section>
<section class="panel" id="downloads" role="tabpanel" aria-labelledby="tab-downloads" hidden>${sections2.downloads}</section>
<section class="panel" id="assumptions" role="tabpanel" aria-labelledby="tab-assumptions" hidden><p>${html(data.context?.description ?? "")}</p>${sections2.settings}<details open><summary>Assumptions</summary><pre id="limitations">${html(data.limitations.join("\n"))}</pre></details><p class="hint">${data.runs.some((run) => run.eyes.some((eye) => eye.ddrAssessment)) ? "Configured DDR limits, evidence and unevaluated checks appear in Results; no DDR compliance claim." : "Observed values only; no pass/fail thresholds or compliance assessment."} Waveform CSVs retain every solver sample. Eye CSVs use linear interpolation. Plot display envelopes preserve extrema.</p></section>
</main><noscript><style>[role=tabpanel][hidden]{display:block!important}</style></noscript><script type="application/json" id="simulation-data">${payload}<\/script><script>(${browserClient})();<\/script></body></html>`;
  return output;
}
export {
  assessDdr,
  generateReport,
  modelingFromCircuitJson,
  resolveDdrAssessments,
  runPipeline,
  stackupFromCircuitJson,
  transmittedBits
};
/*! Bundled license information:

@noble/hashes/esm/utils.js:
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)
*/
