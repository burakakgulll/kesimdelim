(function(){
'use strict';
const DATA = window.DATA;
const PARTS = {}; DATA.parts.forEach(p => PARTS[p.name] = p);
const PROF_ORDER = ['HEA140','UNP120','SHS100*3','SHS50*2.5','L40*4'];
const $app = document.getElementById('app');
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtDeg = a => (Math.round(a*10)/10).toString().replace('.', ',') + '°';
const fmtMm = v => (Math.round(v*10)/10).toString().replace('.', ',');
const pid = n => n.replace('p/','');
const DIA_COL = { 14:'#1E9E52', 18:'#E8590C', 16:'#1C7ED6', 22:'#AE3EC9', 12:'#F08C00', 20:'#C2255C' };
const diaColor = d => DIA_COL[Math.round(d)] || '#495057';
/* hole tuple: [x, Y, Z, axis, dia, face, across, acrossTxt, valueFromZero] */
const faceName = (part, f) => f;

/* ---------- part helpers ---------- */
function baseView(part){ return Object.assign({ r0: 0, r1: part.L }, part); }
function segmentPart(parent, i){
  const segs = parent.ek, n = segs.length, len = segs[i-1].len;
  let start = 0; for(let k=0;k<i-1;k++) start += segs[k].len;
  const sq = { kind:'duz', angle:0, joint:true };
  const holes = (parent.holes||[]).filter(h => h[0] >= start && h[0] < start + len)
    .map(h => [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], h[0] - start]);
  return Object.assign({}, parent, { r0: start, r1: start + len, L: len, holes, qty: 1, zero: 'L',
    seg: { i, n, start, parentL: parent.L },
    ends: [ i === 1 ? parent.ends[0] : sq, i === n ? parent.ends[1] : sq ],
    sb: [ i === 1 ? parent.sb[0] : 0, i === n ? parent.sb[1] : 0 ] });
}
function shortEnd(e){
  if(e.joint) return 'düz (ek)';
  if(e.kind === 'aci') return fmtDeg(e.angle);
  if(e.kind === 'ukesim') return 'düz + çentik';
  return 'düz';
}
function zeroEndTxt(part){
  const k = part.zero === 'R' ? 1 : 0, e = part.ends[k];
  return (k ? 'sağ uç' : 'sol uç') + ' (' + (e.joint ? 'ek ucu' : (e.kind === 'aci' ? fmtDeg(e.angle)+' açılı' : 'düz')) + ')';
}
function sameEnds(part){ const a = part.ends[0], b = part.ends[1]; return !a.joint && !b.joint && a.kind === b.kind && (a.angle||0) === (b.angle||0); }

/* ---------- cut parts (shortened picture, real dimensions) ---------- */
let CP = { iv:[[0,1]], shifts:[0], gapVis:0, r0:0 };
function computeCut(part, withHoles){
  const size = Math.max(part.W, part.H), r0 = part.r0, r1 = part.r1;
  let zones = [[r0, r0 + part.sb[0] + size*1.4], [r1 - part.sb[1] - size*1.4, r1]];
  if(withHoles) (part.holes||[]).forEach(h => zones.push([h[0] - size*0.6, h[0] + size*0.6]));
  zones = zones.map(z => [Math.max(r0, z[0]), Math.min(r1, z[1])]).sort((a,b) => a[0]-b[0]);
  const minGap = size*2.6, iv = [];
  zones.forEach(z => { const l = iv[iv.length-1]; if(l && z[0] - l[1] < minGap) l[1] = Math.max(l[1], z[1]); else iv.push(z.slice()); });
  const gapVis = size*0.9, shifts = [r0];
  for(let k=1;k<iv.length;k++) shifts.push(shifts[k-1] + (iv[k][0] - iv[k-1][1]) - gapVis);
  CP = { iv, shifts, gapVis, r0 };
}
function mapX(x){ const iv = CP.iv; for(let k = iv.length-1; k >= 0; k--){ if(x >= iv[k][0] - 1e-6) return x - CP.shifts[k]; } return x - CP.shifts[0]; }
function mappedLen(){ const iv = CP.iv; return mapX(iv[iv.length-1][1]); }

/* ---------- 3D (orthographic) ---------- */
const V = { renderer:null, scene:null, camera:null, controls:null, root:null, part:null, el:null, mats:[] };
let OFF = 0;
const P3 = (x,Y,Z) => new THREE.Vector3(mapX(x) - OFF, Z, -Y);
function initViewer(){
  if(V.renderer) return;
  const r = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  r.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
  r.localClippingEnabled = true;
  V.renderer = r; V.scene = new THREE.Scene();
  V.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 100000);
  V.scene.add(new THREE.HemisphereLight(0xffffff, 0x7d8894, 0.85));
  const d1 = new THREE.DirectionalLight(0xffffff, 0.7); d1.position.set(0.4, 1, 0.7); V.scene.add(d1);
  const d2 = new THREE.DirectionalLight(0xffffff, 0.35); d2.position.set(-0.6, -0.4, -0.8); V.scene.add(d2);
  V.controls = new THREE.OrbitControls(V.camera, r.domElement);
  V.controls.addEventListener('change', render);
  window.addEventListener('resize', () => { resize(); V.fit && V.fit(); });
}
function spriteSizing(){
  const c = V.camera, ws = (c.top - c.bottom)/c.zoom;
  V.root.traverse(o => {
    if(!o.isSprite) return;
    o.scale.set(o.userData.asp*o.userData.h*ws, o.userData.h*ws, 1);
  });
}
function declutter(){
  const Wp = V.el.clientWidth, Hp = V.el.clientHeight, placed = [], sprites = [];
  V.root.traverse(o => { if(o.isSprite) sprites.push(o); });
  sprites.sort((a,b) => (b.userData.prio||0) - (a.userData.prio||0));
  const v = new THREE.Vector3();
  sprites.forEach(sp => {
    v.setFromMatrixPosition(sp.matrixWorld).project(V.camera);
    const h = sp.userData.h*Hp, w = sp.userData.asp*h, cxs = sp.center.x;
    const cx = (v.x+1)/2*Wp - (cxs-0.5)*w, cy = (1-v.y)/2*Hp + (sp.center.y-0.5)*h;
    const r = [cx-w/2-2, cy-h/2-2, cx+w/2+2, cy+h/2+2];
    const hit = placed.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
    sp.visible = !hit; if(!hit) placed.push(r);
  });
}
function render(){
  if(!(V.renderer && V.el && V.el.isConnected)) return;
  if(V.root){ spriteSizing(); V.root.updateMatrixWorld(true); declutter(); }
  V.renderer.render(V.scene, V.camera);
}
function resize(){
  if(!V.el || !V.el.isConnected) return;
  V.renderer.setSize(V.el.clientWidth, V.el.clientHeight, false); render();
}
function makeLabel(text, bg, fg, h){
  const c = document.createElement('canvas'), ctx = c.getContext('2d'), fs = 64;
  const font = '700 '+fs+'px "Barlow Condensed","Arial Narrow",Arial,sans-serif';
  ctx.font = font; c.width = Math.ceil(ctx.measureText(text).width) + 32; c.height = fs + 24;
  ctx.font = font; ctx.fillStyle = bg; ctx.beginPath();
  if(ctx.roundRect) ctx.roundRect(0,0,c.width,c.height,14); else ctx.rect(0,0,c.width,c.height);
  ctx.fill(); ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.fillText(text, 16, c.height/2+3);
  const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest:false, side:THREE.DoubleSide }));
  sp.renderOrder = 10; sp.userData.h = h; sp.userData.asp = c.width/c.height; return sp;
}
const GEO = {};
function partGeo(part){
  if(GEO[part.name]) return GEO[part.name];
  const v = part.mesh.v, pos = new Float32Array(v.length);
  for(let i=0;i<v.length;i+=3){ pos[i] = v[i]; pos[i+1] = v[i+2]; pos[i+2] = -v[i+1]; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(part.mesh.f); g.computeVertexNormals();
  return (GEO[part.name] = { g, e: new THREE.EdgesGeometry(g, 25) });
}
function capGeo(part){
  if(GEO[part.name+'#cap']) return GEO[part.name+'#cap'];
  const loops = part.sec.map(l => l.map(q => new THREE.Vector2(-q[0], q[1])));   // (Z-up, -Y) seen along +x
  const area = l => { let a = 0; for(let i=0;i<l.length;i++){ const p = l[i], q = l[(i+1)%l.length]; a += p.x*q.y - q.x*p.y; } return Math.abs(a/2); };
  loops.sort((a,b) => area(b) - area(a));
  const shape = new THREE.Shape(loops[0]); loops.slice(1).forEach(h => shape.holes.push(new THREE.Path(h)));
  const g = new THREE.ShapeGeometry(shape);
  // shape coords (u = -Y, v = Z) -> three (x=0, y=Z, z=-Y)
  const p = g.attributes.position;
  for(let i=0;i<p.count;i++){ const u = p.getX(i), w = p.getY(i); p.setXYZ(i, 0, w, u); }
  g.computeVertexNormals();
  return (GEO[part.name+'#cap'] = g);
}
const M = {};
function mats(){
  if(M.edge) return;
  M.edge = new THREE.LineBasicMaterial({ color:0x1A2026 });
  M.dim = new THREE.LineBasicMaterial({ color:0x2B3A47 });
  M.brk = new THREE.LineBasicMaterial({ color:0x56626C });
  M.hole = new THREE.MeshBasicMaterial({ color:0x111518, side:THREE.DoubleSide });
  M.zero = new THREE.LineBasicMaterial({ color:0xD3212D });
  M.ring = {};
}
function ringMat(d){ return M.ring[d] || (M.ring[d] = new THREE.MeshBasicMaterial({ color:new THREE.Color(diaColor(d)), side:THREE.DoubleSide })); }
function clearRoot(){
  if(!V.root) return;
  V.root.traverse(o => { if(o.isSprite){ o.material.map.dispose(); o.material.dispose(); } else if(o.isLine && !o.isLineSegments) o.geometry.dispose(); });
  V.mats.forEach(m => m.dispose()); V.mats = [];
  V.scene.remove(V.root); V.root = null;
}
function line(g, pts, mat){ g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat || M.dim)); }
function addPart(g, part, faint){
  const { g: geo, e: edges } = partGeo(part), cap = capGeo(part);
  const W = part.W, H = part.H, iv = CP.iv, n = iv.length;
  const base = new THREE.MeshStandardMaterial({ color: faint ? 0xB5C5D2 : 0x7591A8, metalness:0.3, roughness:0.5, side:THREE.DoubleSide, flatShading:true,
    polygonOffset:true, polygonOffsetFactor:1, polygonOffsetUnits:1, transparent: !!faint, opacity: faint ? 0.72 : 1, depthWrite: !faint });
  iv.forEach((z, k) => {
    const shift = CP.shifts[k] + OFF;
    const a = z[0] - CP.shifts[k] - OFF, b = z[1] - CP.shifts[k] - OFF;
    const trueL = k === 0 && part.r0 === 0, trueR = k === n-1 && part.r1 === part.mesh_L;
    const planes = [new THREE.Plane(new THREE.Vector3(1,0,0), -(a - (trueL ? 5 : 0))), new THREE.Plane(new THREE.Vector3(-1,0,0), b + (trueR ? 5 : 0))];
    const mm = base.clone(); mm.clippingPlanes = planes; V.mats.push(mm);
    const me = M.edge.clone(); me.clippingPlanes = planes; V.mats.push(me);
    const mesh = new THREE.Mesh(geo, mm); mesh.position.x = -shift; g.add(mesh);
    const ed = new THREE.LineSegments(edges, me); ed.position.x = -shift; g.add(ed);
    // caps where the picture is cut (shortened gaps, ek joints)
    [[a, !trueL], [b, !trueR]].forEach(([x, need]) => { if(!need) return; const c = new THREE.Mesh(cap, base); c.position.x = x; g.add(c); });
  });
  for(let k=1;k<n;k++){
    const gx = mapX(iv[k-1][1]) + CP.gapVis/2 - OFF;
    [-W-8, 8].forEach(Y => {
      const pts = []; for(let s=0;s<=6;s++) pts.push(new THREE.Vector3(gx + (s%2 ? 9 : -9), -8 + (H+16)*s/6, -Y));
      line(g, pts, M.brk);
    });
  }
  V.mats.push(base);
}
function endLabels(g, part){
  const W = part.W, H = part.H;
  [0,1].forEach(side => {
    const e = part.ends[side], isA = e.kind === 'aci';
    const lab = makeLabel(isA ? fmtDeg(e.angle) : (e.kind === 'ukesim' ? '0° + çentik' : '0°'), isA ? '#F5B800' : '#FFFFFF', '#1A2026', 0.065);
    lab.userData.prio = 10; lab.center.set(0.5, 0);
    const xe = side === 0 ? part.r0 : part.r1;
    lab.position.copy(P3(xe, -W/2, H + 30)); g.add(lab);
    if(isA && e.setback > 1){
      const sl = makeLabel('fark '+Math.round(e.setback)+' mm', '#FFFFFF', '#56626C', 0.045);
      sl.userData.prio = 6; sl.center.set(0.5, 1); sl.position.copy(P3(xe, -W/2, -20)); g.add(sl);
    }
  });
}
function sceneCut(part){
  const g = new THREE.Group(), H = part.H;
  addPart(g, part, false);
  const yD = H + 14, x0 = part.r0, x1 = part.r1;
  line(g, [P3(x0,0,yD), P3(x1,0,yD)]);
  line(g, [P3(x0,0,H), P3(x0,0,yD+8)]); line(g, [P3(x1,0,H), P3(x1,0,yD+8)]);
  const ll = makeLabel(part.L+' mm', '#2B3A47', '#FFFFFF', 0.065); ll.userData.prio = 12; ll.center.set(0.5, 0);
  ll.position.copy(P3(x0,0,yD+6)).add(P3(x1,0,yD+6)).multiplyScalar(0.5); g.add(ll);
  endLabels(g, part);
  return g;
}
function sceneHoles(part){
  const g = new THREE.Group(), W = part.W, H = part.H;
  g.userData.zero = true;
  addPart(g, part, true);
  endLabels(g, part);
  (part.holes||[]).forEach(h => {
    const [x, Y, Z, n, d] = h;
    const th = part.pose === 'HEA' ? 8.5 : (n === 'Y' ? 7 : 9);
    const pos = P3(x, Y, Z);
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(d/2, d/2, th + 1.5, 24), M.hole);
    cyl.position.copy(pos); if(n === 'Y') cyl.rotation.x = Math.PI/2; g.add(cyl);
    [-1,1].forEach(s => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(d/2 + 3.5, 2.8, 8, 28), ringMat(Math.round(d)));
      ring.position.copy(pos);
      if(n === 'Y') ring.position.z += s*(th/2 + 1.6); else { ring.rotation.x = Math.PI/2; ring.position.y += s*(th/2 + 1.6); }
      g.add(ring);
    });
  });
  // zero mark: red post + small flag (labels with dimensions are in the 2D drawings below)
  const xz = part.zero === 'R' ? part.r1 : part.r0;
  const out = part.zero === 'R' ? 1 : -1;
  line(g, [P3(xz, -W/2, H/2), P3(xz, -W/2, H/2).add(new THREE.Vector3(out*Math.max(W,H)*0.9, 0, 0))], M.zero);
  const zl = makeLabel('0', '#D3212D', '#FFFFFF', 0.055); zl.userData.prio = 11; zl.center.set(part.zero === 'R' ? 0 : 1, 0.5);
  zl.position.copy(P3(xz, -W/2, H/2)).add(new THREE.Vector3(out*Math.max(W,H)*0.9, 0, 0)); g.add(zl);
  return g;
}
const DIRS = { iso: [-1, 1, 1], left: [-1, 1, 1], right: [1, 1, 1], front: [0, 0, 1], back: [0, 0, 1], top: [0, 0, 1], bottom: [0, 0, 1] };
/* Önden/Üstten/Arkadan/Alttan: kamera hep önde, parça kendi boyuna ekseni etrafında döndürülür.
   Böylece sol uç hep solda, 0 hep çizimdeki tarafta kalır (aynalama yok). */
const ROTX = { top: Math.PI/2, back: Math.PI, bottom: -Math.PI/2 };
function setCamera(kind){
  const p = V.part, W = p.W, H = p.H, size = Math.max(W, H), c = V.camera;
  let lo = mapX(p.r0) - OFF, hi = mapX(p.r1) - OFF;
  if(kind === 'left') hi = Math.min(hi, lo + size*4);
  if(kind === 'right') lo = Math.max(lo, hi - size*4);
  const m = size*0.35 + 30, corners = [];
  const zx = (V.root && V.root.userData.zero) ? size*1.3 + 40 : 0;   // kırmızı 0 işareti için yer
  const zl = V.part.zero === 'R' ? 0 : zx, zr = V.part.zero === 'R' ? zx : 0;
  [lo-m-zl, hi+m+zr].forEach(x => [-m, H+m+60].forEach(y => [-m, W+m].forEach(z => corners.push(new THREE.Vector3(x,y,z)))));
  const rot = new THREE.Matrix4().makeRotationX(ROTX[kind] || 0);
  if(V.root){ V.root.rotation.x = ROTX[kind] || 0; V.root.updateMatrixWorld(true); }
  corners.forEach(q => q.applyMatrix4(rot));
  const dir = new THREE.Vector3(...DIRS[kind] || DIRS.iso).normalize();
  const t = new THREE.Vector3((lo+hi)/2, H/2, W/2).applyMatrix4(rot);
  const D = (hi - lo) + 4000;
  c.position.copy(t).addScaledVector(dir, D); c.up.set(0,1,0); c.lookAt(t); c.updateMatrixWorld();
  const inv = c.matrixWorldInverse; let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  corners.forEach(q => { const v = q.clone().applyMatrix4(inv); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); });
  const asp = V.el.clientWidth / V.el.clientHeight, cx = (x0+x1)/2, cy = (y0+y1)/2;
  let w = (x1-x0)*1.16, h = (y1-y0)*1.25;
  if(w/h > asp) h = w/asp; else w = h*asp;
  // shift the target so the box centre is in the middle of the screen
  const rt = new THREE.Vector3().setFromMatrixColumn(c.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(c.matrixWorld, 1);
  t.addScaledVector(rt, cx).addScaledVector(up, cy); c.position.addScaledVector(rt, cx).addScaledVector(up, cy);
  c.left = -w/2; c.right = w/2; c.top = h/2; c.bottom = -h/2; c.zoom = 1;
  c.near = 1; c.far = D*2 + 20000; c.updateProjectionMatrix();
  V.controls.target.copy(t); V.controls.update(); render();
}
function show(mode, cam){
  clearRoot(); mats();
  const part = V.part;
  computeCut(part, mode === 'holes');
  OFF = (mapX(part.r0) + mapX(part.r1))/2;
  V.root = mode === 'holes' ? sceneHoles(part) : sceneCut(part);
  V.scene.add(V.root);
  V.fit = () => setCamera(V.cam || cam);
  V.cam = cam; setCamera(cam);
}

/* ---------- 2D face drawings for drilling (no overlapping labels) ---------- */
function faceViews(part){
  const groups = {};
  (part.holes||[]).forEach(h => { const k = h[5]; (groups[k] = groups[k] || []).push(h); });
  return Object.keys(groups).map(face => ({ face, holes: groups[face], ax: groups[face][0][3] }));
}
function clipTri(tri, a, b){
  let poly = tri;
  [[a, 1], [b, -1]].forEach(([c, s]) => {
    const out = [];
    for(let i=0;i<poly.length;i++){
      const P = poly[i], Q = poly[(i+1)%poly.length];
      const inP = s*(P[0]-c) >= 0, inQ = s*(Q[0]-c) >= 0;
      if(inP) out.push(P);
      if(inP !== inQ){ const t = (c - P[0])/(Q[0]-P[0]); out.push([c, P[1] + t*(Q[1]-P[1])]); }
    }
    poly = out;
  });
  return poly;
}
function faceSVG(part, fv, avail){
  computeCut(part, true);
  const v = part.mesh.v, f = part.mesh.f;
  // 2D coordinates: horizontal = x (part left at left), vertical = Z (axis Y faces) or Y (axis Z faces, back at top)
  const vert = fv.ax === 'Y' ? (i => v[i*3+2]) : (i => v[i*3+1]);
  const vmin = fv.ax === 'Y' ? 0 : -part.W, vmax = fv.ax === 'Y' ? part.H : 0;
  // aynı mantık: alt yüz -> parça aşağıdan öne döndürülmüş (ön kenar yukarıda); arka yüz -> 180° döndürülmüş (ters)
  const flipV = (fv.ax === 'Z' && fv.holes[0][2] < part.H/2) || (fv.ax === 'Y' && fv.holes[0][1] > -part.W/2);
  const Lm = mappedLen() - mapX(part.r0);
  const s = Math.max(0.3, Math.min(2.5, (avail - 70) / Lm));
  const padL = 46, padT = 30, hV = (vmax - vmin)*s;
  const X = x => padL + (mapX(x) - mapX(part.r0))*s;
  const Yv = val => flipV ? padT + (val - vmin)*s : padT + (vmax - val)*s;
  const Wsvg = Math.ceil(padL + Lm*s + 30);
  // silhouette
  let tris = '';
  for(let k=0;k<f.length;k+=3){
    const T = [f[k], f[k+1], f[k+2]].map(i => [v[i*3], vert(i)]);
    if(Math.abs((T[1][0]-T[0][0])*(T[2][1]-T[0][1]) - (T[2][0]-T[0][0])*(T[1][1]-T[0][1])) < 1e-6) continue;
    CP.iv.forEach(z => {
      const P = clipTri(T, Math.max(z[0], part.r0), Math.min(z[1], part.r1));
      if(P.length >= 3) tris += '<polygon points="'+P.map(q => X(q[0]).toFixed(1)+','+Yv(q[1]).toFixed(1)).join(' ')+'"/>';
    });
  }
  let brk = '';
  for(let k=1;k<CP.iv.length;k++){
    const gx = padL + (mapX(CP.iv[k-1][1]) - mapX(part.r0) + CP.gapVis/2)*s;
    let d = 'M'+(gx-4)+','+(padT-6); for(let j=1;j<=6;j++) d += ' L'+(gx + (j%2 ? 4 : -4))+','+(padT - 6 + (hV+12)*j/6);
    brk += '<path d="'+d+'" fill="none" stroke="#56626C" stroke-width="1.5"/>';
  }
  // holes
  const holes = fv.holes.map(h => {
    const r = Math.max(3.5, h[4]/2*s);
    return '<circle cx="'+X(h[0]).toFixed(1)+'" cy="'+Yv(fv.ax === 'Y' ? h[2] : h[1]).toFixed(1)+'" r="'+r.toFixed(1)+'" fill="'+diaColor(h[4])+'" stroke="#fff" stroke-width="1.2"/>';
  }).join('');
  // running dimensions from the zero side (values like the drawing)
  const zeroX = part.zero === 'R' ? part.r1 : part.r0;
  const cols = {}; fv.holes.forEach(h => { const k = Math.round(h[8]); cols[k] = cols[k] || h[0]; });
  const ticks = Object.keys(cols).map(k => ({ val: +k, x: X(cols[k]) })).sort((a,b) => a.x - b.x);
  const base = padT + hV + 16;
  let dims = '<line x1="'+Math.min(X(zeroX), ticks[0].x)+'" y1="'+base+'" x2="'+Math.max(X(zeroX), ticks[ticks.length-1].x)+'" y2="'+base+'" stroke="#2B3A47"/>';
  dims += '<line x1="'+X(zeroX)+'" y1="'+(padT+hV+4)+'" x2="'+X(zeroX)+'" y2="'+(base+6)+'" stroke="#D3212D" stroke-width="2"/>';
  dims += '<text x="'+X(zeroX)+'" y="'+(base+20)+'" text-anchor="middle" class="t0">0</text>';
  let lastX = -1e9, row = 0, maxRow = 0;
  ticks.forEach(t => {
    row = (t.x - lastX < 15) ? (row + 1) % 2 : 0; if(row === 0) lastX = t.x; maxRow = Math.max(maxRow, row);
    const ty = base + 8 + row*44;
    dims += '<line x1="'+t.x+'" y1="'+(padT+hV+3)+'" x2="'+t.x+'" y2="'+(ty-2)+'" stroke="#8A96A0" stroke-width="0.8"/>';
    dims += '<text transform="translate('+(t.x+4.5)+','+ty+') rotate(90)" class="tv">'+t.val+'</text>';
  });
  // across dimensions on the left
  const acr = {}; fv.holes.forEach(h => { acr[Math.round(h[6]*10)/10] = h; });
  const refV = fv.ax === 'Y' ? 0 : 0;   // bottom edge (Z=0) or back edge (Y=0)
  let ad = '', k2 = 0;
  Object.keys(acr).sort((a,b) => a-b).forEach(a => {
    const h = acr[a], hv = fv.ax === 'Y' ? h[2] : h[1];
    const ax_ = 12 + k2*16; k2++;
    ad += '<line x1="'+ax_+'" y1="'+Yv(refV)+'" x2="'+ax_+'" y2="'+Yv(hv)+'" stroke="#2B3A47"/>';
    ad += '<line x1="'+(ax_-4)+'" y1="'+Yv(hv)+'" x2="'+(padL-2)+'" y2="'+Yv(hv)+'" stroke="#8A96A0" stroke-width="0.8" stroke-dasharray="3 2"/>';
    ad += '<text transform="translate('+(ax_-3)+','+((Yv(refV)+Yv(hv))/2)+') rotate(-90)" text-anchor="middle" class="ta">'+fmtMm(+a)+'</text>';
  });
  const Hsvg = Math.ceil(base + 8 + (maxRow+1)*44 + 6);
  const view = fv.ax === 'Y' ? (fv.holes[0][1] > -part.W/2 ? 'arkadan bakış (180° çevrilmiş, ters)' : 'önden bakış')
    : (fv.holes[0][2] < part.H/2 ? 'alttan bakış (ön kenar yukarıda)' : 'üstten bakış (arka kenar yukarıda)');
  const title = faceName(part, fv.face)+' · '+view;
  return '<div class="face"><div class="fhead"><b>'+esc(title)+'</b><span>'+fv.holes.length+' delik · enine: '+esc(fv.holes[0][7])+'</span></div>'+
    (Wsvg > avail + 4 ? '<div class="fhint">← sağa sola kaydır →</div>' : '')+'<div class="fscroll"><svg width="'+Wsvg+'" height="'+Hsvg+'" viewBox="0 0 '+Wsvg+' '+Hsvg+'" role="img" aria-label="'+esc(title)+'">'+
    '<g fill="#C9D3DA" stroke="#C9D3DA" stroke-width="0.6">'+tris+'</g>'+brk+holes+dims+ad+'</svg></div></div>';
}
function holeTable(part){
  const groups = {};
  (part.holes||[]).forEach(h => { const k = h[5]+'|'+Math.round(h[4])+'|'+h[6]; (groups[k] = groups[k] || { face:h[5], d:Math.round(h[4]), acr:h[6], txt:h[7], vals:[] }).vals.push(Math.round(h[8])); });
  const byFace = {};
  Object.values(groups).forEach(g => (byFace[g.face] = byFace[g.face] || []).push(g));
  return Object.keys(byFace).map(face => '<div class="card"><h3>'+esc(faceName(part, face))+'</h3>'+
    byFace[face].map(g => '<div class="hrow"><div class="hdia" style="background:'+diaColor(g.d)+'">ø'+g.d+'</div><div><div class="hmeta"><b>'+g.vals.length+' delik</b> · '+g.txt+' <b>'+fmtMm(g.acr)+' mm</b></div>'+
      '<div class="hxs">'+[...new Set(g.vals)].sort((a,b)=>a-b).map(x => '<span>'+x+'</span>').join('')+'</div></div></div>').join('')+'</div>').join('');
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
  $app.innerHTML = '<div class="intro"><h1>Tribün parçaları</h1><p class="lead muted">AMFI İmalat 3 · '+DATA.parts.length+' poz. Poza dokun: kesim açıları ve delikler.</p></div>' + html;
}
function partView(name, segNo, tab){
  let part = PARTS['p/'+name];
  if(!part){ notFound('p/'+name); return; }
  part = baseView(part); part.mesh_L = PARTS['p/'+name].L;
  if(segNo){ if(!part.ek || !part.ek[segNo-1]){ notFound('p/'+name); return; } part = segmentPart(part, +segNo); part.mesh_L = PARTS['p/'+name].L; }
  setTitle(part.name);
  const base = '#/p/'+name+(segNo ? '/ek/'+segNo : '');
  const hasHoles = (part.holes||[]).length > 0;
  if(tab === 'delim' && !hasHoles) tab = 'kesim';
  tab = tab || 'kesim';
  const tabs = '<nav class="tabs"><a href="'+base+'" aria-current="'+(tab==='kesim'?'page':'false')+'">Kesim</a>'+
    (hasHoles ? '<a href="'+base+'/delim" aria-current="'+(tab==='delim'?'page':'false')+'">Delim <small>'+part.holes.length+'</small></a>' : '<span class="off">Delik yok</span>')+'</nav>';
  let ek = '';
  if(!part.seg && part.ek) ek = '<p class="note">6 m\'den uzun; <b>'+part.ek.length+' parçadan eklenir</b>: '+part.ek.map((s,i)=>'<a href="#/p/'+name+'/ek/'+(i+1)+(tab==='delim'?'/delim':'')+'">'+(i+1)+'. parça '+s.len+' mm</a>').join(', ')+'.</p>';
  if(part.seg) ek = '<p class="note"><b>'+part.name+'</b> ek parçası '+part.seg.i+'/'+part.seg.n+' (toplam '+part.seg.parentL+' mm). Ek ucu düz.'+(part.seg.start ? ' Bu parçanın 0 noktası ana parçada '+part.seg.start+' mm\'ye denk gelir.' : '')+'</p>';
  const facts = '<div class="facts"><div class="fact"><span>Profil</span><b>'+esc(part.prof)+'</b></div><div class="fact"><span>Boy</span><b>'+part.L+' mm</b></div>'+
    (part.seg ? '' : '<div class="fact"><span>Adet</span><b>'+part.qty+'</b></div>')+
    '<div class="fact"><span>Sol uç</span><b>'+shortEnd(part.ends[0])+'</b></div><div class="fact"><span>Sağ uç</span><b>'+shortEnd(part.ends[1])+'</b></div></div>';
  const camBtns = '<button data-c="iso">İzometrik</button><button data-c="front">Önden</button><button data-c="back">Arkadan</button><button data-c="top">Üstten</button><button data-c="bottom">Alttan</button><button data-c="left">Sol uç</button><button data-c="right">Sağ uç</button>';
  const zeroNote = tab === 'delim' ? '<p class="zero">0 tarafı: <b>'+zeroEndTxt(part)+'</b>'+(sameEnds(part) ? ' (iki uç aynı; 3B\'de kırmızı "0" işaretli uç)' : '')+'. Boyuna ölçüler bu uçtaki en dış köşeden, çizimdeki gibi.</p>' : '';
  const legend = tab === 'delim' ? '<div class="legend">'+[...new Set(part.holes.map(h => Math.round(h[4])))].sort((a,b)=>a-b).map(d => '<span><i style="background:'+diaColor(d)+'"></i>ø'+d+'</span>').join('')+'</div>' : '';
  $app.innerHTML =
    '<div class="ptitle"><h1>'+esc(part.name)+(part.seg ? ' <span class="muted" style="font-size:30px">ek '+part.seg.i+'/'+part.seg.n+'</span>' : '')+'</h1></div>'+
    tabs + facts + ek + zeroNote +
    '<div class="viewer" id="viewer">'+legend+'<span class="vhint">Tek parmak: çevir · iki parmak: yakınlaş / kaydır</span></div>'+
    '<div class="vbtns" id="vbtns">'+camBtns+'</div>'+
    (tab === 'delim' ? '<h2>Delik ölçüleri</h2><div id="faces"></div>'+holeTable(part) : '')+
    '<details class="drawing card"><summary>Orijinal çizim</summary><img loading="lazy" src="'+((window.KESIM_IMG && window.KESIM_IMG[pid(part.name)]) || ('img/'+pid(part.name)+'.png'))+'" alt="'+esc(part.name)+' çizimi"></details>';
  initViewer(); V.el = document.getElementById('viewer'); V.el.appendChild(V.renderer.domElement); V.part = part; resize();
  const mode = tab === 'delim' ? 'holes' : 'cut';
  const mark = c => document.querySelectorAll('#vbtns button').forEach(b => b.setAttribute('aria-pressed', b.dataset.c === c));
  document.querySelectorAll('#vbtns button').forEach(b => b.onclick = () => { mark(b.dataset.c); V.cam = b.dataset.c; setCamera(b.dataset.c); });
  mark('iso'); show(mode, 'iso');
  if(tab === 'delim'){
    const box = document.getElementById('faces');
    box.innerHTML = faceViews(part).map(fv => faceSVG(part, fv, box.clientWidth)).join('');
    computeCut(part, true);
  }
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if(V.part === part){ show(mode, V.cam || 'iso'); } });
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
