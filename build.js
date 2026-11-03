'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const bundle = path.join(root, 'Offline Prototype Exporter.sketchplugin');
const source = ['core.js', 'exporter.js'].map(name => fs.readFileSync(path.join(root, 'src', name), 'utf8')).join('\n\n');
fs.writeFileSync(path.join(bundle, 'Contents', 'Sketch', 'export.js'), source);
const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'Contents', 'Sketch', 'manifest.json'), 'utf8'));
console.log(`Built ${manifest.name} ${manifest.version}`);
