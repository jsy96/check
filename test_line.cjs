'use strict';
/* 自测：从 line.html 抽出 <script id="core"> 真实代码，
   验证几何模型（用 taijing304_MSS.coef 数值复现）、块顺序、格式化、
   光学闭包、校验触发、TXT 参数文件往返。运行：node test_line.cjs */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'line.html'), 'utf8');
const m = html.match(/<script id="core">([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: 未找到 core script 块'); process.exit(1); }
const corePath = path.join(__dirname, '_pb_core_tmp.cjs');
fs.writeFileSync(corePath, m[1]);
const core = require(corePath);

let failed = 0;
function assert(cond, msg){
  if (cond) console.log('  PASS  ' + msg);
  else { console.error('  FAIL  ' + msg); failed++; }
}
function relErr(a, b){ return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-30); }

/* 解析 .coef 文本 → {header, blocks:[{width, x:[], y:[]}]} */
function parseCoef(text){
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l !== '');
  const out = {header: {}, blocks: []};
  let cur = null;
  for (const ln of lines){
    let mm = ln.match(/^width=\s*(\d+)$/);
    if (mm){ cur = {width: +mm[1], x: [], y: []}; out.blocks.push(cur); continue; }
    mm = ln.match(/^(\w+)=\s*(\S+)$/);
    if (mm){ out.header[mm[1]] = mm[2]; continue; }
    mm = ln.match(/^lookAngle([XY]):\s*(.+)$/);
    if (mm){ cur[mm[1] === 'X' ? 'x' : 'y'] = mm[2].trim().split(/\s+/).map(Number); continue; }
    mm = ln.match(/^angleBias\w+/);
    if (mm) continue;
  }
  return out;
}

console.log('Case A：用 taijing304_MSS.coef 复现几何模型（ovl=25、片优先、p/f=斜率、虚拟片全局最小口径）');
{
  const raw = fs.readFileSync(path.join(__dirname, 'taijing304_MSS.coef'), 'utf8');
  const ref = parseCoef(raw);
  const slope = 3.995861429234007983e-06;                    // 文件 lookAngleY 一次项
  const tanBands = [1.216744598045617701e-02, 1.226734251618702594e-02,
                    1.236723905191787660e-02, 1.246713558764872554e-02];
  const geo = core.buildGeometry({B: 4, N: 3, W: 3072, ovl: 25, slope,
    layout: 'colinear', tanBands, order: 'chip', virtualRule: 'min'});
  assert(geo.errors.length === 0, '几何无错误');
  assert(geo.Vw === 9166, `虚拟片宽 = 9166（得 ${geo.Vw}）`);
  const text = core.buildCoefText(4, 3, 5, geo.blocks);
  const mine = parseCoef(text);
  assert(mine.blocks.length === ref.blocks.length && ref.blocks.length === 13,
    `块数 = 13（虚拟 + 3片×4波段，得 ${mine.blocks.length}/${ref.blocks.length}）`);
  let worst = 0, where = '';
  for (let k = 0; k < 13; k++){
    const a = ref.blocks[k], b = mine.blocks[k];
    if (a.width !== b.width){ assert(false, `第${k}块 width ${a.width}≠${b.width}`); continue; }
    for (const [fi, name] of [[0,'x0'], [0,'y0'], [1,'y1']]){
      const r = name === 'x0' ? relErr(a.x[0], b.x[0])
              : name === 'y0' ? relErr(a.y[0], b.y[0]) : relErr(a.y[1], b.y[1]);
      if (r > worst){ worst = r; where = `第${k}块 ${name}`; }
    }
    for (let j = 2; j < 6; j++)
      if (a.y[j] !== 0 || b.y[j] !== 0 || a.x[j] !== 0 || b.x[j] !== 0)
        assert(false, `第${k}块高次系数应为 0`);
  }
  assert(worst < 1e-15, `13 块全部系数复现（最大相对偏差 ${worst.toExponential(2)} @ ${where} < 1e-15）`);
  const exact = text === raw.replace(/^﻿/, '');
  console.log(exact ? '    （且与原文件逐字节一致）'
                    : '    （数值一致；字节级非完全一致，属生成端运算次序的末位差异）');
  const geoDef = core.buildGeometry({B: 4, N: 3, W: 3072, ovl: 25, slope,
    layout: 'colinear', tanBands, order: 'chip'});  // 默认取法（全局最小）
  assert(geoDef.blocks[0].tanX === Math.min.apply(null, tanBands) &&
         ref.blocks[0].x[0] === Math.min.apply(null, tanBands),
    '默认取法（全局最小）虚拟片 X 与实例文件虚拟块一致');
  const geoMM = core.buildGeometry({B: 4, N: 3, W: 3072, ovl: 25, slope,
    layout: 'colinear', tanBands, order: 'chip', virtualRule: 'minmax'});
  assert(geoMM.blocks[0].tanX === Math.max.apply(null, tanBands),
    'minmax 取法（片内最大→片间最小）：虚拟片 X = 各波段 tanX 最大');
}

console.log('Case B：块顺序（片优先 / 波段优先）与垂轨布置');
{
  const s = 1e-5, W = 100, N = 3, B = 2, ovl = 10;
  const geoChip = core.buildGeometry({B, N, W, ovl, slope: s, layout: 'colinear',
    tanBands: [0.01, 0.02], order: 'chip'});
  const geoBand = core.buildGeometry({B, N, W, ovl, slope: s, layout: 'colinear',
    tanBands: [0.01, 0.02], order: 'band'});
  const Vw = 3 * 100 - 2 * 10;
  const h = Vw * s / 2, step = (W - ovl) * s;
  assert(geoChip.blocks.length === 1 + 6, '块数 = 1+6');
  const chipX = geoChip.blocks.slice(1).map(q => q.i + '/' + q.b).join(' ');
  const bandX = geoBand.blocks.slice(1).map(q => q.i + '/' + q.b).join(' ');
  assert(chipX === '1/1 1/2 2/1 2/2 3/1 3/2', `片优先顺序（得 ${chipX}）`);
  assert(bandX === '1/1 2/1 3/1 1/2 2/2 3/2', `波段优先顺序（得 ${bandX}）`);
  const c0s = geoChip.blocks.slice(1).map(q => q.y0);
  assert(relErr(c0s[0], h) < 1e-15 && relErr(c0s[2], h - step) < 1e-15 &&
         relErr(c0s[4], h - 2 * step) < 1e-15, '第 i 片 c0 = 半跨度−(i−1)(W−ovl)s');
  assert(Math.abs(geoChip.chipC0[2] - (W - 1) * s + h) <= s * 1.000001,
    '末片末探元 ≈ −半跨度（1 像元内，居中）');
  assert(geoChip.blocks[0].kind === 'virtual' && geoChip.blocks[0].width === Vw &&
         geoChip.blocks[0].tanX === 0.01,
    '虚拟片：宽 = N·W−(N−1)·ovl，默认取法（全局最小）X = 0.01');
  const geoMM = core.buildGeometry({B, N, W, ovl, slope: s, layout: 'colinear',
    tanBands: [0.01, 0.02], order: 'chip', virtualRule: 'minmax'});
  assert(geoMM.blocks[0].tanX === 0.02, 'minmax 取法：虚拟片 X = 0.02（各波段最大）');
}

console.log('Case C：光学闭包 GSD = p·H/f 与校验触发');
{
  const o1 = core.resolveOptics({p: 10e-6, f: 2.5, H: 500e3});
  assert(o1.GSD != null && relErr(o1.GSD, 2) < 1e-12, 'GSD = p·H/f = 2 m');
  const o2 = core.resolveOptics({f: 2.5, H: 500e3, GSD: 2});
  assert(o2.p != null && relErr(o2.p, 10e-6) < 1e-12, 'p = GSD·f/H = 10 μm');
  const cfg = {B: 1, N: 1, W: 100, ovl: 0, polyN: 5, layout: 'colinear',
               tol: 0.02, R: 6371e3, offsetMissing: []};
  const bad = core.buildChecks({p: 10e-6, f: 2.5, H: 500e3, GSD: 2.5, derived: []}, null, cfg)
                .find(c => c.name === 'GSD = p·H/f');
  assert(bad && bad.status === 'bad', `GSD 矛盾触发（${bad ? bad.detail : '未触发'}）`);
  const ok = core.buildChecks({p: 10e-6, f: 2.5, H: 500e3, GSD: 2, derived: []}, null, cfg)
               .find(c => c.name === 'GSD = p·H/f');
  assert(ok && ok.status === 'ok', 'GSD 一致判 ok');
  const info = core.buildChecks(o1, null, cfg).find(c => c.name === 'GSD = p·H/f');
  assert(info && info.status === 'info', '推导补全时不再重复校验（info）');
}

console.log('Case D：交错排列（各波段基偏移 + 奇/偶片交错分量）');
{
  const geo = core.buildGeometry({B: 2, N: 4, W: 50, ovl: 0, slope: 2e-5,
    layout: 'staggered', tanBands: [0.001, 0.003], tanOdd: 0.0005, tanEven: 0.0015,
    order: 'chip'});
  const xs = geo.blocks.slice(1).map(q => q.tanX);
  const exp = [0.0015, 0.0035, 0.0025, 0.0045, 0.0015, 0.0035, 0.0025, 0.0045];
  assert(xs.length === 8 && xs.every((v, k) => relErr(v, exp[k]) < 1e-12),
    '总 tanX = 波段基偏移 + 奇/偶分量：奇片 0.001/0.003+0.0005，偶片 +0.0015');
  assert(relErr(geo.blocks[0].tanX, 0.001 + 0.0005) < 1e-12,
    '默认虚拟片 X = 最小基偏移 + 较小分量 = 0.0015');
  const geoMM = core.buildGeometry({B: 2, N: 4, W: 50, ovl: 0, slope: 2e-5,
    layout: 'staggered', tanBands: [0.001, 0.003], tanOdd: 0.0005, tanEven: 0.0015,
    order: 'chip', virtualRule: 'minmax'});
  assert(relErr(geoMM.blocks[0].tanX, 0.003 + 0.0005) < 1e-12,
    'minmax 虚拟片 X = 最大基偏移 + 较小分量 = 0.0035');
  const cfg = {B: 2, N: 4, W: 50, ovl: 0, polyN: 5, layout: 'staggered',
               tol: 0.02, R: 6371e3, offsetMissing: [], tanBands: [0.001, 0.003],
               tanOdd: 0.01, tanEven: 0.01, H: 500e3};
  const eq = core.buildChecks({p: 1, f: 1, H: 500e3, GSD: 500e3, derived: []}, null, cfg)
    .find(c => c.name.includes('奇偶错开'));
  assert(eq && eq.status === 'info', '奇偶交错分量相同 → info 提示等效共线');
}

console.log('Case E：参数非法时的拦截');
{
  const g = core.buildGeometry({B: 4, N: 3, W: 3072, ovl: 3072, slope: 4e-6,
    layout: 'colinear', tanBands: [0, 0, 0, 0], order: 'chip'});
  assert(g.errors.length === 1 && /ovl/.test(g.errors[0]), 'ovl = W 被拒绝');
  const g2 = core.buildGeometry({B: 4, N: 3, W: 3072, ovl: 5, slope: 4e-6,
    layout: 'colinear', tanBands: [0, 0, 0], order: 'chip'});
  assert(g2.errors.length === 1 && /未填全/.test(g2.errors[0]), '波段偏移缺项被拒绝');
  const g3 = core.buildGeometry({B: 4, N: 3, W: 3072, ovl: 5, slope: NaN,
    layout: 'colinear', tanBands: [0, 0, 0, 0], order: 'chip'});
  assert(g3.errors.some(e => /p\/f/.test(e)), 'p/f 不可用被拒绝');
  const g4 = core.buildGeometry({B: 2, N: 2, W: 50, ovl: 0, slope: 2e-5,
    layout: 'staggered', tanBands: [0.001], tanOdd: 0.0005, tanEven: 0.0015, order: 'chip'});
  assert(g4.errors.length === 1 && /基偏移/.test(g4.errors[0]),
    '交错排列波段基偏移缺项被拒绝');
}

console.log('Case F：%.18e / %.18f 格式化');
{
  assert(core.fmtE18(0) === '0.000000000000000000e+00', 'fmtE18(0)');
  assert(core.fmtE18(1) === '1.000000000000000000e+00', 'fmtE18(1)');
  assert(core.fmtE18(-1) === '-1.000000000000000000e+00', 'fmtE18(-1)');
  const e = core.fmtE18(0.012167445980456177);
  assert(/^-1?\d\.\d{18}e[+-]\d{2,}$/.test(e) === false && /^\d\.\d{18}e[+-]\d{2,}$/.test(e),
    `指数两位填充（得 ${e}）`);
  assert(core.fmtE18(-1.831303293017945769e-02).startsWith('-1.8313032930179457') &&
         /e-02$/.test(core.fmtE18(-1.831303293017945769e-02)), '负值 + e-02');
  assert(/e\+\d{2,}$/.test(core.fmtE18(1e100)), '三位指数不裁断');
  assert(core.fmtF18(0) === '0.000000000000000000', 'fmtF18(0)');
}

console.log('Case G：coef 文本字节格式');
{
  const geo = core.buildGeometry({B: 1, N: 1, W: 8, ovl: 0, slope: 1e-4,
    layout: 'colinear', tanBands: [0.001], order: 'chip'});
  const text = core.buildCoefText(1, 1, 5, geo.blocks);
  const lines = text.split('\r\n');
  assert(text.endsWith('\r\n') && !text.endsWith('\r\n\r\n'), '末尾恰好一个 CRLF');
  assert(lines.every(l => !/\n/.test(l)), '全部 CRLF 换行');
  assert(lines[0] === 'nCamPoly=5' && lines[1] === 'bandCount=1' && lines[2] === 'sensorCount=1',
    '文件头三行');
  assert(lines[3] === 'angleBiasRoll=0.000000000000000000', 'angleBias 用 %.18f 定点');
  assert(/^angleBiasR:1\.000000000000000000e\+00 0\.000000000000000000e\+00 /.test(lines[6]),
    'angleBiasR 9 个单位阵元素（冒号后无空格，与实例一致）');
  assert(lines[7] === 'width= 8', 'width= 后有空格');
  assert(/^lookAngleX: 1\.0{16}\d{2}e-03 /.test(lines[8]), 'lookAngleX: 后有空格');
  const coefCount = l => l.replace(/^lookAngle[XY]:\s*/, '').trim().split(/\s+/).length;
  assert(coefCount(lines[8]) === 6 && coefCount(lines[9]) === 6,
    'nCamPoly=5 → 每行 6 个系数');
  const geo3 = core.buildGeometry({B: 1, N: 1, W: 8, ovl: 0, slope: 1e-4,
    layout: 'colinear', tanBands: [0.001], order: 'chip'});
  const t3 = core.buildCoefText(1, 1, 3, geo3.blocks);
  const l3 = t3.split('\r\n').find(l => l.startsWith('lookAngleY'));
  assert(l3.replace(/^lookAngleY:\s*/, '').trim().split(/\s+/).length === 4,
    'nCamPoly=3 → 4 个系数');
}

console.log('Case H：参数 TXT 序列化 → 解析 往返一致');
{
  const st = {
    values: {B: 4, N: 3, W: 3072, ovl: 25, polyN: 5,
             f: 2.5, p: 10e-6, H: 500e3, GSD: 2, R: 6371e3,
             d1: 30.4e-3, dd: 2.5e-3, dOdd: 12e-3, dEven: 9e-3},
    db: [{idx: 1, value: 30.4e-3}, {idx: 2, value: 32.9e-3}, {idx: 4, value: 37.9e-3}],
    meta: {layout: 'staggered', offsetMode: 'angle', blockOrder: 'band',
           virtualRule: 'min', tol: 0.01, filename: 'cam_MSS.coef'},
  };
  const text = core.paramsToText(st);
  const r = core.parseParamText(text);
  assert(r.warnings.length === 0, '整文件解析无警告（' + (r.warnings[0] || '') + '）');
  assert(r.meta.layout === 'staggered' && r.meta.offsetMode === 'angle' &&
         r.meta.blockOrder === 'band' && r.meta.virtualRule === 'min' &&
         Math.abs(r.meta.tol - 0.01) < 1e-15 &&
         r.meta.filename === 'cam_MSS.coef', '元参数（含 virtualRule）往返一致');
  let okCnt = 0, totCnt = 0;
  for (const k of ['B','N','W','ovl','polyN','f','p','H','GSD','R','d1','dd','dOdd','dEven']){
    totCnt++;
    if (r.values[k] != null && relErr(r.values[k], st.values[k]) < 1e-10) okCnt++;
  }
  assert(okCnt === totCnt, `14 个标量参数 SI 值往返一致（${okCnt}/${totCnt}）`);
  assert(r.db.length === 3 && r.db.every((d, i) => d.idx === st.db[i].idx &&
         relErr(d.value, st.db[i].value) < 1e-10), 'dbN 波段偏移行往返一致');
  // angle 模式下偏移字段按角度单位解析
  const r2 = core.parseParamText('offsetMode = angle\r\ndOdd = 0.5 °\r\ndEven = 0.25 mrad # 注释');
  assert(Math.abs(r2.values.dOdd - 0.5 * Math.PI / 180) < 1e-15 &&
         Math.abs(r2.values.dEven - 0.25e-3) < 1e-15, '角度单位偏移正确换算');
  const r3 = core.parseParamText(String.fromCharCode(0xFEFF) + 'layout = colinear\nfoo = 1');
  assert(r3.meta.layout === 'colinear' && r3.warnings.some(w => w.includes('foo')),
    'BOM 剥离 + 未知参数警告');
  // 共线模式（dist）下 db 行按距离单位
  const r4 = core.parseParamText('db1 = 30.4 mm\r\ndb2 = 32.9');
  assert(Math.abs(r4.db[0].value - 30.4e-3) < 1e-15 && Math.abs(r4.db[1].value - 32.9e-3) < 1e-15,
    '无单位 db 行按默认 mm');
}

fs.unlinkSync(corePath);
console.log(failed === 0 ? '\n全部通过' : '\n有 ' + failed + ' 项失败');
process.exit(failed === 0 ? 0 : 1);
