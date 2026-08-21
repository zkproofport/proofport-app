# frozen_string_literal: true

# App Store Connect / Developer Portal READ-ONLY backup.
#
# Captures everything that has to be re-entered by hand when the app record is
# recreated on another Apple team (see docs/migration/mobile-apps.md §A). After
# the personal-account app is deleted the data is gone permanently, so this
# errs hard on the side of capturing too much: every endpoint is dumped as raw
# App Store Connect API JSON (no lossy model mapping), and every failure is
# recorded in errors.json instead of aborting the run.
#
# READ-ONLY IS ENFORCED, NOT JUST INTENDED:
#   * ReadOnlyGuard below is prepended onto Spaceship's HTTP client and raises
#     on post / patch / delete. Nothing in this process can write to Apple.
#   * The only Spaceship calls made here are `.get`.
#   * `deliver` is invoked ONLY as `download_metadata` / `download_screenshots`,
#     from a scratch cwd that contains no fastlane folder, so ios/fastlane/
#     Deliverfile (which sets `force true` / `overwrite_screenshots true`) is
#     never loaded. See run_deliver_downloads.
#
# Usage (normally via `fastlane backup_appstore`, see ios/fastlane/Fastfile):
#   ASC_KEY_ID=... ASC_ISSUER_ID=... ASC_API_KEY_PATH=/tmp/key.p8 \
#     bundle exec ruby scripts/asc_backup.rb [output_dir]

require 'json'
require 'fileutils'
require 'tmpdir'
require 'time'
require 'uri'
require 'net/http'
require 'base64'
require 'spaceship'

module AscBackup
  # Hard kill-switch for every mutating HTTP verb. Prepended onto the Spaceship
  # client class that tunes / provisioning / testflight / users all inherit
  # from, so an accidental write anywhere in this process raises instead of
  # reaching Apple.
  module ReadOnlyGuard
    class WriteAttemptError < StandardError; end

    def post(*_args, **_kwargs, &_blk)
      raise WriteAttemptError, 'asc_backup is read-only: POST is blocked'
    end

    def patch(*_args, **_kwargs, &_blk)
      raise WriteAttemptError, 'asc_backup is read-only: PATCH is blocked'
    end

    def delete(*_args, **_kwargs, &_blk)
      raise WriteAttemptError, 'asc_backup is read-only: DELETE is blocked'
    end
  end

  Spaceship::ConnectAPI::APIClient.prepend(ReadOnlyGuard)

  APP_IDENTIFIER = 'com.masselabs.zkproofport'

  # Build "what to test" notes only for the most recent builds — older ones
  # cannot be restored into a new app record anyway (see SUMMARY.md gaps).
  BUILD_LOCALIZATION_LIMIT = Integer(ENV.fetch('ASC_BACKUP_BUILD_LOCALIZATION_LIMIT', '30'))

  class Runner
    attr_reader :out_dir, :app_identifier, :errors, :notes

    def initialize(out_dir:, app_identifier: APP_IDENTIFIER)
      @out_dir = File.expand_path(out_dir)
      @app_identifier = app_identifier
      @errors = []
      @notes = []
      @app = nil
      @summary = {}
    end

    def run!
      FileUtils.mkdir_p(out_dir)
      log("Output directory: #{out_dir}")
      log("App identifier:   #{app_identifier}")

      write_json('run_info.json',
                 'started_at' => Time.now.utc.iso8601,
                 'app_identifier' => app_identifier,
                 'fastlane_version' => (defined?(Fastlane::VERSION) ? Fastlane::VERSION : 'unknown'),
                 'read_only' => true,
                 'script' => File.basename(__FILE__))

      capture_app_record
      if @app.nil?
        log('FATAL: app record not found — App Store Connect capture skipped.')
      else
        capture_app_infos
        capture_app_privacy
        capture_versions
        capture_pricing_and_availability
        capture_in_app_purchases
        capture_builds
        capture_testflight
        capture_misc_app_resources
      end

      capture_portal
      capture_users
      copy_local_entitlements
      run_deliver_downloads

      write_json('errors.json', 'count' => errors.length, 'errors' => errors)
      write_summary
      log("Captured with #{errors.length} recorded error(s). See errors.json.")
      out_dir
    end

    private

    #
    # App Store Connect
    #

    def capture_app_record
      body = capture('apps') do
        get_all(tunes, 'v1/apps', filter: { bundleId: app_identifier }, limit: 200)
      end
      write_json('app.json', body)
      return if body.nil?

      # filter[bundleId] is a prefix-ish match on some ASC versions, so match exactly.
      @app = (body['data'] || []).find { |a| a.dig('attributes', 'bundleId') == app_identifier }
      @app ||= (body['data'] || []).first
      if @app
        log("Found app id=#{@app['id']} name=#{@app.dig('attributes', 'name').inspect}")
        @summary[:app] = @app['attributes'] || {}
        @summary[:app_id] = @app['id']
      else
        record_error('apps', "no app matching bundleId #{app_identifier}")
      end
    end

    def app_id
      @app && @app['id']
    end

    def capture_app_infos
      infos = capture('appInfos') do
        get_all(tunes, "v1/apps/#{app_id}/appInfos",
                includes: 'appInfoLocalizations,primaryCategory,primarySubcategoryOne,' \
                          'primarySubcategoryTwo,secondaryCategory,secondarySubcategoryOne,' \
                          'secondarySubcategoryTwo',
                limit: 200)
      end
      write_json('app_infos.json', infos)
      @summary[:app_infos] = infos

      age_ratings = {}
      (infos && infos['data'] || []).each do |info|
        id = info['id']
        age_ratings[id] = capture("appInfos/#{id}/ageRatingDeclaration") do
          get_all(tunes, "v1/appInfos/#{id}/ageRatingDeclaration")
        end
      end
      write_json('age_ratings_app_info.json', age_ratings)
      @summary[:age_ratings] = age_ratings
    end

    def capture_app_privacy
      usages = capture('appDataUsages') do
        get_all(tunes, "v1/apps/#{app_id}/appDataUsages",
                includes: 'category,grouping,purpose,dataProtection', limit: 200)
      end
      publish_state = capture('appDataUsagesPublishState') do
        get_all(tunes, "v1/apps/#{app_id}/appDataUsagesPublishState")
      end
      # Catalogs make the opaque ids above human-readable — without them the
      # nutrition label cannot be re-entered from the dump.
      categories = capture('appDataUsageCategories') do
        get_all(tunes, 'v1/appDataUsageCategories', includes: 'grouping', limit: 200)
      end
      purposes = capture('appDataUsagePurposes') do
        get_all(tunes, 'v1/appDataUsagePurposes', limit: 200)
      end

      write_json('app_privacy.json',
                 'app_data_usages' => usages,
                 'publish_state' => publish_state,
                 'catalog_categories' => categories,
                 'catalog_purposes' => purposes)
      @summary[:privacy] = usages
    end

    def capture_versions
      versions = capture('appStoreVersions') do
        get_all(tunes, "v1/apps/#{app_id}/appStoreVersions", limit: 200, sort: '-versionString')
      end
      write_json('app_store_versions.json', versions)
      @summary[:versions] = versions

      details = {}
      screenshot_index = []
      preview_index = []

      (versions && versions['data'] || []).each do |version|
        vid = version['id']
        vstring = version.dig('attributes', 'versionString')
        log("Version #{vstring} (#{vid})")

        locs = capture("appStoreVersions/#{vid}/appStoreVersionLocalizations") do
          get_all(tunes, "v1/appStoreVersions/#{vid}/appStoreVersionLocalizations", limit: 200)
        end

        details[vid] = {
          'version_string' => vstring,
          'attributes' => version['attributes'],
          'localizations' => locs,
          'review_detail' => capture("appStoreVersions/#{vid}/appStoreReviewDetail") do
            get_all(tunes, "v1/appStoreVersions/#{vid}/appStoreReviewDetail")
          end,
          'age_rating_declaration' => capture("appStoreVersions/#{vid}/ageRatingDeclaration") do
            get_all(tunes, "v1/appStoreVersions/#{vid}/ageRatingDeclaration")
          end,
          'phased_release' => capture("appStoreVersions/#{vid}/appStoreVersionPhasedRelease") do
            get_all(tunes, "v1/appStoreVersions/#{vid}/appStoreVersionPhasedRelease")
          end,
          'build' => capture("appStoreVersions/#{vid}/build") do
            get_all(tunes, "v1/appStoreVersions/#{vid}/build")
          end
        }

        (locs && locs['data'] || []).each do |loc|
          lid = loc['id']
          locale = loc.dig('attributes', 'locale')

          sets = capture("appStoreVersionLocalizations/#{lid}/appScreenshotSets") do
            get_all(tunes, "v1/appStoreVersionLocalizations/#{lid}/appScreenshotSets",
                    includes: 'appScreenshots', limit: 200)
          end
          screenshot_index << { 'version' => vstring, 'locale' => locale, 'sets' => sets }

          previews = capture("appStoreVersionLocalizations/#{lid}/appPreviewSets") do
            get_all(tunes, "v1/appStoreVersionLocalizations/#{lid}/appPreviewSets",
                    includes: 'appPreviews', limit: 200)
          end
          preview_index << { 'version' => vstring, 'locale' => locale, 'sets' => previews }
        end
      end

      write_json('app_store_version_details.json', details)
      write_json('screenshots.json', screenshot_index)
      write_json('app_previews.json', preview_index)

      download_screenshot_assets(screenshot_index)
      download_preview_assets(preview_index)
    end

    def capture_pricing_and_availability
      # Apple replaced the price-tier model with price schedules; which one an
      # app answers on depends on migration state, so try both and keep whatever
      # responds.
      write_json('pricing.json',
                 'app_price_schedule' => capture('appPriceSchedule') do
                   get_all(tunes, "v1/apps/#{app_id}/appPriceSchedule",
                           includes: 'baseTerritory,manualPrices,automaticPrices')
                 end,
                 'legacy_prices' => capture('prices (legacy)') do
                   get_all(tunes, "v1/apps/#{app_id}/prices", includes: 'priceTier', limit: 200)
                 end)

      write_json('availability.json',
                 'app_availability_v2' => capture('appAvailabilityV2') do
                   get_all(tunes, "v1/apps/#{app_id}/appAvailabilityV2",
                           includes: 'territoryAvailabilities',
                           limit: { territoryAvailabilities: 200 })
                 end,
                 'app_availability' => capture('appAvailability (legacy)') do
                   get_all(tunes, "v1/apps/#{app_id}/appAvailability",
                           includes: 'territoryAvailabilities',
                           limit: { territoryAvailabilities: 200 })
                 end,
                 'available_territories' => capture('availableTerritories (legacy)') do
                   get_all(tunes, "v1/apps/#{app_id}/availableTerritories", limit: 200)
                 end,
                 'all_territories' => capture('territories') do
                   get_all(tunes, 'v1/territories', limit: 200)
                 end)
    end

    def capture_in_app_purchases
      iaps = capture('inAppPurchasesV2') do
        get_all(tunes, "v1/apps/#{app_id}/inAppPurchasesV2", limit: 200)
      end

      iap_details = {}
      (iaps && iaps['data'] || []).each do |iap|
        id = iap['id']
        iap_details[id] = {
          'attributes' => iap['attributes'],
          'localizations' => capture("inAppPurchases/#{id}/inAppPurchaseLocalizations") do
            get_all(tunes, "v2/inAppPurchases/#{id}/inAppPurchaseLocalizations", limit: 200)
          end,
          'price_schedule' => capture("inAppPurchases/#{id}/iapPriceSchedule") do
            get_all(tunes, "v2/inAppPurchases/#{id}/iapPriceSchedule",
                    includes: 'baseTerritory,manualPrices')
          end
        }
      end

      groups = capture('subscriptionGroups') do
        get_all(tunes, "v1/apps/#{app_id}/subscriptionGroups",
                includes: 'subscriptions,subscriptionGroupLocalizations', limit: 200)
      end

      write_json('in_app_purchases.json',
                 'in_app_purchases' => iaps,
                 'in_app_purchase_details' => iap_details,
                 'subscription_groups' => groups)
      @summary[:iap_count] = (iaps && iaps['data'] || []).length
    end

    def capture_builds
      builds = capture('builds') do
        get_all(tunes, "v1/apps/#{app_id}/builds",
                includes: 'preReleaseVersion,buildBetaDetail', limit: 200, sort: '-uploadedDate')
      end
      pre_release = capture('preReleaseVersions') do
        get_all(tunes, "v1/apps/#{app_id}/preReleaseVersions", limit: 200)
      end

      build_localizations = {}
      (builds && builds['data'] || []).first(BUILD_LOCALIZATION_LIMIT).each do |build|
        bid = build['id']
        build_localizations[bid] = capture("builds/#{bid}/betaBuildLocalizations") do
          get_all(tunes, "v1/builds/#{bid}/betaBuildLocalizations", limit: 200)
        end
      end

      write_json('builds.json',
                 'builds' => builds,
                 'pre_release_versions' => pre_release,
                 'beta_build_localizations' => build_localizations,
                 'beta_build_localization_limit' => BUILD_LOCALIZATION_LIMIT)
      @summary[:build_count] = (builds && builds['data'] || []).length
    end

    def capture_testflight
      groups = capture('betaGroups') do
        get_all(tunes, "v1/apps/#{app_id}/betaGroups", limit: 200)
      end

      group_testers = {}
      (groups && groups['data'] || []).each do |group|
        gid = group['id']
        group_testers[gid] = {
          'name' => group.dig('attributes', 'name'),
          'is_internal' => group.dig('attributes', 'isInternalGroup'),
          'testers' => capture("betaGroups/#{gid}/betaTesters") do
            get_all(tunes, "v1/betaGroups/#{gid}/betaTesters", limit: 200)
          end
        }
      end

      write_json('testflight.json',
                 'beta_groups' => groups,
                 'beta_group_testers' => group_testers,
                 'all_beta_testers' => capture('betaTesters') do
                   get_all(tunes, 'v1/betaTesters',
                           filter: { apps: app_id }, includes: 'betaGroups', limit: 200)
                 end,
                 'beta_app_localizations' => capture('betaAppLocalizations') do
                   get_all(tunes, "v1/apps/#{app_id}/betaAppLocalizations", limit: 200)
                 end,
                 'beta_app_review_detail' => capture('betaAppReviewDetail') do
                   get_all(tunes, "v1/apps/#{app_id}/betaAppReviewDetail")
                 end,
                 'beta_license_agreement' => capture('betaLicenseAgreements') do
                   get_all(tunes, 'v1/betaLicenseAgreements', filter: { app: app_id }, limit: 200)
                 end)

      @summary[:beta_groups] = group_testers
    end

    def capture_misc_app_resources
      write_json('app_misc.json',
                 'app_encryption_declarations' => capture('appEncryptionDeclarations') do
                   get_all(tunes, "v1/apps/#{app_id}/appEncryptionDeclarations", limit: 200)
                 end,
                 'app_custom_product_pages' => capture('appCustomProductPages') do
                   get_all(tunes, "v1/apps/#{app_id}/appCustomProductPages",
                           includes: 'appCustomProductPageVersions', limit: 200)
                 end,
                 'end_user_license_agreement' => capture('endUserLicenseAgreement') do
                   get_all(tunes, "v1/apps/#{app_id}/endUserLicenseAgreement",
                           includes: 'territories')
                 end,
                 'promoted_purchases' => capture('promotedPurchases') do
                   get_all(tunes, "v1/apps/#{app_id}/promotedPurchases", limit: 200)
                 end,
                 'review_submissions' => capture('reviewSubmissions') do
                   get_all(tunes, "v1/apps/#{app_id}/reviewSubmissions",
                           includes: 'items', limit: 200)
                 end,
                 'app_clips' => capture('appClips') do
                   get_all(tunes, "v1/apps/#{app_id}/appClips", limit: 200)
                 end)
    end

    #
    # Developer Portal
    #

    def capture_portal
      bundle_ids = capture('bundleIds') do
        get_all(provisioning, 'v1/bundleIds', limit: 200)
      end

      capabilities = {}
      (bundle_ids && bundle_ids['data'] || []).each do |bid|
        id = bid['id']
        capabilities[id] = {
          'identifier' => bid.dig('attributes', 'identifier'),
          'name' => bid.dig('attributes', 'name'),
          'platform' => bid.dig('attributes', 'platform'),
          'capabilities' => capture("bundleIds/#{id}/bundleIdCapabilities") do
            get_all(provisioning, "v1/bundleIds/#{id}/bundleIdCapabilities", limit: 200)
          end
        }
      end

      write_json('portal/bundle_ids.json',
                 'bundle_ids' => bundle_ids,
                 'capabilities_by_bundle_id' => capabilities)
      @summary[:bundle_ids] = capabilities

      certificates = capture('certificates') do
        get_all(provisioning, 'v1/certificates', limit: 200)
      end
      write_json('portal/certificates.json', strip_blobs(certificates, 'certificateContent'))
      dump_blobs(certificates, 'certificateContent', 'portal/certificates', 'cer')
      @summary[:certificates] = certificates

      profiles = capture('profiles') do
        get_all(provisioning, 'v1/profiles', includes: 'bundleId,certificates,devices', limit: 200)
      end
      write_json('portal/profiles.json', strip_blobs(profiles, 'profileContent'))
      dump_blobs(profiles, 'profileContent', 'portal/profiles', 'mobileprovision')
      @summary[:profiles] = profiles

      write_json('portal/devices.json', capture('devices') do
        get_all(provisioning, 'v1/devices', limit: 200)
      end)

      # These four are probed rather than assumed. As of this writing the public
      # App Store Connect API exposes merchantIds but NOT appGroups /
      # cloudContainers (they only exist behind the cookie-authenticated legacy
      # portal API, which an API key cannot reach). Whatever Apple actually
      # answers is recorded verbatim so the SUMMARY reflects reality, not a guess.
      probes = {}
      {
        'merchantIds' => 'v1/merchantIds',
        'appGroups' => 'v1/appGroups',
        'cloudContainers' => 'v1/cloudContainers',
        'passTypeIds' => 'v1/passTypeIds'
      }.each do |name, path|
        probes[name] = capture("portal probe #{name}") do
          get_all(provisioning, path, limit: 200)
        end
      end
      write_json('portal/capability_identifier_probes.json', probes)
      @summary[:portal_probes] = probes
    end

    def capture_users
      write_json('users_and_access.json',
                 'users' => capture('users') do
                   get_all(users_client, 'v1/users', includes: 'visibleApps', limit: 200)
                 end,
                 'user_invitations' => capture('userInvitations') do
                   get_all(users_client, 'v1/userInvitations', includes: 'visibleApps', limit: 200)
                 end)
    end

    #
    # Local artifacts that record capabilities the API cannot answer for
    #

    def copy_local_entitlements
      repo_ios = File.expand_path('..', __dir__)
      copied = []
      Dir.glob(File.join(repo_ios, '**', '*.entitlements')).each do |path|
        next if path.include?('/Pods/')

        rel = path.sub("#{repo_ios}/", '')
        dest = File.join(out_dir, 'local_entitlements', rel)
        FileUtils.mkdir_p(File.dirname(dest))
        FileUtils.cp(path, dest)
        copied << rel
      end
      note("Copied #{copied.length} local .entitlements file(s): #{copied.join(', ')}") unless copied.empty?
      write_json('local_entitlements/index.json', 'files' => copied, 'source' => repo_ios)
    end

    #
    # deliver (download-only, isolated from ios/fastlane/Deliverfile)
    #

    def run_deliver_downloads
      metadata_path = File.join(out_dir, 'deliver', 'metadata')
      screenshots_path = File.join(out_dir, 'deliver', 'screenshots')
      FileUtils.mkdir_p(metadata_path)
      FileUtils.mkdir_p(screenshots_path)

      # Scratch cwd deliberately contains no `fastlane/` folder, so
      # FastlaneCore::FastlaneFolder.path is nil and deliver's
      # `load_configuration_file("Deliverfile")` finds nothing to load. The
      # repo's Deliverfile (force true / overwrite_screenshots true) therefore
      # cannot reach these invocations.
      #
      # It lives outside out_dir on purpose: the short-lived API key JSON is
      # written here, and out_dir is what gets uploaded as a CI artifact.
      work_dir = Dir.mktmpdir('asc-backup-deliver')

      key_json = write_api_key_json(work_dir)
      return if key_json.nil?

      fastlane_bin = ENV.fetch('ASC_BACKUP_FASTLANE_BIN', 'fastlane')

      # `--force` here is deliver's "overwrite the LOCAL metadata folder without
      # an interactive prompt" flag. In the download_metadata code path it is
      # only consulted by force_overwrite_metadata?; without it a non-interactive
      # run silently downloads nothing. It has no upload meaning.
      run_subprocess([fastlane_bin, 'deliver', 'download_metadata',
                      '--app_identifier', app_identifier,
                      '--api_key_path', key_json,
                      '--metadata_path', metadata_path,
                      '--platform', 'ios',
                      '--force'], work_dir, 'deliver download_metadata')

      run_subprocess([fastlane_bin, 'deliver', 'download_screenshots',
                      '--app_identifier', app_identifier,
                      '--api_key_path', key_json,
                      '--screenshots_path', screenshots_path,
                      '--platform', 'ios'], work_dir, 'deliver download_screenshots')
    ensure
      File.unlink(key_json) if key_json && File.exist?(key_json)
      FileUtils.rm_rf(work_dir) if work_dir && Dir.exist?(work_dir)
    end

    def write_api_key_json(dir)
      key_id = ENV['ASC_KEY_ID']
      issuer_id = ENV['ASC_ISSUER_ID']
      key_path = ENV['ASC_API_KEY_PATH']
      key_content = ENV['ASC_API_KEY']

      pem =
        if key_path && File.exist?(key_path)
          File.read(key_path)
        elsif key_content && !key_content.empty?
          Base64.decode64(key_content)
        end

      if key_id.nil? || pem.nil?
        record_error('deliver', 'ASC_KEY_ID / ASC_API_KEY_PATH not set — deliver downloads skipped')
        return nil
      end

      path = File.join(dir, 'asc_api_key.json')
      File.open(path, File::WRONLY | File::CREAT | File::TRUNC, 0o600) do |f|
        f.write(JSON.pretty_generate('key_id' => key_id,
                                     'issuer_id' => issuer_id,
                                     'key' => pem,
                                     'in_house' => false))
      end
      path
    end

    def run_subprocess(argv, cwd, label)
      log("Running: #{label} (cwd=#{cwd})")
      ok = Dir.chdir(cwd) { system(*argv) }
      if ok
        log("#{label}: OK")
      else
        record_error(label, "exited with status #{$?.inspect}")
      end
    rescue StandardError => e
      record_error(label, "#{e.class}: #{e.message}")
    end

    #
    # Asset downloads
    #

    def download_screenshot_assets(index)
      downloaded = []
      seen = {}
      index.each do |entry|
        locale = entry['locale'] || 'unknown'
        version = entry['version'] || 'unknown'
        included = entry.dig('sets', 'included') || []
        included.select { |i| i['type'] == 'appScreenshots' }.each do |shot|
          attrs = shot['attributes'] || {}
          asset = attrs['imageAsset']
          next if asset.nil? || asset['templateUrl'].nil?

          url = asset['templateUrl']
                .gsub('{w}', asset['width'].to_s)
                .gsub('{h}', asset['height'].to_s)
                .gsub('{f}', 'png')
          key = attrs['sourceFileChecksum'] || shot['id']
          display = display_type_for(shot, entry) || 'unknown-display'
          name = attrs['fileName'] || "#{shot['id']}.png"
          dest = File.join(out_dir, 'assets', 'screenshots', version, locale, display, name)

          if seen[key]
            copy_existing(seen[key], dest)
          elsif download_file(url, dest)
            seen[key] = dest
          else
            next
          end
          downloaded << { 'version' => version, 'locale' => locale, 'display_type' => display,
                          'file' => dest.sub("#{out_dir}/", ''), 'url' => url,
                          'width' => asset['width'], 'height' => asset['height'] }
        end
      end
      write_json('assets/screenshots_index.json', downloaded)
      @summary[:screenshot_files] = downloaded.length
      log("Downloaded #{downloaded.length} screenshot file reference(s).")
    end

    def download_preview_assets(index)
      downloaded = []
      index.each do |entry|
        locale = entry['locale'] || 'unknown'
        version = entry['version'] || 'unknown'
        included = entry.dig('sets', 'included') || []
        included.select { |i| i['type'] == 'appPreviews' }.each do |preview|
          attrs = preview['attributes'] || {}
          url = attrs['videoUrl']
          next if url.nil?

          name = attrs['fileName'] || "#{preview['id']}.mov"
          dest = File.join(out_dir, 'assets', 'previews', version, locale, name)
          next unless download_file(url, dest)

          downloaded << { 'version' => version, 'locale' => locale,
                          'file' => dest.sub("#{out_dir}/", ''), 'url' => url }
        end
      end
      write_json('assets/previews_index.json', downloaded)
      @summary[:preview_files] = downloaded.length
      log("Downloaded #{downloaded.length} app preview file(s).")
    end

    def display_type_for(shot, entry)
      sets = entry.dig('sets', 'data') || []
      set = sets.find do |s|
        (s.dig('relationships', 'appScreenshots', 'data') || []).any? { |r| r['id'] == shot['id'] }
      end
      set && set.dig('attributes', 'screenshotDisplayType')
    end

    def copy_existing(src, dest)
      FileUtils.mkdir_p(File.dirname(dest))
      FileUtils.cp(src, dest) unless File.exist?(dest)
      true
    rescue StandardError => e
      record_error("copy #{dest}", "#{e.class}: #{e.message}")
      false
    end

    def download_file(url, dest, redirects_left = 5)
      FileUtils.mkdir_p(File.dirname(dest))
      uri = URI.parse(url)
      Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == 'https', open_timeout: 20,
                                          read_timeout: 120) do |http|
        http.request(Net::HTTP::Get.new(uri)) do |res|
          case res
          when Net::HTTPSuccess
            File.open(dest, 'wb') { |f| res.read_body { |chunk| f.write(chunk) } }
            return true
          when Net::HTTPRedirection
            return false if redirects_left <= 0

            return download_file(URI.join(url, res['location']).to_s, dest, redirects_left - 1)
          else
            record_error("download #{url}", "HTTP #{res.code}")
            return false
          end
        end
      end
      false
    rescue StandardError => e
      record_error("download #{url}", "#{e.class}: #{e.message}")
      false
    end

    #
    # HTTP plumbing (GET only)
    #

    def tunes
      Spaceship::ConnectAPI.client.tunes_request_client
    end

    def provisioning
      Spaceship::ConnectAPI.client.provisioning_request_client
    end

    def users_client
      Spaceship::ConnectAPI.client.users_request_client
    end

    # Follows `links.next` to the end and merges every page into a single
    # JSON:API-shaped hash, so nothing is silently truncated at page 1.
    def get_all(client, path, filter: nil, includes: nil, limit: nil, sort: nil)
      params = client.build_params(filter: filter, includes: includes, limit: limit, sort: sort)
      resp = client.get(path, params.empty? ? nil : params)

      data = []
      included = []
      meta = nil
      pages = 0

      loop do
        body = resp.body || {}
        d = body['data']
        data.concat(d.is_a?(Array) ? d : [d].compact)
        included.concat(body['included'] || [])
        meta ||= body['meta']
        pages += 1

        next_url = (body['links'] || {})['next']
        break if next_url.nil?
        break if pages > 200 # runaway guard

        resp = client.get(next_url)
      end

      { 'data' => data, 'included' => dedupe_included(included), 'meta' => meta, 'pages' => pages }
    end

    def dedupe_included(included)
      seen = {}
      included.each { |i| seen["#{i['type']}:#{i['id']}"] ||= i }
      seen.values
    end

    #
    # Output helpers
    #

    def strip_blobs(payload, attribute)
      return payload if payload.nil?

      copy = Marshal.load(Marshal.dump(payload))
      (copy['data'] || []).each do |item|
        attrs = item['attributes']
        next unless attrs && attrs.key?(attribute)

        attrs[attribute] = "<omitted, #{attrs[attribute].to_s.length} base64 chars — see sibling directory>"
      end
      copy
    end

    def dump_blobs(payload, attribute, dir, extension)
      return if payload.nil?

      (payload['data'] || []).each do |item|
        content = item.dig('attributes', attribute)
        next if content.nil? || content.empty?

        raw_name = item.dig('attributes', 'name') || item.dig('attributes', 'displayName') || item['id']
        safe = raw_name.to_s.gsub(/[^A-Za-z0-9._-]+/, '_')
        dest = File.join(out_dir, dir, "#{safe}-#{item['id']}.#{extension}")
        FileUtils.mkdir_p(File.dirname(dest))
        File.binwrite(dest, Base64.decode64(content))
      rescue StandardError => e
        record_error("dump #{attribute} #{item['id']}", "#{e.class}: #{e.message}")
      end
    end

    def capture(label)
      yield
    rescue StandardError => e
      record_error(label, "#{e.class}: #{e.message}")
      nil
    end

    def record_error(endpoint, message)
      log("  ! #{endpoint}: #{message}")
      @errors << { 'endpoint' => endpoint, 'error' => message, 'at' => Time.now.utc.iso8601 }
    end

    def note(message)
      log("  . #{message}")
      @notes << message
    end

    def write_json(relative, payload)
      dest = File.join(out_dir, relative)
      FileUtils.mkdir_p(File.dirname(dest))
      File.write(dest, JSON.pretty_generate(payload))
      dest
    end

    def log(message)
      puts("[asc_backup] #{message}")
      $stdout.flush
    end

    #
    # SUMMARY.md
    #

    def write_summary
      File.write(File.join(out_dir, 'SUMMARY.md'), SummaryWriter.new(self, @summary).render)
    end
  end

  # Renders the human-readable manual re-entry checklist.
  class SummaryWriter
    def initialize(runner, summary)
      @runner = runner
      @s = summary
    end

    def render
      lines = []
      lines << '# App Store Connect / Developer Portal backup'
      lines << ''
      lines << "Captured: #{Time.now.utc.iso8601}"
      lines << "App identifier: `#{@runner.app_identifier}`"
      lines << "Recorded errors: #{@runner.errors.length} (see `errors.json`)"
      lines << ''
      lines << 'This snapshot is READ-ONLY output. Nothing was written to Apple.'
      lines << ''
      lines.concat(app_section)
      lines.concat(categories_section)
      lines.concat(locales_section)
      lines.concat(privacy_section)
      lines.concat(age_rating_section)
      lines.concat(testflight_section)
      lines.concat(portal_section)
      lines.concat(files_section)
      lines.concat(gaps_section)
      lines.join("\n") + "\n"
    end

    private

    def app_section
      a = @s[:app] || {}
      out = ['## 1. App record', '',
             '| Field | Value |', '| --- | --- |']
      {
        'App Store Connect app id' => @s[:app_id],
        'Name' => a['name'],
        'Bundle ID' => a['bundleId'],
        'SKU' => a['sku'],
        'Primary language' => a['primaryLocale'],
        'Content rights declaration' => a['contentRightsDeclaration'],
        'Made for kids' => a['isOrEverWasMadeForKids'],
        'Subscription status URL' => a['subscriptionStatusUrl']
      }.each { |k, v| out << "| #{k} | #{md(v)} |" }
      out << ''
      out << 'Full record: `app.json`, `app_infos.json`.'
      out << ''
      out
    end

    def categories_section
      infos = @s[:app_infos]
      return [] if infos.nil?

      included = infos['included'] || []
      cats = included.select { |i| i['type'] == 'appCategories' }.map { |c| c['id'] }
      out = ['## 2. Categories', '']
      out << if cats.empty?
               'No category relationships returned — check `app_infos.json` manually.'
             else
               "Category ids referenced: #{cats.uniq.map { |c| "`#{c}`" }.join(', ')}. " \
               'Relationship mapping (primary / secondary / subcategories) is in `app_infos.json`.'
             end
      out << ''
      out
    end

    def locales_section
      details = safe_read('app_store_version_details.json')
      out = ['## 3. Per-locale version metadata (re-enter one row per locale)', '']
      if details.nil? || details.empty?
        out << 'No version detail captured — see `errors.json`.'
        out << ''
        return out
      end

      details.each_value do |v|
        locs = v.dig('localizations', 'data') || []
        out << "### Version #{v['version_string']} — #{locs.length} locale(s)"
        out << ''
        out << '| Locale | Has description | Keywords | Promo text | What\'s new | Support URL | Marketing URL |'
        out << '| --- | --- | --- | --- | --- | --- | --- |'
        locs.each do |l|
          at = l['attributes'] || {}
          out << "| `#{at['locale']}` | #{yn(at['description'])} | #{yn(at['keywords'])} | " \
                 "#{yn(at['promotionalText'])} | #{yn(at['whatsNew'])} | #{md(at['supportUrl'])} | " \
                 "#{md(at['marketingUrl'])} |"
        end
        out << ''
      end
      out << 'Full text: `app_store_version_details.json` and the `deliver/metadata/` tree ' \
             '(the deliver tree can be uploaded straight into the new app with `deliver`).'
      out << ''
      out
    end

    def privacy_section
      usages = @s[:privacy]
      out = ['## 4. App Privacy (nutrition label)', '']
      if usages.nil?
        out << 'NOT captured — see `errors.json`.'
        out << ''
        return out
      end

      rows = usages['data'] || []
      out << "#{rows.length} `appDataUsages` declaration row(s) captured in `app_privacy.json`."
      out << ''
      out << 'Each row references a category / purpose / data-protection id. The id catalogs ' \
             'are dumped alongside (`catalog_categories`, `catalog_purposes`) so each opaque id ' \
             'can be resolved to the label shown in the App Store Connect UI.'
      out << ''
      out << 'This is the single most painful section to re-enter by hand — work through ' \
             '`app_privacy.json` row by row.'
      out << ''
      out
    end

    def age_rating_section
      out = ['## 5. Age rating / content descriptors', '']
      ar = @s[:age_ratings]
      if ar.nil? || ar.empty?
        out << 'NOT captured — see `errors.json`.'
      else
        out << 'Declarations are in `age_ratings_app_info.json` (per appInfo) and inside ' \
               '`app_store_version_details.json` (per version). Every non-`NONE` field is a ' \
               'question you must answer identically in the new app.'
      end
      out << ''
      out
    end

    def testflight_section
      out = ['## 6. TestFlight', '']
      groups = @s[:beta_groups]
      if groups.nil? || groups.empty?
        out << 'No beta groups captured — see `errors.json`.'
        out << ''
        return out
      end

      out << '| Group | Internal | Testers |'
      out << '| --- | --- | --- |'
      groups.each_value do |g|
        testers = (g.dig('testers', 'data') || []).length
        out << "| #{md(g['name'])} | #{g['is_internal'] ? 'yes' : 'no'} | #{testers} |"
      end
      out << ''
      out << 'Tester email addresses, beta app description, feedback email and beta app review ' \
             'contact details are in `testflight.json`.'
      out << ''
      out
    end

    def portal_section
      out = ['## 7. Developer Portal', '']
      caps = @s[:bundle_ids] || {}
      if caps.empty?
        out << 'No bundle ids captured — see `errors.json`.'
      else
        out << '| Bundle ID | Name | Capabilities |'
        out << '| --- | --- | --- |'
        caps.each_value do |b|
          types = (b.dig('capabilities', 'data') || [])
                  .map { |c| c.dig('attributes', 'capabilityType') }.compact
          out << "| `#{b['identifier']}` | #{md(b['name'])} | #{types.empty? ? '—' : types.join(', ')} |"
        end
      end
      out << ''

      certs = (@s.dig(:certificates, 'data') || []).length
      profs = (@s.dig(:profiles, 'data') || []).length
      out << "Certificates: #{certs} (inventory in `portal/certificates.json`, public `.cer` " \
             'files in `portal/certificates/`).'
      out << "Provisioning profiles: #{profs} (inventory in `portal/profiles.json`, " \
             '`.mobileprovision` files in `portal/profiles/`).'
      out << 'Registered devices: `portal/devices.json`.'
      out << ''

      probes = @s[:portal_probes] || {}
      out << '### Capability-identifier probes'
      out << ''
      out << '| Resource | Result |'
      out << '| --- | --- |'
      probes.each do |name, value|
        out << if value.nil?
                 "| `#{name}` | not available (request failed — see `errors.json`) |"
               else
                 "| `#{name}` | #{(value['data'] || []).length} record(s) |"
               end
      end
      out << ''
      out << 'App Groups and iCloud Containers are not exposed by the public App Store Connect ' \
             'API — an API key cannot read them. If the app ever gains one, re-create it from ' \
             'the entitlements files copied into `local_entitlements/`.'
      out << ''
      out
    end

    def files_section
      [
        '## 8. Files in this backup',
        '',
        '| Path | Contents |',
        '| --- | --- |',
        '| `app.json`, `app_infos.json` | App record, categories, app-level localizations |',
        '| `app_store_versions.json`, `app_store_version_details.json` | Version history + every per-locale field |',
        '| `app_privacy.json` | Data-collection declarations + id catalogs |',
        '| `age_ratings_app_info.json` | Age rating declarations |',
        '| `screenshots.json`, `app_previews.json` | Screenshot / preview set inventory per locale and device size |',
        '| `assets/screenshots/**`, `assets/previews/**` | Downloaded image and video files |',
        '| `pricing.json`, `availability.json` | Price schedule / tier and territory availability |',
        '| `in_app_purchases.json` | IAPs, their localizations, subscription groups |',
        '| `builds.json` | Build + pre-release version history, "what to test" notes |',
        '| `testflight.json` | Beta groups, testers, beta app review info |',
        '| `app_misc.json` | Export compliance, custom product pages, EULA, review submissions |',
        '| `users_and_access.json` | Team users and pending invitations |',
        '| `portal/**` | Bundle ids + capabilities, certificates, profiles, devices |',
        '| `local_entitlements/**` | Entitlements files copied from the repo |',
        '| `deliver/metadata/**` | `deliver` metadata tree — re-uploadable into the new app |',
        '| `deliver/screenshots/**` | `deliver` screenshot tree |',
        '| `errors.json` | Every endpoint that failed, with the reason |',
        ''
      ]
    end

    def gaps_section
      [
        '## 9. NOT captured — permanently lost on deletion',
        '',
        'No backup can preserve these. Read this section before deleting the app.',
        '',
        '- **Ratings and reviews.** Deleted with the app record. They cannot be exported, ',
        '  imported, or migrated to a new app. The new app starts at zero reviews.',
        '- **Install base / units / retention analytics.** App Analytics history belongs to the ',
        '  old app record. Sales & Trends reports can be downloaded separately, but the numbers ',
        '  do not carry into the new app.',
        '- **Version lineage and build numbers.** The new app starts fresh; `builds.json` is a ',
        '  record, not something that can be restored.',
        '- **Existing TestFlight testers stay on the old build.** `testflight.json` preserves the ',
        '  email list so testers can be re-invited, but every tester must accept a new invitation ',
        '  and the 90-day build expiry clock restarts.',
        '- **Promo codes** already issued against the old app.',
        '- **`.p8` private keys.** Apple allows exactly one download and the API never returns ',
        '  the private half. The existing keys are at ',
        '  `~/Documents/개인/Recipiary/AuthKey_27PLGJGZ7U.p8` and ',
        '  `~/Documents/개인/Recipiary/AuthKey_F68NQ8UMWQ.p8` — back those files up separately, ',
        '  they are not in this directory. New keys must be generated on the corporate account ',
        '  regardless.',
        '- **Certificate private keys.** `portal/certificates/*.cer` holds only the public ',
        '  certificate. The private keys live in the fastlane match repo ',
        '  (`github.com/zkproofport/ios-certificates`) and in the local keychain. New certificates ',
        '  must be issued under the corporate team anyway.',
        '- **App Groups / iCloud Containers.** Not readable through the App Store Connect API ',
        '  (see §7). This app currently declares neither.',
        '- **App Store Connect user roles.** `users_and_access.json` records who had access; ',
        '  invitations have to be re-sent by hand.',
        ''
      ]
    end

    def safe_read(name)
      JSON.parse(File.read(File.join(@runner.out_dir, name)))
    rescue StandardError
      nil
    end

    def yn(value)
      value.nil? || value.to_s.strip.empty? ? 'no' : 'yes'
    end

    def md(value)
      return '—' if value.nil? || value.to_s.strip.empty?

      value.to_s.gsub('|', '\\|')
    end
  end

  def self.run!(output_dir: nil, app_identifier: APP_IDENTIFIER)
    output_dir ||= default_output_dir
    Runner.new(out_dir: output_dir, app_identifier: app_identifier).run!
  end

  def self.default_output_dir
    stamp = Time.now.utc.strftime('%Y%m%dT%H%M%SZ')
    File.join(Dir.pwd, 'build', 'asc-backup', stamp)
  end

  # Authenticates Spaceship from ASC_* env vars. Only needed when this script is
  # run directly; the fastlane lane authenticates before calling run!.
  def self.authenticate_from_env!
    key_id = ENV['ASC_KEY_ID']
    issuer_id = ENV['ASC_ISSUER_ID']
    key_path = ENV['ASC_API_KEY_PATH']
    key_content = ENV['ASC_API_KEY']

    raise 'ASC_KEY_ID is required' if key_id.nil? || key_id.empty?

    if key_path && File.exist?(key_path)
      Spaceship::ConnectAPI.auth(key_id: key_id, issuer_id: issuer_id, filepath: key_path)
    elsif key_content && !key_content.empty?
      Spaceship::ConnectAPI.auth(key_id: key_id, issuer_id: issuer_id,
                                 key: Base64.decode64(key_content))
    else
      raise 'Set ASC_API_KEY_PATH (PEM .p8 path) or ASC_API_KEY (base64 .p8)'
    end
  end
end

if __FILE__ == $PROGRAM_NAME
  require 'fastlane'
  AscBackup.authenticate_from_env!
  path = AscBackup.run!(output_dir: ARGV[0])
  puts("[asc_backup] Done: #{path}")
end
