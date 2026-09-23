// WP13/T1 取景导览（固定机位，非行走）：按钮组 + 机位切换。
// 从 web/main.js 拆出，逻辑集中在本文件方便合并；main.js 保留 setupTour 挂钩与 __tour 钩子。
export function setupTour({ camera, controls, setZone, updateLabelVis, setHud }) {
  let tourData = null, curTour = null;

  function buildTour() {
    fetch('/out/tour.json').then(r => { if (!r.ok) throw 0; return r.json(); }).then(t => {
      tourData = t;
      const holder = document.getElementById('tourbtns');
      for (const [key, v] of Object.entries(t)) {
        const b = document.createElement('button');
        b.dataset.tour = key;
        b.textContent = v.label || key;
        b.title = '固定取景机位（非行走）· ' + (v.source || '');
        holder.appendChild(b);
      }
      holder.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-tour]');
        if (b) setTour(b.dataset.tour);
      });
      const want = new URLSearchParams(location.search).get('tour');
      if (want && t[want]) setTour(want);
    }).catch(() => { document.getElementById('tourcap').textContent = '取景导览（本目录无 tour.json）'; });
  }

  function setTour(key) {
    const v = tourData && tourData[key];
    if (!v) return;
    setZone(v.zone || 'core', false);
    curTour = key;
    camera.position.set(v.p[0], v.p[1], v.p[2]);
    controls.target.set(v.t[0], v.t[1], v.t[2]);
    controls.update();
    document.querySelectorAll('[data-tour]').forEach(b => b.classList.toggle('active', b.dataset.tour === key));
    document.querySelectorAll('[data-cam]').forEach(b => b.classList.toggle('active', false));
    setHud(`<b>取景导览 · ${v.label}</b>（固定机位，非行走）<br><span style="font-size:11px">${v.source || ''}</span>`);
    updateLabelVis();
  }

  return { buildTour, setTour, clear: () => { curTour = null; }, get tourData() { return tourData; }, get curTour() { return curTour; } };
}
