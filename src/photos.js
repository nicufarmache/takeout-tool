import 'dotenv/config';
import * as path from 'path';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { startPath, csvPathJson, csvPathFiles, csvPathExtra } from '../config/general.js';
import { CustomJsonToFile, CustomExtraFilesToJson } from '../config/photos.js';

export default class Photos {
  rootPath = path.join(startPath, 'Takeout', 'Google Photos');
  ignoreFiles = [
    'print-subscriptions.json',
    'shared_album_comments.json',
    'user-generated-memory-titles.json',
    'metadata.json',
    'metadata(1).json',
    'metadata(2).json',
  ];
  progress = {};
  suffixRegex = new RegExp('\\(\\d+\\)$', 'g');
  ilegalCharsRegex = new RegExp('[\\\\/:*?\\"<>|%&]', 'g');
  mp4Regex = new RegExp('\\.MP4$', 'g');
  jpgRegex = new RegExp('\\.jpg$', 'g');
  dirList = [];
  fileSet = new Set();
  jsonSet = new Set();
  jsonToFileMap = new Map();
  fileToJsonMap = new Map();
  jsonToExtraFilesMap = new Map();

  constructor({ progress }) {
    this.progress = progress;
    this.scanDirs(this.rootPath);
    this.matchJsonFiles();
    this.checkForUnmachedFiles();
    this.exportCSVs();
    // process.exit();
  }

  scanDirs() {
    this.progress.info(['Scanning directories'], 1);
  
    this.dirList.push(this.rootPath);
    this.progress.reset();
    
    while(this.dirList.length) {
      const dir = this.dirList.shift();
      this.progress.debug(['DIR: ', dir], 4);
    
      const subItems = readdirSync(dir, {withFileTypes: true});
    
      for(const subItem of subItems) {
        const subPath = path.join(dir, subItem.name);
        
        if(subItem.isDirectory()) {
          this.dirList.push(subPath);
          continue;
        } 
        
        if(!subPath.endsWith('.json')) {
          this.fileSet.add(subPath)
          continue;
        }
    
        if(this.ignoreFiles.includes(path.basename(subPath))) {
          continue;
        }
  
        this.jsonSet.add(subPath);
        this.progress.add();
      }
    }
    this.progress.hide();
  }
  
  matchJsonFiles() {
    this.progress.info(['Processing json files'], 1);
    this.progress.reset();
    this.progress.add(this.jsonSet.size);
    for (const jsonPath of this.jsonSet){
      this.matchJson(jsonPath)
      this.progress.resolve();
    }
    this.progress.hide();
    this.progress.info(['Matched', this.jsonToFileMap.size, 'json files out of', this.jsonSet.size], 1);
  }
  
  matchJson(jsonPath) {
    this.progress.debug(['JSON: ', jsonPath], 4);
    const jsonBasename = path.parse(jsonPath).name;
    const dir = path.dirname(jsonPath);
  
    // check custom names
    if (CustomJsonToFile.has(jsonBasename)) {
      const customFilename = CustomJsonToFile.get(jsonBasename);
      const customFilePath = path.join(dir, customFilename);
      if(this.fileSet.has(customFilePath)) {
        this.progress.debug(['File found: ', customFilename], 4);
        this.addMatch(jsonPath, customFilePath);
      } else {
        this.progress.error(['File missing: ', customFilename, ' from:', jsonPath]);
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
      this.progress.error(['JSON Error:', jsonPath, error]);
      return;
    }
  
    // replace ilegal chars
    imageFilename = imageFilename.replaceAll(this.ilegalCharsRegex, '_');
  
    let ext = path.parse(imageFilename).ext;
    let basename = path.parse(imageFilename).name;
  
    // handle missing ext
    if (ext === '') {
      let found = 0;
      let newExt = '';
      if (this.fileSet.has(path.join(dir, basename + '.jpg'))) {
        newExt = '.jpg'
        found++;
      }
      if (this.fileSet.has(path.join(dir, basename + '.png'))) {
        newExt = '.png'
        found++;
      }
      if (this.fileSet.has(path.join(dir, basename + '.gif'))) {
        newExt = '.gif'
        found++;
      }
      if (this.fileSet.has(path.join(dir, basename + '.jpeg'))) {
        newExt = '.jpeg'
        found++;
      }
      if (found === 1) {
        ext = newExt;
        imageFilename = basename + ext;
      } 
      if (found > 1) {
        this.progress.error(['Ambiguous name: ', imageFilename, ' from:', jsonPath]);
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
      const match = jsonBasename.match(this.suffixRegex);
      if (match) {
        const suffix = match[0];
        basename = basename + suffix
        imageFilename = basename + ext;
      }
    }
  
    // check if file exists
    const filePath = path.join(dir, imageFilename);
    if(!this.fileSet.has(filePath)) {
      this.progress.error(['File missing: ', imageFilename, ' from:', jsonPath]);
      return;
    } 
    
    this.progress.debug(['File found: ', imageFilename], 4);
    this.addMatch(jsonPath, filePath);
  }
  
  addMatch(jsonPath, filePath) {
    if (this.fileToJsonMap.has(filePath)) {
      this.progress.error(["Duplicate file match:", filePath]);
      this.progress.error(["  new:", jsonPath]);
      this.progress.error(["  old:", this.fileToJsonMap.get(filePath)]);
  
      return;
    }
    this.jsonToFileMap.set(jsonPath, filePath);
    this.fileToJsonMap.set(filePath, jsonPath);
  }
  
  checkForUnmachedFiles() {
    this.progress.info(['Checking for unmatched files'], 1);
    this.progress.reset();
    this.progress.add(this.fileSet.size);
    for (const filePath of this.fileSet){
      this.progress.resolve();
      if(this.fileToJsonMap.has(filePath)) continue;
  
      // custom names
      if(CustomExtraFilesToJson.has(path.parse(filePath).base)) {
        const dir = path.parse(filePath).dir;
        const mainFilePath = path.join(dir, CustomExtraFilesToJson.get(path.parse(filePath).base));
        if (this.tryToAddExtraFile(filePath, mainFilePath)) continue;
      }
  
      if(filePath.includes('MVIMG')) {
        // fix this
        const mainFilePath = filePath.replaceAll(this.mp4Regex,'') + '.jpg';
        if (this.tryToAddExtraFile(filePath, mainFilePath)) continue;
      }
  
      if(filePath.includes('-edited')) {
        const mainFilePath = filePath.replaceAll('-edited','');
        if (this.tryToAddExtraFile(filePath, mainFilePath)) continue;
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
        const match = basename.match(this.suffixRegex);
        if (match) {
          const suffix = match[0];
          basename = basename.slice(0, 0 - suffix.length);
          ext  = ext + suffix;
        }
        const mainFilePath = path.join(dir, basename + ext + newExt);
        if (this.tryToAddExtraFile(filePath, mainFilePath)) continue;
        this.progress.error(['Tried         :', mainFilePath], 1);
      }
  
      if(filePath.includes('/original_') && filePath.endsWith(').jpg')) {
        // fix this
        const mainFilePath = filePath.replaceAll(this.jpgRegex,'').replaceAll(this.suffixRegex,'') + '.jpg';
        if (this.tryToAddExtraFile(filePath, mainFilePath)) continue;
      }
  
      if(this.fileToJsonMap.has(filePath)) {
        this.progress.error(['This should not happen:', filePath]);
      }
  
      this.progress.error(['Unmatched file:', filePath]);
    }
    this.progress.info(['Matched', this.fileToJsonMap.size - this.jsonToFileMap.size, 'extra files to', this.jsonToExtraFilesMap.size, 'json files']);
    this.progress.hide();
  }
  
  tryToAddExtraFile(filePath, mainFilePath) {
    if(!this.fileToJsonMap.has(mainFilePath)) {
      return false;
    }
  
    const jsonPath = this.fileToJsonMap.get(mainFilePath);
  
    let filePaths = [];
    if(this.jsonToExtraFilesMap.has(jsonPath)){
      filePaths = this.jsonToExtraFilesMap.get(jsonPath);
    }
  
    filePaths.push(filePath)
    this.jsonToExtraFilesMap.set(jsonPath, filePaths);
    this.fileToJsonMap.set(filePath, jsonPath);
    return true;
  }
  
  exportCSVs() {
    let data = '';
  
    // json
    this.progress.info(['Exporting csv: ', csvPathJson], 1);
    this.progress.reset();
    this.progress.add(this.jsonToFileMap.size);
    data = "\"sep=,\"\nJson,File";
    this.jsonToFileMap.forEach((filePath, jsonPath) => {
      data=`${data}\n"${jsonPath}","${filePath}"`;
      this.progress.resolve();
    });
    writeFileSync(csvPathJson, data);
  
    // files
    this.progress.info(['Exporting csv: ', csvPathFiles], 1);
    this.progress.reset();
    this.progress.add(this.fileToJsonMap.size);
    data = "\"sep=,\"\nFile,Json";
    this.fileToJsonMap.forEach((jsonPath, filePath) => {
      data=`${data}\n"${filePath}","${jsonPath}"`;
      this.progress.resolve();
    });
    writeFileSync(csvPathFiles, data);
  
    // extra
    this.progress.info(['Exporting csv: ', csvPathExtra], 1);
    this.progress.reset();
    this.progress.add(this.jsonToExtraFilesMap.size);
    data = "\"sep=,\"\nJson,Files";
    this.jsonToExtraFilesMap.forEach((filePaths, jsonPath) => {
      data=`${data}\n"${jsonPath}","${filePaths.join('","')}"`;
      this.progress.resolve();
    });
    writeFileSync(csvPathExtra, data);
  
    this.progress.hide();
  }
};
