// Print the payload of every QR code in an image, using macOS CoreImage.
//
// scripts/dev-wallet.js reads the WalletConnect pairing link off a simulator
// screenshot with this: AppKit's QR view has no copy-link button.
//
//   swift scripts/decode-qr.swift <image.png>
import CoreImage
import Foundation

guard CommandLine.arguments.count == 2 else {
  FileHandle.standardError.write("usage: swift decode-qr.swift <image>\n".data(using: .utf8)!)
  exit(2)
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let image = CIImage(contentsOf: url) else {
  FileHandle.standardError.write("cannot read image \(url.path)\n".data(using: .utf8)!)
  exit(1)
}
let detector = CIDetector(ofType: CIDetectorTypeQRCode, context: nil,
                          options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])!
for feature in detector.features(in: image) {
  if let qr = feature as? CIQRCodeFeature, let message = qr.messageString {
    print(message)
  }
}
