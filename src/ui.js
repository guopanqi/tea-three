/*
 * 界面上没有进度条、没有倒计时、没有「完成！」。
 * 只有一行字，很轻地来，很轻地走。留白比内容重要。
 */
export class UI {
  constructor() {
    this.el = document.getElementById('line');
    this.label = document.getElementById('label');
    this._timer = null;
    this._current = '';
  }

  say(text, holdSeconds = 0) {
    if (this._current === text) return;
    this._current = text;
    clearTimeout(this._timer);
    this.el.classList.remove('on');
    // 等上一句淡完再换，免得中途换字
    this._timer = setTimeout(() => {
      this.el.textContent = text;
      this.el.classList.add('on');
      if (holdSeconds > 0) {
        this._timer = setTimeout(() => this.hide(), holdSeconds * 1000);
      }
    }, this.el.classList.contains('on') ? 1200 : 60);
  }

  hide() {
    clearTimeout(this._timer);
    this._current = '';
    this.el.classList.remove('on');
  }

  /**
   * 时辰滑块。
   * @param {number} initial 0..1
   * @param {{at:number,name:string}[]} marks
   * @param {(t:number)=>void} onChange
   */
  initClock(initial, marks, onChange) {
    const el = document.getElementById('clock');
    const track = document.getElementById('clock-track');
    const knob = document.getElementById('clock-knob');
    const name = document.getElementById('clock-name');
    const marksEl = document.getElementById('clock-marks');

    for (const m of marks) {
      const i = document.createElement('i');
      i.style.left = (m.at * 100) + '%';
      marksEl.appendChild(i);
    }

    let value = initial;
    let dragging = false;
    let hideTimer = null;

    const paint = (label) => {
      knob.style.left = (value * 100) + '%';
      name.style.left = (value * 100) + '%';
      if (label) name.textContent = label;
    };

    const fromEvent = (e) => {
      const r = track.getBoundingClientRect();
      return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    };

    const commit = (e) => {
      value = fromEvent(e);
      paint(onChange(value));
    };

    el.addEventListener('pointerdown', (e) => {
      dragging = true;
      el.classList.add('live');
      clearTimeout(hideTimer);
      try { el.setPointerCapture(e.pointerId); } catch { /* 有些指针不支持捕获 */ }
      commit(e);
      e.stopPropagation();
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      commit(e);
      e.stopPropagation();
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      try { el.releasePointerCapture(e.pointerId); } catch { /* 指针可能已经没了 */ }
      // 松手之后再亮一会儿，然后自己退回去
      hideTimer = setTimeout(() => el.classList.remove('live'), 1600);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    paint(onChange(value));
  }

  showLabel(text, x, y) {
    this.label.textContent = text;
    this.label.style.left = x + 'px';
    this.label.style.top = y + 'px';
    this.label.classList.add('on');
  }

  hideLabel() {
    this.label.classList.remove('on');
  }
}
