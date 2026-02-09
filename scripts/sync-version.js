#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Read package.json
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;

// Parse semver
const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!match) {
  console.error(`❌ Invalid version format: ${version}`);
  process.exit(1);
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
