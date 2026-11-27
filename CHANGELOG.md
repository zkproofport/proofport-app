## [1.8.1](https://github.com/zkproofport/proofport-app/compare/app-v1.8.0...app-v1.8.1) (2026-11-27)


### Bug Fixes

* **proof:** name the step that prepares what the wallet signs ([559c529](https://github.com/zkproofport/proofport-app/commit/559c5296524f7410d46a53afdd23648279df79b5))

# [1.8.0](https://github.com/zkproofport/proofport-app/compare/app-v1.7.2...app-v1.8.0) (2026-11-23)


### Bug Fixes

* **proof:** show Checking wallet until the stored wallet is read ([fcd01d9](https://github.com/zkproofport/proofport-app/commit/fcd01d94b0ad8b6e74efbc01744510f0d3821cb2))
* **wallet:** keep a remembered wallet while it is used ([be163dc](https://github.com/zkproofport/proofport-app/commit/be163dc09ca710584832d10551359b30c1c30ea6))


### Features

* **sign:** ask the wallet to sign a readable proof request ([393b0e3](https://github.com/zkproofport/proofport-app/commit/393b0e346b79e1e04313a124828314711b099cd0))

## [1.7.2](https://github.com/zkproofport/proofport-app/compare/app-v1.7.1...app-v1.7.2) (2026-11-23)


### Bug Fixes

* **proof:** count any start of a dApp request as its start ([d588fba](https://github.com/zkproofport/proofport-app/commit/d588fbac4dc53d25326749ead6881368e67cf422))

## [1.7.1](https://github.com/zkproofport/proofport-app/compare/app-v1.7.0...app-v1.7.1) (2026-11-23)


### Bug Fixes

* **proof:** run one proof attempt at a time ([068a0a8](https://github.com/zkproofport/proofport-app/commit/068a0a8ec54ec708e6edbccf64c3c5a86e3d0d29))

# [1.7.0](https://github.com/zkproofport/proofport-app/compare/app-v1.6.0...app-v1.7.0) (2026-11-21)


### Bug Fixes

* **ios:** start through the scene life cycle so iOS 27 SDK builds launch ([944eb7b](https://github.com/zkproofport/proofport-app/commit/944eb7b59ce78cf37a91c779cdc4834cb9e55079))


### Features

* **history:** keep why a failed proof ended and show it in the record ([a9fb7ee](https://github.com/zkproofport/proofport-app/commit/a9fb7eeabe426b32593bfe4e9255436bed865cec))

# [1.6.0](https://github.com/zkproofport/proofport-app/compare/app-v1.5.0...app-v1.6.0) (2026-11-21)


### Features

* tell the person to approve each wallet signature in the wallet app ([70ef957](https://github.com/zkproofport/proofport-app/commit/70ef957a170afa7bf591652020f4ba08504e4d67))

# [1.5.0](https://github.com/zkproofport/proofport-app/compare/app-v1.4.0...app-v1.5.0) (2026-11-20)


### Bug Fixes

* **android:** a relay without the device-check endpoint is a service error, not E2016 ([2d619c6](https://github.com/zkproofport/proofport-app/commit/2d619c67185618d1da5284983d6b4c3f80df3613))
* **app:** an unknown circuit has no cache version, not version 0 ([4928556](https://github.com/zkproofport/proofport-app/commit/4928556dfaa4b22af76cc295e1b3404748df3078))
* **appattest:** attest a fresh key when a development key came from another build ([5b3b374](https://github.com/zkproofport/proofport-app/commit/5b3b37440b84d2c15126a65b91bad66440d05247))
* **app:** bring a new request's review in front of an ended proof attempt ([b940497](https://github.com/zkproofport/proofport-app/commit/b94049760b7fe7e0e2afcdfd1c05b326f7a2eb66))
* **app:** keep the step line out of the pulsing active circle ([9462e48](https://github.com/zkproofport/proofport-app/commit/9462e482aac278f60663da14080e17363b0fd828))
* **app:** let no circuit feature depend on Developer Mode ([e533ad8](https://github.com/zkproofport/proofport-app/commit/e533ad8f882241253d1d2936de191c8fb688173a))
* **app:** never pick a revoked Coinbase attestation to prove ([0f8a75e](https://github.com/zkproofport/proofport-app/commit/0f8a75ec945d42db00744ab9e0ed042fc38a3c4f))
* **app:** offer WalletConnect wallets only, no email or social login ([f54eed3](https://github.com/zkproofport/proofport-app/commit/f54eed3787b128b6ca211a0085b19f53ab0045a1))
* **app:** one scanned QR is one proof request ([c942123](https://github.com/zkproofport/proofport-app/commit/c942123091a5262a88ae03cfba034b2b0181c73d))
* **app:** renumber App Attest failure to E2014 (E2012 is OIDC nonce) ([36a589f](https://github.com/zkproofport/proofport-app/commit/36a589f7c9a8603c5acec322925ea6100b3e9a0a))
* **app:** show History records as stored text, never fail the list on one ([6b969cf](https://github.com/zkproofport/proofport-app/commit/6b969cf9430830129d8a6093898b06d4ab8a565e))
* **app:** show History records as stored text, never fail the list on one ([eb3e61c](https://github.com/zkproofport/proofport-app/commit/eb3e61c20c905fe9aada58b0acf2bc588c1a5049))
* **app:** show the requested condition heading once on the request screen ([33aa508](https://github.com/zkproofport/proofport-app/commit/33aa50888a8c0a3a68783d16b17cd631103154af))
* **app:** verify on-chain against core 0.2.0's pinned verifier ([91a4a30](https://github.com/zkproofport/proofport-app/commit/91a4a3003fcbc3a89ed66b562e3c75e4ade1930d))
* **build:** bundle the published SDK without a source checkout ([81c210a](https://github.com/zkproofport/proofport-app/commit/81c210a73f49f35650e404ce179ab3ded7c09200))
* **ci:** build iOS with the proving library committed beside its bindings ([909d319](https://github.com/zkproofport/proofport-app/commit/909d319dd2c15c05d2ca4e5d9ba0f26ee425289c))
* **ci:** cache mopro_bindings/node_modules in the iOS and release workflows ([ec64651](https://github.com/zkproofport/proofport-app/commit/ec64651e707875fb64afe3d8351fa09e77d18b87))
* **ci:** cache mopro_bindings/node_modules with the app's node_modules ([6fe10e4](https://github.com/zkproofport/proofport-app/commit/6fe10e4f34d2222d345c4f9d8a2e6f7eebe1d195))
* **ci:** cache mopro_bindings/node_modules with the app's node_modules ([5588afa](https://github.com/zkproofport/proofport-app/commit/5588afa5c30cc2e9fbc9ff1150f0d13933242cc5))
* **ci:** fail the Android beta when the Play credential is missing ([ff71b20](https://github.com/zkproofport/proofport-app/commit/ff71b201aa36e67188290923d810dd1cda5d6377))
* **ci:** give the iOS beta build 45 minutes ([cbfb8c1](https://github.com/zkproofport/proofport-app/commit/cbfb8c15cf22f13167cb2f0af4059b7584ae323e))
* **ci:** pass the Play credential so the Android beta reaches the internal track ([41030a6](https://github.com/zkproofport/proofport-app/commit/41030a68934e0ae253f022e33b5585a5a708a407))
* **ci:** pass the Play credential so the Android beta reaches the internal track ([8dc8dc7](https://github.com/zkproofport/proofport-app/commit/8dc8dc7764adeddc72754f8d6bce345ad6878ea9))
* **ci:** provide Node to the bundle preflight before CocoaPods ([7ad6f52](https://github.com/zkproofport/proofport-app/commit/7ad6f52fb55d4606bda37a9ad9a3de0c6ddf0c18))
* **circuits:** read file ranges through expo-file-system, not RNFS.read ([7291750](https://github.com/zkproofport/proofport-app/commit/7291750c485717cb54595f98618948ca1c3ffe43))
* **errors:** say "security check" on screen, keep the device-check reason in logs ([2d9b949](https://github.com/zkproofport/proofport-app/commit/2d9b9494d93b65830c60bcb8327b5b4104628750))
* **human-passport:** a refused chain returns to the chain picker, not the wallet picker ([1aa1e2e](https://github.com/zkproofport/proofport-app/commit/1aa1e2eecbafebada357d87902a2a9e60a9cfa3c))
* **human-passport:** answer dApp requests as standard and let the person pick the chain ([28e785d](https://github.com/zkproofport/proofport-app/commit/28e785d88f05c667fa6727ab3f2fd658ebeaf5c3))
* **ios:** raise pod deployment targets below the app minimum ([ec2aeed](https://github.com/zkproofport/proofport-app/commit/ec2aeeda4b1757e510f85d8f337a748aa2c417ee))
* **ios:** resolve signing project from the fastlane directory ([943a10f](https://github.com/zkproofport/proofport-app/commit/943a10f0fcc824c6f4ae688bf3c4291d0dc10566))
* **oidc:** retry once when Android reports an account reauth failure ([6d0499a](https://github.com/zkproofport/proofport-app/commit/6d0499ad89fc615cb08f1ea55025a5a6972e7d55))
* **openstoa-host:** hand the mini-app the topic proof's signerVariant ([fe631d1](https://github.com/zkproofport/proofport-app/commit/fe631d1b40c2445dad4dc4730ea7b0f07e1d5a70))
* **proof:** keep the progress in view and never show a cached circuit as downloading ([a7c7b57](https://github.com/zkproofport/proofport-app/commit/a7c7b57921589868b79863062af8604e0a28a4df))
* **verify:** check a History OIDC proof past the request window on the contract ([6f1175a](https://github.com/zkproofport/proofport-app/commit/6f1175af6ecf634f02361c3a02613242db19fd7f))
* **verify:** re-check a History Coinbase KYC proof past the window on the contract ([a755ae2](https://github.com/zkproofport/proofport-app/commit/a755ae2a024a11c8590806b7fe74df03ce43b9a2))
* **wallet:** read AppKit's numeric eth_chainId as a chain id ([910e58b](https://github.com/zkproofport/proofport-app/commit/910e58b85e4c046b23ccbc6f37ae1f9e19939681))
* **wallet:** show the wallet's code and message, never [object Object] ([f840d40](https://github.com/zkproofport/proofport-app/commit/f840d4012ae3f8d92f816401e7b07a80e47dad03))


### Features

* **android:** add the AndroidKeyAttestation native module ([6493913](https://github.com/zkproofport/proofport-app/commit/64939136a2eada64bc6cc35010ab8de3f121d69f))
* **android:** capture a real attestation chain and Play verdict over adb ([bb86ab9](https://github.com/zkproofport/proofport-app/commit/bb86ab9c7b6cb31a424414b5b80b35a27383c7f7))
* **android:** capture attestation from a Play-installed staging build ([ad0e72e](https://github.com/zkproofport/proofport-app/commit/ad0e72e12c3208f16fd40c811c1f841c094906dc))
* **android:** request Play Integrity tokens for factory-provisioned phones ([fe7d46b](https://github.com/zkproofport/proofport-app/commit/fe7d46b7db5feb364fbb9db3b85b4e40ce316a65))
* **app:** add the dojang_playground circuit ([f04a210](https://github.com/zkproofport/proofport-app/commit/f04a210a23641c581c2e007166ff1b82daa9f83a))
* **app:** answer every relay request exactly once ([ecbdfa7](https://github.com/zkproofport/proofport-app/commit/ecbdfa7fbe8075bf33d3303678ce738f3456c70c))
* **app:** bind Coinbase KYC revocation with Apple App Attest (prototype) ([771bdd6](https://github.com/zkproofport/proofport-app/commit/771bdd6b5359755c453173d44db8c16161fe0742))
* **app:** bind OIDC sign-in tokens to a per-request nonce ([bec5cba](https://github.com/zkproofport/proofport-app/commit/bec5cba2a604e8dc42a47775b1a9fd914aa158e7))
* **app:** forced update from a minimum-version file, and relay hash v2 ([7982944](https://github.com/zkproofport/proofport-app/commit/7982944c5e6860247c81b8ab03069664ce089c59))
* **app:** keep and copy the proof log in Developer Mode ([3c7d3d1](https://github.com/zkproofport/proofport-app/commit/3c7d3d1800d694109917d292f72d0e0c90b10422))
* **app:** make Coinbase KYC v2 the Coinbase KYC proof on iOS ([e08e00c](https://github.com/zkproofport/proofport-app/commit/e08e00ce00d24a69d96d0920afaa5a3603bfe117))
* **app:** pin one circuits tag per app version; build OIDC v2 inputs ([ae83c67](https://github.com/zkproofport/proofport-app/commit/ae83c67fea755405b8a270a76be5549294092c67))
* **app:** prove Coinbase KYC v2 and OIDC on Android with key attestation ([fe6487c](https://github.com/zkproofport/proofport-app/commit/fe6487c56bd946bd7b1bd46fd1b400182eaa5c0e))
* **app:** prove Coinbase KYC v2 with the final circuit (circuits v2.0.0-rc.1) ([40f8ff2](https://github.com/zkproofport/proofport-app/commit/40f8ff2d517d53d35a34ae80f529207d947465b4)), closes [hi#s](https://github.com/hi/issues/s)
* **app:** prove on factory-provisioned Android phones with a Play verdict ([d4210ed](https://github.com/zkproofport/proofport-app/commit/d4210ed8e9650142e1969bda9aa2b4ff0af6f522))
* **app:** show the brand-kit wordmark and keep marks in assets/brand ([3e89cac](https://github.com/zkproofport/proofport-app/commit/3e89cac33bf29ba0672709259faf3b2982d8c442))
* **app:** switch the Laboratory on and off from More ([a24362e](https://github.com/zkproofport/proofport-app/commit/a24362efb3309de3cfe70a1f23ea44f62c2ea7bd))
* **app:** verify Android proofs on their own package's contract ([79f655b](https://github.com/zkproofport/proofport-app/commit/79f655b4c260997f91c54e758d73cc281d5187e5))
* **app:** verify OIDC v2 proofs against the Base Sepolia v2 verifier ([9d5ae5c](https://github.com/zkproofport/proofport-app/commit/9d5ae5c8bcab4cc755374a4c6e298a944ba510cb))
* **circuits:** read per-platform circuit files and join a split .srs ([fc97d5e](https://github.com/zkproofport/proofport-app/commit/fc97d5e4ad6f91c806bfab98ff0e3f958d11dfce))
* **circuits:** read the Android packages from circuits 8fad8da ([0c771c6](https://github.com/zkproofport/proofport-app/commit/0c771c6897134a8681d5e1882cdfda2ed9e91de1))
* **config:** name the Base mainnet verifiers in production builds ([bdcdf91](https://github.com/zkproofport/proofport-app/commit/bdcdf918e7157e6594f3f67b66091f1e70be4353))
* core 0.4.0-beta.9, circuits v3.0.0-rc.1, bb 6.0.0 testnet verifiers ([e3ffdc9](https://github.com/zkproofport/proofport-app/commit/e3ffdc9e88e5fea7a5d3e9b2e96edb280ebc7eea))
* **country:** prove Coinbase Country v2 with the device statement and an optional action ([b8085e8](https://github.com/zkproofport/proofport-app/commit/b8085e8eca608c4f358bc1a154506a116d6bea4f))
* **country:** read Coinbase Country v2 files from circuits 75bec01 ([8a44c93](https://github.com/zkproofport/proofport-app/commit/8a44c932296c4943e326764c579eb0ace6619aa0))
* **country:** verify Coinbase Country v2 on its deployed contracts through core 0.4.0-beta.2 ([abe4743](https://github.com/zkproofport/proofport-app/commit/abe474375588df8e029f7694c11dc065bd1b9a6f))
* **human-passport:** choose the chain the score was recorded on ([7f2444c](https://github.com/zkproofport/proofport-app/commit/7f2444c928f0c4c1669821dc82e844abb9b20839))
* **human-passport:** look up scores on the six chains Passport offers ([97ab0ea](https://github.com/zkproofport/proofport-app/commit/97ab0eaca51afca846e31e4bd6f29e0d2c31114e))
* **human-passport:** prove a Human Passport score on the Proof tab and for dApp requests ([4a45261](https://github.com/zkproofport/proofport-app/commit/4a45261733975f649839d95eb811f4caeec5593f))
* **oidc:** sign the provider-key statement with App Attest ([91a8617](https://github.com/zkproofport/proofport-app/commit/91a86179547435a37a19e7d5746e35ea4f3e7e53))
* OPRF nullifier, wallet-free signal_hash, Noir 1.0.0 circuits ([8995983](https://github.com/zkproofport/proofport-app/commit/89959839b1fe96985c0f17c32755629a5d8ba02b))
* **proof:** fetch circuit files with the proof and prove off the JS thread ([449d19b](https://github.com/zkproofport/proofport-app/commit/449d19b5b0fcbdbc9f160d2e381b6a5187a7b1de))
* read circuits 2181748; request circuit is oprf_request_auth ([71bd91a](https://github.com/zkproofport/proofport-app/commit/71bd91abf811bae3b3fe9cb58c408d1bba156a7f))
* read OPRF and OIDC circuits from ddf11f0, rebuilt bindings ([82ef1d8](https://github.com/zkproofport/proofport-app/commit/82ef1d863bbd332aa94da3514e08bf4fc7bc956a))
* **relay:** answer device-check failures with a neutral reason code ([b294f36](https://github.com/zkproofport/proofport-app/commit/b294f36baa76ba6d3fef72f399a7a175bff0dc05))


### Performance Improvements

* **oidc:** read the circuit ABI from the head of the file ([71931fb](https://github.com/zkproofport/proofport-app/commit/71931fb5d6e51565ab8c36707eebb6cb0cdc42bd))
* **proof:** count a circuit's public inputs once per file; name the step honestly ([4fa3b83](https://github.com/zkproofport/proofport-app/commit/4fa3b83df0e7c13b91b796c6a31c199feb6d1475))

## [1.3.1](https://github.com/zkproofport/proofport-app/compare/app-v1.3.0...app-v1.3.1) (2026-09-04)


### Bug Fixes

* **android:** derive the version code from the version, not the run counter ([b341cb8](https://github.com/zkproofport/proofport-app/commit/b341cb887f5698106c5e5e9a44bbc2020a9a22b8))

# [1.3.0](https://github.com/zkproofport/proofport-app/compare/app-v1.2.2...app-v1.3.0) (2026-09-04)


### Bug Fixes

* **release:** the pipeline must hold the permissions it calls with ([86cd45d](https://github.com/zkproofport/proofport-app/commit/86cd45d1379d1c55b1abb75692eaacdbbb7458fb))


### Features

* **release:** one run that decides the version, tags it, and ships it ([aaef596](https://github.com/zkproofport/proofport-app/commit/aaef59626ff1e4ef5397baf32fb829b8263bcc22))

## [1.4.0](https://github.com/zkproofport/proofport-app/compare/app-v1.3.1...app-v1.4.0) (2026-09-23)


### Features

* add Arc action proofs and unify wallet networks ([3882e38](https://github.com/zkproofport/proofport-app/commit/3882e3879dc75a085d841c839d5c3e17dbb9725f))
* build an action for any circuit that can bind one ([de4029a](https://github.com/zkproofport/proofport-app/commit/de4029ab663344f1904a7322373a7420a749705e))
* connect mobile topic proofs and synchronize Korean UI ([d27a840](https://github.com/zkproofport/proofport-app/commit/d27a840c54343848fff22279208125031b50a168))
* read the action rule from the published SDK ([15f0c60](https://github.com/zkproofport/proofport-app/commit/15f0c60c7f745dd54aafb879daa75937671681ca))
* redesign proof review wallet history and settings flows ([aecdf3e](https://github.com/zkproofport/proofport-app/commit/aecdf3e969c5f00fe68d464fe0870deb1eb8d4b2))
* sign an optional EIP-712 action for giwa and arc proofs ([3adcc03](https://github.com/zkproofport/proofport-app/commit/3adcc03d3ffa931f834ee27fe50fc6cfed911a69))


### Bug Fixes

* keep circuit downloads aligned with verified release sources ([3fbf8d6](https://github.com/zkproofport/proofport-app/commit/3fbf8d666b15a0d14635ec3b5a89e817f84a33cf))
* keep giwa and arc action proofs aligned in production ([c4f1d6a](https://github.com/zkproofport/proofport-app/commit/c4f1d6a1e23042072351e5391ebb16a085392ce6))
* pin the app to the synchronized OpenStoa mobile source ([e78d944](https://github.com/zkproofport/proofport-app/commit/e78d944daac63116f3d88925188d888570ae573a))
* **scripts:** sign from the base64 key, so no .p8 has to sit anywhere ([bd82021](https://github.com/zkproofport/proofport-app/commit/bd820216e163a21251860598568b0e8ccdb5bf16))

## [1.2.2](https://github.com/zkproofport/proofport-app/compare/app-v1.2.1...app-v1.2.2) (2026-09-04)


### Bug Fixes

* **release:** split the version bump from the build, and never ship on merge ([44cc605](https://github.com/zkproofport/proofport-app/commit/44cc605a9faa559d595499d7f36429cf083ae6ad))
* **release:** tag after the builds, one release at a time ([470e564](https://github.com/zkproofport/proofport-app/commit/470e564a8573f90f9cb9e9ea2a6b4e1e00d693a6)), closes [#4103](https://github.com/zkproofport/proofport-app/issues/4103)

## [1.2.1](https://github.com/zkproofport/proofport-app/compare/app-v1.2.0...app-v1.2.1) (2026-09-04)


### Bug Fixes

* **release:** hand the version to the build jobs instead of making them find it ([ff6a60a](https://github.com/zkproofport/proofport-app/commit/ff6a60a0ec034734b0ada82ea2a9b48aab275597))

# [1.2.0](https://github.com/zkproofport/proofport-app/compare/app-v1.1.0...app-v1.2.0) (2026-09-04)


### Bug Fixes

* **release:** build the tag semantic-release just made, not the branch tip ([35fe961](https://github.com/zkproofport/proofport-app/commit/35fe961e95bebe45dffc185824e29432c19ed661))


### Features

* **scripts:** read TestFlight builds, and refuse an argument it does not know ([e5d0d86](https://github.com/zkproofport/proofport-app/commit/e5d0d860527c3c6ea331748f8f38afbbea3e0f73))

# [1.1.0](https://github.com/zkproofport/proofport-app/compare/app-v1.0.1...app-v1.1.0) (2026-09-04)


### Bug Fixes

* **app:** derive circuit paths from the SDK's key FILE, not its directory ([d0b6339](https://github.com/zkproofport/proofport-app/commit/d0b63395b266bed7e5f7b74d4c0c68bcb32a2031))


### Features

* **app:** take verification key paths from the SDK, and fix the GIWA icon ([0fae4f5](https://github.com/zkproofport/proofport-app/commit/0fae4f511127b1abc9a71f0fef137122583c2e01))

## [1.0.1](https://github.com/zkproofport/proofport-app/compare/app-v1.0.0...app-v1.0.1) (2026-09-03)


### Bug Fixes

* **ci:** bump the OpenStoa pin past the passkey switch ([4306945](https://github.com/zkproofport/proofport-app/commit/43069450cd27400f3e5b0c0e5ee3c0b3a18f34f9))
* **deeplink:** a cold-start mDL link no longer loses its navigation ([a090524](https://github.com/zkproofport/proofport-app/commit/a0905245c32371ed7e16a11ea5d66d9966dca816))
* **release:** make the tag history describe what actually shipped ([e84561c](https://github.com/zkproofport/proofport-app/commit/e84561c89435f9fdf4ea4932699a822c6462fba1))


### Reverts

* Revert "chore(release): 1.6.0" ([13fcf55](https://github.com/zkproofport/proofport-app/commit/13fcf55f70aad070ec9dc6063c1babef6a01601b))

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
