(function(){
'use strict';
const DATA = window.DATA;
const PARTS = {}; DATA.parts.forEach(p => PARTS[p.name] = p);
const PROF_ORDER = ['HEA140','UNP120','SHS100*3','SHS50*2.5','L40*4'];
const $app = document.getElementById('app');
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtDeg = a => (Math.round(a*10)/10).toString().replace('.', ',') + '°';
const fmtMm = v => (Math.round(v*10)/10).toString().replace('.', ',');
const ev = (e, Y, Z) => e[0] + e[1]*Y + e[2]*Z;
const pid = n => n.replace('p/','');
/* hole tuple: [x, Y, Z, normalAxis, dia, face, across, acrossTxt] */

function segmentPart(parent, i){
  const segs = parent.ek, n = segs.length, len = segs[i-1].len;
  let start = 0; for(let k=0;k<i-1;k++) start += segs[k].len;
  const prisms = parent.prisms.map(pr => ({ outer: pr.outer, holes: pr.holes,
    e0: i === 1 ? pr.e0 : [0,0,0], e1: i === n ? [pr.e1[0]-start, pr.e1[1], pr.e1[2]] : [len,0,0] }));
  const sq = {kind:'duz', angle:0, joint:true};
  const holes = (parent.holes||[]).filter(h => h[0] >= start && h[0] < start + len).map(h => [h[0]-start].concat(h.slice(1)));
  return Object.assign({}, parent, { L: len, prisms, holes, qty: 1, seg: {i, n, start, parentL: parent.L},
    ends: [ i === 1 ? parent.ends[0] : sq, i === n ? parent.ends[1] : sq ] });
}
function shortEnd(e){
  if(e.joint) return 'düz (ek)';
  if(e.kind === 'aci') return fmtDeg(e.angle);
  if(e.kind === 'ukesim') return 'düz + çentik';
  return 'düz';
}

/* ---------- 3D ---------- */
const V = { renderer:null, scene:null, camera:null, controls:null, root:null, part:null, el:null };
function initViewer(){
  if(V.renderer) return;
  const r = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  r.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
  V.renderer = r; V.scene = new THREE.Scene();
  V.camera = new THREE.PerspectiveCamera(38, 1, 1, 200000);
  V.scene.add(new THREE.HemisphereLight(0xffffff, 0x7d8894, 0.85));
  const d1 = new THREE.DirectionalLight(0xffffff, 0.7); d1.position.set(0.5, 1, 0.7); V.scene.add(d1);
  const d2 = new THREE.DirectionalLight(0xffffff, 0.35); d2.position.set(-0.6, -0.3, -0.8); V.scene.add(d2);
  V.controls = new THREE.OrbitControls(V.camera, r.domElement);
  V.controls.addEventListener('change', render);
  window.addEventListener('resize', resize);
}
function declutter(){
  if(!V.root) return;
  const el = V.el, Wp = el.clientWidth, Hp = el.clientHeight, k = V.camera.projectionMatrix.elements[5]/2*Hp;
  const placed = [];
  const sprites = []; V.root.traverse(o => { if(o.isSprite) sprites.push(o); });
  sprites.sort((a,b) => (b.userData.prio||0) - (a.userData.prio||0));
  const v = new THREE.Vector3();
  sprites.forEach(sp => {
    v.setFromMatrixPosition(sp.matrixWorld).project(V.camera);
    const w = sp.scale.x*k, h = sp.scale.y*k;
    const cx = (v.x+1)/2*Wp - (sp.center.x-0.5)*w, cy = (1-v.y)/2*Hp + (sp.center.y-0.5)*h;
    const r = [cx-w/2-2, cy-h/2-2, cx+w/2+2, cy+h/2+2];
    const hit = v.z > 1 || placed.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
    sp.visible = !hit;
    if(!hit) placed.push(r);
  });
}
function render(){
  if(!(V.renderer && V.el && V.el.isConnected)) return;
  if(V.root){ V.root.updateMatrixWorld(true); declutter(); }
  V.renderer.render(V.scene, V.camera);
}
function resize(){
  if(!V.el || !V.el.isConnected) return;
  const w = V.el.clientWidth, h = V.el.clientHeight;
  V.renderer.setSize(w, h, false); V.camera.aspect = w/h; V.camera.updateProjectionMatrix(); render();
}
function makeLabel(text, bg, fg, h){
  const c = document.createElement('canvas'), ctx = c.getContext('2d'), fs = 64;
  const font = '700 '+fs+'px "Barlow Condensed","Arial Narrow",Arial,sans-serif';
  ctx.font = font; c.width = Math.ceil(ctx.measureText(text).width) + 32; c.height = fs + 24;
  ctx.font = font; ctx.fillStyle = bg; ctx.beginPath();
  if(ctx.roundRect) ctx.roundRect(0,0,c.width,c.height,14); else ctx.rect(0,0,c.width,c.height);
  ctx.fill(); ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.fillText(text, 16, c.height/2+3);
  const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest:false, sizeAttenuation:false }));
  sp.renderOrder = 10; sp.scale.set(h*c.width/c.height, h, 1); return sp;
}
/* table frame (x, Y back=0 front=-W, Z up) -> three (map(x)-OFF, Z, -Y)
   "Cut parts": long empty stretches are shortened in the picture (like Tekla); dimensions stay real. */
let OFF = 0;
let CP = { iv: null, gapVis: 0, shifts: [] };
function mapX(x){
  const iv = CP.iv; if(!iv) return x;
  for(let k = iv.length-1; k >= 0; k--){ if(x >= iv[k][0] - 1e-6) return x - CP.shifts[k]; }
  return x;
}
const P3 = (x,Y,Z) => new THREE.Vector3(mapX(x) - OFF, Z, -Y);
function extremeX(part, side){
  let v = side === 0 ? Infinity : -Infinity;
  part.prisms.forEach(pr => pr.outer.forEach(q => {
    const x = ev(side === 0 ? pr.e0 : pr.e1, q[0], q[1]);
    v = side === 0 ? Math.min(v, x) : Math.max(v, x);
  }));
  return v;
}
function computeCut(part, withHoles){
  const size = Math.max(part.W, part.H);
  const xa = extremeX(part,0), xb = extremeX(part,1);
  let setL = 0, setR = 0;
  part.prisms.forEach(pr => pr.outer.forEach(q => { setL = Math.max(setL, ev(pr.e0,q[0],q[1]) - xa); setR = Math.max(setR, xb - ev(pr.e1,q[0],q[1])); }));
  let zones = [[xa, xa + setL + size*1.4], [xb - setR - size*1.4, xb]];
  if(withHoles) (part.holes||[]).forEach(h => zones.push([h[0] - size*0.6, h[0] + size*0.6]));
  zones = zones.map(z => [Math.max(xa, z[0]), Math.min(xb, z[1])]).sort((a,b) => a[0]-b[0]);
  const minGap = size*2.6, iv = [];
  zones.forEach(z => { const last = iv[iv.length-1]; if(last && z[0] - last[1] < minGap) last[1] = Math.max(last[1], z[1]); else iv.push(z.slice()); });
  const gapVis = size*0.9, shifts = [0];
  for(let k=1;k<iv.length;k++) shifts.push(shifts[k-1] + (iv[k][0] - iv[k-1][1]) - gapVis);
  CP = { iv, gapVis, shifts };
}
function prismGeometry(pr){
  const pos = [], P = (x,Y,Z) => [mapX(x) - OFF, Z, -Y];
  const tri = (a,b,c) => pos.push(...a, ...b, ...c);
  [pr.outer].concat(pr.holes || []).forEach(lp => {
    for(let i=0;i<lp.length;i++){
      const a = lp[i], b = lp[(i+1)%lp.length];
      const A0 = P(ev(pr.e0,a[0],a[1]),a[0],a[1]), A1 = P(ev(pr.e1,a[0],a[1]),a[0],a[1]);
      const B0 = P(ev(pr.e0,b[0],b[1]),b[0],b[1]), B1 = P(ev(pr.e1,b[0],b[1]),b[0],b[1]);
      tri(A0,A1,B1); tri(A0,B1,B0);
    }
  });
  const all = pr.outer.concat(...(pr.holes||[]));
  THREE.ShapeUtils.triangulateShape(pr.outer.map(v => new THREE.Vector2(v[0],v[1])), (pr.holes||[]).map(h => h.map(v => new THREE.Vector2(v[0],v[1])))).forEach(f => {
    const v = f.map(i => all[i]);
    tri(...v.map(q => P(ev(pr.e0,q[0],q[1]),q[0],q[1])));
    tri(...v.map(q => P(ev(pr.e1,q[0],q[1]),q[0],q[1])));
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}
const M = {};
const DIA_COL = { 14:'#1E9E52', 18:'#E8590C', 16:'#1C7ED6', 22:'#AE3EC9', 12:'#F08C00', 20:'#C2255C' };
const diaColor = d => DIA_COL[d] || '#495057';
function mats(){
  if(M.part) return;
  M.part = new THREE.MeshStandardMaterial({ color:0x7591A8, metalness:0.3, roughness:0.5, side:THREE.DoubleSide, flatShading:true, polygonOffset:true, polygonOffsetFactor:1, polygonOffsetUnits:1 });
  M.faint = new THREE.MeshStandardMaterial({ color:0xA9BCCB, metalness:0.2, roughness:0.6, side:THREE.DoubleSide, flatShading:true, transparent:true, opacity:0.78, depthWrite:false, polygonOffset:true, polygonOffsetFactor:1, polygonOffsetUnits:1 });
  M.edge = new THREE.LineBasicMaterial({ color:0x1A2026 });
  M.dim = new THREE.LineBasicMaterial({ color:0x2B3A47 });
  M.lead = new THREE.LineBasicMaterial({ color:0x8A96A0 });
  M.brk = new THREE.LineBasicMaterial({ color:0x56626C });
  M.hole = new THREE.MeshBasicMaterial({ color:0x111518 });
  M.ringBy = {};
}
function ringMat(d){ if(!M.ringBy[d]) M.ringBy[d] = new THREE.MeshBasicMaterial({ color:new THREE.Color(diaColor(d)) }); return M.ringBy[d]; }
function clearRoot(){
  if(!V.root) return;
  V.root.traverse(o => { if(o.geometry) o.geometry.dispose(); if(o.material && o.material.map){ o.material.map.dispose(); o.material.dispose(); } });
  V.scene.remove(V.root); V.root = null;
}
function line(g, pts, mat){ g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat || M.dim)); }
function addPart(g, part, faint){
  const iv = CP.iv, n = iv.length;
  iv.forEach((z, k) => {
    part.prisms.forEach(pr => {
      const piece = { outer: pr.outer, holes: pr.holes, e0: k === 0 ? pr.e0 : [z[0],0,0], e1: k === n-1 ? pr.e1 : [z[1],0,0] };
      const geo = prismGeometry(piece);
      g.add(new THREE.Mesh(geo, faint ? M.faint : M.part));
      g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), M.edge));
    });
  });
  // break marks in every shortened gap
  const W = part.W, H = part.H;
  for(let k=1;k<n;k++){
    const gx = mapX(iv[k-1][1]) + CP.gapVis/2 - OFF;
    [[-W-6],[6]].forEach(([Y]) => {
      const pts = []; const steps = 6;
      for(let s=0;s<=steps;s++){ pts.push(new THREE.Vector3(gx + (s%2 ? 9 : -9), -6 + (H+12)*s/steps, -Y)); }
      line(g, pts, M.brk);
    });

  }
}
function endLabels(g, part, zeroMark){
  const W = part.W, H = part.H;
  [0,1].forEach(side => {
    const e = part.ends[side];
    const pl = side === 0 ? part.prisms[0].e0 : part.prisms[0].e1;
    const isA = e.kind === 'aci';
    const txt = isA ? fmtDeg(e.angle) : (e.kind === 'ukesim' ? '0° + çentik' : '0°');
    const z = zeroMark && side === 0;
    const lab = makeLabel(z ? '0 tarafı · '+txt : txt, z ? '#D3212D' : (isA ? '#F5B800' : '#FFFFFF'), z ? '#FFFFFF' : '#1A2026', 0.05);
    lab.userData.prio = 10; lab.center.set(0.5, 0);
    const xe = side === 0 ? extremeX(part,0) : extremeX(part,1);
    lab.position.copy(P3(xe, 0, H + 40)); g.add(lab);
    if(isA){
      const xf = ev(pl, 0, H), xr = ev(pl, -W, H);
      if(Math.abs(xf - xr) > 1){
        const sl = makeLabel('fark '+Math.round(Math.abs(xf-xr))+' mm', '#FFFFFF', '#56626C', 0.032);
        sl.userData.prio = 6; sl.center.set(0.5, 1);
        sl.position.copy(P3(xe, -W, -12)); g.add(sl);
      }
    }
  });
}
function sceneCut(part){
  const g = new THREE.Group(), H = part.H, L = part.L;
  addPart(g, part, false);
  const yD = H + 18, x0 = extremeX(part,0), x1 = extremeX(part,1);
  line(g, [P3(x0,0,yD), P3(x1,0,yD)]);
  line(g, [P3(x0,0,H), P3(x0,0,yD+8)]); line(g, [P3(x1,0,H), P3(x1,0,yD+8)]);
  const ll = makeLabel(L+' mm', '#2B3A47', '#FFFFFF', 0.05); ll.userData.prio = 12;
  ll.position.copy(P3(x0,0,yD+10)).add(P3(x1,0,yD+10)).multiplyScalar(0.5); g.add(ll);
  endLabels(g, part);
  return g;
}
function zeroEndTxt(part){
  const e = part.ends[0];
  if(e.joint) return 'ek ucu';
  return e.kind === 'aci' ? fmtDeg(e.angle)+' açılı uç' : 'düz uç';
}
function sameEnds(part){ const a = part.ends[0], b = part.ends[1]; return !a.joint && !b.joint && a.kind === b.kind && (a.angle||0) === (b.angle||0); }
function holeGroups(part){
  const groups = {};
  (part.holes||[]).forEach(h => { const k = h[5]+'|'+h[4]+'|'+h[6]; (groups[k] = groups[k] || { face:h[5], d:h[4], acr:h[6], acrTxt:h[7], n:h[3], Y:h[1], Z:h[2], xs:[] }).xs.push(h[0]); });
  return Object.values(groups).map(g => { g.xs.sort((a,b)=>a-b); return g; });
}
function sceneHoles(part){
  const g = new THREE.Group(), W = part.W, H = part.H;
  addPart(g, part, true);
  endLabels(g, part, true);
  (part.holes||[]).forEach(h => {
    const [x, Y, Z, n, d] = h;
    const th = part.pose === 'HEA' ? 8.5 : (n === 'Y' ? 7 : 9);
    const pos = P3(x, Y, Z);
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(d/2, d/2, th + 1.5, 24), M.hole);
    cyl.position.copy(pos); if(n === 'Y') cyl.rotation.x = Math.PI/2; g.add(cyl);
    const off = th/2 + 1.6;
    [-1,1].forEach(s => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(d/2 + 3.5, 2.8, 8, 28), ringMat(d));
      ring.position.copy(pos);
      if(n === 'Y') ring.position.z += s*off; else { ring.rotation.x = Math.PI/2; ring.position.y += s*off; }
      g.add(ring);
    });
  });
  const x0 = extremeX(part, 0);
  const byFace = {};
  (part.holes||[]).forEach(h => (byFace[h[5]] = byFace[h[5]] || []).push(h));
  Object.keys(byFace).forEach(face => {
    const hs = byFace[face], h0 = hs[0];
    const below = face === 'Ön kanat' || face === 'Alt kanat';
    const Yc = h0[3] === 'Y' ? h0[1] : -W/2;
    const Zc = below ? -45 : H + 45;
    const base = x => P3(x, Yc, Zc);
    const xs = [...new Set(hs.map(h => h[0]))].sort((a,b)=>a-b);
    line(g, [base(x0), base(xs[xs.length-1])]);
    [x0].concat(xs).forEach(x => line(g, [base(x).clone().add(new THREE.Vector3(0,-7,0)), base(x).clone().add(new THREE.Vector3(0,7,0))]));
    xs.forEach(x => {
      const col = hs.filter(h => h[0] === x);
      const hz = col.map(h => h[2]);
      const zt = below ? Math.min(...hz) : Math.max(...hz);
      line(g, [base(x), P3(x, Yc, zt)], M.lead);
      const lb = makeLabel(fmtMm(x - x0), '#FFFFFF', '#1A2026', 0.034); lb.userData.prio = 3;
      lb.center.set(0.5, below ? 1 : 0); lb.position.copy(base(x)).add(new THREE.Vector3(0, below ? -9 : 9, 0)); g.add(lb);
      // diameter tag next to the hole column
      const d = col[0][4];
      const dl = makeLabel('ø'+d, diaColor(d), '#FFFFFF', 0.028); dl.userData.prio = 2;
      dl.center.set(0, 0.5); dl.position.copy(P3(x, col[0][1], col[0][2])).add(new THREE.Vector3(d/2 + 8, 0, 0)); g.add(dl);
    });
    const z0 = makeLabel('0', '#2B3A47', '#FFFFFF', 0.034); z0.userData.prio = 5; z0.center.set(1, 0.5); z0.position.copy(base(x0)).add(new THREE.Vector3(-8,0,0)); g.add(z0);
    [...new Set(hs.map(h => h[6]))].forEach(a => {
      const row = hs.filter(q => q[6] === a), h = row[0];
      const lb = makeLabel(h[7]+' '+fmtMm(a), '#2B3A47', '#FFFFFF', 0.03); lb.userData.prio = 4; lb.center.set(1, 0.5);
      lb.position.copy(P3(Math.min(...row.map(q=>q[0])), h[1], h[2])).add(new THREE.Vector3(-18,0,0)); g.add(lb);
    });
  });
  return g;
}
function setCamera(kind){
  const p = V.part, L = p.L, W = p.W, H = p.H, size = Math.max(W,H);
  const c = V.camera, t = V.controls.target, dir = new THREE.Vector3();
  const xa = mapX(extremeX(p,0)) - OFF, xb = mapX(extremeX(p,1)) - OFF;
  let lo = xa, hi = xb;
  if(kind === 'left') hi = Math.min(xb, xa + size*3.5);
  if(kind === 'right') lo = Math.max(xa, xb - size*3.5);
  const m = 70, corners = [];
  [lo-m, hi+m].forEach(x => [-m, H+m].forEach(y => [-m, W+m].forEach(z => corners.push(new THREE.Vector3(x,y,z)))));
  if(kind === 'left') dir.set(-0.6, 0.5, 0.62);
  else if(kind === 'right') dir.set(0.6, 0.5, 0.62);
  else if(kind === 'front') dir.set(-0.1, 0.3, 0.95);
  else if(kind === 'back') dir.set(0.1, 0.3, -0.95);
  else if(kind === 'top') dir.set(0, 1, 0.03);
  else if(kind === 'bottom') dir.set(0, -1, 0.3);
  else dir.set(-0.45, 0.5, 0.74);
  dir.normalize();
  t.set((lo+hi)/2, H/2, W/2);
  const f = dir.clone().negate();
  const up = Math.abs(f.y) > 0.95 ? new THREE.Vector3(0,0,-1) : new THREE.Vector3(0,1,0);
  const r = new THREE.Vector3().crossVectors(f, up).normalize(), u = new THREE.Vector3().crossVectors(r, f).normalize();
  const vf = Math.tan(c.fov*Math.PI/360), hf = vf*c.aspect*0.78;
  let d = 0;
  corners.forEach(q => { const v = q.clone().sub(t); d = Math.max(d, Math.abs(v.dot(r))/hf - v.dot(f), Math.abs(v.dot(u))/vf - v.dot(f)); });
  c.up.copy(up);
  c.position.copy(t).addScaledVector(dir, d*1.2);
  c.near = Math.max(0.5, d*0.01); c.far = d*10 + L*4; c.updateProjectionMatrix();
  V.controls.update(); render();
}
function show(mode, cam){
  clearRoot(); mats();
  const part = V.part;
  computeCut(part, mode === 'holes');
  OFF = (mapX(extremeX(part,0)) + mapX(extremeX(part,1)))/2;
  V.root = mode === 'holes' ? sceneHoles(part) : sceneCut(part);
  V.scene.add(V.root);
  setCamera(cam);
}

/* ---------- pages ---------- */
function setTitle(t){ document.title = t + ' · Tribün'; }
function homeView(){
  setTitle('Pozlar');
  let html = '';
  PROF_ORDER.forEach(pf => {
    const ps = DATA.parts.filter(p => p.prof === pf).sort((a,b) => +pid(a.name) - +pid(b.name));
    if(!ps.length) return;
    html += '<section class="prof"><div class="prof-head"><h3>'+esc(pf)+'</h3><span class="muted">'+ps.length+' poz</span></div><div class="plist">'+
      ps.map(p => '<a class="prow" href="#/p/'+pid(p.name)+'"><span class="nm">'+esc(p.name)+'</span><span class="sub"><b>'+p.L+' mm</b> · '+p.qty+' adet</span><span class="ends">'+shortEnd(p.ends[0])+' | '+shortEnd(p.ends[1])+(p.holes.length ? ' · <span class="hb">'+p.holes.length+' delik</span>' : '')+'</span></a>').join('')+'</div></section>';
  });
  $app.innerHTML = '<div class="intro"><h1>Tribün parçaları</h1><p class="lead muted">AMFI İmalat 3 · '+DATA.parts.length+' poz. Poza dokun: kesim açıları ve delikler 3B.</p></div>' + html;
}
function holeTable(part){
  const gs = holeGroups(part);
  if(!gs.length) return '';
  const byFace = {};
  gs.forEach(g => (byFace[g.face] = byFace[g.face] || []).push(g));
  return Object.keys(byFace).map(face => {
    const rows = byFace[face].map(g => {
      const x0 = extremeX(part, 0);
      return '<div class="hrow"><div class="hdia" style="background:'+diaColor(g.d)+'">ø'+g.d+'</div><div><div class="hmeta"><b>'+g.xs.length+' delik</b> · '+g.acrTxt+' <b>'+fmtMm(g.acr)+' mm</b></div>'+
        '<div class="hxs">'+g.xs.map(x => '<span>'+fmtMm(x - x0)+'</span>').join('')+'</div></div></div>';
    }).join('');
    return '<div class="card"><h3>'+esc(face)+'</h3><p class="zero">0 tarafı: <b>'+zeroEndTxt(part)+'</b>'+(sameEnds(part) ? ' (iki uç aynı; 3B\'de kırmızı işaretli uç)' : '')+'. Boyuna ölçüler bu uçtaki en dış köşeden.</p>'+rows+'</div>';
  }).join('');
}
function partView(name, segNo, tab){
  let part = PARTS['p/'+name];
  if(!part){ notFound('p/'+name); return; }
  if(segNo){ if(!part.ek || !part.ek[segNo-1]){ notFound('p/'+name); return; } part = segmentPart(part, +segNo); }
  setTitle(part.name);
  const base = '#/p/'+name+(segNo ? '/ek/'+segNo : '');
  const hasHoles = (part.holes||[]).length > 0;
  if(tab === 'delim' && !hasHoles) tab = 'kesim';
  tab = tab || 'kesim';
  const tabs = '<nav class="tabs"><a href="'+base+'" aria-current="'+(tab==='kesim'?'page':'false')+'">Kesim</a>'+
    (hasHoles ? '<a href="'+base+'/delim" aria-current="'+(tab==='delim'?'page':'false')+'">Delim <small>'+part.holes.length+'</small></a>' : '<span class="off">Delik yok</span>')+'</nav>';
  let ek = '';
  if(!part.seg && part.ek) ek = '<p class="note">6 m\'den uzun; <b>'+part.ek.length+' parçadan eklenir</b>: '+part.ek.map((s,i)=>'<a href="#/p/'+name+'/ek/'+(i+1)+(tab==='delim'?'/delim':'')+'">'+(i+1)+'. parça '+s.len+' mm</a>').join(', ')+'.</p>';
  if(part.seg) ek = '<p class="note"><b>'+part.name+'</b> ek parçası '+part.seg.i+'/'+part.seg.n+' (toplam '+part.seg.parentL+' mm). Ek ucu düz.'+(part.seg.start ? ' Bu parçanın 0 noktası, ana parçada '+part.seg.start+' mm\'ye denk gelir.' : '')+'</p>';
  const facts = '<div class="facts"><div class="fact"><span>Profil</span><b>'+esc(part.prof)+'</b></div><div class="fact"><span>Boy</span><b>'+part.L+' mm</b></div>'+
    (part.seg ? '' : '<div class="fact"><span>Adet</span><b>'+part.qty+'</b></div>')+
    (tab === 'kesim' ? '<div class="fact"><span>Sol uç</span><b>'+shortEnd(part.ends[0])+'</b></div><div class="fact"><span>Sağ uç</span><b>'+shortEnd(part.ends[1])+'</b></div>' : '')+'</div>';
  const camBtns = tab === 'delim'
    ? '<button data-c="view">Genel</button><button data-c="front">Önden</button><button data-c="back">Arkadan</button><button data-c="top">Üstten</button><button data-c="bottom">Alttan</button><button data-c="left">Sol uç</button><button data-c="right">Sağ uç</button>'
    : '<button data-c="view">Genel</button><button data-c="left">Sol uç</button><button data-c="right">Sağ uç</button><button data-c="top">Üstten</button><button data-c="front">Önden</button>';
  $app.innerHTML =
    '<div class="ptitle"><h1>'+esc(part.name)+(part.seg ? ' <span class="muted" style="font-size:30px">ek '+part.seg.i+'/'+part.seg.n+'</span>' : '')+'</h1></div>'+
    tabs + facts + ek +
    '<div class="viewer" id="viewer">'+(tab === 'delim' ? '<div class="legend">'+[...new Set(part.holes.map(h => h[4]))].sort((a,b)=>a-b).map(d => '<span><i style="background:'+diaColor(d)+'"></i>ø'+d+'</span>').join('')+'</div>' : '')+'<span class="vhint">Tek parmak: çevir · iki parmak: yakınlaş / kaydır</span></div>'+
    '<div class="vbtns" id="vbtns">'+camBtns+'</div>'+
    (tab === 'delim' ? '<h2>Delik ölçüleri</h2>'+holeTable(part) : '')+
    '<details class="drawing card"><summary>Orijinal çizim</summary><a href="img/'+pid(part.name)+'.png" target="_blank" rel="noopener"><img loading="lazy" src="img/'+pid(part.name)+'.png" alt="'+esc(part.name)+' çizimi"></a></details>';
  initViewer(); V.el = document.getElementById('viewer'); V.el.appendChild(V.renderer.domElement); V.part = part; resize();
  const mode = tab === 'delim' ? 'holes' : 'cut';
  let first = 'view';
  if(mode === 'holes'){
    const f = {}; part.holes.forEach(h => f[h[5]] = (f[h[5]]||0)+1);
    const top = Object.keys(f).sort((a,b) => f[b]-f[a])[0];
    first = top === 'Gövde' || top === 'Arka kanat' ? 'back' : (top === 'Alt kanat' ? 'bottom' : 'front');
  }
  const mark = c => document.querySelectorAll('#vbtns button').forEach(b => b.setAttribute('aria-pressed', b.dataset.c === c));
  document.querySelectorAll('#vbtns button').forEach(b => b.onclick = () => { mark(b.dataset.c); setCamera(b.dataset.c); });
  mark(first); show(mode, first);
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if(V.part === part){ show(mode, first); mark(first); } });
}
function notFound(what){
  $app.innerHTML = '<h1>Bulunamadı</h1><p class="lead">"'+esc(what)+'" listede yok. Poz numarasını rakamla yaz (örn. 138).</p><p><a href="#/">Pozlara dön</a></p>';
}
function route(){
  const h = location.hash.replace(/^#\/?/, ''); let m;
  window.scrollTo(0,0);
  if((m = h.match(/^p\/(\d+)(?:\/ek\/(\d+))?(?:\/(delim))?$/))) partView(m[1], m[2], m[3]);
  else homeView();
}
window.addEventListener('hashchange', route);
document.getElementById('searchForm').addEventListener('submit', e2 => {
  e2.preventDefault();
  const q = document.getElementById('q').value.trim().toLowerCase().replace(/\s+/g,'');
  const m = q.match(/^(?:p\/?)?(\d+)$/);
  if(m) location.hash = '#/p/'+m[1]; else notFound(q);
  document.getElementById('q').blur();
});
route();
})();
