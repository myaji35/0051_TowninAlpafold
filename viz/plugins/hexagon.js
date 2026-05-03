// viz/plugins/hexagon.js — HexagonLayer (육각 격자 집계 차트)
(function (root) {
  'use strict';

  function buildLayers(target, data, scales, scope) {
    const points = (data && data.points) || [];
    const Tk = root.VizTokens;
    const layers = [];

    layers.push(new deck.HexagonLayer({
      id: 'viz-hex-layer', data: points,
      pickable: true, extruded: true,
      radius: 800, elevationScale: 8, coverage: 0.85,
      getPosition: d => d.coordinates,
      getElevationWeight: d => d.height,
      getColorWeight: d => d.colorVal,
      colorRange: Tk.tokens().hexRange,
      onClick: scope && scope.onPick ? scope.onPick : null,
    }));

    if (target && typeof target.setProps === 'function') {
      target.setProps({ layers });
    }
    return layers;
  }

  if (root.VizEngine) {
    root.VizEngine.register({
      id: 'hexagon',
      label: '육각 격자',
      icon: '⬡',
      supports: scope => Array.isArray(scope.dongs) && scope.dongs.length > 0,
      render: buildLayers,
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
