#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// The version to write, from the argument if given, otherwise package.json.
//
// WHY AN ARGUMENT. semantic-release calls this with no argument, having already
// written package.json — that path is unchanged. The release workflow's build
// jobs call it WITH the version, because they must not depend on reading it
// from git: semantic-release creates the version-bump commit during the run,
// and a job that starts before that commit lands builds the previous version's
// numbers. That is how app-v1.1.0 shipped `versionName 1.0.1` to Play on
// 2026-09-04.
//
// Passing the value removes the dependency entirely. Nothing has to wait for a
// commit or a tag to appear.
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
