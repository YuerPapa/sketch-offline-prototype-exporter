'use strict';

var sketch = require('sketch');
var UI = require('sketch/ui');

function layerId(layer) {
  return layer && layer.sketchObject ? String(layer.sketchObject.objectID()) : String(layer.id);
}

function liveCanvasFrames(page) {
  return Array.from(page.canvasLevelFrames || []).filter(function (layer) {
    return !layer.hidden && layer.type !== 'SymbolMaster' && layer.frame.width > 0 && layer.frame.height > 0;
  });
}

function selectedCanvasIds(document, allById) {
  var result = [];
  Array.from(document.selectedLayers.layers).forEach(function (layer) {
    var parent = layer;
    while (parent && parent.type !== 'Page') {
      var id = layerId(parent);
      if (allById[id]) {
        if (result.indexOf(id) < 0) result.push(id);
        return;
      }
      parent = parent.parent;
    }
  });
  return result;
}

function isInvisible(layer) {
  return layer.hidden || (layer.style && layer.style.opacity === 0);
}

function rectangleInFrame(layer, frame) {
  var width = Number(layer.frame.width);
  var height = Number(layer.frame.height);
  var points = [[0, 0], [width, 0], [width, height], [0, height]].map(function (point) {
    return new sketch.Rectangle(point[0], point[1], 0, 0).changeBasis({ from: layer, to: frame });
  });
  return OfflinePrototypeCore.fromCorners(points);
}

function hasFill(layer) {
  if (layer.type === 'Image' || layer.type === 'SymbolInstance') return true;
  return Boolean(layer.style && Array.from(layer.style.fills || []).some(function (fill) {
    if (fill.enabled === false) return false;
    if (fill.fillType !== 'Color') return true;
    var color = String(fill.color || '');
    return color.length !== 9 || parseInt(color.slice(-2), 16) > 0;
  }));
}

function extractFrame(frame, warnings) {
  var bounds = { x: 0, y: 0, width: Number(frame.frame.width), height: Number(frame.frame.height) };
  var regions = [];
  var symbolWarnings = Object.create(null);

  function visit(layer, clip, interactiveAncestor) {
    if (isInvisible(layer)) return;
    var rect = rectangleInFrame(layer, frame);
    if (!rect) return;
    var visibleRect = OfflinePrototypeCore.intersection(rect, clip);
    var flow = layer.flow;
    var target = flow && flow.targetId ? String(flow.targetId) : null;
    var validFlow = target && (target === 'back' || flow.isValidConnection());
    if (validFlow && visibleRect) {
      regions.push({
        kind: 'link', id: layerId(layer), label: String(layer.name || '跳转'),
        target: target, rect: visibleRect,
        animation: String(flow.animationType || 'none')
      });
    } else if (target && !validFlow) {
      warnings.push('已跳过无效连线：' + frame.name + ' / ' + layer.name);
    }

    var isContainer = Boolean(layer.layers && layer.layers.length);
    // Later painted artwork blocks earlier links; descendants still inherit a linked group's action.
    if (!validFlow && !interactiveAncestor && visibleRect && hasFill(layer) &&
        (layer.type === 'Shape' || layer.type === 'ShapePath' || layer.type === 'Image' ||
         layer.type === 'SymbolInstance' || layer.isFrame)) {
      regions.push({ kind: 'block', id: layerId(layer), rect: visibleRect });
    }

    var nextClip = clip;
    if (layer.isFrame && layer.clipsContents) {
      nextClip = OfflinePrototypeCore.intersection(clip, rect);
      if (!nextClip) return;
    }

    if (isContainer) {
      Array.from(layer.layers).forEach(function (child) {
        visit(child, nextClip, Boolean(interactiveAncestor || validFlow));
      });
    }

    if (layer.type === 'SymbolInstance' && layer.expandedLayers && !symbolWarnings[layerId(layer)]) {
      var nestedFlow = false;
      function inspect(node) {
        if (isInvisible(node)) return;
        if (node.flow && node.flow.targetId) nestedFlow = true;
        if (node.layers) Array.from(node.layers).forEach(inspect);
      }
      Array.from(layer.expandedLayers).forEach(inspect);
      if (nestedFlow) {
        symbolWarnings[layerId(layer)] = true;
        warnings.push('组件内部连线尚未导出，请将连线设在组件实例上：' + frame.name + ' / ' + layer.name);
      }
    }
  }

  Array.from(frame.layers || []).forEach(function (layer) { visit(layer, bounds, false); });
  return { id: layerId(frame), name: String(frame.name), width: bounds.width, height: bounds.height, regions: regions };
}

function makeSnapshot(document, options) {
  options = options || {};
  var page = document.selectedPage;
  var allById = Object.create(null);
  Array.from(document.pages).forEach(function (p) {
    liveCanvasFrames(p).forEach(function (frame) { allById[layerId(frame)] = frame; });
  });
  var pageFrames = liveCanvasFrames(page).sort(OfflinePrototypeCore.readingOrder);
  var selected = selectedCanvasIds(document, allById);
  var initial = options.scope === 'selection' ? selected : pageFrames.map(layerId);
  if (!initial.length) throw new Error(options.scope === 'selection' ? '请先选中画框或画框内的图层' : '当前页面没有可导出的画框');
  var warnings = [];
  var extracted = Object.create(null);
  function dataFor(frame) {
    var id = layerId(frame);
    if (!extracted[id]) extracted[id] = extractFrame(frame, warnings);
    return extracted[id];
  }
  var ids = OfflinePrototypeCore.collectReachable(initial, allById, function (frame) {
    return dataFor(frame).regions.filter(function (r) { return r.kind === 'link'; }).map(function (r) { return r.target; });
  });
  var startId = selected.find(function (id) { return ids.indexOf(id) >= 0; });
  if (options.startId && ids.indexOf(String(options.startId)) >= 0) startId = String(options.startId);
  if (!startId) {
    var start = pageFrames.find(function (frame) { return frame.flowStartPoint && ids.indexOf(layerId(frame)) >= 0; });
    startId = start ? layerId(start) : ids[0];
  }
  var frames = ids.map(function (id) {
    var data = dataFor(allById[id]);
    var buffer = sketch.export(allById[id], { output: false, formats: ['png'], scales: String(options.scale || 1) });
    if (!buffer || !buffer.length) throw new Error('无法导出画框：' + data.name);
    var encoded = buffer.toString('base64');
    if (!encoded || encoded.indexOf('iVBOR') !== 0) throw new Error('画框图片格式异常：' + data.name);
    data.image = 'data:image/png;base64,' + encoded;
    return data;
  });
  return {
    schemaVersion: 1, title: String(page.name) + ' · 原型演示',
    pageName: String(page.name), startId: startId, frames: frames,
    warnings: warnings, exporter: 'Offline Prototype Exporter 1.2.0',
    sketchVersion: String(NSBundle.mainBundle().objectForInfoDictionaryKey('CFBundleShortVersionString'))
  };
}

function readUTF8(path) {
  var data = NSData.dataWithContentsOfFile(String(path));
  if (!data) throw new Error('无法读取演示模板：' + path);
  return String(NSString.alloc().initWithData_encoding(data, NSUTF8StringEncoding));
}

function exportToPath(document, destination, options) {
  options = options || {};
  var template = readUTF8(options.templatePath);
  var snapshot = makeSnapshot(document, options);
  var html = OfflinePrototypeCore.buildHTML(template, snapshot);
  var success = NSString.stringWithString(html).writeToFile_atomically_encoding_error(
    String(destination), true, NSUTF8StringEncoding, null
  );
  if (!success) throw new Error('无法保存文件，请检查目标目录的写入权限');
  return {
    path: String(destination), frames: snapshot.frames.length,
    links: snapshot.frames.reduce(function (total, f) { return total + f.regions.filter(function (r) { return r.kind === 'link'; }).length; }, 0),
    warnings: snapshot.warnings, startId: snapshot.startId
  };
}

function choosePath(document) {
  var panel = NSSavePanel.savePanel();
  panel.setCanCreateDirectories(true);
  panel.setAllowedFileTypes(['html']);
  panel.setNameFieldStringValue(String(document.selectedPage.name).replace(/[\\/:*?"<>|]/g, '-') + '-原型演示.html');
  panel.setTitle('导出离线 HTML 原型');
  panel.setMessage('导出为一个 HTML 文件。发送给他人后，用电脑浏览器打开即可演示。');
  if (panel.runModal() !== NSModalResponseOK) return null;
  return String(panel.URL().path());
}

function run(context, scope) {
  var document = sketch.getSelectedDocument();
  if (!document) { UI.message('请先打开一个 Sketch 文档'); return; }
  try {
    if (scope === 'selection' && !document.selectedLayers.length) {
      UI.message('请先选中一个画框或画框内的图层'); return;
    }
    var destination = context.exportPath ? String(context.exportPath) : choosePath(document);
    if (!destination) return;
    var templateURL = context.plugin.urlForResourceNamed('player.html');
    if (!templateURL) throw new Error('插件安装不完整，缺少 player.html');
    var startFrame = context.startFrameName && liveCanvasFrames(document.selectedPage).find(function (f) { return f.name === String(context.startFrameName); });
    var result = exportToPath(document, destination, { scope: scope, templatePath: String(templateURL.path()), startId: startFrame ? layerId(startFrame) : null });
    if (context.openAfterExport !== false && String(context.openAfterExport) !== '0' && String(context.openAfterExport) !== 'false') {
      NSWorkspace.sharedWorkspace().openURL(NSURL.fileURLWithPath(destination));
    }
    console.log(JSON.stringify(result));
    UI.message('已导出 ' + result.frames + ' 个画框、' + result.links + ' 条连线');
    if (result.warnings.length) UI.alert('导出完成，部分连线需要检查', result.warnings.slice(0, 8).join('\n'));
  } catch (error) {
    console.log(error && error.stack ? error.stack : String(error));
    UI.alert('导出未完成', String(error.message || error));
  }
}

function exportCurrentPage(context) { run(context, 'page'); }
function exportSelectedFlow(context) { run(context, 'selection'); }
function showAbout() {
  UI.alert('离线原型导出 1.2.0', '适配 Sketch 2026 新版画框。\n\n导出当前页面，或从所选画框开始沿已有连线导出关联画框。\n导出文件包含全部图片，可离线打开，不需要 Sketch 账号。\n\n演示页：左侧页面列表默认展开并固定占位，可收起侧栏（B）；返回、前进、重置、热点提示、全屏。\n点击流程与源稿一致；输入、查询、组件内部连线及高级动画不会转换成真实功能。');
}

if (typeof module !== 'undefined') {
  module.exports = {
    exportCurrentPage: exportCurrentPage, exportSelectedFlow: exportSelectedFlow,
    showAbout: showAbout, exportToPath: exportToPath, makeSnapshot: makeSnapshot
  };
}
