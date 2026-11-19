'use strict';
// Minifie JS/CSS et copie le reste dans dist/. Le serveur sert dist/ s'il existe, sinon web/.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const src = path.join(__dirname, '..', 'web'), out = path.join(__dirname, '..', 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
esbuild.buildSync({ entryPoints: ['app.js', 'admin.js', 'style.css'].map((f) => path.join(src, f)), outdir: out, bundle: false, minify: true, target: 'es2019', legalComments: 'none' });
for (const f of fs.readdirSync(src)) if (/\.html$/.test(f)) fs.copyFileSync(path.join(src, f), path.join(out, f));
fs.cpSync(path.join(src, 'img'), path.join(out, 'img'), { recursive: true });
console.log('build ok ->', out);
