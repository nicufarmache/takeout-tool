import 'dotenv/config';
import * as path from 'path';
import { readdirSync, readFileSync } from 'node:fs';
import Progress from './progress.js';
import CustomNames from './custom-names.js';

const rootPath = path.join(process.env.ROOT_PATH, 'Takeout', 'Google Photos');
const specialJsonFiles = [
  'print-subscriptions.json',
  'shared_album_comments.json',
  'user-generated-memory-titles.json',
  'metadata.json',
];

const progress = new Progress;
const suffixRegex = new RegExp('\\(\\d\\)$');
const ilegalCharsRegex = new RegExp('[\\\\/:*?\\"<>|%&]', 'g');
const dirList = [];
const fileList = [];
const jsonList = [];

dirList.push(rootPath);

progress.info(['Scanning directories'], 1);

while(dirList.length) {

  const dir = dirList.shift();
  progress.debug(['DIR: ', dir], 4);

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
const matchMap = new Map();

// progress.info(['Starting to process files: ', fileSet.size], 1);
// for (const filePath of fileSet){
//   indexFile(filePath)
// }

progress.info(['Starting to process json files'], 1);
for (const jsonPath of jsonSet){
  matchJson(jsonPath)
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
      matchMap.set(jsonPath, customFilePath);
    } else {
      progress.error(['File missing: ', customFilename, ' from:', jsonPath]);
    } 
    progress.resolve();
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
    progress.resolve();
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

  // handle (x) suffix
  if (suffix !== ''){
    basename = basename + suffix
    imageFilename = basename + ext;
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
      progress.resolve();
      return;
    }
  }

  // handle 51 char limit
  if (imageFilename.length > 51) {
    basename = basename.substring(0, 51  - ext.length);
    imageFilename = basename + ext;
  }

  // check if file exists
  const filePath = path.join(dir, imageFilename);
  if(!fileSet.has(filePath)) {
    progress.error(['File missing: ', imageFilename, ' from:', jsonPath]);
    progress.resolve();
    return;
  } 
  
  progress.debug(['File found: ', imageFilename], 4);
  matchMap.set(jsonPath, filePath);
  progress.resolve();
}

progress.hide();
progress.info(['Matched', matchMap.size, 'json files out of', jsonSet.size], 1);
process.exit();