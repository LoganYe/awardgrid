import UIKit
import WebKit
import Capacitor

/// The appearance chosen in the app's own Settings (System, Light or Dark) reaches the native side (UI/UX v1 T22; U-042).
///
/// Capacitor makes the web view this controller's view and paints its background `systemBackground`, which follows the
/// device's appearance, not the app's. That background shows around the page: below the tab bar, over the home
/// indicator, and when a page is pulled past its end, so a dark app had a white strip at the bottom and a light app a
/// black one. The page posts its chosen scheme and the colour of its bottom surface to `agAppearance` whenever either
/// changes (apps/ios/src/native/appearance.ts). This sets the window's interface style, so native parts such as the
/// keyboard follow the choice too, and paints the web view's background that colour. Nothing is stored here; the page
/// posts again at every launch.
class AppViewController: CAPBridgeViewController, WKScriptMessageHandler {
    static let messageName = "agAppearance"

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        // Until the page reports its own colour (below), the launch screen's: the app's canvas, light or dark
        // (Assets.xcassets LaunchBackground). Capacitor would paint the system background, white or black.
        if let canvas = UIColor(named: "LaunchBackground") {
            webView?.backgroundColor = canvas
            webView?.scrollView.backgroundColor = canvas
            webView?.underPageBackgroundColor = canvas
        }
        webView?.configuration.userContentController.add(self, name: Self.messageName)
        // "Connect seats.aero" in the OAuth flavour (SeatsAuthPlugin.swift). Registered in every flavour; only the OAuth
        // one calls it.
        bridge?.registerPluginInstance(SeatsAuthPlugin())
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == Self.messageName, let body = message.body as? [String: Any] else { return }
        switch body["scheme"] as? String {
        case "dark": view.window?.overrideUserInterfaceStyle = .dark
        case "light": view.window?.overrideUserInterfaceStyle = .light
        default: view.window?.overrideUserInterfaceStyle = .unspecified
        }
        if let r = body["r"] as? Double, let g = body["g"] as? Double, let b = body["b"] as? Double {
            let color = UIColor(red: r / 255, green: g / 255, blue: b / 255, alpha: 1)
            webView?.backgroundColor = color
            webView?.scrollView.backgroundColor = color
            webView?.underPageBackgroundColor = color
        }
        setNeedsStatusBarAppearanceUpdate()
    }
}
