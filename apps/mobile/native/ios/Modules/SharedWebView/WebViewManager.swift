//
//  WebViewManager.swift
//  FollowNative
//
//  Created by Innei on 2025/1/31.
//
import SafariServices
import UIKit
@preconcurrency import WebKit

// Everything here runs on the main thread: the web view needs it, and the state is shared with
// the lifecycle callbacks there
@MainActor
enum WebViewManager {
  // Public observable state
  static let state = WebViewState()

  // Shared instance and lifecycle
  private(set) static var shared: WKWebView?
  private static weak var currentHost: UIView?
  private static var lifecycleObservers: [NSObjectProtocol] = []
  private static var destroyWorkItem: DispatchWorkItem?

  // Readiness and pending scripts
  private static var isReady = false
  private static var pendingJavaScripts: [String] = []

  // Last known URL and replayable state (dynamic key-value, like JS object)
  private static var lastURL: String?
  private static var lastState: [String: Any] = [:]

  // MARK: - Public API

  public static func initializeLifecycleObservers() {
    guard lifecycleObservers.isEmpty else { return }

    lifecycleObservers = [
      NotificationCenter.default.addObserver(
        forName: UIApplication.didEnterBackgroundNotification,
        object: nil,
        queue: .main
      ) { _ in
        MainActor.assumeIsolated { didEnterBackground() }
      },
      NotificationCenter.default.addObserver(
        forName: UIApplication.willEnterForegroundNotification,
        object: nil,
        queue: .main
      ) { _ in
        MainActor.assumeIsolated { willEnterForeground() }
      },
    ]
  }

  public static func cleanupLifecycleObservers() {
    // A block observer goes only with the token it was registered with
    for observer in lifecycleObservers {
      NotificationCenter.default.removeObserver(observer)
    }
    lifecycleObservers.removeAll()

    // Cancel any pending destroy work item
    destroyWorkItem?.cancel()
    destroyWorkItem = nil
  }

  public static func evaluateJavaScript(_ js: String) {
    DispatchQueue.main.async {
      // Queue until ready/loading completed
      guard let webView = shared, webView.url != nil, !webView.isLoading, isReady else {
        pendingJavaScripts.append(js)
        return
      }
      webView.evaluateJavaScript(js)
    }
  }

  public static func load(_ urlString: String) {
    DispatchQueue.main.async {
      lastURL = urlString
      let webView = getOrCreate()
      guard let url = URL(string: urlString) else { return }
      if webView.url == url && !webView.isLoading { return }
      isReady = false
      if url.scheme == "file" {
        if let localHtml = resolveLocalHTML(from: urlString) {
          webView.loadFileURL(
            localHtml, allowingReadAccessTo: localHtml.deletingLastPathComponent())
          debugPrint("load local html: \(localHtml.absoluteString)")
        } else {
          debugPrint("Invalid local html url: \(urlString)")
        }
      } else {
        webView.load(URLRequest(url: url))
        debugPrint("load remote html: \(url.absoluteString)")
      }
    }
  }

  /// Whether the main frame may show `url`: the bundled renderer, or the page `load` was given
  /// (the renderer's dev server)
  static func isRendererPage(_ url: URL) -> Bool {
    url.isFileURL || url.absoluteString == lastURL
  }

  public static func attach(to host: UIView) {
    DispatchQueue.main.async {
      let webView = getOrCreate()

      // Move from previous host if needed
      if webView.superview !== host {
        webView.removeFromSuperview()
        host.addSubview(webView)
      }
      currentHost = host
    }
  }

  public static func detach(from host: UIView) {
    DispatchQueue.main.async {
      guard currentHost === host else { return }
      currentHost = nil
      // Do not remove subview immediately; releasing is handled by background logic
    }
  }

  public static func updateFrame(_ rect: CGRect) {
    DispatchQueue.main.async {
      guard let webView = shared else { return }
      webView.frame = rect
      webView.scrollView.frame = rect
    }
  }

  public static func markReadyAndFlush() {
    DispatchQueue.main.async {
      isReady = true
      flushPendingScripts()
    }
  }

  public static func handleProcessTerminated() {
    DispatchQueue.main.async {
      // Try to reload last URL and replay state
      isReady = false
      if let urlString = lastURL {
        load(urlString)
      }
      replayState()
    }
  }

  // Generic state recorder
  public static func recordJSON(key: String, payload: String?) {
    guard let payload else {
      lastState[key] = NSNull()
      return
    }
    if let data = payload.data(using: .utf8),
      let obj = try? JSONSerialization.jsonObject(with: data)
    {
      lastState[key] = obj
    } else {
      // Store raw string if not valid JSON
      lastState[key] = payload
    }
  }

  // MARK: - Internals

  @discardableResult
  static func getOrCreate() -> WKWebView {
    if let webView = shared { return webView }
    state.setInitialContentHeightIfNeeded()
    let webView = FOWebView(frame: .zero, state: state)
    shared = webView
    return webView
  }

  private static func flushPendingScripts() {
    guard let webView = shared, webView.url != nil, !webView.isLoading, isReady else { return }
    let scripts = pendingJavaScripts
    pendingJavaScripts.removeAll()
    for js in scripts {
      webView.evaluateJavaScript(js)
    }
  }

  private static func replayState() {
    guard let json = buildStateJSON() else { return }
    let call =
      "(function(){ if (window.__FO_BRIDGE__ && typeof window.__FO_BRIDGE__.applyState === 'function') { window.__FO_BRIDGE__.applyState(JSON.parse(\(jsonString(json)))); } })()"
    pendingJavaScripts.append(call)
    flushPendingScripts()
  }

  private static func buildStateJSON() -> String? {
    guard JSONSerialization.isValidJSONObject(lastState) else {
      // Try to sanitize by converting non-JSON types to string
      var sanitized: [String: Any] = [:]
      for (k, v) in lastState {
        if JSONSerialization.isValidJSONObject([k: v]) {
          sanitized[k] = v
        } else {
          sanitized[k] = String(describing: v)
        }
      }
      if let data = try? JSONSerialization.data(withJSONObject: sanitized, options: []) {
        return String(data: data, encoding: .utf8)
      }
      return nil
    }
    if let data = try? JSONSerialization.data(withJSONObject: lastState, options: []) {
      return String(data: data, encoding: .utf8)
    }
    return nil
  }

  private static func jsonString(_ value: String) -> String {
    // Wrap as JSON string literal
    let data = try? JSONSerialization.data(withJSONObject: ["v": value], options: [])
    if let data = data, let s = String(data: data, encoding: .utf8) {
      // {"v":"..."}
      if let range = s.range(of: ":") {
        return String(s[range.upperBound..<s.index(before: s.endIndex)])
      }
    }
    // Fallback naive escaping
    let escaped = value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(
      of: "\"", with: "\\\"")
    return "\"\(escaped)\""
  }

  private static func didEnterBackground() {
    // If not attached to a host, schedule destroy to save memory
    guard currentHost == nil else { return }
    destroyWorkItem?.cancel()
    let work = DispatchWorkItem {
      MainActor.assumeIsolated { destroyWebView() }
    }
    destroyWorkItem = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 3.0, execute: work)
  }

  private static func willEnterForeground() {
    destroyWorkItem?.cancel()
    // Prewarm by recreating and loading lastURL
    if shared == nil {
      _ = getOrCreate()
      if let urlString = lastURL {
        load(urlString)
      }
      replayState()
    }
  }

  private static func destroyWebView() {
    guard let webView = shared else { return }
    isReady = false
    pendingJavaScripts.removeAll()
    cleanup(webView)
    shared = nil
  }

  private static func cleanup(_ webView: WKWebView) {
    webView.stopLoading()
    webView.navigationDelegate = nil
    webView.uiDelegate = nil
    if let fo = webView as? FOWebView {
      fo.configuration.userContentController.removeScriptMessageHandler(forName: "message")
    }
    webView.removeFromSuperview()

    debugPrint("destroy webview: \(debugState())")
  }

  // MARK: - Debug helpers
  public static func debugState() -> [String: Any] {
    var dict: [String: Any] = [:]
    dict["hasWebView"] = shared != nil
    dict["hasHost"] = currentHost != nil
    dict["ready"] = isReady
    dict["pending"] = pendingJavaScripts.count
    dict["lastURL"] = lastURL ?? NSNull()
    dict["contentHeight"] = Double(state.contentHeight)
    dict["keys"] = Array(lastState.keys)
    return dict
  }

  public static func destroyForDebug() {
    destroyWebView()
  }

  public static func reloadLastURL() {
    if let url = lastURL { load(url) }
  }

  public static func flushForDebug() {
    flushPendingScripts()
  }

  private static func resolveLocalHTML(from fileURL: String) -> URL? {
    // Map RN-provided file:// path to actual bundle resource url
    if let url = URL(string: fileURL), url.scheme == "file" {
      let directoryPath = url.deletingLastPathComponent().absoluteString.replacingOccurrences(
        of: "file://", with: "")
      let fileName = url.lastPathComponent
      let fileExtension = url.pathExtension
      if let fileURL = Bundle.main.url(
        forResource: String(fileName.dropLast(Int(fileExtension.count) + 1)),
        withExtension: fileExtension,
        subdirectory: directoryPath
      ) {
        return fileURL
      } else {
        return nil
      }
    }
    return nil
  }

  // The in-app browser shown last, closed before the app opens a link it is asked to open
  private static weak var presentedBrowser: SafariViewController?

  /// Opens an http(s) link in the in-app browser over the topmost screen, or any other link in the
  /// app that handles it. `onDismiss` runs once the browser closes, or right away when none opens.
  static func presentModalWebView(url: URL, onDismiss: @escaping () -> Void) {
    // SFSafariViewController raises an exception, which ends the app, for any URL that is not
    // http(s). Others, such as mailto: and tel:, belong to the apps that handle them; a URL
    // without a scheme, such as a relative link, cannot be opened at all.
    guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
      if url.scheme != nil {
        UIApplication.shared.open(url)
      }
      onDismiss()
      return
    }
    guard let presenter = Utils.topViewController() else {
      onDismiss()
      return
    }

    let safariVC = SafariViewController(url: url)
    safariVC.view.tintColor = Utils.accentColor
    safariVC.preferredControlTintColor = Utils.accentColor
    safariVC.setOnDismiss(onDismiss)
    presentedBrowser = safariVC
    presenter.present(safariVC, animated: true)
  }

  /// Closes the in-app browser when it is shown; `completion` gets whether it was. Screens the
  /// app presents meanwhile would only appear once the user closed it.
  static func dismissPresentedBrowser(completion: @escaping (Bool) -> Void) {
    guard let browser = presentedBrowser, browser.presentingViewController != nil else {
      completion(false)
      return
    }
    browser.dismiss(animated: true) {
      completion(true)
    }
  }
}

private class SafariViewController: SFSafariViewController {
  private var onDismiss: (() -> Void)?

  public func setOnDismiss(_ onDismiss: @escaping () -> Void) {
    self.onDismiss = onDismiss
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    onDismiss?()
  }
}
