import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';

const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const metadata=parse(fs.readFileSync('dist/latest.yml','utf8'));
if(metadata.version!==pkg.version) throw new Error('Updater metadata version does not match app');
const file=metadata.files?.find(f=>f.url===`Unstable-Watch-Setup-${pkg.version}.exe`);
if(!file) throw new Error('Updater metadata does not reference expected installer');
const installer=fs.readFileSync(path.join('dist',file.url));
if(createHash('sha512').update(installer).digest('base64')!==file.sha512) throw new Error('Installer checksum does not match latest.yml');
if(file.size!==installer.length) throw new Error('Installer size does not match latest.yml');
if(!fs.statSync(path.join('dist',file.url+'.blockmap')).size) throw new Error('Missing installer blockmap');
console.log(`Verified installer, latest.yml checksum, and blockmap for ${pkg.version}`);
