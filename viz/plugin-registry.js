// viz/plugin-registry.js — Plugin Registry
// ChartPlugin 인터페이스: { id, label, icon, render(target, data, scales, scope), supports(scope) }
// 글로벌 노출: window.VizPluginRegistry
(function (root) {
  'use strict';

  const _plugins = new Map();

  function register(plugin) {
    if (!plugin || !plugin.id || typeof plugin.render !== 'function') {
      throw new Error('[VizPluginRegistry] plugin은 { id, render } 필수');
    }
    if (_plugins.has(plugin.id)) {
      console.warn(`[VizPluginRegistry] '${plugin.id}' 덮어쓰기`);
    }
    _plugins.set(plugin.id, plugin);
    return plugin.id;
  }

  function unregister(id) { return _plugins.delete(id); }
  function get(id) { return _plugins.get(id) || null; }
  function has(id) { return _plugins.has(id); }
  function list() { return Array.from(_plugins.values()); }
  function ids() { return Array.from(_plugins.keys()); }
  function size() { return _plugins.size; }

  root.VizPluginRegistry = { register, unregister, get, has, list, ids, size };
})(typeof window !== 'undefined' ? window : globalThis);
