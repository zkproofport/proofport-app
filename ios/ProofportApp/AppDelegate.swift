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
      withModuleName: "ZKProofport",
      in: window,
      launchOptions: launchOptions
    )

    print("🔵 AppDelegate: React Native started with module: ZKProofport")
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
