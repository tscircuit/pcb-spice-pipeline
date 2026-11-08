# Two dimensional extraction

The stage machine is unchanged: admit → declare → bind → extract → simulate → observe → seal.
Extraction now walks the actual copper. It does not launch FastHenry or FasterCap.

1. **Segment.** Resolve driver and receiver pads, bends, widths, layers, neighbours, pad boundaries
   and polygon edges. Intersect each perpendicular slice with metal on every layer and with the
   physical dielectric stack. Cutouts stay cutouts. Electrical junctions share nodes.
2. **Solve the slice.** A constant-panel boundary-element method solves conductor potentials and
   dielectric transmission boundaries in open space. A charge-neutral constraint determines the
   common potential. Solve again in vacuum and calculate L = μ0 ε0 C0⁻¹. Neutral floating pads are
   eliminated with a Schur complement. Repeated geometry is cached within the extraction.
3. **Model vias.** Use physical hole, pad, antipad, plating and active length. A missing dimension
   raises a named diagnostic. TI's closed-form via approximation gives lumped R/L/C; it is not a
   full-wave discontinuity solution.
4. **Build the ladder.** The fastest selected IBIS edge and the bit timing determine the frequency
   band and number of cells. Each cell has the complete coupled inductance matrix and Maxwell C.
   Positive-real Foster RL branches model skin/proximity loss from the solved surface-current
   distribution. Series RC branches model dielectric loss from material sensitivity. Fit residuals
   and all mesh refinement steps are artifacts. This works with native ngspice primitives.
5. **Run and observe.** Native ngspice runs the IBIS experiment. The existing waveform, eye and DDR
   stages consume its output. No synthetic waveform replaces a native measurement.

All numerical policy is in `src/kernel/numerics.ts`. There are no solver process timeouts, mesh
attempt limits, lane caps, or maximum cell clamps. Refinement continues until every nonzero matrix
entry meets the documented relative-change criterion. Exact symmetry zeros use a roundoff floor.
Physical Dk, loss tangent, copper conductivity, layer thickness and via plating come from the original
`pcb_stackup`, including solder mask; incomplete presets fail with field-specific diagnostics.

The model has explicit limits. Cross-sections are local quasi-TEM models, excluding radiation and
bend fringing. Magnetic coupling is distributed between parallel, co-propagating route pieces;
oblique metal contributes electrostatically as a neutral conductor in that local slice. Ideal DC
source rails are AC equipotential in this model. Their physical copper participates in the reference
surfaces; distributed supply/ground-connection impedance is not extracted. A split with no reference
metal in the whole slice is a named error, not an invented return strip. These limitations are also
recorded on every result; see `REPORT.md` for which requested checks actually pass.

```mermaid
flowchart LR
  copper[Real copper and stackup] --> segments[Segment and slice]
  segments --> bem[Layered 2D BEM and vacuum solve]
  segments --> via[Closed-form via model]
  bem --> ladder[Automatic coupled RLGC ladder]
  via --> ladder
  ibis[IBIS edges and bit timing] --> ladder
  ladder --> spice[Native ngspice]
  spice --> eyes[Observe eyes and DDR]
```

References: [Hammerstad–Jensen single microstrip](https://qucs.sourceforge.net/tech/node75.html),
[coupled microstrip](https://qucs.sourceforge.net/tech/node77.html),
[TI Analog Engineer's Pocket Reference, via formulas](https://www.ti.com/lit/eb/slyw038c/slyw038c.pdf).
These references define validation oracles; they are not substituted for the BEM solution.
