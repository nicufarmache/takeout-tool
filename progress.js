import Logger from 'log-with-statusbar';

export default class Progress {
  total = 0;
  processed = 0;
  barLength = 30;
  barComplete = '█';
  barIncomplete = '░';
  barStart = '[';
  barEnd = ']';
  lastTime = 0;
  updateInterval = 100;
  maxLogLevel = 3;

  constructor(){
    this.logger = Logger();
    this.logger.setStatusBarText([
      `Starting...`
    ]);
    this.clock();
  }

  debug(text, level = 3){
    if (level > this.maxLogLevel) return;
    this.logger.debug(...text)
  }

  info(text, level = 2){
    if (level > this.maxLogLevel) return;
    this.logger.info(...text)
  }

  error(text, level = 1){
    if (level > this.maxLogLevel) return;
    this.logger.error(...text)
  }

  throttlePrint(){
    const now = performance.now();
    if (now - this.lastTime > this.updateInterval) {
      this.print();
      this.lastTime = now;
    }
  }

  hide() {
    this.logger.setStatusBarText([]);
  }

  print() {
    const percent = (this.total === 0) ? 0 : Math.round(this.processed*100/this.total);
    this.logger.setStatusBarText([
      `  Progress: ${this.makeBar(percent)} ${percent}% | ${this.processed}/${this.total} files processed`,
    ]);
  }
  add(count = 1){
    this.total += count;
    this.throttlePrint();
  }
  resolve(count = 1){
    this.processed += count;
    this.throttlePrint();
  }
  makeBar(percent){
    const chars = Math.round(this.barLength * percent / 100);
    const bar = `${this.barStart}${''.padStart(chars, this.barComplete).padEnd(this.barLength, this.barIncomplete)}${this.barEnd}`;
    return bar;
  }
  clock(){
    this.print();
    setTimeout(this.clock.bind(this), this.updateInterval);
  }
}