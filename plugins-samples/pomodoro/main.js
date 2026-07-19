// 示例插件：番茄钟（25 分钟专注 / 5 分钟休息）
const instances = new Map();
let current = null;

const WORK = 25 * 60;
const REST = 5 * 60;

function createPomodoro(container) {
  const root = document.createElement('div');
  root.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:14px';
  root.innerHTML = `
    <div class="pomo-phase" style="font-size:14px;color:#83817a">准备开始</div>
    <div class="pomo-time" style="font-size:64px;font-weight:700;font-variant-numeric:tabular-nums">25:00</div>
    <div style="display:flex;gap:10px">
      <button class="pomo-start" style="padding:8px 26px;border:0;border-radius:8px;background:#4f46e5;color:#fff;font-size:14px;cursor:pointer">开始</button>
      <button class="pomo-reset" style="padding:8px 26px;border:1px solid #d8d6cf;border-radius:8px;background:#fff;font-size:14px;cursor:pointer">重置</button>
    </div>
    <div style="font-size:12px;color:#a3a19a">25 分钟专注 → 5 分钟休息，循环</div>`;
  container.appendChild(root);

  const timeEl = root.querySelector('.pomo-time');
  const phaseEl = root.querySelector('.pomo-phase');
  const startBtn = root.querySelector('.pomo-start');

  const ctl = {
    root, container,
    remain: WORK,
    phase: 'work', // work | rest
    running: false,
    timer: null,
  };

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  function paint() {
    timeEl.textContent = fmt(ctl.remain);
    phaseEl.textContent = ctl.running ? (ctl.phase === 'work' ? '🍅 专注中…' : '☕ 休息中…') : (ctl.remain === WORK && ctl.phase === 'work' ? '准备开始' : '已暂停');
    startBtn.textContent = ctl.running ? '暂停' : '开始';
  }
  function notify(text) {
    if (window.mazz?.isElectron) window.mazz.invoke('notify:show', { title: '番茄钟', body: text }).catch(() => {});
  }
  function tick() {
    if (ctl.remain > 0) {
      ctl.remain--;
      paint();
      return;
    }
    // 阶段切换
    if (ctl.phase === 'work') {
      ctl.phase = 'rest';
      ctl.remain = REST;
      notify('专注结束，休息 5 分钟！');
    } else {
      ctl.phase = 'work';
      ctl.remain = WORK;
      notify('休息结束，开始新一轮专注！');
    }
    paint();
  }
  startBtn.addEventListener('click', () => {
    ctl.running = !ctl.running;
    if (ctl.running && !ctl.timer) ctl.timer = setInterval(tick, 1000);
    if (!ctl.running && ctl.timer) { clearInterval(ctl.timer); ctl.timer = null; }
    paint();
  });
  root.querySelector('.pomo-reset').addEventListener('click', () => {
    ctl.running = false;
    if (ctl.timer) { clearInterval(ctl.timer); ctl.timer = null; }
    ctl.phase = 'work';
    ctl.remain = WORK;
    paint();
  });
  paint();
  return ctl;
}

export default {
  displayName: '番茄钟',
  icon: '🍅',
  create(container) {
    const ctl = createPomodoro(container);
    instances.set(container, ctl);
    return { container };
  },
  activate(container) { current = instances.get(container); },
  deactivate(container) { if (current === instances.get(container)) current = null; },
  getContent() { return ''; },
  setContent() {},
  newDocument() {},
  getCharCount() { return 0; },
  getCursorPos() { return '番茄钟'; },
  contributes: { commands: [], keybindings: [], menus: {}, bridges: [], aiActions: [] },
};
