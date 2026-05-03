// viz/plugins/columns3d.js — 3D 기둥 차트 (행정동 폴리곤 + ColumnLayer + 선택 링)
// register(VizEngine.register({...}))
(function (root) {
  'use strict';

  function buildLayers(target, data, scales, scope) {
    const points = (data && data.points) || [];
    const Tk = root.VizTokens;
    const layers = [];

    // (1) 실제 행정동 폴리곤 (있을 때)
    const polygonFeatures = points
      .filter(p => p.polygon)
      .map(p => ({
        type: 'Feature',
        properties: {
          code: p.code, name: p.name, colorVal: p.colorVal,
          plddt: p.plddt, real_adm_nm: p.real_adm_nm,
        },
        geometry: p.polygon,
      }));

    if (polygonFeatures.length > 0) {
      layers.push(new deck.GeoJsonLayer({
        id: 'analyze-real-polygons',  // alias: 기존 verify_v07 회귀 호환
        data: { type: 'FeatureCollection', features: polygonFeatures },
        pickable: true, stroked: true, filled: true,
        lineWidthMinPixels: 0.6,
        getFillColor: f => {
          const c = Tk.colorGrad(f.properties.colorVal);
          return [c[0], c[1], c[2], 90];
        },
        getLineColor: [255, 255, 255, 70],
        onClick: scope && scope.onPick ? scope.onPick : null,
      }));
    } else {
      layers.push(new deck.ScatterplotLayer({
        id: 'viz-columns3d-area', data: points,
        filled: true, stroked: true, lineWidthMinPixels: 0.5,
        radiusUnits: 'meters', getRadius: 600,
        getPosition: d => d.coordinates,
        getFillColor: d => { const c = Tk.colorGrad(d.colorVal); return [c[0],c[1],c[2],60]; },
        getLineColor: [255, 255, 255, 40],
      }));
    }

    // (2) 3D 기둥
    layers.push(new deck.ColumnLayer({
      id: 'viz-columns3d-cols', data: points,
      diskResolution: 24, radius: 320,
      extruded: true, pickable: true, elevationScale: 1,
      getPosition: d => d.coordinates,
      getElevation: d => d.height * 4500,
      getFillColor: d => Tk.colorGrad(d.colorVal),
      getLineColor: [255, 255, 255, 100], lineWidthMinPixels: 1,
      onClick: scope && scope.onPick ? scope.onPick : null,
    }));

    // (3) 선택 링
    if (scope && scope.dongCode) {
      const sel = points.find(p => p.code === scope.dongCode);
      if (sel) {
        layers.push(new deck.ScatterplotLayer({
          id: 'viz-columns3d-ring', data: [sel],
          stroked: true, filled: false, lineWidthMinPixels: 3,
          radiusUnits: 'meters', getRadius: 800,
          getPosition: d => d.coordinates,
          getLineColor: d => Tk.plddtColor(d.plddt),
        }));
      }
    }

    if (target && typeof target.setProps === 'function') {
      target.setProps({ layers });
    }
    return layers;
  }

  if (root.VizEngine) {
    root.VizEngine.register({
      id: 'columns3d',
      label: '3D 기둥',
      icon: '🏛',
      supports: scope => Array.isArray(scope.dongs) && scope.dongs.length > 0,
      render: buildLayers,
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
