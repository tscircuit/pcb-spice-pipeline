use spade::{AngleLimit, ConstrainedDelaunayTriangulation, Point2, RefinementParameters, Triangulation};
use std::collections::HashSet;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(getter_with_clone)]
pub struct Mesh {
    pub points: Vec<f64>,
    pub triangles: Vec<u32>,
    pub complete: bool,
}

#[wasm_bindgen]
pub fn triangulate(xy: &[f64], segments: &[u32], min_angle: f64, max_area: f64, budget: usize) -> Result<Mesh, JsValue> {
    if xy.len() % 2 != 0 || segments.len() % 2 != 0 || xy.iter().any(|x| !x.is_finite()) {
        return Err(JsValue::from_str("Invalid coordinates or segment list"));
    }
    let points: Vec<_> = xy.chunks_exact(2).map(|p| Point2::new(p[0], p[1])).collect();
    let edges: Vec<_> = segments.chunks_exact(2).map(|e| [e[0] as usize, e[1] as usize]).collect();
    if edges.iter().flatten().any(|i| *i >= points.len()) {
        return Err(JsValue::from_str("Invalid segment index"));
    }
    let mut conflicts = 0;
    let mut cdt = ConstrainedDelaunayTriangulation::<Point2<f64>>::try_bulk_load_cdt(points, edges, |_| conflicts += 1)
        .map_err(|e| JsValue::from_str(&format!("{e:?}")))?;
    if conflicts != 0 { return Err(JsValue::from_str("Conflicting input constraints")); }
    let result = cdt.refine(RefinementParameters::new()
        .with_angle_limit(AngleLimit::from_deg(min_angle))
        .with_max_allowed_area(max_area)
        .with_max_additional_vertices(budget)
        .exclude_outer_faces(true));
    let excluded: HashSet<_> = result.excluded_faces.into_iter().collect();
    let points = cdt.vertices().flat_map(|v| { let p = v.position(); [p.x, p.y] }).collect();
    let triangles = cdt.inner_faces().filter(|f| !excluded.contains(&f.fix()))
        .flat_map(|f| f.vertices().map(|v| v.fix().index() as u32)).collect();
    Ok(Mesh { points, triangles, complete: result.refinement_complete })
}
