'use strict';
/* 自测：从 frame.html 抽出 <script id="core"> 真实代码与 DOM 脚本，
   验证 gf4b-VIS.coef（Frame 格式）解析与几何模型复现、理想 2×2 拼接重现实例尺寸、
   kjg.txt 原点解析、二元 3 次多项式语义、字节级格式 golden、校验触发、TXT 往返、
   stub DOM 装载页面脚本的渲染与缩放控件冒烟。
   运行：node test_frame.cjs */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'frame.html'), 'utf8');
const m = html.match(/<script id="core">([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: 未找到 core script 块'); process.exit(1); }
const corePath = path.join(__dirname, '_frame_core_tmp.cjs');
fs.writeFileSync(corePath, m[1]);
const core = require(corePath);

let failed = 0;
function assert(cond, msg){
  if (cond) console.log('  PASS  ' + msg);
  else { console.error('  FAIL  ' + msg); failed++; }
}
function relErr(a, b){ return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-30); }

/* 解析 Frame .coef 文本 → {header, blocks:[{width,height,x:[],y:[]}]} */
function parseCoef(text){
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l !== '');
  const out = {header: {}, blocks: []};
  let cur = null;
  for (const ln of lines){
    let mm = ln.match(/^width=\s*(\d+)$/);
    if (mm){ cur = {width: +mm[1], x: [], y: []}; out.blocks.push(cur); continue; }
    mm = ln.match(/^height=\s*(\d+)$/);
    if (mm){ cur.height = +mm[1]; continue; }
    mm = ln.match(/^lookAngle([XY]):\s*(.+)$/);
    if (mm){ cur[mm[1] === 'X' ? 'x' : 'y'] = mm[2].trim().split(/\s+/).map(Number); continue; }
    mm = ln.match(/^(\w+)=\s*(\S+)$/);
    if (mm && !/^angleBiasR/.test(ln)){ out.header[mm[1]] = mm[2]; continue; }
  }
  return out;
}

/* 二元 3 次多项式求值（项序 1,x,y,x²,xy,y²,x³,x²y,xy²,y³） */
const TERMS = [[0,0],[1,0],[0,1],[2,0],[1,1],[0,2],[3,0],[2,1],[1,2],[0,3]];
function evalPoly(c, x, y){
  let v = 0;
  for (let k = 0; k < c.length; k++) v += c[k] * Math.pow(x, TERMS[k][0]) * Math.pow(y, TERMS[k][1]);
  return v;
}

console.log('Case A：gf4b-VIS.coef 解析——头字段、块结构、几何关系（虚拟块 c0 = 各片最小）、字节格式');
{
  const raw = fs.readFileSync(path.join(__dirname, 'gf4b-VIS.coef'), 'utf8');
  const ref = parseCoef(raw);
  assert(ref.header.Type === 'Frame' && ref.header.CamPoly === '3' &&
         ref.header.bandCount === '1' && ref.header.sensorCount === '4',
    `文件头 Type=Frame、CamPoly=3、bandCount=1、sensorCount=4`);
  assert(ref.blocks.length === 5, `块数 = 5（虚拟整帧 + 4 物理片，得 ${ref.blocks.length}）`);
  assert(JSON.stringify(ref.blocks.map(b => b.width)) === JSON.stringify([22504,12288,12288,12288,12288]) &&
         JSON.stringify(ref.blocks.map(b => b.height)) === JSON.stringify([22438,12288,12288,12288,12288]),
    '尺寸：虚拟 22504×22438 + 4 片 12288×12288（含 height 行）');
  assert(ref.blocks.every(b => b.x.length === 10 && b.y.length === 10),
    'CamPoly=3 → 每块 lookAngleX/Y 各 10 系数');
  const virt = ref.blocks[0], chips = ref.blocks.slice(1);
  assert(virt.x[0] === Math.min(...chips.map(b => b.x[0])) &&
         virt.y[0] === Math.min(...chips.map(b => b.y[0])),
    '虚拟块两轴 c0 与各片最小 c0 严格相等（外接框口径）');
  const s = 5.517241379310344e-7;                                  // 实例 p/f
  assert(chips.every(b => Math.abs(b.x[1] - s) < 1e-21 && Math.abs(b.y[2] - s) < 1e-21),
    `各片 lookAngleX c1 与 lookAngleY c2 均为 ${s.toExponential()}（X 随 x、Y 随 y 变化）`);
  assert(chips.every(b => Math.abs(b.x[2]) < 1e-21 && Math.abs(b.y[1]) < 1e-21),
    '各片交叉项 c2(X)/c1(Y) ≈ 0（X 与 y、Y 与 x 无关）');
  assert(ref.blocks.every(b => b.x.slice(3).every(v => Math.abs(v) < 1e-20) &&
                               b.y.slice(3).every(v => Math.abs(v) < 1e-20)),
    '高次项均为 e-2x 量级标定噪声（|c| < 1e-20）');
  assert(2 * 12288 - 22504 === 2072 && 2 * 12288 - 22438 === 2138,
    '实例尺寸分解：2×12288−2072=22504、2×12288−2138=22438（2×2 拼接设计搭接 2072×2138 像元）');
  assert(raw.charCodeAt(0) !== 0xFEFF && raw.startsWith('Type=Frame') &&
         raw.endsWith('\r\n') && !raw.endsWith('\r\n\r\n') && !/[^\r]\n/.test(raw),
    '字节格式：无 BOM、CRLF 换行、末尾恰好一个 CRLF');
  assert(/^angleBiasR:1\.000000000000000000 0\.000000000000000000 [\d.]+  {2}/.test(raw.split('\r\n')[7]) ||
         /^angleBiasR:1\.000000000000000000 0\.000000000000000000 [\-0.\d]+  /.test(raw.split('\r\n')[7]),
    'angleBiasR 为 %.18f 定点（无指数），行组间两空格');
  const la = raw.split('\r\n').find(l => l.startsWith('lookAngleX'));
  const segs = la.slice('lookAngleX: '.length).split('  ');
  assert(segs.length === 10 && segs.every(t => /^[-+0-9]/.test(t) && !/\s/.test(t)),
    'lookAngle 系数以两个空格分隔（10 段，段内无空白）');
}

console.log('Case B：理想 2×2 拼接（搭接 2072×2138）重现 gf4b 虚拟整帧尺寸 22504×22438');
{
  const s = 5.517241379310344e-7, f = 6.5, p = s * f;
  const W = 12288, Hh = 12288, ox = 2072, oy = 2138;
  const chips = [
    {id: 1, x0: 0, y0: 0},
    {id: 2, x0: (W - ox) * p, y0: 0},
    {id: 3, x0: 0, y0: (Hh - oy) * p},
    {id: 4, x0: (W - ox) * p, y0: (Hh - oy) * p},
  ];
  const geo = core.buildGeometry({B: 1, W, H: Hh, slope: s, f, order: 'chip', chips});
  assert(geo.errors.length === 0, '几何无错误');
  assert(geo.Vw === 22504 && geo.Vh === 22438,
    `虚拟整帧 = ⌈(max−min)/p⌉+W → ${geo.Vw}×${geo.Vh}（期望 22504×22438）`);
  assert(geo.blocks.length === 5 && geo.blocks[0].width === 22504 && geo.blocks[0].height === 22438,
    '块数 5，第 0 块为虚拟整帧');
  assert(geo.overlapPairs.length === 6,
    `2×2 拼接共 6 对片 2D 搭接（4 邻接 + 2 对角，得 ${geo.overlapPairs.length}）`);
  assert(geo.overlapPairs.some(q => Math.abs(q.ox - ox) < 1e-6 && Math.abs(q.oy - 12288) < 1e-6) &&
         geo.overlapPairs.some(q => Math.abs(q.ox - 12288) < 1e-6 && Math.abs(q.oy - oy) < 1e-6) &&
         geo.overlapPairs.some(q => Math.abs(q.ox - ox) < 1e-6 && Math.abs(q.oy - oy) < 1e-6),
    `搭接像元数：x 邻接对 ${ox}×12288、y 邻接对 12288×${oy}、对角对 ${ox}×${oy}`);
  assert(geo.gapX.total === 0 && geo.gapY.total === 0, '投影方向无覆盖间隙');
  const text = core.buildCoefText(1, geo.N, geo.blocks);
  const mine = parseCoef(text);
  assert(mine.blocks[2].x[0] === 0 || relErr(mine.blocks[2].x[0], (W - ox) * s) < 1e-12,
    '第 2 片 c0 = (W−搭接)·p/f');
  // 非整像素间距：外接框 ceil
  const p2 = 1e-4;
  const geo2 = core.buildGeometry({B: 1, W: 10, H: 8, slope: p2 / 1, f: 1, order: 'chip',
    chips: [{id: 1, x0: 0, y0: 0}, {id: 2, x0: 100.5 * p2, y0: 0}]});
  assert(geo2.Vw === 111, `非整像素间距 ceil：跨度 100.5+10 = 110.5 → width ${geo2.Vw}（期望 111）`);
  const geo3 = core.buildGeometry({B: 1, W: 10, H: 8, slope: p2 / 1, f: 1, order: 'chip',
    chips: [{id: 1, x0: 0, y0: 0}]});
  assert(geo3.Vw === 10 && geo3.Vh === 8, '单片：虚拟整帧 = 单片尺寸');
}

console.log('Case C：用 gf4b 实例片 c0 反推原点 → 重新生成 → 系数复现');
{
  const raw = fs.readFileSync(path.join(__dirname, 'gf4b-VIS.coef'), 'utf8');
  const ref = parseCoef(raw);
  const s = 5.517241379310344e-7;
  const chips = ref.blocks.slice(1).map((b, i) => ({id: i + 1, x0: b.x[0], y0: b.y[0]}));  // f=1：tan 即坐标
  const geo = core.buildGeometry({B: 1, W: 12288, H: 12288, slope: s, f: 1, order: 'chip', chips});
  const mine = parseCoef(core.buildCoefText(1, geo.N, geo.blocks));
  assert(mine.blocks.length === 5, '重生成块数 5');
  let ok = true;
  for (let k = 1; k < 5; k++){
    const a = ref.blocks[k], b = mine.blocks[k];
    if (b.x[0] !== a.x[0] || b.y[0] !== a.y[0] || b.x[1] !== s || b.y[2] !== s) ok = false;
    for (let j = 2; j < 10; j++) if (b.x[j] !== 0) ok = false;   // lookAngleX 仅 c0、c1 非零
    for (let j = 1; j < 10; j++) if (j !== 2 && b.y[j] !== 0) ok = false;  // lookAngleY 仅 c0、c2 非零
  }
  assert(ok, '4 物理片 c0 逐位复原、c1/c2 = s、其余 9 项精确为 0');
  assert(mine.blocks[0].x[0] === ref.blocks[0].x[0] && mine.blocks[0].y[0] === ref.blocks[0].y[0],
    '虚拟块 c0 = 实例虚拟块 c0（min 口径一致）');
  assert(mine.blocks[0].width >= ref.blocks[0].width && mine.blocks[0].height >= ref.blocks[0].height,
    `外接框 ≥ 实例设计格网（得 ${mine.blocks[0].width}×${mine.blocks[0].height} vs 实例 22504×22438，` +
    `差源自实例实测片位姿偏差）`);
}

console.log('Case D：kjg.txt 原点解析与鲁棒性');
{
  const raw = fs.readFileSync(path.join(__dirname, 'kjg.txt'), 'utf8');
  const r = core.parseOriginText(raw, 1e-3);
  assert(r.warnings.length === 0 && r.chips.length === 24,
    `kjg.txt：24 片、无警告（得 ${r.chips.length} 片 / ${r.warnings.length} 警告）`);
  assert(r.chips[0].id === 1 && relErr(r.chips[0].x0, -225.258e-3) < 1e-15 &&
         relErr(r.chips[0].y0, -38.256e-3) < 1e-15,
    '第 1 片原点 (-225.258, -38.256) mm');
  assert(r.chips[23].id === 24 && relErr(r.chips[23].x0, 205.601e-3) < 1e-15 &&
         relErr(r.chips[23].y0, 8.744e-3) < 1e-15,
    '第 24 片原点 (205.601, 8.744) mm');
  assert(r.chips.every((c, i) => relErr(c.y0, i % 2 === 0 ? -38.256e-3 : 8.744e-3) < 1e-15),
    'y 沿行序 -38.256 / +8.744 交错');
  const ru = core.parseOriginText(raw, 1e-6);
  assert(relErr(ru.chips[0].x0, -225.258e-6) < 1e-15, '单位因子：μm 口径换算正确');
  const r2 = core.parseOriginText('ccd\tx\ty\n0.5\t1.5\n-1 2', 1e-3);
  assert(r2.chips.length === 2 && r2.chips[0].id === 1 && r2.chips[1].id === 2 &&
         relErr(r2.chips[1].x0, -1e-3) < 1e-15,
    '缺片号列：两列按行序自动编号');
  const r3 = core.parseOriginText('1,-225.258,-38.256\r\n2; -206.525;8.744', 1e-3);
  assert(r3.chips.length === 2 && r3.warnings.length === 0, '逗号 / 分号分隔均可');
  const r4 = core.parseOriginText('# 注释\n1 0 0\nfoo bar\n2 1 1', 1e-3);
  assert(r4.chips.length === 2 && r4.warnings.length === 1 && r4.warnings[0].includes('无法解析'),
    '数据后非数值行报警告并跳过');
  const r5 = core.parseOriginText('1 0 0\n1 1 1', 1e-3);
  assert(r5.chips.length === 2 && r5.warnings.some(w => w.includes('重复')), '重复片号警告');
  const r6 = core.parseOriginText(String.fromCharCode(0xFEFF) + '1\t-1.5\t2.5\n12abc 0 0', 1e-3);
  assert(r6.chips.length === 1 && relErr(r6.chips[0].x0, -1.5e-3) < 1e-15 &&
         r6.warnings.length === 1, 'BOM 剥离 + 含糊数值行拒绝');
}

console.log('Case E：块顺序（片优先 / 波段优先）与多项式语义');
{
  const geo = core.buildGeometry({B: 2, W: 10, H: 8, slope: 1e-4, f: 2, order: 'chip',
    chips: [{id: 1, x0: 0, y0: 0}, {id: 2, x0: 1e-3, y0: 0}]});
  assert(geo.blocks.length === 5 && geo.blocks[0].kind === 'virtual', '块数 1+N×B = 5，虚拟块居首');
  assert(geo.blocks.slice(1).map(q => q.i + '/' + q.b).join(' ') === '1/1 1/2 2/1 2/2',
    '片优先顺序：i 外层、b 内层');
  const geoB = core.buildGeometry({B: 2, W: 10, H: 8, slope: 1e-4, f: 2, order: 'band',
    chips: [{id: 1, x0: 0, y0: 0}, {id: 2, x0: 1e-3, y0: 0}]});
  assert(geoB.blocks.slice(1).map(q => q.i + '/' + q.b).join(' ') === '1/1 2/1 1/2 2/2',
    '波段优先顺序：b 外层、i 内层');
  // 二元 3 次多项式：tanX 只依赖 x、tanY 只依赖 y
  const slope = 2e-5, f = 1.5, W = 100, Hh = 50;
  const g2 = core.buildGeometry({B: 1, W, H: Hh, slope, f, order: 'chip',
    chips: [{id: 1, x0: 0.01, y0: -0.02}]});
  const cx = g2.blocks[1].cx, cy = g2.blocks[1].cy;
  assert(relErr(evalPoly(cx, 0, 0), 0.01 / 1.5) < 1e-12 &&
         relErr(evalPoly(cx, 99, 37), 0.01 / 1.5 + 99 * slope) < 1e-12,
    'tanX(x,y) = x0/f + (p/f)·x（与 y 无关，含 10 项求值）');
  assert(relErr(evalPoly(cy, 0, 0), -0.02 / 1.5) < 1e-12 &&
         relErr(evalPoly(cy, 63, 49), -0.02 / 1.5 + 49 * slope) < 1e-12,
    'tanY(x,y) = y0/f + (p/f)·y（与 x 无关）');
}

console.log('Case F：字节级 golden——完整 .coef 文件逐字节比对');
{
  const geo = core.buildGeometry({B: 1, W: 2, H: 3, slope: 0.125, f: 1, order: 'chip',
    chips: [{id: 1, x0: 0.5, y0: -0.25}]});           // 全体二进制可精确表示 → 末位确定
  const text = core.buildCoefText(1, 1, geo.blocks);
  const Z = '0.000000000000000000e+00';
  const lx = 'lookAngleX: 5.000000000000000000e-01  1.250000000000000000e-01  ' + Array(8).fill(Z).join('  ');
  const ly = 'lookAngleY: -2.500000000000000000e-01  ' + Z + '  1.250000000000000000e-01  ' + Array(7).fill(Z).join('  ');
  const golden = [
    'Type=Frame', 'CamPoly=3', 'bandCount=1', 'sensorCount=1',
    'angleBiasRoll=0.000000000000000000',
    'angleBiasPitch=0.000000000000000000',
    'angleBiasYaw=0.000000000000000000',
    'angleBiasR:1.000000000000000000 0.000000000000000000 0.000000000000000000' +
    '  0.000000000000000000 1.000000000000000000 0.000000000000000000' +
    '  0.000000000000000000 0.000000000000000000 1.000000000000000000',
    'width= 2', 'height= 3', lx, ly,
    'width= 2', 'height= 3', lx, ly,
  ].join('\r\n') + '\r\n';
  assert(text === golden, '生成文件与 golden 逐字节一致（头/双空格/%.18e/%.18f/CRLF/末尾单换行）');
  assert(core.fmtE18(0.5) === '5.000000000000000000e-01' &&
         core.fmtE18(-0.25) === '-2.500000000000000000e-01' &&
         core.fmtE18(2) === '2.000000000000000000e+00' &&
         core.fmtE18(0.0625) === '6.250000000000000000e-02',
    'fmtE18 二进制精确值末位确定');
  assert(core.fmtE18(1e100).endsWith('e+100'), '三位指数不裁断');
}

console.log('Case G：校验触发——GSD 恒等式、搭接、间隙、地平线、原点缺失');
{
  const mk = (chips, W, H, slope) =>
    core.buildGeometry({B: 1, W, H, slope, f: 1, order: 'chip', chips});
  const o1 = core.resolveOptics({p: 10e-6, f: 2.5, H: 500e3});
  assert(o1.GSD != null && relErr(o1.GSD, 2) < 1e-12, 'GSD = p·H/f = 2 m');
  const o2 = core.resolveOptics({f: 2.5, H: 500e3, GSD: 2});
  assert(o2.p != null && relErr(o2.p, 10e-6) < 1e-12, 'p = GSD·f/H = 10 μm');
  const cfg0 = {B: 1, W: 100, H: 100, tol: 0.02, R: 6371e3, originN: 1, originWarnings: []};
  const bad = core.buildChecks({p: 10e-6, f: 2.5, H: 500e3, GSD: 2.5, derived: []}, null, cfg0)
                  .find(c => c.name === 'GSD = p·H/f');
  assert(bad && bad.status === 'bad', `GSD 矛盾触发（${bad ? bad.detail : '未触发'}）`);
  const okc = core.buildChecks({p: 10e-6, f: 2.5, H: 500e3, GSD: 2, derived: []}, null, cfg0)
                  .find(c => c.name === 'GSD = p·H/f');
  assert(okc && okc.status === 'ok', 'GSD 一致判 ok');
  const infoc = core.buildChecks(o1, null, cfg0).find(c => c.name === 'GSD = p·H/f');
  assert(infoc && infoc.status === 'info', '推导补全时不再重复校验（info）');
  // 搭接：p=0.01、Wp=Hp=1 m，两片 x 错开 0.9 m → 搭接 10 像元
  const gOv = mk([{id: 1, x0: 0, y0: 0}, {id: 2, x0: 0.9, y0: 0}], 100, 100, 1e-2);
  const cOv = core.buildChecks({p: 1e-2, f: 1, H: null, GSD: null, derived: []}, gOv, cfg0)
                  .find(c => c.name === '片间 2D 搭接');
  assert(cOv && cOv.status === 'ok' && cOv.detail.includes('1 对') &&
         Math.abs(gOv.overlapPairs[0].ox - 10) < 1e-6,
    `搭接判 ok：1 对、ox = 10 像元（得 ${gOv.overlapPairs[0].ox.toFixed(4)}）`);
  // 间隙：x 错开 2.5 m → 间隙 1.5 m；无搭接
  const gGap = mk([{id: 1, x0: 0, y0: 0}, {id: 2, x0: 2.5, y0: 0}], 100, 100, 1e-2);
  const cGap = core.buildChecks({p: 1e-2, f: 1, H: null, GSD: null, derived: []}, gGap, cfg0)
                   .find(c => c.name === '投影覆盖间隙');
  assert(cGap && cGap.status === 'info' && cGap.detail.includes('x 向'),
    '覆盖间隙触发 info（x 向 1.5 m = 150 像元）');
  const cNo = core.buildChecks({p: 1e-2, f: 1, H: null, GSD: null, derived: []}, gOv, cfg0)
                  .find(c => c.name === '投影覆盖间隙');
  assert(cNo && cNo.status === 'ok', '无间隙判 ok');
  // 地平线：corner tan ≈ 100 → 离轴角 89.4° > 地平线角 asin(R/(R+H)) ≈ 68.0°
  const gHz = mk([{id: 1, x0: 0, y0: 0}], 100000, 1, 1e-3);
  const cHz = core.buildChecks({p: 1e-3, f: 1, H: 500e3, GSD: null, derived: []}, gHz,
                 {B: 1, W: 100000, H: 1, tol: 0.02, R: 6371e3, originN: 1, originWarnings: []})
                 .find(c => c.name.includes('地平线'));
  assert(cHz && cHz.status === 'bad', `边缘离轴角超地平线角报红（${cHz ? cHz.detail : '未触发'}）`);
  // 原点缺失
  const cNoOrig = core.buildChecks({p: 1e-3, f: 1, H: null, GSD: null, derived: []}, null,
                    {B: 1, W: 10, H: 10, tol: 0.02, R: 6371e3, originN: 0, originWarnings: []})
                    .find(c => c.name === 'CCD 原点文件');
  assert(cNoOrig && cNoOrig.status === 'bad', '原点缺失报红');
  // 多波段提示
  const cB = core.buildChecks({p: 1e-2, f: 1, H: null, GSD: null, derived: []}, gOv,
                 {B: 3, W: 100, H: 100, tol: 0.02, R: 6371e3, originN: 2, originWarnings: []})
                 .find(c => c.name === '多波段块');
  assert(cB && cB.status === 'info', 'B>1 给出共用原点提示');
  // 非法参数拦截
  const gBad = core.buildGeometry({B: 0, W: 10, H: 8, slope: 1e-4, f: 1, order: 'chip',
    chips: [{id: 1, x0: 0, y0: 0}]});
  assert(gBad.errors.some(e => e.includes('波段数')), 'B=0 被拒绝');
  const gBad2 = core.buildGeometry({B: 1, W: 10, H: 8, slope: NaN, f: 1, order: 'chip',
    chips: [{id: 1, x0: 0, y0: 0}]});
  assert(gBad2.errors.some(e => /p\/f/.test(e)), 'p/f 不可用被拒绝');
  const gBad3 = core.buildGeometry({B: 1, W: 10, H: 8, slope: 1e-4, f: 1, order: 'chip', chips: []});
  assert(gBad3.errors.some(e => e.includes('原点为空')), '原点为空被拒绝');
}

console.log('Case H：参数 TXT 序列化 → 解析 往返一致（含原点 oN 行）');
{
  const st = {
    values: {B: 1, W: 2048, H: 5120, f: 2, p: 10e-6, Horb: 500e3, GSD: 2.5, R: 6371e3},
    origins: [{idx: 1, x0: -0.225258, y0: -0.038256},
              {idx: 2, x0: -0.206525, y0: 0.008744},
              {idx: 24, x0: 0.205601, y0: 0.008744}],
    meta: {originUnit: 'mm', blockOrder: 'band', tol: 0.01, filename: 'kjg.coef'},
  };
  const text = core.paramsToText(st);
  const r = core.parseParamText(text);
  assert(r.warnings.length === 0, '整文件解析无警告（' + (r.warnings[0] || '') + '）');
  assert(r.meta.originUnit === 'mm' && r.meta.blockOrder === 'band' &&
         Math.abs(r.meta.tol - 0.01) < 1e-15 && r.meta.filename === 'kjg.coef',
    '元参数往返一致');
  let okCnt = 0, totCnt = 0;
  for (const k of ['B','W','H','f','p','Horb','GSD','R']){
    totCnt++;
    if (r.values[k] != null && relErr(r.values[k], st.values[k]) < 1e-10) okCnt++;
  }
  assert(okCnt === totCnt, `8 个标量参数 SI 值往返一致（${okCnt}/${totCnt}）`);
  assert(r.origins.length === 3 && r.origins.every((o, i) => o.idx === st.origins[i].idx &&
         relErr(o.x0, st.origins[i].x0) < 1e-10 && relErr(o.y0, st.origins[i].y0) < 1e-10),
    'oN 原点行（mm 口径）往返一致');
  const stU = JSON.parse(JSON.stringify(st));
  stU.meta.originUnit = 'μm';
  const rU = core.parseParamText(core.paramsToText(stU));
  assert(rU.warnings.length === 0 && rU.origins.every((o, i) =>
         relErr(o.x0, st.origins[i].x0) < 1e-10), 'originUnit=μm 出入同单位换算一致');
  const r3 = core.parseParamText(String.fromCharCode(0xFEFF) + 'B = 1\nfoo = 1');
  assert(r3.values.B === 1 && r3.warnings.some(w => w.includes('foo')), 'BOM 剥离 + 未知参数警告');
}

console.log('Case I：DOM 冒烟——stub DOM 装载页面脚本：默认参数渲染、坐标轴方向与缩放控件');
{
  const vm = require('vm');
  const srcs = [...html.matchAll(/<script(?:\s+id="(\w+)")?>([\s\S]*?)<\/script>/g)];
  const domSrc = srcs.find(mm => !mm[1])[2];
  const seed = {in_B:'1', in_W:'2048', in_H:'5120', in_f:'2000', in_p:'10', in_Horb:'500',
    in_GSD:'2.5', in_R:'6371', un_f:'mm', un_p:'μm', un_Horb:'km', un_GSD:'m', un_R:'km',
    unOrig:'mm', orderSel:'chip', tolSel:'0.02'};
  const E = {};
  function mkEl(id){
    const el = {id, value: seed[id] != null ? seed[id] : '', textContent:'', innerHTML:'',
      className:'', disabled:false, checked:false, style:{}, attrs:{}, ev:{},
      classList:{add(){}, remove(){}, contains(){ return false; }},
      setAttribute(k, v){ el.attrs[k] = String(v); },
      getAttribute(k){ return el.attrs[k]; },
      removeAttribute(k){ delete el.attrs[k]; },
      addEventListener(t, fn){ el.ev[t] = fn; },
      setPointerCapture(){}, getBoundingClientRect(){ return {left: 0, top: 0}; },
      click(){}, files: null};
    return el;
  }
  const doc = {
    querySelector(sel){
      const mm = sel.match(/^#([\w-]+)$/);
      if (!mm) return null;
      if (!E[mm[1]]) E[mm[1]] = mkEl(mm[1]);
      return E[mm[1]];
    },
    querySelectorAll(){ return []; },
    createElement(){ return mkEl('_dyn'); },
    body: mkEl('body'),
  };
  const ctx = {document: doc, console,
    window: {addEventListener(){}}, addEventListener(){},
    localStorage: {getItem(){ return null; }, setItem(){}, removeItem(){}},
    location: {reload(){}},
    setTimeout, clearTimeout};
  vm.createContext(ctx);
  vm.runInContext(srcs.find(mm => mm[1] === 'core')[2], ctx, {filename: 'frame_core.js'});
  vm.runInContext(domSrc, ctx, {filename: 'frame_dom.js'});
  // 默认参数渲染
  assert(E.inOrigins.value.includes('-225.258') && (E.inOrigins.value.match(/-38\.256/g) || []).length === 12,
    '页面装载：预填 kjg 24 片原点（12 行 y=-38.256）');
  assert(E.coefPre.textContent.startsWith('Type=Frame') &&
         E.coefPre.textContent.includes('sensorCount=24') &&
         E.coefPre.textContent.includes('width= 45134') &&
         E.coefPre.textContent.includes('height= 9820'),
    'recalc 生成 .coef 预览：25 块、虚拟整帧 45134×9820');
  assert(E.banner.className === 'ok', '默认参数全部检查通过（banner ok）');
  // 示意图：坐标轴方向 + 结构
  assert(E.fzPct.textContent === '100%' && E.focalSvg.attrs.viewBox === '0 0 760 540',
    '焦面图初始视图 100%（容器 760×540，1 单位 = 1px，文字不再整体放大）');
  const inner = E.focalSvg.innerHTML;
  const nRect = (inner.match(/<rect/g) || []).length;
  assert(nRect === 25 && inner.includes('scale(') && inner.includes('主点 (0,0)'),
    `SVG：24 片 + 虚拟整帧共 25 个矩形（得 ${nRect}），含缩放变换与主点标记`);
  // lookAngleX 向下为正（垂直轴 x/width）、lookAngleY 向左为正（水平轴 y/height）：
  // 第 1 片原点 x0 最小（tanX 最小 → 最上）、y0=-38.256 为 y 最小列（tanY 最小 → 最右）
  const rects = [...inner.matchAll(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g)]
                 .map(mm => ({x: +mm[1], y: +mm[2], w: +mm[3], h: +mm[4]}));
  const chipsR = rects.slice(1);          // 第 0 个 rect 为虚拟整帧虚线框
  const m1 = inner.match(/<rect x="([-\d.]+)" y="([-\d.]+)"[^>]*fill="#2059a8"/);
  assert(m1 && +m1[1] === Math.max(...chipsR.map(r => r.x)) && +m1[2] === Math.min(...chipsR.map(r => r.y)),
    '第 1 片在最上、最右（tanX 最小 → 顶、tanY 最小 → 右；探元 (0,0) 在右上角一端）');
  const cols = new Set(chipsR.map(r => r.x.toFixed(1)));
  assert(cols.size === 2, `y0 两值 → 24 片分两列（得 ${cols.size} 列）`);
  assert(chipsR.every(r => r.h < r.w) && rects[0].h > rects[0].w,
    'width 方向竖放：片竖跨 W·p·k < 横跨 H·p·k；虚拟整帧外接框竖长（kjg 横长原点 → 图中竖条）');
  assert((inner.match(/text-anchor="middle"/g) || []).length === 24,
    '默认视图即显示 24 个片号标签（文字 11px 恒定）');
  // 缩放控件
  E.fzIn.ev.click(); E.fzIn.ev.click();
  assert(E.fzPct.textContent === '169%', '两次 ＋（×1.3）→ 169%');
  E.fzFit.ev.click();
  assert(E.fzPct.textContent === '100%' && E.focalSvg.innerHTML.includes('scale(1)'),
    '「适配」重置回 100%');
  E.fzOut.ev.click();
  assert(E.fzPct.textContent === '77%', '一次 － → 77%');
}

fs.unlinkSync(corePath);
console.log(failed === 0 ? '\n全部通过' : '\n有 ' + failed + ' 项失败');
process.exit(failed === 0 ? 0 : 1);
