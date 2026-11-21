import UIKit
import Expo
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  // React Native reads application.delegate.window (RCTDeviceInfo, on every
  // orientation change); SceneDelegate sets it.
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

    // The window and React Native start in SceneDelegate.
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

// Apps built with the iOS 27 SDK are stopped at launch unless they use the
// scene life cycle, so the window and React Native start here, and links that
// arrive through the scene are handed to the app delegate's handlers above.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else {
      return
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window

    // A link that cold-starts the app arrives here, not in the app delegate's
    // launch options; Linking.getInitialURL reads it from these.
    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let url = connectionOptions.urlContexts.first?.url {
      launchOptions[.url] = url
    } else if let activity = connectionOptions.userActivities.first(where: { $0.activityType == NSUserActivityTypeBrowsingWeb }) {
      launchOptions[.userActivityDictionary] = [
        UIApplication.LaunchOptionsKey.userActivityType: activity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": activity,
      ] as [AnyHashable: Any]
    }

    factory.startReactNative(
      withModuleName: "ZKProofport",
      in: window,
      launchOptions: launchOptions.isEmpty ? nil : launchOptions
    )
    print("🔵 SceneDelegate: React Native started with module: ZKProofport")
  }

  // zkproofport:// links while the app runs.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    for context in URLContexts {
      _ = appDelegate.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  // Universal links while the app runs.
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    _ = appDelegate.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  /// Get the host machine's local IP address for physical device debugging
  static func getHostIPAddress() -> String? {
    var address: String?
    var ifaddr: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&ifaddr) == 0, let firstAddr = ifaddr else { return nil }
    defer { freeifaddrs(ifaddr) }

    for ptr in sequence(first: firstAddr, next: { $0.pointee.ifa_next }) {
      let sa = ptr.pointee.ifa_addr.pointee
      guard sa.sa_family == UInt8(AF_INET) else { continue }
      let name = String(cString: ptr.pointee.ifa_name)
      guard name == "en0" || name == "en1" else { continue }
      var addr = ptr.pointee.ifa_addr.pointee
      var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
      if getnameinfo(&addr, socklen_t(sa.sa_len), &hostname, socklen_t(hostname.count), nil, 0, NI_NUMERICHOST) == 0 {
        address = String(cString: hostname)
        break
      }
    }
    return address
  }

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
    // Prefer an embedded dev bundle if one was packaged in (Metro-independent
    // PoC builds — avoids the LAN-IP churn that breaks the Metro connection).
    // A normal dev build has no embedded main.jsbundle, so this is a no-op and
    // we fall through to Metro below.
    if let embedded = Bundle.main.url(forResource: "main", withExtension: "jsbundle") {
      print("🔵 ReactNativeDelegate: using EMBEDDED main.jsbundle (no Metro)")
      return embedded
    }
    // Try RCTBundleURLProvider first
    var url = RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")

    // If nil, auto-detect Mac's IP for physical device debugging
    if url == nil {
      print("🔵 ReactNativeDelegate: RCTBundleURLProvider returned nil, detecting host IP")
      if let hostIP = Self.getHostIPAddress() {
        print("🔵 ReactNativeDelegate: Detected host IP: \(hostIP)")
        url = URL(string: "http://\(hostIP):8081/index.bundle?platform=ios&dev=true&minify=false")
      }
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
