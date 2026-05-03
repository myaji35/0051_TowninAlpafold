// viz/plugins/heatmap.js — HeatmapLayer 차트
(function (root) {
  'use strict';

  function buildLayers(target, data, scales, scope) {
    const points = (data && data.points) || [];
    const Tk = root.VizTokens;
    const layers = [];

    layers.push(new deck.HeatmapLayer({
      id: 'viz-heat-layer', data: points,
      getPosition: d => d.coordinates,
      getWeight: d => d.height,
      radiusPixels: 60, intensity: 1.4, threshold: 0.04,
      colorRange: Tk.tokens().heatRange,
    }));

    layers.push(new deck.ScatterplotLayer({
      id: 'viz-heat-pts', data: points,
      pickable: true, stroked: true, filled: true,
      lineWidthMinPixels: 1, radiusUnits: 'meters', getRadius: 200,
      getPosition: d => d.coordinates,
      getFillColor: d => Tk.colorGrad(d.colorVal),
      getLineColor: [255, 255, 255, 120],
      onClick: scope && scope.onPick ? scope.onPick : null,
    }));

    if (target && typeof target.setProps === 'function') {
      target.setProps({ layers });
    }
    return layers;
  }

  if (root.VizEngine) {
    root.VizEngine.register({
      id: 'heatmap',
      label: '히트맵',
      icon: '🌡',
      supports: scope => Array.isArray(scope.dongs) && scope.dongs.length > 0,
      render: buildLayers,
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
