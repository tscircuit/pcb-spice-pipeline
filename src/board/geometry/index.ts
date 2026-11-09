// Lane resolution + both reductions -> today's Geometry (was geometry.ts minus decks).
import type { ArtifactScope, Produced } from '../../kernel'
import type { CircuitJson } from '../schema'
import type { Board } from '../model'
import { fail } from '../diagnostics'
import { stackupFromCircuitJson, defaultCopperConductivitySm } from '../stackup'
import { selectPort, resolveRouteVias } from './ports'
import { routedCopperGeometry } from './routed'
import { parallelCopperGeometry } from './parallel'
import { joinSeriesMappings } from './series'
import type { BoardModeling as Modeling, Geometry, LaneMapping, ResolvedModeling, RouteStage, RoutedPoint } from './types'

/** Returns `v` when it is a positive finite number; otherwise fails 'modeling_input' naming `label`. */
const positive=(v: unknown,label: string): number=>{
  if(typeof v!=='number'||!Number.isFinite(v)||v<=0) fail('modeling_input',`${label} must be a positive number`)
  return v
}
/** Returns `v` when it is a finite number; otherwise fails 'modeling_input' naming `label`. */
const finite=(v: unknown,label: string): number=>{
  if(typeof v!=='number'||!Number.isFinite(v)) fail('modeling_input',`${label} must be explicit and finite`)
  return v
}
/** Checks every modeling field the reductions rely on before any geometry is built, failing with the matching board code. */
export function validateModeling(m: Modeling): void {
  if(m.reduction!=='routed-copper') fail('reduction','Only routed copper is supported')
  if(!Array.isArray(m.lanes)||(m.lanes.length < 1 && !m.allowIdeal)) fail('lanes','At least one routed conductor is required')
  for(const [i,l] of m.lanes.entries()) if(!l.port||!l.from||!l.to) fail('pin_mapping',`Lane ${i}: port/from/to mappings required`)
  if(new Set(m.lanes.map(l=>l.port)).size!==m.lanes.length) fail('pin_mapping','Lane port labels must be distinct')
  if(m.reduction==='routed-copper') {
    positive(m.relativePermittivity,'relativePermittivity (homogeneous dielectric approximation)')
    positive(m.extraction?.groundMeshMm,'extraction.groundMeshMm')
  }
  if(!m.extraction) fail('extraction','Explicit mesh/frequency/model settings required')
  for(const key of ['minimumHz','maximumHz','modelHz','filaments','refinementFilaments','convergenceTolerance','capTolerance','maxPanelLengthMm','reciprocityTolerance','dcResistanceTolerance'] as const) positive(m.extraction[key],`extraction.${key}`)
  if(m.extraction.minimumHz>m.extraction.modelHz||m.extraction.modelHz>m.extraction.maximumHz||!Number.isInteger(m.extraction.filaments)) fail('extraction','Require minimumHz <= modelHz <= maximumHz and integer filaments')
  if(!Number.isInteger(m.extraction.refinementFilaments)||m.extraction.refinementFilaments<=m.extraction.filaments) fail('extraction','Integer refinementFilaments must exceed filaments')
  if(!Number.isInteger(m.sections)||m.sections<1||m.sections>128) fail('sections','sections must be an integer 1..128')
}
/** Resolves each lane to its routed PCB trace and constructs 3D routed copper, with a guarded parallel-bar reduction. */
export function geometryFromCircuitJson(cj: CircuitJson,modeling: Modeling): Geometry {
  if(!Array.isArray(cj)) fail('circuit_json','Expected a Circuit JSON element array, not a mesh-preparation object')
  const stackup = stackupFromCircuitJson(cj)
  for (const key of ['stackup', 'conductivitySm', 'copperLayers']) if (key in modeling)
    fail('modeling_input', `Remove modeling.${key}; physical construction comes from Circuit JSON pcb_stackup`)
  const m: ResolvedModeling = {...modeling, stackup: stackup.copperLayers, conductivitySm: defaultCopperConductivitySm,
    relativePermittivity: modeling.relativePermittivity ?? stackup.relativePermittivity, viaPlatingMm: modeling.viaPlatingMm ?? stackup.viaPlatingMm}
  validateModeling(m)
  if (!m.lanes.length && m.allowIdeal) return { stackup, cells: [], mappings: [], units: { circuitJson: 'mm', geometry: 'm', conductivity: 'S/m' }, approximations: ['Unrouted signal copper is ideal by explicit block.unrouted=ideal'] }
  const routes: RouteStage[][]=[]
  const mappings: LaneMapping[]=[]
  const selectedTraces=new Set<string>()
  for(const lane of m.lanes) {
    const from=selectPort(cj,lane.from)
    const to=selectPort(cj,lane.to)
    if(from.source_port_id===to.source_port_id) fail('pin_mapping',`${lane.port}: selected lane requires distinct physical source and receiver ports`)
    const sources=cj.filter(e=>e.type==='source_trace').filter(e=>(lane.sourceTraceId?e.source_trace_id===lane.sourceTraceId:e.connected_source_port_ids?.includes(from.source_port_id)&&e.connected_source_port_ids?.includes(to.source_port_id)))
    if(sources.length!==1) fail('route_selection',`${lane.port}: expected one source trace; specify sourceTraceId`)
    const src=sources[0]
    if(!src.connected_source_port_ids?.includes(from.source_port_id)||!src.connected_source_port_ids?.includes(to.source_port_id)) fail('pin_mapping',`${lane.port}: selected trace does not connect requested source ports`)
    if(src.connected_source_port_ids.length!==2) fail('route_selection',`${lane.port}: fan-out is unsupported; selected trace must connect exactly the two requested ports`)
    if(selectedTraces.has(src.source_trace_id)) fail('route_selection',`${lane.port}: selected lanes must use distinct source traces`)
    selectedTraces.add(src.source_trace_id)
    const traces=cj.filter(e=>e.type==='pcb_trace').filter(e=>e.source_trace_id===src.source_trace_id)
    if(traces.length!==1) fail('route_selection',`${lane.port}: expected one complete PCB route, got ${traces.length}`)
    const original=resolveRouteVias(cj,traces[0])
    if(!Array.isArray(original)||original.length<2) fail('empty_route',`${lane.port}: at least two routed vertices required`)
    let route: RoutedPoint[]=original.map((p,i)=>{
      if(p.route_type!=='wire'&&p.route_type!=='via') fail('route_type','Only wire/via routed primitives supported')
      finite(p.x,`${lane.port} route[${i}].x`)
      finite(p.y,`${lane.port} route[${i}].y`)
      if(p.route_type==='wire') {
        positive(p.width,`${lane.port} route[${i}].width`)
        if(p.start_width!==undefined||p.end_width!==undefined||p.width_interpolation_mode!==undefined) fail('varying_width','Tapered routes are not implemented')
      }
      return p
    })
    if(route[0].route_type!=='wire'||route[route.length-1].route_type!=='wire') fail('route_type','Routed endpoints must be wire vertices at the selected PCB ports')
    const ports=[from,to].map(p=>{
      const matches=cj.filter(e=>e.type==='pcb_port').filter(e=>e.source_port_id===p.source_port_id)
      if(matches.length!==1) fail('pin_mapping',`${lane.port}: expected one PCB port for ${p.source_port_id}, got ${matches.length}`)
      return matches[0]
    })
    for(const p of ports) {
      finite(p.x,`${p.pcb_port_id}.x`)
      finite(p.y,`${p.pcb_port_id}.y`)
    }
    /** True when a route point sits on a port position (within 1e-5 mm). */
    const matches=(a: { x: number; y: number },p: { x: number; y: number }): boolean=>Math.hypot(a.x-p.x,a.y-p.y)<1e-5
    if(matches(route[0],ports[1])&&matches(route[route.length-1],ports[0])) route=[...route].reverse().map(p=>p.route_type==='via'?{...p,from_layer:p.to_layer,to_layer:p.from_layer}:p)
    if(!matches(route[0],ports[0])||!matches(route[route.length-1],ports[1])) fail('endpoint_position',`${lane.port}: routed endpoints do not match selected physical source/receiver ports`)
    for(const [point,port] of [[route[0],ports[0]],[route[route.length-1],ports[1]]] as const) {
      if(point.route_type==='wire'&&!port.layers.includes(point.layer)) fail('endpoint_layer',`${lane.port}: route layer does not reach physical pad ${port.pcb_port_id}`)
      for(const key of ['start_pcb_port_id','end_pcb_port_id'] as const) if(point.route_type==='wire'&&point[key]&&point[key]!==port.pcb_port_id) fail('stale_endpoint',`${lane.port}: ${key}=${point[key]} disagrees with ${port.pcb_port_id}; repair source metadata explicitly`)
    }
    const stages: RouteStage[]=[]
    /** Looks up the stackup copper layer named `n`, failing 'stackup' when it is missing. */
    const layer=(n: string): ResolvedModeling['stackup'][number]=>{
      const l=m.stackup.find(l=>l.name===n)
      if(!l) fail('stackup',`No copper z range for ${n}`)
      return l
    }
    for(let i=1;i<route.length;i++) {
      const a=route[i-1]
      const b=route[i]
      if(!['wire','via'].includes(a.route_type)||!['wire','via'].includes(b.route_type)) fail('route_type','Only wire/via routed primitives supported')
      const distance=Math.hypot(b.x-a.x,b.y-a.y)
      if(b.route_type==='via') {
        if(distance>1e-5) fail('via_geometry','Via must follow a co-located wire vertex')
        if(a.route_type!=='wire'||a.layer!==b.from_layer||b.from_layer===b.to_layer) fail('via_geometry','Via must continue preceding wire layer and change layer')
        const la=layer(b.from_layer)
        const lb=layer(b.to_layer)
        const plating=positive(m.viaPlatingMm,'viaPlatingMm (not recorded in ordinary Circuit JSON)')
        const width=positive(m.viaEquivalentWidthMm,'viaEquivalentWidthMm')
        if(!m.omitThroughViaStubs) fail('via_stub','This reduction requires explicit omitThroughViaStubs=true')
        const hole=positive(b.hole_diameter,'hole_diameter')
        const area=Math.PI*((hole/2+plating)**2-(hole/2)**2)
        const length=Math.abs((la.zMinMm+la.zMaxMm-lb.zMinMm-lb.zMaxMm)/2)
        positive(length,'via active length')
        stages.push({kind:'via',profile:'via',lengthMm:length,widthMm:width,thicknessMm:area/width,holeMm:hole,platingMm:plating})
      } else if(distance>1e-10) {
        const layerName=a.route_type==='via'?a.to_layer:a.layer
        if(b.layer!==layerName) fail('layer_transition','Layer change requires explicit via')
        const l=layer(layerName)
        const width=positive(b.width,'route wire width')
        if(a.route_type==='wire'&&a.width!==b.width) fail('varying_width','Width transitions require explicit supported stage reduction')
        const last=stages.at(-1)
        if(last?.kind==='wire'&&last.profile===layerName&&last.widthMm===width) last.lengthMm+=distance
        else stages.push({kind:'wire',profile:layerName,lengthMm:distance,widthMm:width,thicknessMm:l.zMaxMm-l.zMinMm,conductivitySm:l.conductivitySm})
      } else if(b.layer!==(a.route_type==='via'?a.to_layer:a.layer)) {
        fail('layer_transition','Co-located layer change still requires explicit via')
      }
    }
    if(!stages.length) fail('empty_route',lane.port)
    routes.push(stages)
    mappings.push({port:lane.port,sourceTraceId:src.source_trace_id,pcbTraceId:traces[0].pcb_trace_id,from:from.source_port_id,to:to.source_port_id,pcbPorts:ports.map(p=>p.pcb_port_id),stages,originalRoute:route})
  }
  const geometry = {...routedCopperGeometry(cj,m,joinSeriesMappings(mappings)),stackup}
  return m.simplifyParallel ? parallelCopperGeometry(geometry) : geometry
}

/** Board + board modeling -> today's Geometry, plus `geometry.json` under `scope` (byte-identical to jsonFile). */
export function channelGeometry(board: Board, modeling: Modeling, scope: ArtifactScope): Produced<Geometry> {
  const value = geometryFromCircuitJson(board.circuitJson, modeling)
  return { value, artifacts: [scope.json('geometry.json', value)] }
}
