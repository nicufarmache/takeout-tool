import 'dotenv/config';
import * as path from 'path';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import Progress from './progress.js';
import { CustomJsonToFile, CustomExtraFilesToJson } from './custom-names.js';

const rootPath = path.join(process.env.ROOT_PATH, 'Takeout', 'Google Photos');
const csvPathJson = process.env.CSV_PATH_JSON;
const csvPathFiles = process.env.CSV_PATH_FILES;
const csvPathExtra = process.env.CSV_PATH_JSON_EXTRA;
const specialJsonFiles = [
  'print-subscriptions.json',
  'shared_album_comments.json',
  'user-generated-memory-titles.json',
  'metadata.json',
];

const progress = new Progress;
const suffixRegex = new RegExp('\\(\\d+\\)$', 'g');
const ilegalCharsRegex = new RegExp('[\\\\/:*?\\"<>|%&]', 'g');
const mp4Regex = new RegExp('\\.MP4$', 'g');
const jpgRegex = new RegExp('\\.jpg$', 'g');
const dirList = [];
const fileSet = new Set();
const jsonSet = new Set();
const jsonToFileMap = new Map();
const fileToJsonMap = new Map();
const jsonToExtraFilesMap = new Map();

scanDirs(rootPath);
matchJsonFiles();
checkForUnmachedFiles();
exportCSVs();
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
  if (CustomJsonToFile.has(jsonBasename)) {
    const customFilename = CustomJsonToFile.get(jsonBasename);
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
  let suffix = '';
  if (jsonBasename.endsWith(')')) {
    const match = jsonBasename.match(suffixRegex);
    if (match) {
      const suffix = match[0];
      basename = basename + suffix
      imageFilename = basename + ext;
    }
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
  progress.info(['Checking for unmatched files'], 1);
  progress.reset();
  progress.add(fileSet.size);
  for (const filePath of fileSet){
    progress.resolve();
    if(fileToJsonMap.has(filePath)) continue;

    // custom names
    if(CustomExtraFilesToJson.has(path.parse(filePath).base)) {
      const dir = path.parse(filePath).dir;
      const mainFilePath = path.join(dir, CustomExtraFilesToJson.get(path.parse(filePath).base));
      if (tryToAddExtraFile(filePath, mainFilePath)) continue;
    }

    if(filePath.includes('MVIMG')) {
      // fix this
      const mainFilePath = filePath.replaceAll(mp4Regex,'') + '.jpg';
      if (tryToAddExtraFile(filePath, mainFilePath)) continue;
    }

    if(filePath.includes('-edited')) {
      const mainFilePath = filePath.replaceAll('-edited','');
      if (tryToAddExtraFile(filePath, mainFilePath)) continue;
    }

    if(
      filePath.endsWith('MP') ||
      filePath.endsWith('MP~1') ||
      filePath.endsWith('MP~2')
    ) {
      const dir = path.parse(filePath).dir;
      let basename = path.parse(filePath).name;
      let ext = path.parse(filePath).ext;
      const newExt = '.jpg'

      // limit
      if ((basename + ext + newExt).length > 51) {
        let name = basename + ext;
        name = name.substring(0, 51 - newExt.length);
        basename = path.parse(name).name;
        ext = path.parse(name).ext;
      }

      // sufix
      const match = basename.match(suffixRegex);
      if (match) {
        const suffix = match[0];
        basename = basename.slice(0, 0 - suffix.length);
        ext  = ext + suffix;
      }
      const mainFilePath = path.join(dir, basename + ext + newExt);
      if (tryToAddExtraFile(filePath, mainFilePath)) continue;
      progress.error(['Tried         :', mainFilePath], 1);
    }

    if(filePath.includes('/original_') && filePath.endsWith(').jpg')) {
      // fix this
      const mainFilePath = filePath.replaceAll(jpgRegex,'').replaceAll(suffixRegex,'') + '.jpg';
      if (tryToAddExtraFile(filePath, mainFilePath)) continue;
    }

    if(fileToJsonMap.has(filePath)) {
      progress.error(['This should not happen:', filePath]);
    }

    progress.error(['Unmatched file:', filePath]);
  }
  progress.info(['Matched', fileToJsonMap.size - jsonToFileMap.size, 'extra files to', jsonToExtraFilesMap.size, 'json files']);
  progress.hide();
}

function tryToAddExtraFile(filePath, mainFilePath) {
  if(!fileToJsonMap.has(mainFilePath)) {
    return false;
  }

  const jsonPath = fileToJsonMap.get(mainFilePath);

  let filePaths = [];
  if(jsonToExtraFilesMap.has(jsonPath)){
    filePaths = jsonToExtraFilesMap.get(jsonPath);
  }

  filePaths.push(filePath)
  jsonToExtraFilesMap.set(jsonPath, filePaths);
  fileToJsonMap.set(filePath, jsonPath);
  return true;
}

function exportCSVs() {
  let data = '';

  // json
  progress.info(['Exporting csv: ', csvPathJson], 1);
  progress.reset();
  progress.add(jsonToFileMap.size);
  data = "\"sep=,\"\nJson,File";
  jsonToFileMap.forEach((filePath, jsonPath) => {
    data=`${data}\n"${jsonPath}","${filePath}"`;
    progress.resolve();
  });
  writeFileSync(csvPathJson, data);

  // files
  progress.info(['Exporting csv: ', csvPathFiles], 1);
  progress.reset();
  progress.add(fileToJsonMap.size);
  data = "\"sep=,\"\nFile,Json";
  fileToJsonMap.forEach((jsonPath, filePath) => {
    data=`${data}\n"${filePath}","${jsonPath}"`;
    progress.resolve();
  });
  writeFileSync(csvPathFiles, data);

  // extra
  progress.info(['Exporting csv: ', csvPathExtra], 1);
  progress.reset();
  progress.add(jsonToExtraFilesMap.size);
  data = "\"sep=,\"\nJson,Files";
  jsonToExtraFilesMap.forEach((filePaths, jsonPath) => {
    data=`${data}\n"${jsonPath}","${filePaths.join('","')}"`;
    progress.resolve();
  });
  writeFileSync(csvPathExtra, data);

  progress.hide();
}