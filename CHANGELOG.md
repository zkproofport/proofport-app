# [1.6.0](https://github.com/zkproofport/proofport-app/compare/app-v1.5.2...app-v1.6.0) (2026-09-03)


### Bug Fixes

* **android:** an offline circuit download no longer kills the app ([97d3cb6](https://github.com/zkproofport/proofport-app/commit/97d3cb6c1bc86f84943049263494a83302048408))
* **android:** CI fetches the shared library the build actually links ([37c1849](https://github.com/zkproofport/proofport-app/commit/37c18495c968d8ce5f199a994534c7b227154060))
* **android:** keep the proving library in the repository ([9db5bb9](https://github.com/zkproofport/proofport-app/commit/9db5bb9b48f372130071179dafb1c71b7287b40e))
* **app:** a failed circuit download is no longer silent ([8b2c99c](https://github.com/zkproofport/proofport-app/commit/8b2c99ce4b33b172da8cab3537124342313c0e11))
* **ci:** abandon the Play edit with DELETE, and never let cleanup decide the verdict ([b8b4b32](https://github.com/zkproofport/proofport-app/commit/b8b4b320f5f86d3a630e0047e78422be06cb8fb6))
* **ci:** build from the lockfile instead of re-resolving every range ([610bd6f](https://github.com/zkproofport/proofport-app/commit/610bd6f293828882e0ce7d9cc2da544b4605286e))
* **ci:** commit the lockfile so every install is reproducible ([3492033](https://github.com/zkproofport/proofport-app/commit/34920330392b5153573128407aaeaabc2055a2c3))
* **ci:** drop the Google Cloud auth step that only ever failed ([77afb07](https://github.com/zkproofport/proofport-app/commit/77afb071db3a326bb40f35050fd7d39e5e61110c))
* **ci:** hand Play the service-account json, not a path to it ([089ddaf](https://github.com/zkproofport/proofport-app/commit/089ddaf019588f5b8ac03f5434a76e82ba932f6e))
* **ci:** name the repo when downloading the prebuilt proving library ([178d757](https://github.com/zkproofport/proofport-app/commit/178d757da906792c0b5778995cefada46ccb6c57))
* **ci:** the listing workflow runs from the repo root, not a subdirectory ([fa707df](https://github.com/zkproofport/proofport-app/commit/fa707df45926068d49b77371dcfe724122c9d55c))
* **deeplink:** a cold-start mDL link no longer loses its navigation ([1aa67a6](https://github.com/zkproofport/proofport-app/commit/1aa67a659cafdc6ce50cacacc899ec41f68be43b))
* **deeplink:** only hand the user back when another app is waiting ([7427ce9](https://github.com/zkproofport/proofport-app/commit/7427ce947f9127b77eb9d29c3985b5384ef39b09))
* **deps:** pin expo-image-picker to the SDK 54 line ([912441b](https://github.com/zkproofport/proofport-app/commit/912441b409c352e6039b4cccd0fbac08b71883af))
* **giwa:** wallet gate retry-loop guard + chunked eth_getLogs attestation search + MockGiwaAttester rename ([aa11437](https://github.com/zkproofport/proofport-app/commit/aa114373cd5b567d83dece96fbb2b682b4888ffd))
* **i18n:** every error and screen speaks Korean ([4bdcce7](https://github.com/zkproofport/proofport-app/commit/4bdcce7d012bead6ee7d79658899820a99c665a7))
* **i18n:** the host's copy of the mini-app wording had drifted, and it ships ([51e1ada](https://github.com/zkproofport/proofport-app/commit/51e1adabb4b80bd6ae2708697a3a93fa2f7c9928))
* **i18n:** the launch screen greets a Korean phone in Korean ([c0eacdc](https://github.com/zkproofport/proofport-app/commit/c0eacdcb5f09281110540d67462b3db1c8872314))
* **i18n:** the leaving warning said the opposite of what happens ([a3fa6f2](https://github.com/zkproofport/proofport-app/commit/a3fa6f2ed010b5b4973b0ba180bb6669f28cfa34))
* **ios:** build on macos-26 so Apple accepts the upload ([9f847e8](https://github.com/zkproofport/proofport-app/commit/9f847e8c137041f4b8182dbc82f7fb5f284c1524))
* **ios:** explain the location APIs the app links but never calls ([8c4ef24](https://github.com/zkproofport/proofport-app/commit/8c4ef2436ad1935eee65d8fe84d53bd738c50de3))
* **ios:** let the Xcode 26 header patch write to a cached file ([a6e7b86](https://github.com/zkproofport/proofport-app/commit/a6e7b86e0cc18c41ab6a7e864c3b2a75fb7b891b))
* **ios:** name the signing branch instead of inheriting master ([6e86d6c](https://github.com/zkproofport/proofport-app/commit/6e86d6c0c12e8f49005c258a2d503c476e70fb6f))
* **ios:** point signing at one repository named after this app ([b7be85b](https://github.com/zkproofport/proofport-app/commit/b7be85bb57e9e48b78de90bfb9c46e8d37f1f913))
* **ios:** tell iOS the app has Korean, so Korean phones get it ([d56f6f7](https://github.com/zkproofport/proofport-app/commit/d56f6f7348bce70bf49d2c49e6f6781c1025cb0f))
* **legal:** drop Privy from the policy — the SDK is gone, only the hook name remains ([d393241](https://github.com/zkproofport/proofport-app/commit/d393241c6015663620c498e0e3048afcdd2496be))
* **legal:** put the privacy policy back where its App Store URL points ([b568ccd](https://github.com/zkproofport/proofport-app/commit/b568ccddf6c6538948ffee0112c0695e5907476a))
* **mdlKr:** drop phantom expected_* fields from ownership flatten ([f2c320d](https://github.com/zkproofport/proofport-app/commit/f2c320d9880b86c276383a33d6c9073d9a3ffb7f))
* **mdlKr:** i18n the input screen + rename "disclose" → "prove" ([bed3914](https://github.com/zkproofport/proofport-app/commit/bed391454a55664832a3b0ae915994fc604a2836))
* **mdl:** open the mobile ID app on Android, on both OACX paths ([7699d2d](https://github.com/zkproofport/proofport-app/commit/7699d2d2b7be0f7cfa6b98a9fe86c34697cda3bc))
* **more:** the history switch says what it does, and is tested ([58180f9](https://github.com/zkproofport/proofport-app/commit/58180f9b819ef286cf4c5ca25980e9be977c14d6))
* **nav:** the OpenStoa tab badge has room for 99+ ([9900529](https://github.com/zkproofport/proofport-app/commit/99005293b308f02b3f1b989ff3bb32a1b41efc95))
* **oacx:** supply all required widget keys + stop auto-launching mDL app ([0ac6dd9](https://github.com/zkproofport/proofport-app/commit/0ac6dd9097e1077af4bb86cef1ad0e0d185c3fc4))
* **oidc:** remove .onmicrosoft.com test-tenant xms_edov bypass ([16b5718](https://github.com/zkproofport/proofport-app/commit/16b5718ef7840c1b6ecef56b7e407ea4c4f484ac))
* **openstoa-host:** drop cookies + honor LOGGED_OUT marker ([87d3f2d](https://github.com/zkproofport/proofport-app/commit/87d3f2dd8e8f2ca402ab713056ba9da0c5672fa9))
* **openstoa-host:** unregister push before revoking the session ([c175d14](https://github.com/zkproofport/proofport-app/commit/c175d149c99f4666b08d1f810a454def18b59f05))
* **openstoa:** show the mini-app's errors, and act on a delivered push ([df159aa](https://github.com/zkproofport/proofport-app/commit/df159aa0c718676abef77bd7c64edc0b548b8099))
* **passkey:** recovery follows the build's environment, not a fixed staging domain ([8638a85](https://github.com/zkproofport/proofport-app/commit/8638a854d8086791635621b0ec998d4cb26c3bd8))
* **play:** images live under listings/, not an images/ collection ([f7f6199](https://github.com/zkproofport/proofport-app/commit/f7f619982035b0e3780b94148b4fb0577bbec73d))
* **play:** retake the More shot with no clipped row ([0973675](https://github.com/zkproofport/proofport-app/commit/0973675fab7e32a1deb503ec1953696ffdd43bf6))
* **play:** the read-back check looked at the wrong path too ([10e3e72](https://github.com/zkproofport/proofport-app/commit/10e3e7298e799417bf75a4683558cd994f6447eb))
* **play:** upload as a draft release, because the app is still a draft ([092fd1d](https://github.com/zkproofport/proofport-app/commit/092fd1d246442396bd8188a5675e22613098f933))
* **play:** upload the listing via the Play API, not supply ([bca7090](https://github.com/zkproofport/proofport-app/commit/bca7090ba533ea4cd9478a7d110b3e5e48c0deea))
* **proof-request:** the screen that asks for consent speaks the user's language ([64f6a1c](https://github.com/zkproofport/proofport-app/commit/64f6a1c6d8dd1161a5f0b614eb23c3033515a40e))
* **push:** declare the chat notification channel before registering ([2392a12](https://github.com/zkproofport/proofport-app/commit/2392a12d543e950d581c7fb2152a90abe0f19527))
* **push:** let an Android emulator register, because it can ([1659ee1](https://github.com/zkproofport/proofport-app/commit/1659ee13b8aea5dcd8a64b86ddaa96fa2001d764))
* **push:** register the raw FCM token on Android ([e182f8e](https://github.com/zkproofport/proofport-app/commit/e182f8e8023f95de27a8371f1419d1d6f43b1ed3))
* **release:** the upload said nothing, then named a package that is never built ([85ed82c](https://github.com/zkproofport/proofport-app/commit/85ed82c12d884a62a8bde22e12ecdf60447f29f1))
* **settings:** delete the language field nothing read, and pin the real one ([295d1d9](https://github.com/zkproofport/proofport-app/commit/295d1d967a3ec1cd86842a4891b4257403b39606))
* upload Android builds to alpha track instead of internal ([60913ba](https://github.com/zkproofport/proofport-app/commit/60913ba7a679f8eb41efad18eadd5fc912319c0c))


### Features

* **app:** hand control back the way each platform actually allows ([17be439](https://github.com/zkproofport/proofport-app/commit/17be43990777768aaab793fb939516fd9996fff7))
* **app:** Korea mDL on-device proving + OpenStoa login flow ([a10da88](https://github.com/zkproofport/proofport-app/commit/a10da884cc86b43661079c2dc08e74044034a00d))
* **app:** verify downloaded circuit files before using them ([391fff5](https://github.com/zkproofport/proofport-app/commit/391fff5a02bff5dfd539d391ad8ba72b99523bb0))
* **ci:** a workflow that uploads the store listing and nothing else ([b97b70a](https://github.com/zkproofport/proofport-app/commit/b97b70acd8d8c3c9a897ccdef19eca1912621b21))
* **ci:** report the Play listing's current languages instead of asking ([c91a830](https://github.com/zkproofport/proofport-app/commit/c91a83019f6d0e55c4e9036be49e4b66d1aee825))
* **config:** OPENSTOA_ENABLED comes from the build, with a developer override ([9f446c8](https://github.com/zkproofport/proofport-app/commit/9f446c8b75d8fdd7c2ca045cbf26c3751a1c51b7))
* **giwa:** GIWA KYC (Experimental) circuit integration + per-circuit wallet cache ([bc9d974](https://github.com/zkproofport/proofport-app/commit/bc9d974ba374e44cc0930a8d865bd71713a096f9))
* **host:** host OpenStoa mini-app + rebrand to ZKProofport ([76cba52](https://github.com/zkproofport/proofport-app/commit/76cba52ebeafc15de577e62ba93e96a636a0d1cf))
* **host:** OpenStoa on/off build flag; restore History tab when disabled ([ac53046](https://github.com/zkproofport/proofport-app/commit/ac530467957c32dd21c11659fda1db0dcd0a7d09))
* **host:** OpenStoa on/off build flag; restore History tab when disabled ([47a25c0](https://github.com/zkproofport/proofport-app/commit/47a25c0ddbc286d0b438cce30521b137fd766341))
* **host:** reorder tabs, promote Wallet, move History into More ([e2781fa](https://github.com/zkproofport/proofport-app/commit/e2781fa8282ec37e49a863661a32c0a97a370180))
* keyboard/modal UX policy, mDL Android .so, iOS fmt patch, dev mode bridge ([42c3bba](https://github.com/zkproofport/proofport-app/commit/42c3bbad9f83013fa68ef3889a3476d8af58bb1d))
* **mdl_kr_ownership:** expected-value matching UI + circuit v2 wiring ([e62fdce](https://github.com/zkproofport/proofport-app/commit/e62fdcedd171e27dde8aab4c925630676f131b37))
* **mdl_kr:** v4 OIDC-style nullifier + OACX WebView + global InAppBrowser ([c56e418](https://github.com/zkproofport/proofport-app/commit/c56e418f167707adacd27e2c07e1ffacbdaa34e1))
* **mobile:** install react-native-keyboard-controller for unified keyboard toolbar (iOS + Android) ([3d5ca0f](https://github.com/zkproofport/proofport-app/commit/3d5ca0f88f7796dad579fdd350fb9fd78637850f))
* **mopro:** carry the iOS proving library too, through Git LFS ([7db5871](https://github.com/zkproofport/proofport-app/commit/7db58710712c0570fdf0341e9fb85859b1001703))
* **oacx:** parse widget token + Developer-Mode CX-UI toggle ([2809bac](https://github.com/zkproofport/proofport-app/commit/2809bac59323d48d15c8139c4bc1da6f66e3d896))
* **openstoa-host:** honour the mini-app's request deadlines ([c042809](https://github.com/zkproofport/proofport-app/commit/c0428093bd2e904416b3270c087199208cf71308))
* **openstoa:** enable mini-app E2EE chat — crypto polyfill, local dev, dev-login ([5eb13d1](https://github.com/zkproofport/proofport-app/commit/5eb13d103d3f7df99e58ba23c6027b3bd0ef080c))
* **openstoa:** host secure/local store + production crypto polyfill for MLS chat ([b15c55b](https://github.com/zkproofport/proofport-app/commit/b15c55b59f73156141d05177c2769ce798d3cf7b))
* **openstoa:** Phase 4 host wiring — passkey PRF bridge + dev baseUrl via getDevServer; enable OpenStoa mini-app by default ([27e468c](https://github.com/zkproofport/proofport-app/commit/27e468c1a083b9283aefd474214b980cd48c73bf))
* **openstoa:** Phase 6 host push registration bridge (registerForPush) ([60828da](https://github.com/zkproofport/proofport-app/commit/60828dab3d8200d597798a639c6248792b471a1a))
* **openstoa:** Phase 7 push B scaffold — iOS NSE + Keychain access group + Android FCM handler (device build pending) ([306ca4d](https://github.com/zkproofport/proofport-app/commit/306ca4da84edac6c8cb662bfa3d4eab4f106ebf3))
* **openstoa:** push delivery — expo-notifications registerForPush + tap handler + NSE native integration ([68dcb56](https://github.com/zkproofport/proofport-app/commit/68dcb567997d549b08c9bf00bb22a04b3969181c))
* **passkey:** switch recovery off in both clients until it works everywhere ([a761a04](https://github.com/zkproofport/proofport-app/commit/a761a04a9a9b6aec79bc92867de14873457ce01b))
* **play:** a fastlane lane that uploads the store listing without a build ([8747b26](https://github.com/zkproofport/proofport-app/commit/8747b26dd31aefb09b35bf63408a5a209b6a98e3))
* **play:** set the contact email and website, never the phone ([c913e18](https://github.com/zkproofport/proofport-app/commit/c913e18a26f36006949250a5426855a92c42fe65))
* **play:** the store listing, in both languages, within Google's limits ([94c9856](https://github.com/zkproofport/proofport-app/commit/94c985650ff219c2bdf0d3d9f92ba56cdb741570))
* **play:** upload store screenshots with the listing text ([9d52b4d](https://github.com/zkproofport/proofport-app/commit/9d52b4d0dd4de0bcfb777d2ee7d0ab514c24cfd0))
* **poc:** Phase 0 MLS round-trip + passkey PRF harness ([08e7bd0](https://github.com/zkproofport/proofport-app/commit/08e7bd092537261189e22bd67a67cb437912eb5a))
* **push:** clear a conversation's notifications when it is opened ([0b6fc74](https://github.com/zkproofport/proofport-app/commit/0b6fc7470c13c7fdfcb33fa7e4f00a02565401cf))
* **push:** decrypt an attachment for the notification preview ([edd1596](https://github.com/zkproofport/proofport-app/commit/edd1596d1a12611650a7086ba8e67d3e4b31b2f5))
* **push:** iOS NSE preview, Android FCM handler, tap routing ([50b3c90](https://github.com/zkproofport/proofport-app/commit/50b3c9004b2dfebdce0c1b354285e4af2554b6f6))
* **testflight:** the tester note lives in the repo, not the console ([3e3e920](https://github.com/zkproofport/proofport-app/commit/3e3e920d74dfd4685af0714a151fe3cd5530984a))
* **wallet:** per-circuit binding at connect, status pills + actions ([e2f7c48](https://github.com/zkproofport/proofport-app/commit/e2f7c48ed12cf827ad1e2c2dd6f6030e16f66c08))
* **webview:** unify host InAppBrowser with mini-app + toolbar + progress bar ([5517205](https://github.com/zkproofport/proofport-app/commit/551720524f5a894e32654d96225e7cdc8fe13a73))

## [1.5.2](https://github.com/zkproofport/proofport-app/compare/app-v1.5.1...app-v1.5.2) (2026-03-27)


### Bug Fixes

* change camera permission button text 'Allow Camera' → 'Continue' (App Store 5.1.1) ([de9b20b](https://github.com/zkproofport/proofport-app/commit/de9b20bbd1ae1c3573712917c5f0e6a1316bb84c))

## [1.5.1](https://github.com/zkproofport/proofport-app/compare/app-v1.5.0...app-v1.5.1) (2026-03-25)


### Bug Fixes

* prevent infinite loading on fresh install (App Store review rejection) ([0b13395](https://github.com/zkproofport/proofport-app/commit/0b1339567c57491b5cc762f8c92166eaa1b9715b))

# [1.5.0](https://github.com/zkproofport/proofport-app/compare/app-v1.4.1...app-v1.5.0) (2026-03-23)


### Features

* make OIDC domain optional — auto-extract from JWT email ([1758818](https://github.com/zkproofport/proofport-app/commit/17588185c64913dec5b6cb0ae47fcb7e240a5534))

## [1.4.1](https://github.com/zkproofport/proofport-app/compare/app-v1.4.0...app-v1.4.1) (2026-03-19)


### Bug Fixes

* restore APP_ID_SUFFIX handling in production flavor for Play Console ([130204f](https://github.com/zkproofport/proofport-app/commit/130204f5089d50384ba3c7578b5c20ce104dd135))

# [1.4.0](https://github.com/zkproofport/proofport-app/compare/app-v1.3.1...app-v1.4.0) (2026-03-19)


### Features

* add staging environment, development flavor, fix release workflow ([c16be1b](https://github.com/zkproofport/proofport-app/commit/c16be1b109165f6b57f804a740325161d61cfa0f))

## [1.3.1](https://github.com/zkproofport/proofport-app/compare/app-v1.3.0...app-v1.3.1) (2026-03-19)


### Bug Fixes

* bump Android versionCode offset to 2000 for release builds ([3fcbb49](https://github.com/zkproofport/proofport-app/commit/3fcbb49dc0af03ff19f11df6dcea20bb6afb26cf))
* restore Android BUILD_NUMBER with +100 offset for release builds ([b64c52c](https://github.com/zkproofport/proofport-app/commit/b64c52c8701b804af9d7de617a5f2f6fe23b4679))

# [1.3.0](https://github.com/zkproofport/proofport-app/compare/app-v1.2.0...app-v1.3.0) (2026-03-19)


### Features

* bump version to 1.2.0, fix release build number collision ([9ee3f89](https://github.com/zkproofport/proofport-app/commit/9ee3f8913975aebeb273fdf58cbc0b8899637b79))

# [1.2.0](https://github.com/zkproofport/proofport-app/compare/app-v1.1.1...app-v1.2.0) (2026-03-19)


### Bug Fixes

* bump CIRCUIT_DATA_VERSION to 3, add MS auth redirect URI logging ([51b5af3](https://github.com/zkproofport/proofport-app/commit/51b5af313344e5796624e8da0e8cb416380ade00))
* lazy load expo-auth-session to prevent Release build crash on non-OIDC screens ([7fd4e16](https://github.com/zkproofport/proofport-app/commit/7fd4e165c2961714b4d09e75e584614c6fe79397))
* move makeRedirectUri outside hook to prevent Release build crash ([1b43b5b](https://github.com/zkproofport/proofport-app/commit/1b43b5be9d33338b0ec0a02ea1944628eda6272f))
* sync package.json walletconnect version to 2.23.8 ([49f3aff](https://github.com/zkproofport/proofport-app/commit/49f3aff8917ebc3063e274177542af526a8bb184))
* update YttriumWrapper to 0.10.50 (react-native-compat 2.23.8) ([7bb9a64](https://github.com/zkproofport/proofport-app/commit/7bb9a6463c39329d06e96429b0d1faa1fc9e5a25))
* use explicit redirect URI for Microsoft auth, add debug logging ([0258fde](https://github.com/zkproofport/proofport-app/commit/0258fde34f2563bf8bc53adb028f94405bba904d))


### Features

* add email_verified check, hd workspace verification, provider UI ([5aea9f1](https://github.com/zkproofport/proofport-app/commit/5aea9f1f97496b873c8ab32f05277baac37f5f1a))
* add Microsoft 365 OIDC provider for organization membership verification ([0512be9](https://github.com/zkproofport/proofport-app/commit/0512be994663aa658d0bd628614316806216f1c4))
* implement OIDC domain attestation on-device proof generation ([d8521ca](https://github.com/zkproofport/proofport-app/commit/d8521ca220fb3b89d9d75e58203b1174424a7017))
* per-circuit data versions, Android MSAL redirect, improved error handling ([9b0cf75](https://github.com/zkproofport/proofport-app/commit/9b0cf750f7eeacf15d0bc09bda28f25c1e286415))
* show domain instead of wallet address in OIDC proof request modal ([48126d9](https://github.com/zkproofport/proofport-app/commit/48126d98dc5ad9f5c33c48403113ae74c6875445))

## [1.1.1](https://github.com/zkproofport/proofport-app/compare/app-v1.1.0...app-v1.1.1) (2026-03-07)


### Bug Fixes

* increase Android BUILD_NUMBER offset in release-app workflow ([7d7ea6f](https://github.com/zkproofport/proofport-app/commit/7d7ea6fa894b286f7495d5d4cd213e9e6eaad190))
* increase Android versionCode offset to 1000 ([2605297](https://github.com/zkproofport/proofport-app/commit/2605297d9f1ea896695c29a06b54387469260681))

# [1.1.0](https://github.com/zkproofport/proofport-app/compare/app-v1.0.2...app-v1.1.0) (2026-03-07)


### Bug Fixes

* use production flavor with APP_ID_SUFFIX for Android release ([a3a9ccd](https://github.com/zkproofport/proofport-app/commit/a3a9ccd7293557382a6378f47d92e8aa717488f0))
* use staging flavor with production config for Android release ([422da46](https://github.com/zkproofport/proofport-app/commit/422da46667cdaf4d8602993ecd7290cd513edb0e))


### Features

* add app_env override for staging flavor Android builds ([ef61934](https://github.com/zkproofport/proofport-app/commit/ef619346d5756c39cb9dde3f8705569197fdc939))

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
