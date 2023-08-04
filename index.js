import 'dotenv/config';
import * as path from 'path';
import Logger from 'log-with-statusbar';
import { readdir, lstat, access } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { log } from 'console';

const rootPath = path.join(process.env.ROOT_PATH, 'Takeout', 'Google Photos');
const suffixRegex = new RegExp("\\(\\d\\)$");

class Progress {
  total = 0;
  processed = 0;
  barLength = 30;
  barComplete = '█';
  barIncomplete = '░';
  barStart = '[';
  barEnd = ']';
  lastTime = 0;
  updateInterval = 1000;
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

  print() {
    const percent = (this.total === 0) ? 0 : Math.round(this.processed*100/this.total);
    this.logger.setStatusBarText([
      `  Progress: ${this.makeBar(percent)} ${percent}%  |   ${this.processed}/${this.total} files processed`,
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

const progress = new Progress;

const specialJsonFiles = [
  'print-subscriptions.json',
  'shared_album_comments.json',
  'user-generated-memory-titles.json',
  'metadata.json',
];

const dirList = [];
const fileList = [];
const jsonList = [];

dirList.push(rootPath);

while(dirList.length) {

  const dir = dirList.shift();
  progress.debug(['DIR: ', dir]);

  const subItems = await readdirSync(dir, {withFileTypes: true});

  for(const subItem of subItems) {
    const subPath = path.join(dir, subItem.name);
    
    if(subItem.isDirectory()) {
      dirList.push(subPath);
      continue;
    } 
    
    if(!subPath.endsWith('.json')) {
      fileList.push(subPath)
      // progress.add();
      continue;
    }

    if(specialJsonFiles.includes(path.basename(subPath))) {
      continue;
    }

    jsonList.push(subPath)
    progress.add();
  }
}

const fileSet = new Set(fileList);
const jsonSet = new Set(jsonList);

// progress.info(['Starting to process files: ', fileSet.size], 1);
// for (const filePath of fileSet){
//   indexFile(filePath)
// }

progress.info(['Starting to process jsons: ', jsonSet.size], 1);
for (const jsonPath of jsonSet){
  indexJson(jsonPath)
}

function indexJson(jsonPath) {
  progress.debug(['JSON: ', jsonPath], 4);
  try {
    const suffix = getSuffix(jsonPath);
    const rawdata = readFileSync(jsonPath);
    const data = JSON.parse(rawdata);
    const imageFilename = data.title;
    const imagePath = (suffix === '') ? 
      path.join(path.dirname(jsonPath), imageFilename) : 
      path.join(path.dirname(jsonPath), path.parse(imageFilename).name + suffix + path.parse(imageFilename).ext);
    progress.debug(['JSON title: ', imageFilename], 4);
    progress.debug(['JSON suffx: ', suffix], 4);
    if(fileSet.has(imagePath)) {
      progress.debug(['File found: ', path.basename(imagePath)], 4);
    } else {
      progress.error(['File missing: ', path.basename(imagePath), ' from:', jsonPath]);
    }
  } catch (error) {
    progress.error(['JSON Error:', jsonPath, error]);
  }
  progress.resolve();
}

function getSuffix(jsonPath) {
  const basename = path.basename(jsonPath, '.json');
  if (!basename.endsWith(')')) return '';
  const match = basename.match(suffixRegex);
  if (!match) return '';
  return match[0];
}



progress.print();
process.exit();