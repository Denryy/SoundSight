import * as THREE from '../frontend-react/node_modules/three/build/three.module.js';
const Q = THREE.Quaternion, V = THREE.Vector3;
const eq = (a,b,t=1e-6)=>Math.abs(a-b)<t;
const axisDeg=(ax,deg)=>new Q().setFromAxisAngle(ax.clone().normalize(), deg*Math.PI/180);
function assertQ(name,a,b){
  // сравниваем как повороты (учитываем знак-двойственность кватернионов)
  const d=Math.abs(a.x*b.x+a.y*b.y+a.z*b.z+a.w*b.w);
  if(!eq(d,1,1e-5)){console.log('FAIL',name,'dot',d.toFixed(5),'\n a',a.toArray().map(x=>+x.toFixed(3)),'\n b',b.toArray().map(x=>+x.toFixed(3)));process.exit(1);}
  console.log('ok',name);
}

// ── (a) НЕ-палец: world-delta ретаргет должен дать world = R · restWorld ──
{
  const qBind=axisDeg(new V(0,1,0),30);          // bind драйвера (произвольный)
  const bindInv=qBind.clone().invert();
  const R=axisDeg(new V(0.3,0.5,0.8),47);        // мировой поворот, который сделал драйвер
  const qNow=R.clone().multiply(qBind);          // now = R · bind  → Δ должна выйти = R
  const restWorld=axisDeg(new V(1,0,0),-65);     // rest-ориентация кости модели (своя)
  const parentWorld=axisDeg(new V(0,0,1),20);    // мировой поворот родителя кости

  // повтор последовательности из skinnedHumanoid.applyChannels:
  const _delta=qNow.clone().multiply(bindInv);   // Δ = qNow·bindInv
  const _target=_delta.clone().multiply(restWorld);
  const local=parentWorld.clone().invert().multiply(_target);
  const worldResult=parentWorld.clone().multiply(local); // = target

  assertQ('delta == R', _delta, R);
  assertQ('bone world == R·restWorld', worldResult, R.clone().multiply(restWorld));
}

// ── (b) Палец: выравнивание плоскости сгиба по ладони модели ──
// Драйвер сгибает палец вокруг локальной оси ладони на θ. После переноса палец
// модели в системе СВОЕЙ ладони должен иметь тот же поворот.
{
  const Hd=axisDeg(new V(0,1,0),10);             // мировая ориентация ладони драйвера
  const align=axisDeg(new V(0.2,0.3,0.9),35);    // ладонь модели = align · ладонь драйвера
  const Hm=align.clone().multiply(Hd);

  const curlHandLocal=axisDeg(new V(1,0,0),70);  // «сгиб» в системе ЛАДОНИ (вокруг X ладони)
  // мировая дельта драйвера для такого локального сгиба: Δ = Hd · curl · Hd⁻¹
  const delta=Hd.clone().multiply(curlHandLocal).multiply(Hd.clone().invert());

  // последовательность из кода (finger-ветка):
  const _align=Hm.clone().multiply(Hd.clone().invert());
  const _alignInv=_align.clone().invert();
  const deltaM=_align.clone().multiply(delta).multiply(_alignInv); // align·Δ·alignInv

  // проверка: deltaM в системе ладони МОДЕЛИ == curlHandLocal
  const deltaM_inHand=Hm.clone().invert().multiply(deltaM).multiply(Hm);
  assertQ('align == Hm·Hd⁻¹', _align, align);
  assertQ('сгиб пальца в системе ладони модели сохранён', deltaM_inHand, curlHandLocal);
}

console.log('\nretarget math: OK');
