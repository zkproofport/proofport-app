## [1.0.2](https://github.com/zkproofport/proofport-app/compare/app-v1.0.1...app-v1.0.2) (2026-03-07)


### Bug Fixes

* use absolute path for Android keystore in release workflow ([3ac2109](https://github.com/zkproofport/proofport-app/commit/3ac210916d1752abbe366edac3951086c650b617))

## [1.0.1](https://github.com/zkproofport/proofport-app/compare/app-v1.0.0...app-v1.0.1) (2026-03-07)


### Bug Fixes

* set semantic-release output variables for non-dry-run builds ([7cf4bf5](https://github.com/zkproofport/proofport-app/commit/7cf4bf56d4a30618cb194df24935c1418ad995f7))

# 1.0.0 (2026-03-07)


### Bug Fixes

* add API key debug validation step in iOS CI ([7f997cb](https://github.com/zkproofport/proofport-app/commit/7f997cb333c2e7984875b2a9ad0e3813fe72e465))
* **android:** bundle Feather icon font for vector icons ([f1bcccd](https://github.com/zkproofport/proofport-app/commit/f1bcccd52656f7160346665e03ab1be646e6b41a))
* **android:** enable QR scanning with camera permission and ML Kit bundling ([f3d5b87](https://github.com/zkproofport/proofport-app/commit/f3d5b8759ff5d862ba9217924ac1625224e65b43)), closes [#3434](https://github.com/zkproofport/proofport-app/issues/3434)
* **android:** increase tab bar padding to prevent label cutoff ([7da426c](https://github.com/zkproofport/proofport-app/commit/7da426c20a413c7d4bf71c4f50816543e3581a95))
* **android:** resolve Gradle 9 build errors and @expo/cli path resolution ([51dc17a](https://github.com/zkproofport/proofport-app/commit/51dc17adf37aafc908448bd6846dcad399c93493))
* auto versionCode from env var and update YttriumWrapper to 0.10.37 ([6a64743](https://github.com/zkproofport/proofport-app/commit/6a64743f247fa2cc4411b430632cd242d6280154))
* convert PKCS8 key to EC PEM format for Ruby OpenSSL 3.x compat ([8f176a2](https://github.com/zkproofport/proofport-app/commit/8f176a282695c2ab09858770dc6da60fce57b3f0))
* decode ASC API key to file to avoid OpenSSL 3.x curve error ([6e2cbe6](https://github.com/zkproofport/proofport-app/commit/6e2cbe6c5b86e51470234c2f35cb03cd7d8d199f))
* delete stale Podfile.lock before pod install in CI ([6ea7377](https://github.com/zkproofport/proofport-app/commit/6ea73775f65769e3fe3a79686c000624965e2c2d))
* **docs:** clarify privacy policy to avoid cryptocurrency misclassification ([6535621](https://github.com/zkproofport/proofport-app/commit/6535621585283f9991c5160c23e5c216413bb86d))
* **docs:** update privacy policy to match actual data storage ([d9104e4](https://github.com/zkproofport/proofport-app/commit/d9104e4d31790a3409dbd74ce74c46c98192fb23))
* downgrade CI Ruby to 3.2 for fastlane OpenSSL compatibility ([7d1194d](https://github.com/zkproofport/proofport-app/commit/7d1194dd76614b37bea870efc7373a089d0e87a8))
* embed GH_PAT in MATCH_GIT_URL for CI cert repo access ([51d30b2](https://github.com/zkproofport/proofport-app/commit/51d30b20784901df8d499fbf5898f5baece3fa12))
* improve ProofComplete navigation and fix live logs overlap ([e8d504f](https://github.com/zkproofport/proofport-app/commit/e8d504f6b2d565bea15ba154b291174454a436c5))
* increase Android build timeout to 45 minutes ([6fa5f28](https://github.com/zkproofport/proofport-app/commit/6fa5f2827a7cfa99e3fb54355c98995470cf5b8d))
* **ios:** add allowProvisioningUpdates and encryption compliance ([b99f614](https://github.com/zkproofport/proofport-app/commit/b99f614335fcbd9d7b3b8871ab5c45b615c56a94))
* move versionCode offset to build.gradle for GitHub Actions compat ([b254195](https://github.com/zkproofport/proofport-app/commit/b254195289bb74ee2cfa7a39409a29d5086fbae5))
* pass json_key to fastlane supply for WIF auth ([b459aa1](https://github.com/zkproofport/proofport-app/commit/b459aa118d076f09ee2e6812eba911e45c759cc2))
* remove flex:1 from LiveLogsPanel to fix nested ScrollView collapse ([bc8d125](https://github.com/zkproofport/proofport-app/commit/bc8d125704307007a7bdb0b8effa3de19cfef3a0))
* resolve Android CI disk space issue ([b73bddb](https://github.com/zkproofport/proofport-app/commit/b73bddbc9fdbed0a4a768c124ad88fbce7d2daaf))
* resolve CI workflow failures and update deployment docs ([e543899](https://github.com/zkproofport/proofport-app/commit/e5438994a0676db5722b5db77edf5a2275c5dbd2))
* rewrite proof generation with reliable error detection and settings gate ([a5eee39](https://github.com/zkproofport/proofport-app/commit/a5eee39d4ef8c09d5d60975e4020e0065b2c65f2))
* set code signing settings after match in CI ([afe1f28](https://github.com/zkproofport/proofport-app/commit/afe1f28188f383b5d83675de9bf02c7945060ed8))
* silence background session reset and increase timeout to 10 minutes ([2c27f49](https://github.com/zkproofport/proofport-app/commit/2c27f4985fe8e5e7f3c88e4c5777fd0e5c80f6fe))
* track mopro_bindings/lib in git for CI builds ([4778581](https://github.com/zkproofport/proofport-app/commit/4778581d4763e8d10883089dc5c0e937d84e87e0))
* update walletconnect to 2.23.7 and YttriumWrapper to 0.10.40 ([ed7c6b0](https://github.com/zkproofport/proofport-app/commit/ed7c6b036eda245036ab179706cd372bb1663381))
* use correct package_name for staging flavor in supply ([62b712e](https://github.com/zkproofport/proofport-app/commit/62b712e07960df437478ed715178785fbcd74685))
* use noble/hashes for SHA-256 and stop merging clientId into inputs ([2c80689](https://github.com/zkproofport/proofport-app/commit/2c806891b7addf94c0a35b4075377494cbbfb03f))
* use PKCS8 key for altool upload, EC PEM for Ruby OpenSSL ([49c716b](https://github.com/zkproofport/proofport-app/commit/49c716b50c5be848be218ddafc9533f4da5154d7))
* use pod install --repo-update in CI workflows ([3a2b4fb](https://github.com/zkproofport/proofport-app/commit/3a2b4fb680ccd20f54d16a3ea9935388c8f9c876))


### Features

* add Base Mainnet fallback verifier addresses ([2e43880](https://github.com/zkproofport/proofport-app/commit/2e43880aca721cd62fdbfa8c7136dd8be325376b))
* add build scripts, fastlane configs, and AppEnv native module ([e1ff6e3](https://github.com/zkproofport/proofport-app/commit/e1ff6e3835c293bfec70f5f366ffc24cfbff578b))
* add CI/CD pipeline, version sync, and UI improvements ([a8cd764](https://github.com/zkproofport/proofport-app/commit/a8cd76459e78a1b9218ab0bf0785e728b2cc1852))
* add deep link integrity verification via inputs hash ([8e6290c](https://github.com/zkproofport/proofport-app/commit/8e6290c8aff0a9dd23b1f35f4085054a15021bcb))
* add Workload Identity auth and Play Console auto-upload ([d22b008](https://github.com/zkproofport/proofport-app/commit/d22b008b6e9fbe2d6eb4f24fe31709f9b0b7f9d2))
* auto-increment versionCode using github.run_number ([41f5304](https://github.com/zkproofport/proofport-app/commit/41f53048d3750aba80b9eb69022b2cb05bbecedd))
* **ci:** add environment selection to release workflow and fastlane match ([8b5a6a7](https://github.com/zkproofport/proofport-app/commit/8b5a6a73a7f2f9a97fd5d4e12a15831529e64139))
* download mopro binaries from GitHub Release in CI ([449d2b4](https://github.com/zkproofport/proofport-app/commit/449d2b482194dc73366cf84b26fdd8160f07748e))
* implement AboutScreen with env-aware URLs and app logo ([31808c9](https://github.com/zkproofport/proofport-app/commit/31808c94d5fc46c66accbdd3266e8fa9c38e4fb4))
* improve proof generation screen UX ([acd0f61](https://github.com/zkproofport/proofport-app/commit/acd0f61fdda492b2e07205da49c536248aefa5b7))
* update app icons with new logo on dark charcoal background ([aaf4669](https://github.com/zkproofport/proofport-app/commit/aaf46695fb4d195a3f54d1842b2db5b5b99b6836))


### Performance Improvements

* add build caching and bump versionCode to 102 ([b2ad3ff](https://github.com/zkproofport/proofport-app/commit/b2ad3ff312d9b650c0bee6077b9be63d38a34273))
