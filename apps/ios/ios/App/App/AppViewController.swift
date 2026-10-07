import UIKit
import WebKit
import Capacitor

/// The app's bridge controller: the page's safe area (PR-D) and the appearance chosen in Settings (T22; U-042).
///
/// **Safe area.** The page lays itself out under the status bar and the home indicator (`viewport-fit=cover` in
/// index.html) and pads its own chrome with `env(safe-area-inset-*)`. So the web view's scroll view must not inset
/// the page as well: `contentInsetAdjustmentBehavior` is `.never` here and `ios.contentInset` is "never" in
/// capacitor.config.ts. With "always" both happened. The page is exactly one screen tall (its shell is 100dvh and
/// scrolls inside), so the extra inset made the web view scrollable by the inset's height, and where WebKit left it
/// depended on launch timing: at one end the inset came on top of the page's own padding (a 62 pt empty band above
/// a title on an iPhone, and 34 pt more under the tab bar), at the other the page sat a full inset higher (on an
/// iPad in a window, the title under the window controls on the first launch after an install).
///
/// **Window controls (iPadOS 26 and later).** In a window, the close/minimise/resize controls sit in the top-leading
/// corner, below the status bar, and the plain safe area does not include them: the window's safe area top is 32 pt
/// while the controls reach 75 pt (measured on an iPad Air 11-inch M3, iPadOS 27, this iPhone app in a window).
/// UIKit reports that corner through the corner-adapted safe area, and this adds the difference to the controller's
/// `additionalSafeAreaInsets`, so the web view's safe area, and with it the page's `env(safe-area-inset-top)`,
/// starts below the controls. It is read from the window, whose safe area never includes this controller's
/// additions, so setting it cannot feed back into the next reading. On an iPhone in portrait and on iOS 18 the
/// difference is 0 and nothing changes. An iPhone in landscape on iOS 26 reports 18 pt for its rounded corners
/// (measured on iOS 26.5: env(safe-area-inset-top) 18 there, 0 before), which only adds that much space above a
/// header where the status bar is hidden; the page pads the side insets (62 pt) itself.
///
/// **Appearance.** Capacitor makes the web view this controller's view and paints its background `systemBackground`,
/// which follows the device's appearance, not the app's. That background shows around the page: below the tab bar,
/// over the home indicator, and when a page is pulled past its end, so a dark app had a white strip at the bottom and
/// a light app a black one. The page posts its chosen scheme and the colour of its bottom surface to `agAppearance`
/// whenever either changes (apps/ios/src/native/appearance.ts). This sets the window's interface style, so native
/// parts such as the keyboard follow the choice too, and paints the web view's background that colour. Nothing is
/// stored here; the page posts again at every launch.
class AppViewController: CAPBridgeViewController, WKScriptMessageHandler {
    static let messageName = "agAppearance"

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        // The page pads itself (above). Also set in capacitor.config.ts; set here too so a stale generated
        // capacitor.config.json can never bring the double inset back.
        webView?.scrollView.contentInsetAdjustmentBehavior = .never
        // Until the page reports its own colour (below), the launch screen's: the app's canvas, light or dark
        // (Assets.xcassets LaunchBackground). Capacitor would paint the system background, white or black.
        if let canvas = UIColor(named: "LaunchBackground") {
            webView?.backgroundColor = canvas
            webView?.scrollView.backgroundColor = canvas
            webView?.underPageBackgroundColor = canvas
        }
        webView?.configuration.userContentController.add(self, name: Self.messageName)
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        updateWindowControlsInset()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        updateWindowControlsInset()
    }

    /// How far the window controls reach below the window's plain safe area, added to this controller's safe area
    /// (see the type's comment). 0 where there are no window controls.
    private func updateWindowControlsInset() {
        var extra: CGFloat = 0
        if #available(iOS 26.0, *), let window = view.window {
            let cornerAdapted = window.edgeInsets(for: .safeArea(cornerAdaptation: .vertical)).top
            extra = max(0, cornerAdapted - window.safeAreaInsets.top)
        }
        if additionalSafeAreaInsets.top != extra {
            additionalSafeAreaInsets.top = extra
        }
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
