'use strict';
/* 自测：从 wiskbroom.html 抽出 <script id="core"> 真实代码，
   验证推导链闭环、互检触发、漏扫约束触发、TXT 参数文件往返。运行：node test_core.cjs */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'wiskbroom.html'), 'utf8');
const m = html.match(/<script id="core">([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: 未找到 core script 块'); process.exit(1); }
const corePath = path.join(__dirname, '_core_tmp.cjs');
fs.writeFileSync(corePath, m[1]);
const core = require(corePath);

const DEG = Math.PI / 180;
let failed = 0;
function assert(cond, msg){
  if (cond) console.log('  PASS  ' + msg);
  else { console.error('  FAIL  ' + msg); failed++; }
}
function relErr(a, b){ return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-30); }

/* 一套典型自洽参数（SI 单位） */
const D2R = Math.PI/180;
const omegaM = 4e-4;                      // 镜转速 4e-4 rad/s（0.0229°/s）：Δθ 步进 4 m = 0.8 像元 ≤ GSD⊥ 5 m
const dtheta = 2 * omegaM * 0.01;         // 帧间视线角 8e-6 rad
const thetaTot = 600 * dtheta;            // 4.8e-3 rad（0.275°）
const phiTot = core.totalGeoPhi(thetaTot, 6371e3, 6871e3, 'start'); // 球面换算（代码自己算，避免手算误差）

const base = {
  R:6371e3, mu:3.986004418e14, H:500e3, f:1, v_sat:7616.9,
  N_det:10240, p_along:10e-6, L_det:0.1024, fov_along:0.1024, D_along:51200, t_fly:6,
  M_det:1024, p_cross:10e-6, W_det:0.01024, fov_cross:0.01024, D_cross:5120,
  F_frame:100, t_frame:0.01, omega_m:omegaM, dtheta:dtheta, s_step:500e3*dtheta,
  N_f:600, Theta:thetaTot, phi_total:phiTot, SW:6371e3*phiTot,
};

console.log('Case A：全冗余输入（含视场角参数）应零矛盾');
{
  const val = core.solve(base, 'start');
  const chk = core.buildChecks(val, 0.02);
  const con = core.buildConstraints(val, 'start');
  const badC = chk.filter(c=>c.status==='bad'), badK = con.filter(c=>c.status==='bad');
  console.log('    恒等式校验 ' + chk.length + ' 条，约束 ' + con.length + ' 条');
  chk.filter(c=>c.status==='bad').forEach(c=>console.log('    矛盾: ' + c.label + ' 偏差 ' + (c.rel*100).toFixed(2) + '%'));
  badK.forEach(c=>console.log('    约束违反: ' + c.name + ' ' + c.detail));
  assert(chk.length >= 12, '恒等式校验项不少于 12（覆盖互检对）');
  assert(badC.length === 0, '无恒等式矛盾');
  assert(badK.length === 0, '无约束违反');
}

console.log('Case B：摆扫周期 8s → 周期内推进 v_g·T > 沿轨视场地面距离 D∥ → 条带漏扫报警');
{
  const val = core.solve({...base, t_fly:8}, 'start');
  const con = core.buildConstraints(val, 'start');
  const hit = con.find(c=>c.name.includes('条带间不漏扫') && c.status==='bad');
  console.log('    ' + (hit ? hit.detail : '（未触发）'));
  assert(!!hit, '条带间漏扫约束触发为 bad（v_g·T = 7062×8 ≈ 56.5 km > D∥ 51.2 km）');
}

console.log('Case C：只给骨干参数 → 推导链补全');
{
  const ins = {R:6371e3, mu:3.986004418e14, H:500e3, f:1,
               N_det:10240, p_along:10e-6, F_frame:100, omega_m:omegaM, N_f:600,
               M_det:1024, p_cross:10e-6};
  const val = core.solve(ins, 'start');
  assert(val.D_along && relErr(val.D_along.value, 51200) < 1e-9, 'D∥ = H·L/f = 51200 m');
  assert(val.D_cross && relErr(val.D_cross.value, 5120) < 1e-9, 'D⊥ = H·W/f = 5120 m');
  assert(val.Theta && relErr(val.Theta.value, thetaTot) < 1e-9, 'Θ = N_f·Δθ = 4.8e-3 rad（0.275°）');
  assert(val.t_fly && relErr(val.t_fly.value, 6) < 1e-9, 'T = N_f·t_f（连续摆扫）= 6 s');
  assert(val.t_retrace && Math.abs(val.t_retrace.value) < 1e-12, 'T往返 = T − N_f·t_f = 0（连续摆扫）');
  assert(val.SW && relErr(val.SW.value, 2400) < 0.01, 'SW ≈ 2.400 km（球面换算，1% 内）');
  assert(val.fov_along && relErr(val.fov_along.value, 0.1024) < 1e-9, 'Ω∥ = L/f 推导');
  assert(val.fov_cross && relErr(val.fov_cross.value, 0.01024) < 1e-9, 'Ω⊥ = W/f 推导');
  assert(val.v_gnd && relErr(val.v_gnd.value, 7062) < 0.01, 'v_g = v·R/a ≈ 7062 m/s');
}

console.log('Case D：D∥ 故意给错（60000 vs 推导 51200）→ 恒等式矛盾报警');
{
  const val = core.solve({...base, D_along:60000}, 'start');
  const chk = core.buildChecks(val, 0.02);
  const hit = chk.find(c=>c.status==='bad');
  console.log('    ' + (hit ? hit.label + '，偏差 ' + (hit.rel*100).toFixed(1) + '%' : '（未触发）'));
  assert(!!hit, '恒等式矛盾被检出');
}

console.log('Case E：只给卫星速度 → 反推轨道');
{
  const val = core.solve({R:6371e3, mu:3.986004418e14, v_sat:7616.9}, 'start');
  assert(val.H && relErr(val.H.value, 500e3) < 0.005, 'H = μ/v² − R ≈ 500 km（0.5% 内，受 v 输入精度限制）');
}

console.log('Case F：帧间步进超过摆扫方向地面分辨率 → 帧间欠采样报警');
{
  const val = core.solve({...base, omega_m:30*D2R, dtheta:2*30*D2R*0.01, s_step:500e3*2*30*D2R*0.01, Theta:600*2*30*D2R*0.01}, 'start');
  const con = core.buildConstraints(val, 'start');
  const hit = con.find(c=>c.name.includes('帧间步进') && c.status==='bad');
  console.log('    ' + (hit ? hit.detail : '（未触发）'));
  assert(!!hit, '帧间步进欠采样约束触发为 bad（s ≈ 5.236 km >> GSD⊥ 5 m）');
}

console.log('Case G：参数 TXT 序列化 → 解析 往返一致');
{
  const ins = {R:6371e3, mu:3.986004418e14, H:500e3, f:1, F_frame:100, omega_m:omegaM, N_f:600,
               t_fly:6.4, N_det:10240, p_along:10e-6, M_det:1024, p_cross:10e-6};
  const units = {R:0, mu:0, H:0, f:1, F_frame:0, omega_m:0, N_f:0, t_fly:0,
                 N_det:0, p_along:4, M_det:0, p_cross:4}; // 保存时所选显示单位索引
  const text = core.paramsToText(ins, units, 'start', 0.01);
  const r = core.parseParamText(text);
  assert(r.warnings.length === 0, '整文件解析无警告');
  assert(r.mode === 'start' && Math.abs(r.tol - 0.01) < 1e-15, 'mode / tolerance 往返一致');
  const keys = Object.keys(ins);
  let ok = keys.filter(k => r.inputs[k] != null && relErr(r.inputs[k], ins[k]) < 1e-10);
  assert(ok.length === keys.length, keys.length + ' 个参数 SI 值往返一致（' + ok.length + '）');

  const r2 = core.parseParamText(
    'H = 500 km\r\nTheta = 6 ° # 行内注释\nmode = center\nv_sat = 7616.9 km/s\nfoo = 1');
  assert(r2.inputs.H === 500e3 && r2.units.H === 0, '"H = 500 km"（CRLF 行）正确换算');
  assert(Math.abs(r2.inputs.Theta - 6*D2R) < 1e-12, '"Theta = 6 °" + 行内注释正确解析');
  assert(r2.mode === 'center' && Math.abs(r2.inputs.v_sat - 7616.9e3) < 1e-6, '手写 mode / 速度行生效');
  assert(r2.warnings.some(w => w.includes('foo')), '未知参数产生警告');

  const r3 = core.parseParamText('H = 500'); // 不带单位 = SI 基本单位
  assert(r3.inputs.H === 500 && r3.units.H === 1, '无单位视为 SI 基本单位 m（单位索引切到 m）');

  const r4 = core.parseParamText(String.fromCharCode(0xFEFF) + 'H = 500 km'); // 带 UTF-8 BOM 的文件
  assert(r4.inputs.H === 500e3 && r4.warnings.length === 0, '带 BOM 文件头正确剥离');
}

console.log('Case H：摆扫周期 7s → 每次摆扫距离（T×卫星速度）> D∥ → 报警，地速口径仍通过');
{
  const val = core.solve({...base, t_fly:7}, 'start');
  const con = core.buildConstraints(val, 'start');
  const hit = con.find(c=>c.name.includes('每次摆扫距离') && c.status==='bad');
  console.log('    ' + (hit ? hit.detail : '（未触发）'));
  assert(!!hit, '每次摆扫距离不漏扫约束触发为 bad（v·T = 7616.9×7 ≈ 53.3 km > D∥ 51.2 km）');
  const strip = con.find(c=>c.name.includes('条带间不漏扫'));
  assert(!!strip && strip.status==='ok', '同期地速口径 v_g·T = 7062×7 ≈ 49.4 km ≤ D∥ 51.2 km 仍为 ok');
}

console.log('Case I：只输入往返时间 1s（T 留空）→ T = 成像时长 + T往返 = 7 s 反推');
{
  const val = core.solve({N_f:600, F_frame:100, t_retrace:1}, 'start');
  assert(val.t_fly && relErr(val.t_fly.value, 7) < 1e-9, 'T = N_f·t_f + T往返 = 7 s');
  assert(val.t_retrace && val.t_retrace.source === '输入', 'T往返 保持输入值不被覆盖');
  const chk = core.buildChecks(val, 0.02);
  const hit = chk.find(c=>c.status==='bad' && c.pid==='t_fly');
  assert(!hit, 'T 留空按 T往返 推导不产生假矛盾（连续公式为假设，不参与互检）');
}

fs.unlinkSync(corePath);
console.log(failed === 0 ? '\n全部通过' : '\n有 ' + failed + ' 项失败');
process.exit(failed === 0 ? 0 : 1);
