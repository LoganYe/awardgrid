import Foundation
import AuthenticationServices
import Capacitor

/// "Connect seats.aero" in the OAuth flavour (release plan step 18b): seats.aero's own sign-in and consent page, in the
/// system's authentication sheet.
///
/// The page calls `SeatsAuth.authorize({ url })` (apps/ios/src/oauth/seats-auth-plugin.ts) with seats.aero's consent
/// URL. The sheet opens it, seats.aero redirects to the token service's callback, and the service redirects to
/// `com.dowhiz.awardgrid://oauth/seats?code=…&state=…`, which the sheet catches and hands back as the call's `url`. The
/// state check, the code exchange and the Keychain are the page's (connect.ts); this file only opens and closes the
/// sheet. `prefersEphemeralWebBrowserSession` is false, so a person already signed in to seats.aero in Safari is not
/// asked to sign in again. Nothing is stored or logged here.
@objc(SeatsAuthPlugin)
public class SeatsAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "SeatsAuthPlugin"
    public let jsName = "SeatsAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise)
    ]

    /// The scheme the sheet listens for: the app's bundle identifier, which no other app can claim for it.
    static let callbackURLScheme = "com.dowhiz.awardgrid"

    /// The sheet while it is open. One at a time.
    private var session: ASWebAuthenticationSession?

    @objc func authorize(_ call: CAPPluginCall) {
        // Only seats.aero's consent page, over HTTPS: the sheet is never pointed anywhere else.
        guard let raw = call.getString("url"),
              let url = URL(string: raw),
              url.scheme == "https",
              url.host == "seats.aero",
              url.path == "/oauth2/consent" else {
            call.reject("The sign-in address must be seats.aero's consent page.", "invalid_url")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                call.reject("The seats.aero sign-in could not open.", "failed")
                return
            }
            guard self.session == nil else {
                call.reject("A seats.aero sign-in is already open.", "busy")
                return
            }
            let session = ASWebAuthenticationSession(url: url, callback: .customScheme(Self.callbackURLScheme)) { [weak self] callbackURL, error in
                self?.session = nil
                if let callbackURL = callbackURL {
                    call.resolve(["url": callbackURL.absoluteString])
                } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    call.reject("The seats.aero sign-in was closed.", "canceled")
                } else {
                    call.reject("The seats.aero sign-in did not finish.", "failed", error)
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                self.session = nil
                call.reject("The seats.aero sign-in could not open.", "failed")
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
}
