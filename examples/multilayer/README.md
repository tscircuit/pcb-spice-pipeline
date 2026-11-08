# Layer transitions and split return

`index.circuit.tsx` renders one real SC70 link with two physical vias (top → bottom → top)
and a U-shaped top ground pour. The gap crosses the bottom signal at x=0 and is joined around
the bottom of the board. Copper thickness, Dk, loss tangent and via plating are explicit physical
construction in `makeBoard`; they are not numerical extraction controls.
