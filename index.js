import 'dotenv/config';
import * as path from 'path';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import Progress from './progress.js';
import CustomNames from './custom-names.js';

const rootPath = path.join(process.env.ROOT_PATH, 'Takeout', 'Google Photos');
const csvPath = process.env.CSV_PATH;
const specialJsonFiles = [
  'print-subscriptions.json',
  'shared_album_comments.json',
  'user-generated-memory-titles.json',
  'metadata.json',
];

const progress = new Progress;
const suffixRegex = new RegExp('\\(\\d+\\)$');
const ilegalCharsRegex = new RegExp('[\\\\/:*?\\"<>|%&]', 'g');
const dirList = [];
const fileSet = new Set();
const jsonSet = new Set();
const jsonToFileMap = new Map();
const fileToJsonMap = new Map();

scanDirs(rootPath);
matchJsonFiles();
exportCSV();
checkForUnmachedFiles();
process.exit();

function scanDirs(rootPath) {
  progress.info(['Scanning directories'], 1);

  dirList.push(rootPath);
  progress.reset();
  
  while(dirList.length) {
    const dir = dirList.shift();
    progress.debug(['DIR: ', dir], 4);
  
    const subItems = readdirSync(dir, {withFileTypes: true});
  
    for(const subItem of subItems) {
      const subPath = path.join(dir, subItem.name);
      
      if(subItem.isDirectory()) {
        dirList.push(subPath);
        continue;
      } 
      
      if(!subPath.endsWith('.json')) {
        fileSet.add(subPath)
        continue;
      }
  
      if(specialJsonFiles.includes(path.basename(subPath))) {
        continue;
      }

      jsonSet.add(subPath);
      progress.add();
    }
  }
  progress.hide();
}

function matchJsonFiles() {
  progress.info(['Processing json files'], 1);
  progress.reset();
  progress.add(jsonSet.size);
  for (const jsonPath of jsonSet){
    matchJson(jsonPath)
    progress.resolve();
  }
  progress.hide();
  progress.info(['Matched', jsonToFileMap.size, 'json files out of', jsonSet.size], 1);
}

function matchJson(jsonPath) {
  progress.debug(['JSON: ', jsonPath], 4);
  const jsonBasename = path.parse(jsonPath).name;
  const dir = path.dirname(jsonPath);

  // check custom names
  if (CustomNames.has(jsonBasename)) {
    const customFilename = CustomNames.get(jsonBasename);
    const customFilePath = path.join(dir, customFilename);
    if(fileSet.has(customFilePath)) {
      progress.debug(['File found: ', customFilename], 4);
      addMatch(jsonPath, customFilePath);
    } else {
      progress.error(['File missing: ', customFilename, ' from:', jsonPath]);
    } 
    return;
  }

  // read json
  let data = {};
  let imageFilename = '';
  try {
    const rawdata = readFileSync(jsonPath);
    data = JSON.parse(rawdata);
    imageFilename = data.title;
  } catch (error) {
    progress.error(['JSON Error:', jsonPath, error]);
    return;
  }

  // replace ilegal chars
  imageFilename = imageFilename.replaceAll(ilegalCharsRegex, '_');

  let ext = path.parse(imageFilename).ext;
  let basename = path.parse(imageFilename).name;

  // get suffix
  let suffix = '';
  if (jsonBasename.endsWith(')')) {
    const match = jsonBasename.match(suffixRegex);
    if (match) {
      suffix = match[0];
    }
  }

  // handle missing ext
  if (ext === '') {
    let found = 0;
    let newExt = '';
    if (fileSet.has(path.join(dir, basename + '.jpg'))) {
      newExt = '.jpg'
      found++;
    }
    if (fileSet.has(path.join(dir, basename + '.png'))) {
      newExt = '.png'
      found++;
    }
    if (fileSet.has(path.join(dir, basename + '.gif'))) {
      newExt = '.gif'
      found++;
    }
    if (fileSet.has(path.join(dir, basename + '.jpeg'))) {
      newExt = '.jpeg'
      found++;
    }
    if (found === 1) {
      ext = newExt;
      imageFilename = basename + ext;
    } 
    if (found > 1) {
      progress.error(['Ambiguous name: ', imageFilename, ' from:', jsonPath]);
      return;
    }
  }

  // handle 51 char limit
  if (imageFilename.length > 51) {
    basename = basename.substring(0, 51  - ext.length);
    imageFilename = basename + ext;
  }

  // handle (x) suffix
  if (suffix !== ''){
    basename = basename + suffix
    imageFilename = basename + ext;
  }

  // check if file exists
  const filePath = path.join(dir, imageFilename);
  if(!fileSet.has(filePath)) {
    progress.error(['File missing: ', imageFilename, ' from:', jsonPath]);
    return;
  } 
  
  progress.debug(['File found: ', imageFilename], 4);
  addMatch(jsonPath, filePath);
}

function addMatch(jsonPath, filePath) {
  if (fileToJsonMap.has(filePath)) {
    progress.error(["Duplicate file match:", filePath]);
    progress.error(["  new:", jsonPath]);
    progress.error(["  old:", fileToJsonMap.get(filePath)]);

    return;
  }
  jsonToFileMap.set(jsonPath, filePath);
  fileToJsonMap.set(filePath, jsonPath);
}

function checkForUnmachedFiles() {
  progress.info(['Checking for unmacthed files'], 1);
  progress.reset();
  progress.add(fileSet.size);
  for (const filePath of fileSet){
    if(filePath.includes('MVIMG')) {
      // TODO handle these
      continue;
    }
    if(filePath.includes('-edited')) {
      continue;
    }
    if(filePath.endsWith('MP')) {
      continue;
    }
    if(filePath.endsWith('MP~1')) {
      continue;
    }
    if(filePath.endsWith('MP~2')) {
      continue;
    }
    if(filePath.includes('/original_')) {
      continue;
    }
    if(!fileToJsonMap.has(filePath)) {
      progress.error(['Unmatched file: ', filePath]);
    }
    progress.resolve();
  }
  progress.hide();
}

function exportCSV() {
  progress.info(['Exporting csv: ', csvPath], 1);
  progress.reset();
  progress.add(jsonToFileMap.size);
  let data = "\"sep=,\"\nJson,File";
  jsonToFileMap.forEach((filePath, jsonPath) => {
    data=`${data}\n"${jsonPath}","${filePath}"`;
    progress.resolve()
  });
  writeFileSync(csvPath, data);
  progress.hide();
}