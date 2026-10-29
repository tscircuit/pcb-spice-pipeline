# Via-in-pad ground reproduction

Run `node --import tsx tests/visual/via-in-pad.ts` to regenerate the two views from `tests/fixtures/via-in-pad.tsx`. Open [top](via-in-pad-top.svg) and [inner1](via-in-pad-inner1.svg) together. On top, each ground pad below a signal pad contains a centered via (0.30 mm copper diameter inside the 0.40 mm pad). On inner1, the same two vias meet a solid GND pour. The plated barrels span top to inner1; there are no ground lead traces. The fixture is a reduced native TSX version of the DDR channel.

Run `node --import tsx --test tests/via-in-pad.test.ts`: the TODO regression currently reports `ground_connection: ... require one routed ground lead`. It should produce two vertical reference paths, one for each ground pin.
