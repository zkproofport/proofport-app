import UIKit
import Expo
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    print("🔵 AppDelegate: didFinishLaunchingWithOptions started")

    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)

    window = UIWindow(frame: UIScreen.main.bounds)
    print("🔵 AppDelegate: Window created with frame: \(UIScreen.main.bounds)")

    factory.startReactNative(
      withModuleName: "zkProofPort",
      in: window,
      launchOptions: launchOptions
    )

    print("🔵 AppDelegate: React Native started with module: zkProofPort")
    print("🔵 AppDelegate: Window visible: \(window?.isHidden == false)")

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Deep link handling - URL Scheme
  override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    print("🔵 AppDelegate: Deep link received - \(url.absoluteString)")
    return RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links handling
  override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    print("🔵 AppDelegate: Universal link received")
    return RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // TODO: Disable Bridgeless mode for MetaMask SDK compatibility
  // Temporarily commented out to test if this is causing the crash
  // override func bridgelessEnabled() -> Bool {
  //   return false
  // }

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    print("🔵 ReactNativeDelegate: sourceURL called")
    let url =    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
    print("🔵 ReactNativeDelegate: sourceURL = \(url?.absoluteString ?? "nil")")
    return url
  }

  override func bundleURL() -> URL? {
    print("🔵 ReactNativeDelegate: bundleURL called")
#if DEBUG
    // Try RCTBundleURLProvider first
    var url = RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")

    // If nil, create URL directly with Mac's IP (for physical device debugging)
    if url == nil {
      print("🔵 ReactNativeDelegate: RCTBundleURLProvider returned nil, using IP fallback")
      // Use Mac's IP address for physical device - update this if IP changes
      url = URL(string: "http://10.78.14.37:8081/index.bundle?platform=ios&dev=true&minify=false")
    }

    print("🔵 ReactNativeDelegate: DEBUG bundle URL = \(url?.absoluteString ?? "nil")")
    return url
#else
    let url = Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    print("🔵 ReactNativeDelegate: RELEASE bundle URL = \(url?.absoluteString ?? "nil")")
    return url
#endif
  }
}
