#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// The version to write, from the argument if given, otherwise package.json.
//
// WHY AN ARGUMENT AT ALL. semantic-release calls this with no argument, having
// already written package.json — that is the only caller today, through
// `prepareCmd` in .releaserc.json and the `version:sync` npm script.
//
// The argument was added on 2026-09-04 for build jobs that had to write the
// version themselves, and it outlived that need one day later: release.yml now
// tags first and release-app.yml builds the tag, so nothing downstream writes a
// version. It is kept because passing the number explicitly is the safer shape
// for any future caller, and because the check below — validate the format
// before touching the file — was added after an earlier draft wrote the string
// "--help" into package.json.
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = process.argv[2] || packageJson.version;


// Parse semver
const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!match) {
  console.error(`❌ Invalid version format: ${version}`);
  process.exit(1);
}

// Only after the format check — an earlier draft wrote first and validated
// second, so `sync-version.js --help` put the string "--help" into
// package.json before rejecting it.
if (process.argv[2] && packageJson.version !== version) {
  packageJson.version = version;
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
  console.log(`📦 package.json version set to ${version}`);
}

const [, major, minor, patch] = match.map(Number);
const marketingVersion = `${major}.${minor}.${patch}`;
const versionCode = major * 10000 + minor * 100 + patch;

console.log(`📦 Syncing version ${marketingVersion} (code: ${versionCode})`);

// Update iOS project.pbxproj
const pbxprojPath = path.join(__dirname, '..', 'ios', 'ProofportApp.xcodeproj', 'project.pbxproj');
let pbxprojContent = fs.readFileSync(pbxprojPath, 'utf8');

const originalPbxproj = pbxprojContent;
pbxprojContent = pbxprojContent.replace(
  /CURRENT_PROJECT_VERSION = \d+;/g,
  `CURRENT_PROJECT_VERSION = ${versionCode};`
);
pbxprojContent = pbxprojContent.replace(
  /MARKETING_VERSION = [\d.]+;/g,
  `MARKETING_VERSION = ${marketingVersion};`
);

if (pbxprojContent !== originalPbxproj) {
  fs.writeFileSync(pbxprojPath, pbxprojContent, 'utf8');
  console.log(`✅ iOS: MARKETING_VERSION = ${marketingVersion}, CURRENT_PROJECT_VERSION = ${versionCode}`);
} else {
  console.log(`⚠️  iOS: No changes needed`);
}

// Update Android build.gradle
const buildGradlePath = path.join(__dirname, '..', 'android', 'app', 'build.gradle');
let buildGradleContent = fs.readFileSync(buildGradlePath, 'utf8');

const originalGradle = buildGradleContent;
buildGradleContent = buildGradleContent.replace(
  /versionCode \d+/,
  `versionCode ${versionCode}`
);
buildGradleContent = buildGradleContent.replace(
  /versionName "[\d.]+"/,
  `versionName "${marketingVersion}"`
);

if (buildGradleContent !== originalGradle) {
  fs.writeFileSync(buildGradlePath, buildGradleContent, 'utf8');
  console.log(`✅ Android: versionName "${marketingVersion}", versionCode ${versionCode}`);
} else {
  console.log(`⚠️  Android: No changes needed`);
}

console.log(`✨ Version sync complete`);
