#!/usr/bin/env ruby
# frozen_string_literal: true
#
# Register the OpenStoaNSE Notification Service Extension target in
# ProofportApp.xcodeproj.
#
# The extension's sources, Info.plist and entitlements are committed under
# `ios/OpenStoaNSE/`, but an Xcode TARGET cannot be created by an Expo config
# plugin (see `plugins/withOpenStoaNSE.js`), so it is registered here instead.
# Run this after any native regeneration that rewrites the pbxproj:
#
#     ruby ios/scripts/add_nse_target.rb
#
# The script is IDEMPOTENT — re-running it on an already-wired project reports
# "no changes" and rewrites nothing. It is also the only supported way to make
# this edit: hand-editing project.pbxproj is how the file gets corrupted.
#
# What it wires:
#   - a `com.apple.product-type.app-extension` target named OpenStoaNSE,
#     bundle id com.masselabs.zkproofport.OpenStoaNSE
#   - every *.swift under ios/OpenStoaNSE as its sources
#   - INFOPLIST_FILE / CODE_SIGN_ENTITLEMENTS pointing at the committed files
#   - deployment target, Swift version and team copied FROM THE HOST so the two
#     can never drift apart
#   - MARKETING_VERSION / CURRENT_PROJECT_VERSION copied from the host. The App
#     Store rejects a bundle whose extension version differs from its host, and
#     both of the repo's bump paths (scripts/sync-version.js regex, fastlane
#     increment_build_number via agvtool) rewrite every configuration in the
#     pbxproj — so once the keys exist here they stay in lockstep.
#   - a "Embed Foundation Extensions" copy-files phase on the host target plus a
#     host -> extension target dependency, so the .appex ends up in PlugIns/
#
# Signing note: the target is left on automatic signing. A CI distribution build
# additionally needs a provisioning profile for com.masselabs.zkproofport.OpenStoaNSE
# that includes the shared Keychain access group.

require 'xcodeproj'

PROJECT_PATH = File.expand_path('../ProofportApp.xcodeproj', __dir__)
NSE_DIR = File.expand_path('../OpenStoaNSE', __dir__)
HOST_TARGET_NAME = 'ProofportApp'
NSE_TARGET_NAME = 'OpenStoaNSE'
NSE_BUNDLE_ID = 'com.masselabs.zkproofport.OpenStoaNSE'
EMBED_PHASE_NAME = 'Embed Foundation Extensions'

abort "project not found: #{PROJECT_PATH}" unless File.directory?(PROJECT_PATH)
abort "extension sources not found: #{NSE_DIR}" unless File.directory?(NSE_DIR)

changes = []
def note(changes, msg)
  changes << msg
end

project = Xcodeproj::Project.open(PROJECT_PATH)
host = project.targets.find { |t| t.name == HOST_TARGET_NAME }
abort "host target #{HOST_TARGET_NAME} not found" if host.nil?

host_debug = host.build_configurations.find { |c| c.name == 'Debug' } || host.build_configurations.first
host_settings = host_debug.build_settings

# --- 1. the target itself -----------------------------------------------------

nse = project.targets.find { |t| t.name == NSE_TARGET_NAME }
if nse.nil?
  nse = project.new_target(
    :app_extension,
    NSE_TARGET_NAME,
    :ios,
    host_settings['IPHONEOS_DEPLOYMENT_TARGET'],
    project.products_group,
    :swift
  )
  note(changes, "created target #{NSE_TARGET_NAME}")
end

# --- 2. source files ----------------------------------------------------------

# A group with an explicit path so file refs stay relative to ios/OpenStoaNSE.
group = project.main_group.children.find { |c| c.display_name == NSE_TARGET_NAME && c.is_a?(Xcodeproj::Project::Object::PBXGroup) }
if group.nil?
  group = project.main_group.new_group(NSE_TARGET_NAME, NSE_TARGET_NAME)
  note(changes, "created group #{NSE_TARGET_NAME}")
end

# Glob rather than list: a Swift file added to the extension later must not
# silently fail to compile because someone forgot to edit this script.
swift_files = Dir.glob(File.join(NSE_DIR, '*.swift')).sort.map { |f| File.basename(f) }
abort 'no Swift sources found under ios/OpenStoaNSE' if swift_files.empty?

sources_phase = nse.source_build_phase

swift_files.each do |name|
  ref = group.files.find { |f| f.display_name == name }
  if ref.nil?
    ref = group.new_reference(name)
    note(changes, "added file reference #{name}")
  end
  next if sources_phase.files_references.include?(ref)

  sources_phase.add_file_reference(ref)
  note(changes, "added #{name} to the OpenStoaNSE compile sources")
end

# Drop build files for sources that no longer exist on disk, so a deleted file
# does not leave a dangling reference that fails the build.
sources_phase.files.dup.each do |bf|
  name = bf.file_ref&.display_name
  next if name && swift_files.include?(name)

  sources_phase.remove_build_file(bf)
  note(changes, "removed stale source #{name.inspect} from OpenStoaNSE")
end

# Info.plist / entitlements are referenced by build settings, not compiled, but
# they belong in the group so they are visible and editable in Xcode.
%w[Info.plist OpenStoaNSE.entitlements].each do |name|
  next unless File.exist?(File.join(NSE_DIR, name))
  next if group.files.any? { |f| f.display_name == name }

  group.new_reference(name)
  note(changes, "added file reference #{name}")
end

# --- 3. build settings --------------------------------------------------------

desired = {
  'PRODUCT_NAME' => '$(TARGET_NAME)',
  'PRODUCT_BUNDLE_IDENTIFIER' => NSE_BUNDLE_ID,
  'INFOPLIST_FILE' => "#{NSE_TARGET_NAME}/Info.plist",
  'CODE_SIGN_ENTITLEMENTS' => "#{NSE_TARGET_NAME}/#{NSE_TARGET_NAME}.entitlements",
  'IPHONEOS_DEPLOYMENT_TARGET' => host_settings['IPHONEOS_DEPLOYMENT_TARGET'],
  'SWIFT_VERSION' => host_settings['SWIFT_VERSION'],
  'DEVELOPMENT_TEAM' => host_settings['DEVELOPMENT_TEAM'],
  'MARKETING_VERSION' => host_settings['MARKETING_VERSION'],
  'CURRENT_PROJECT_VERSION' => host_settings['CURRENT_PROJECT_VERSION'],
  'VERSIONING_SYSTEM' => 'apple-generic',
  'TARGETED_DEVICE_FAMILY' => '1,2',
  'SKIP_INSTALL' => 'YES',
  'GENERATE_INFOPLIST_FILE' => 'NO',
  'CLANG_ENABLE_MODULES' => 'YES',
  'ENABLE_BITCODE' => 'NO',
  # An .appex is nested two levels deeper than the host binary, hence the second
  # search path — without it the extension cannot find the app's frameworks.
  'LD_RUNPATH_SEARCH_PATHS' => [
    '$(inherited)',
    '@executable_path/Frameworks',
    '@executable_path/../../Frameworks'
  ]
}.compact

nse.build_configurations.each do |config|
  per_config = desired.merge(
    'SWIFT_OPTIMIZATION_LEVEL' => config.name == 'Debug' ? '-Onone' : '-O',
    'SWIFT_ACTIVE_COMPILATION_CONDITIONS' => config.name == 'Debug' ? 'DEBUG' : ''
  )
  per_config.each do |key, value|
    next if config.build_settings[key] == value

    config.build_settings[key] = value
    note(changes, "set #{config.name}/#{key}")
  end
end

# --- 4. embed into the host app ----------------------------------------------

unless host.dependencies.any? { |d| d.target == nse }
  host.add_dependency(nse)
  note(changes, 'added host -> OpenStoaNSE target dependency')
end

embed = host.copy_files_build_phases.find do |phase|
  phase.symbol_dst_subfolder_spec == :plug_ins || phase.name == EMBED_PHASE_NAME
end
if embed.nil?
  embed = host.new_copy_files_build_phase(EMBED_PHASE_NAME)
  embed.symbol_dst_subfolder_spec = :plug_ins
  embed.dst_path = ''
  note(changes, "created host copy-files phase #{EMBED_PHASE_NAME.inspect}")
end

unless embed.files_references.include?(nse.product_reference)
  build_file = embed.add_file_reference(nse.product_reference)
  build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
  note(changes, 'embedded OpenStoaNSE.appex into the host PlugIns folder')
end

# --- 5. keep CFBundleVersion identical to the host ----------------------------

# The App Store rejects a bundle whose extension's CFBundleVersion differs from
# its host app's (ITMS-90473). The host's Info.plist carries a LITERAL
# CFBundleVersion — fastlane's increment_build_number drives it through
# `agvtool new-version -all`, which rewrites every Info.plist in the project — so
# the extension has to carry a literal too. Mirroring the build setting instead
# would drift, because scripts/sync-version.js rewrites CURRENT_PROJECT_VERSION
# in the pbxproj without touching the host's Info.plist.
host_plist_path = File.expand_path(host_settings['INFOPLIST_FILE'], File.dirname(PROJECT_PATH))
nse_plist_path = File.join(NSE_DIR, 'Info.plist')

if File.exist?(host_plist_path) && File.exist?(nse_plist_path)
  host_bundle_version = Xcodeproj::Plist.read_from_path(host_plist_path)['CFBundleVersion']

  # A `$(...)` value means the host resolves it from build settings; the
  # extension already inherits the same setting, so leave its plist alone.
  if host_bundle_version.is_a?(String) && !host_bundle_version.include?('$(')
    nse_plist_text = File.read(nse_plist_path)
    pattern = %r{(<key>CFBundleVersion</key>\s*\n\s*<string>)([^<]*)(</string>)}
    match = nse_plist_text.match(pattern)

    if match.nil?
      warn 'WARNING: could not find CFBundleVersion in ios/OpenStoaNSE/Info.plist — ' \
           'host/extension versions may diverge and fail App Store validation'
    elsif match[2] != host_bundle_version
      File.write(nse_plist_path, nse_plist_text.sub(pattern, "\\1#{host_bundle_version}\\3"))
      note(changes, "synced OpenStoaNSE CFBundleVersion to the host's #{host_bundle_version}")
    end
  end
end

# --- 6. shared scheme ---------------------------------------------------------

# Without a shared scheme the extension can only be built as a side effect of the
# host, which makes a compile error in it far harder to isolate. With one,
# `xcodebuild -scheme OpenStoaNSE` builds it alone.
scheme_path = File.join(PROJECT_PATH, 'xcshareddata', 'xcschemes', "#{NSE_TARGET_NAME}.xcscheme")
unless File.exist?(scheme_path)
  scheme = Xcodeproj::XCScheme.new
  scheme.add_build_target(nse)
  scheme.save_as(PROJECT_PATH, NSE_TARGET_NAME, true)
  note(changes, "created shared scheme #{NSE_TARGET_NAME}")
end

# --- 7. save ------------------------------------------------------------------

if changes.empty?
  puts "OpenStoaNSE already registered — no changes (#{swift_files.length} Swift sources)."
else
  project.save
  puts "OpenStoaNSE target updated in #{PROJECT_PATH}:"
  changes.each { |c| puts "  - #{c}" }
end
