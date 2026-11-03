var OfflinePrototypeCore = (function () {
  'use strict';

  function intersection(a, b) {
    var x = Math.max(a.x, b.x);
    var y = Math.max(a.y, b.y);
    var right = Math.min(a.x + a.width, b.x + b.width);
    var bottom = Math.min(a.y + a.height, b.y + b.height);
    if (right <= x || bottom <= y) return null;
    return { x: x, y: y, width: right - x, height: bottom - y };
  }

  function fromCorners(points) {
    var xs = points.map(function (p) { return Number(p.x); });
    var ys = points.map(function (p) { return Number(p.y); });
    var x = Math.min.apply(null, xs);
    var y = Math.min.apply(null, ys);
    var right = Math.max.apply(null, xs);
    var bottom = Math.max.apply(null, ys);
    if (![x, y, right, bottom].every(Number.isFinite)) return null;
    return { x: x, y: y, width: right - x, height: bottom - y };
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function safeJSON(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }

  function readingOrder(a, b) {
    return a.frame.y - b.frame.y || a.frame.x - b.frame.x;
  }

  function collectReachable(initial, allById, targetIds) {
    var queue = initial.slice();
    var result = [];
    var seen = Object.create(null);
    while (queue.length) {
      var id = queue.shift();
      if (seen[id] || !allById[id]) continue;
      seen[id] = true;
      result.push(id);
      targetIds(allById[id]).forEach(function (target) {
        if (target !== 'back' && !seen[target]) queue.push(target);
      });
    }
    return result;
  }

  function buildHTML(template, snapshot) {
    if (!snapshot.frames || !snapshot.frames.length) throw new Error('没有可导出的画框');
    if (!snapshot.frames.some(function (frame) { return frame.id === snapshot.startId; })) {
      throw new Error('起始画框不在导出范围内');
    }
    if (!template.includes('__PROTOTYPE_DATA__') || !template.includes('__DOCUMENT_TITLE__')) {
      throw new Error('演示模板缺失或损坏');
    }
    return template.replace('__DOCUMENT_TITLE__', function () { return escapeHTML(snapshot.title); })
      .replace('__PROTOTYPE_DATA__', function () { return safeJSON(snapshot); });
  }

  return {
    intersection: intersection,
    fromCorners: fromCorners,
    safeJSON: safeJSON,
    escapeHTML: escapeHTML,
    readingOrder: readingOrder,
    collectReachable: collectReachable,
    buildHTML: buildHTML
  };
}());

if (typeof module !== 'undefined') module.exports = OfflinePrototypeCore;
